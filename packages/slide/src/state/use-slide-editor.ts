"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SlideCommand, SlideCommandResult, SlideDeck, SlideElement } from "../model/types";
import type { SlideEvent, SlideProps, SlideSelection } from "../props";
import { applySlideCommands, normalizeSlideDeck, parseSlideDeck, serializeSlideDeck, SLIDE_LIMITS } from "../model/index";
import { getDeck, getSlides, getSlide, getElements, getElement, getAnimations } from "../model/query";
import type { SlidePptxExportOptions } from "../export/types";
import { createSlideSession } from "../session/create-slide-session";
import { awaitSlideImageTask, throwIfSlideImageAborted } from "../render/async";
import type { SlideImageExportOptions, SlideImagesExportOptions } from "../render/browser-export";
import type { SlideImageCommonOptions } from "../render/types";

const featureDefaults = {
  addSlides: true, deleteSlides: true, reorderSlides: true, text: true, shapes: true, images: true,
  formatting: true, animations: true, notes: true, import: true, export: true, presentation: true, history: true,
};
export type SlideFeatureState = typeof featureDefaults;
export type SlideNotice = { kind: "info" | "error" | "success"; text: string } | null;
const copy = <T,>(value: T): T => structuredClone(value);

function permitted(command: SlideCommand, features: SlideFeatureState, deck: SlideDeck): boolean {
  if (command.type === "animation.set" || command.type === "animation.remove") return features.animations;
  if (command.type === "slide.add" && command.slide?.animations?.length && !features.animations) return false;
  if (command.type === "slide.add" || command.type === "slide.duplicate") return features.addSlides;
  if (command.type === "slide.delete") return features.deleteSlides;
  if (command.type === "slide.move") return features.reorderSlides;
  if (command.type === "deck.resize") return features.formatting;
  if (command.type === "slide.update") return (!Object.hasOwn(command.patch, "notes") || features.notes) &&
    (!Object.hasOwn(command.patch, "background") || features.formatting);
  if (command.type === "element.add") return features[command.element.type === "shape" ? "shapes" : command.element.type === "image" ? "images" : "text"];
  if (command.type === "element.duplicate") return command.elementIds.every(id => {
    const element = deck.slides.find(slide => slide.id === command.slideId)?.elements.find(item => item.id === id);
    return !element || features[element.type === "shape" ? "shapes" : element.type === "image" ? "images" : "text"];
  });
  if (command.type === "element.update") return Object.keys(command.patch).every(key =>
    key === "text" ? features.text : key === "alt" || key === "name" || features.formatting);
  if (command.type === "element.order") return features.formatting;
  return true;
}

/** UI orchestration only. Persistent edits and history belong to the headless session. */
export function useSlideEditor(props: SlideProps) {
  const [session] = useState(() => createSlideSession(props.initialDeck));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const propsRef = useRef(props);
  useLayoutEffect(() => { propsRef.current = props; });
  const mounted = useRef(true);
  const [selection, setSelection] = useState<SlideSelection>(() => ({ slideId: snapshot.deck.slides[0]?.id ?? "", elementIds: [] }));
  const selectionRef = useRef(selection);
  const slideSelectionVersion = useRef(0);
  useLayoutEffect(() => { selectionRef.current = selection; }, [selection]);
  const [notice, setNotice] = useState<SlideNotice>(null);
  const [busy, setBusy] = useState<"save" | "import" | "export" | null>(null);
  const busyRef = useRef(false);
  const snapshotPending = useRef(false);
  const mutations = useRef(new Set<Promise<unknown>>());
  const inputRegistration = useRef<{ flush: () => void; pending: () => boolean; reset?: () => void } | null>(null);
  const [inputPending, setInputPending] = useState(false);
  const operationGeneration = useRef(0);
  const selectionPast = useRef<SlideSelection[]>([]), selectionFuture = useRef<SlideSelection[]>([]);
  const [requesting, setRequesting] = useState(false);
  const permission = useRef<{ granted: boolean; controller: AbortController | null; promise: Promise<boolean> | null }>({ granted: false, controller: null, promise: null });
  const clipboard = useRef<SlideElement[]>([]);
  const imageExports = useRef(new Set<AbortController>());
  const features = { ...featureDefaults, ...props.features };
  const readOnly = props.readOnly ?? !props.onSave;
  const [wasReadOnly, setWasReadOnly] = useState(readOnly);
  if (wasReadOnly !== readOnly) {
    setWasReadOnly(readOnly);
    if (readOnly) setInputPending(false);
  }
  const dirty = snapshot.dirty || inputPending;
  const refreshPendingInput = useCallback(() => {
    const pending = inputRegistration.current?.pending() ?? false;
    // Blur begins an async command before its input buffer disappears. Keep the
    // dirty signal until that command commits or is rejected.
    setInputPending(previous => pending || (previous && mutations.current.size > 0));
  }, []);

  const emit = useCallback((event: SlideEvent) => {
    if (!mounted.current) return;
    try { void Promise.resolve(propsRef.current.onEvent?.(copy(event))).catch(() => {}); } catch { /* Observer errors do not undo completed edits. */ }
  }, []);
  const reportError = useCallback((error: unknown) => {
    if (mounted.current) setNotice({ kind: "error", text: error instanceof Error ? error.message : "操作を完了できませんでした。" });
  }, []);
  const invalidateOperations = useCallback(() => { operationGeneration.current++; }, []);
  const endEdit = useCallback(() => {
    invalidateOperations();
    permission.current.controller?.abort();
    permission.current = { granted: false, controller: null, promise: null };
    if (mounted.current) setRequesting(false);
    emit({ type: "edit-mode", mode: "view" });
  }, [emit, invalidateOperations]);
  useEffect(() => {
    mounted.current = true;
    const exports = imageExports.current;
    return () => { mounted.current = false; invalidateOperations(); permission.current.controller?.abort(); for (const controller of exports) controller.abort(); };
  }, [invalidateOperations]);
  useLayoutEffect(() => {
    if (props.features?.export === false) for (const controller of imageExports.current)
      controller.abort(new Error("エクスポート機能は無効です。"));
  }, [props.features?.export]);
  useEffect(() => { if (readOnly) { inputRegistration.current?.reset?.(); endEdit(); } }, [readOnly, endEdit]);

  const authorize = useCallback(async () => {
    const current = propsRef.current;
    if ((current.readOnly ?? !current.onSave) || busyRef.current || !mounted.current) return false;
    if (permission.current.granted) return true;
    if (permission.current.promise) return permission.current.promise;
    const controller = new AbortController();
    const state = { granted: false, controller, promise: null as Promise<boolean> | null };
    permission.current = state;
    setRequesting(true);
    emit({ type: "edit-mode", mode: "requesting" });
    state.promise = (async () => {
      try {
        const allowed = await awaitSlideImageTask(() => current.onEditRequest?.({ deck: copy(session.getSnapshot().deck) }, {
          requestId: crypto.randomUUID(), signal: controller.signal,
        }) ?? true, controller.signal);
        if (controller.signal.aborted || !mounted.current || (propsRef.current.readOnly ?? !propsRef.current.onSave)) return false;
        state.granted = allowed;
        if (!allowed) setNotice({ kind: "info", text: "他のユーザーが編集中のため変更できません。" });
        emit({ type: "edit-mode", mode: allowed ? "edit" : "view" });
        return allowed;
      } catch (error) { if (!controller.signal.aborted) reportError(error); return false; }
      finally { if (permission.current === state) { state.promise = null; if (mounted.current) setRequesting(false); } }
    })();
    return state.promise;
  }, [emit, reportError, session]);

  const select = useCallback((next: SlideSelection) => {
    const slide = session.getSnapshot().deck.slides.find(item => item.id === next.slideId);
    if (!slide) return;
    const value = { slideId: slide.id, elementIds: [...new Set(next.elementIds)].filter(id => slide.elements.some(item => item.id === id)) };
    if (selectionRef.current.slideId !== value.slideId) slideSelectionVersion.current++;
    selectionRef.current = value;
    setSelection(value);
    try { propsRef.current.onSelectionChange?.(copy(value)); } catch { /* Selection stays valid even if an observer fails. */ }
  }, [session]);
  useEffect(() => {
    const current = selectionRef.current;
    const slide = snapshot.deck.slides.find(item => item.id === current.slideId) ?? snapshot.deck.slides[0];
    if (!slide) { if (current.slideId || current.elementIds.length) setSelection({ slideId: "", elementIds: [] }); return; }
    if (slide.id !== current.slideId || current.elementIds.some(id => !slide.elements.some(item => item.id === id))) {
      select({ slideId: slide.id, elementIds: current.elementIds });
    }
  }, [snapshot.deck, select]);
  useEffect(() => { try { propsRef.current.onDirtyChange?.(dirty); } catch { /* Dirty state is already committed. */ } }, [dirty]);
  const previousDeck = useRef(snapshot.deck);
  useEffect(() => {
    if (previousDeck.current === snapshot.deck) return;
    previousDeck.current = snapshot.deck;
    try { propsRef.current.onChange?.(copy(snapshot.deck)); } catch { /* Observers do not affect the session. */ }
  }, [snapshot.deck]);

  const track = useCallback(<T,>(task: Promise<T>): Promise<T> => {
    mutations.current.add(task);
    const settled = () => { mutations.current.delete(task); if (mounted.current) refreshPendingInput(); };
    void task.then(settled, settled);
    return task;
  }, [refreshPendingInput]);
  const rememberSelection = useCallback((previous: SlideSelection) => {
    selectionPast.current.push(copy(previous));
    if (selectionPast.current.length > 100) selectionPast.current.shift();
    selectionFuture.current = [];
  }, []);
  const registerInputFlush = useCallback((flush: () => void, pending: () => boolean = () => false, reset?: () => void) => {
    const registration = { flush, pending, reset };
    inputRegistration.current = registration;
    return () => { if (inputRegistration.current === registration) inputRegistration.current = null; };
  }, []);
  const runCommands = useCallback(async (command: SlideCommand | readonly SlideCommand[], expectedDeck?: SlideDeck, expectedSlideId?: string, expectedSlideVersion?: number): Promise<SlideCommandResult | null> => {
    const generation = operationGeneration.current;
    const commands = Array.isArray(command) ? command : [command];
    const activeFeatures = { ...featureDefaults, ...propsRef.current.features };
    try {
      const deck = session.getSnapshot().deck;
      if (expectedDeck && deck !== expectedDeck || expectedSlideId && selectionRef.current.slideId !== expectedSlideId ||
        expectedSlideVersion !== undefined && slideSelectionVersion.current !== expectedSlideVersion) return null;
      if (!commands.every(item => permitted(item, activeFeatures, deck))) return null;
      if (!applySlideCommands(deck, commands).changed) return null;
      // With permission already granted, commit synchronously so consecutive
      // input/API edits build on each other. An actual permission wait must not
      // replay a drag against a deck changed while pending. The optional
      // baseline is internal to gestures; ordinary queued API edits keep their
      // existing latest-deck semantics, including geometry commands.
      if (!permission.current.granted && !await authorize()) return null;
      if (busyRef.current || !mounted.current || generation !== operationGeneration.current ||
        (propsRef.current.readOnly ?? !propsRef.current.onSave) || expectedDeck && session.getSnapshot().deck !== expectedDeck ||
        expectedSlideId && selectionRef.current.slideId !== expectedSlideId ||
        expectedSlideVersion !== undefined && slideSelectionVersion.current !== expectedSlideVersion) return null;
      const latestFeatures = { ...featureDefaults, ...propsRef.current.features };
      if (!commands.every(item => permitted(item, latestFeatures, session.getSnapshot().deck))) return null;
      const previous = copy(selectionRef.current);
      const before = session.getSnapshot().deck;
      const result = session.execute(commands);
      if (result.changed) {
        rememberSelection(previous);
        const targetSlideId = result.slideId ?? previous.slideId;
        const target = result.deck.slides.find(item => item.id === targetSlideId);
        const oldIds = new Set(before.slides.find(item => item.id === targetSlideId)?.elements.map(item => item.id));
        const addedIds = target?.elements.filter(item => !oldIds.has(item.id)).map(item => item.id) ?? [];
        const preservesSelection = commands.every(item => ["element.update", "element.order", "slide.update", "slide.move", "deck.rename", "deck.resize"].includes(item.type));
        select(preservesSelection ? previous : { slideId: targetSlideId, elementIds: addedIds.length ? addedIds : previous.slideId === targetSlideId ? previous.elementIds : result.elementIds });
        emit({ type: "change", source: "command", deck: result.deck });
      }
      return result;
    } catch (error) { reportError(error); return null; }
  }, [authorize, emit, rememberSelection, reportError, select, session]);
  const execute = useCallback((command: SlideCommand | readonly SlideCommand[], expectedDeck?: SlideDeck) =>
    snapshotPending.current ? Promise.resolve(null) : track(runCommands(command, expectedDeck)), [runCommands, track]);
  const prepareCommands = useCallback((prepare: () => Promise<SlideCommand | readonly SlideCommand[]>, target?: { deck: SlideDeck; slideId: string }) => {
    if (snapshotPending.current || busyRef.current || !mounted.current) return Promise.resolve(null);
    if (target && (session.getSnapshot().deck !== target.deck || selectionRef.current.slideId !== target.slideId)) return Promise.resolve(null);
    const generation = operationGeneration.current;
    const targetVersion = target ? slideSelectionVersion.current : undefined;
    return track((async () => {
      try { const commands = await prepare(); return mounted.current && generation === operationGeneration.current ? await runCommands(commands, target?.deck, target?.slideId, targetVersion) : null; }
      catch (error) { reportError(error); return null; }
    })());
  }, [reportError, runCommands, session, track]);

  const history = useCallback((direction: "undo" | "redo") => {
    if (snapshotPending.current || propsRef.current.features?.history === false || !session.getSnapshot()[direction === "undo" ? "canUndo" : "canRedo"]) return Promise.resolve(false);
    return track((async () => {
    if (!await authorize() || busyRef.current || !mounted.current) return false;
    const previous = copy(selectionRef.current);
    const changed = session[direction]();
    if (changed) {
      const source = direction === "undo" ? selectionPast : selectionFuture;
      const destination = direction === "undo" ? selectionFuture : selectionPast;
      const next = source.current.pop(); destination.current.push(previous);
      if (next) select(next);
      emit({ type: "change", source: direction, deck: session.getSnapshot().deck });
    }
    return !!changed;
    })());
  }, [authorize, emit, select, session, track]);
  const withSnapshot = useCallback(async <T,>(kind: "save" | "export", consume: (deck: SlideDeck) => Promise<T>, signal?: SlideImageCommonOptions["signal"]): Promise<T | null> => {
    throwIfSlideImageAborted(signal);
    if (busyRef.current || snapshotPending.current || !mounted.current) return null;
    // Flush before reserving the operation so the input's blur command can join
    // the pending mutations. Existing commands may finish; new edits are blocked.
    inputRegistration.current?.flush();
    if (busyRef.current || snapshotPending.current || !mounted.current) return null;
    snapshotPending.current = true; setBusy(kind);
    try {
      await awaitSlideImageTask(() => Promise.all([...mutations.current]), signal);
      throwIfSlideImageAborted(signal);
      if (!mounted.current) return null;
      busyRef.current = true;
      return await awaitSlideImageTask(() => consume(copy(session.getSnapshot().deck)), signal);
    } finally { busyRef.current = false; snapshotPending.current = false; if (mounted.current) setBusy(null); }
  }, [session]);
  const save = useCallback(async () => {
    const current = propsRef.current;
    const onSave = current.onSave;
    if (!onSave || (current.readOnly ?? !onSave)) return false;
    try {
      return await withSnapshot("save", async deck => {
        if ((propsRef.current.readOnly ?? !propsRef.current.onSave) || !session.getSnapshot().dirty) return false;
        emit({ type: "save", phase: "start" });
        if (await current.onBeforeSave?.(copy(deck)) === false) { emit({ type: "save", phase: "cancelled" }); return false; }
        if (!mounted.current || (propsRef.current.readOnly ?? !propsRef.current.onSave)) return false;
        const saved = await onSave(copy(deck));
        if (!mounted.current) return false;
        session.markSaved(saved ? normalizeSlideDeck(saved) : deck);
        endEdit();
        setNotice({ kind: "success", text: "保存しました。" });
        emit({ type: "save", phase: "success" });
        return true;
      }) ?? false;
    } catch (error) {
      reportError(error); emit({ type: "save", phase: "error", error: error instanceof Error ? error.message : "保存に失敗しました。" }); return false;
    }
  }, [emit, endEdit, reportError, session, withSnapshot]);
  const discard = useCallback(() => {
    if (busyRef.current || snapshotPending.current) return;
    const input = inputRegistration.current;
    if (input?.reset) input.reset(); else input?.flush();
    endEdit(); // Invalidates the blur command before it can mutate the discarded deck.
    session.discard(); selectionPast.current = []; selectionFuture.current = []; setInputPending(false);
  }, [endEdit, session]);

  const importDeck = useCallback(async (loader: () => Promise<{ deck: SlideDeck; warnings: readonly string[] }>) => {
    const importEnabled = () => propsRef.current.features?.import !== false;
    if (snapshotPending.current || busyRef.current || !mounted.current || !importEnabled() || (propsRef.current.readOnly ?? !propsRef.current.onSave)) return;
    const generation = operationGeneration.current;
    // Preserve an in-progress edit in the history before replacing its document.
    inputRegistration.current?.flush();
    if (snapshotPending.current || busyRef.current || !mounted.current) return;
    snapshotPending.current = true; setBusy("import");
    const applicable = () => mounted.current && generation === operationGeneration.current &&
      !(propsRef.current.readOnly ?? !propsRef.current.onSave) && importEnabled();
    try {
      await Promise.all([...mutations.current]);
      if (!applicable() || !await authorize() || !applicable()) return;
      busyRef.current = true;
      const result = await loader();
      if (!applicable()) return;
      const before = session.getSnapshot().deck;
      const previous = copy(selectionRef.current);
      session.replace(result.deck, { saved: false });
      const changed = session.getSnapshot().deck !== before;
      if (changed) rememberSelection(previous);
      if (result.deck.slides[0]) select({ slideId: result.deck.slides[0].id, elementIds: [] });
      setNotice({ kind: result.warnings.length ? "info" : "success", text: result.warnings.length ? `読み込みました。${result.warnings.join(" ")}` : "読み込みました。" });
      emit({ type: "import", warnings: result.warnings });
      if (changed) emit({ type: "change", source: "import", deck: session.getSnapshot().deck });
    } catch (error) { reportError(error); }
    finally { busyRef.current = false; snapshotPending.current = false; if (mounted.current) setBusy(null); }
  }, [authorize, emit, rememberSelection, reportError, select, session]);
  const importPptx = useCallback(async (input: Blob | ArrayBuffer | Uint8Array) => {
    await importDeck(async () => (await import("../import/import-pptx")).importSlidePptx(input));
  }, [importDeck]);
  const importNative = useCallback(async (input: string | Blob) => {
    await importDeck(async () => {
      // UTF-8 can use three bytes per JavaScript string code unit. The parser
      // separately enforces jsonLength after decoding, including ASCII files.
      if (typeof input !== "string" && input.size > SLIDE_LIMITS.jsonLength * 3) throw new Error("LikeSlideファイルが大きすぎます。");
      return { deck: parseSlideDeck(typeof input === "string" ? input : await input.text()), warnings: [] };
    });
  }, [importDeck]);
  const exportFile = useCallback(async (format: "pptx" | "slon", options?: SlidePptxExportOptions) => {
    const exportEnabled = () => propsRef.current.features?.export !== false;
    if (!exportEnabled()) throw new Error("エクスポート機能は無効です。");
    const result = await withSnapshot("export", async deck => {
      if (!exportEnabled()) throw new Error("エクスポート機能は無効です。");
      const warnings: string[] = [];
      const blob = format === "pptx" ? await (await import("../export/export-pptx")).exportSlidePptx(deck, { onWarning: warning => {
        warnings.push(warning); options?.onWarning?.(warning);
      } })
        : new Blob([serializeSlideDeck(deck)], { type: "application/json" });
      if (!mounted.current) return null;
      if (!exportEnabled()) throw new Error("エクスポート機能は無効です。");
      const filename = (propsRef.current.exportFileName ?? deck.title ?? "presentation").replace(/\.(pptx|slon|json)$/i, "") || "presentation";
      return { blob, filename: `${filename}.${format}`, warnings };
    });
    if (!result) throw new Error("別の処理中、または画面が閉じられたためエクスポートできませんでした。");
    return result;
  }, [withSnapshot]);
  const exportPptx = useCallback(async (options?: SlidePptxExportOptions) => {
    const result = await exportFile("pptx", options);
    if (result.warnings.length) setNotice({ kind: "info", text: result.warnings.join(" ") });
    return result.blob;
  }, [exportFile]);
  const exportNative = useCallback(async () => (await exportFile("slon")).blob, [exportFile]);
  const withImageSnapshot = useCallback(async <T,>(signal: SlideImageCommonOptions["signal"], consume: (deck: SlideDeck, signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (propsRef.current.features?.export === false) throw new Error("エクスポート機能は無効です。");
    throwIfSlideImageAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    imageExports.current.add(controller);
    try {
      const result = await withSnapshot("export", async deck => {
        if (propsRef.current.features?.export === false) throw new Error("エクスポート機能は無効です。");
        const rendered = await consume(deck, controller.signal);
        throwIfSlideImageAborted(controller.signal);
        return rendered;
      }, controller.signal);
      if (result === null) throw new Error("別の処理中、または画面が閉じられたため画像を取得できませんでした。");
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      imageExports.current.delete(controller);
    }
  }, [withSnapshot]);
  const exportImage = useCallback((options: SlideImageExportOptions) => {
    const { renderer, signal, ...target } = options;
    const captured = copy(target);
    return withImageSnapshot(signal, async (deck, signal) => (await import("../render/browser-export")).exportImage(deck, { ...captured, renderer, signal }));
  }, [withImageSnapshot]);
  const exportImages = useCallback((options: SlideImagesExportOptions = {}) => {
    const { renderer, signal, ...target } = options;
    const captured = copy(target);
    return withImageSnapshot(signal, async (deck, signal) => (await import("../render/browser-export")).exportImages(deck, { ...captured, renderer, signal }));
  }, [withImageSnapshot]);
  const download = useCallback(async (format: "pptx" | "slon", document: Document) => {
    const exportEnabled = () => propsRef.current.features?.export !== false;
    if (!exportEnabled()) return;
    try {
      const { blob, filename, warnings } = await exportFile(format);
      if (!mounted.current || !exportEnabled()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (warnings.length) setNotice({ kind: "info", text: warnings.join(" ") });
    } catch (error) { reportError(error); }
  }, [exportFile, reportError]);

  const copyElements = useCallback(() => {
    const current = selectionRef.current;
    clipboard.current = copy(session.getSnapshot().deck.slides.find(slide => slide.id === current.slideId)?.elements.filter(element => current.elementIds.includes(element.id)) ?? []);
    if (clipboard.current.length) setNotice({ kind: "info", text: `${clipboard.current.length} 個のオブジェクトをコピーしました。` });
  }, [session]);
  const canPasteElements = useCallback(() => {
    const activeFeatures = { ...featureDefaults, ...propsRef.current.features };
    return clipboard.current.length > 0 && clipboard.current.every(element =>
      activeFeatures[element.type === "shape" ? "shapes" : element.type === "image" ? "images" : "text"]);
  }, []);
  const pasteElements = useCallback(async (slideId = selectionRef.current.slideId, expectedDeck?: SlideDeck) => {
    if (!slideId || !clipboard.current.length) return;
    const commands: SlideCommand[] = clipboard.current.map(element => ({ type: "element.add", slideId,
      element: { ...copy(element), id: crypto.randomUUID(), x: element.x + 20, y: element.y + 20 } }));
    await execute(commands, expectedDeck);
  }, [execute]);

  useImperativeHandle(props.ref, () => ({
    getDeck: options => copy(getDeck(session.getSnapshot().deck, options)),
    getSlides: options => copy(getSlides(session.getSnapshot().deck, options)),
    getSlide: (slideId, options) => copy(getSlide(session.getSnapshot().deck, slideId, options)),
    getElements: (slideId, options) => copy(getElements(session.getSnapshot().deck, slideId, options)),
    getElement: (slideId, elementId, options) => copy(getElement(session.getSnapshot().deck, slideId, elementId, options)),
    getAnimations: slideId => copy(getAnimations(session.getSnapshot().deck, slideId)),
    execute: command => execute(command),
    undo: () => history("undo"), redo: () => history("redo"), save, discard,
    getSelection: () => copy(selectionRef.current), select, importNative, exportNative, importPptx, exportPptx, exportImage, exportImages,
  }), [discard, execute, exportNative, exportPptx, exportImage, exportImages, history, importNative, importPptx, save, select, session]);

  return { ...snapshot, dirty, selection, select, execute, save, discard, history, importPptx, importNative, exportImage, exportImages, download,
    copyElements, pasteElements, canPasteElements, prepareCommands, registerInputFlush, refreshPendingInput, notice, setNotice, reportError, features, readOnly, busy, requesting,
    editable: !readOnly && !busy && !requesting };
}

export type SlideEditor = ReturnType<typeof useSlideEditor>;
