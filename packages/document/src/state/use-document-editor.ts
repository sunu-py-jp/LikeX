"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DocumentCommand, DocumentCommandResult, DocumentModel } from "../model/types";
import type { DocumentEvent, DocumentImportOptions, DocumentProps, DocumentSelection } from "../props";
import { DOCUMENT_LIMITS, executeDocumentCommands, getDocumentPage, normalizeDocument, parseDocument, serializeDocument } from "../model/index";
import { record } from "../model/validation";
import { createDocumentSession } from "../session/create-document-session";
import { importDocumentDocx, exportDocumentDocx } from "../io/index";
import { assertDocumentFeatures, resolveDocumentFeatures } from "./document-features";

import { useDocumentSearch } from "./use-document-search";
import { useDocumentRibbon } from "./use-document-ribbon";

type BusyKind = "save" | "import" | "export" | "permission";
type Operation = { id: number; epoch: number; signal: AbortSignal };
const pagePosition = (document: DocumentModel, pageNumber: number) => {
  const page = getDocumentPage(document, pageNumber);
  if (!page) throw new Error(`明示的な改ページで区切られた${pageNumber}ページ目がありません。`);
  return page.from;
};
export function useDocumentEditor(props: DocumentProps) {
  const ribbon = useDocumentRibbon(props);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const [initial] = useState(() => {
    const session = createDocumentSession(props.initialDocument);
    try {
      const position = props.initialPageNumber === undefined ? undefined : pagePosition(session.getSnapshot().document, props.initialPageNumber);
      if (position !== undefined) session.select({ from: position, to: position });
      return { session, position };
    } catch (cause) { return { session, error: cause instanceof Error ? cause.message : "ページを表示できません。" }; }
  });
  const session = initial.session;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(() => initial.error ? { kind: "error", text: initial.error } : null);
  const [pageReveal, setPageReveal] = useState<{ document: DocumentModel; position: number } | null>(() => initial.position === undefined ? null : { document: session.getSnapshot().document, position: initial.position });
  const control = useRef({ mounted: true, busy: false, kind: null as BusyKind | null, edit: false, epoch: 0, operationId: 0, abort: new AbortController() });
  const readOnly = props.readOnly === true || !props.onSave;
  const features = resolveDocumentFeatures(props.features);
  const policy = JSON.stringify({ ...features, search: undefined });
  const emit = useCallback((event: DocumentEvent) => { if (!control.current.mounted) return; try { void Promise.resolve(latest.current.onEvent?.(event)).catch(() => {}); } catch { /* Observers cannot roll back an operation. */ } }, []);
  function error(value: unknown) { if (control.current.mounted) setNotice({ kind: "error", text: value instanceof Error ? value.message : "処理に失敗しました。" }); }
  function writable() { return control.current.mounted && !latest.current.readOnly && !!latest.current.onSave; }
  function notifyChange(source: "command" | "import" | "undo" | "redo" | "save") {
    if (!control.current.mounted) return;
    const document = session.getSnapshot().document;
    try { latest.current.onChange?.(document); } catch { /* Host observer only. */ }
    emit({ type: "change", source, document });
  }
  function reserve(kind: BusyKind): Operation {
    const state = control.current;
    state.busy = true; state.kind = kind; setBusy(kind);
    return { id: ++state.operationId, epoch: state.epoch, signal: state.abort.signal };
  }
  function current(operation: Operation) {
    const state = control.current;
    return state.mounted && state.operationId === operation.id && state.epoch === operation.epoch && !operation.signal.aborted;
  }
  function release(operation: Operation) {
    const state = control.current;
    if (state.operationId !== operation.id) return;
    state.busy = false; state.kind = null;
    if (state.mounted) setBusy(null);
  }
  function endEdit() {
    const state = control.current;
    state.edit = false; state.abort.abort(); state.abort = new AbortController();
    emit({ type: "edit-mode", mode: "view" });
  }
  const invalidate = useCallback(() => {
    const state = control.current;
    const hadEdit = state.edit || state.kind === "permission";
    state.epoch++; state.operationId++; state.busy = false; state.kind = null; state.edit = false;
    state.abort.abort(); state.abort = new AbortController();
    if (state.mounted) { setBusy(null); if (hadEdit) emit({ type: "edit-mode", mode: "view" }); }
  }, [emit]);
  useEffect(() => {
    const state = control.current; state.mounted = true; state.abort = new AbortController();
    return () => { state.mounted = false; state.epoch++; state.operationId++; state.busy = false; state.abort.abort(); };
  }, []);
  const { onDirtyChange, onSelectionChange } = props;
  useEffect(() => { try { onDirtyChange?.(snapshot.dirty); } catch { /* Host observer only. */ } }, [snapshot.dirty, onDirtyChange]);
  useEffect(() => { try { onSelectionChange?.(snapshot.selection); } catch { /* Host observer only. */ } }, [snapshot.selection, onSelectionChange]);
  const previousPolicy = useRef({ readOnly, policy });
  useEffect(() => {
    const previous = previousPolicy.current;
    previousPolicy.current = { readOnly, policy };
    if (previous.readOnly !== readOnly || previous.policy !== policy) invalidate();
  }, [readOnly, policy, invalidate]);

  function perform<T>(apply: () => T, fallback: T): Promise<T> {
    const state = control.current;
    if (!writable() || state.busy) return Promise.resolve(fallback);
    const startingEdit = !state.edit;
    if (state.edit || !latest.current.onEditRequest) {
      // Keep ordinary ProseMirror transactions synchronous; returning a Promise must not delay their commit.
      if (startingEdit) { state.edit = true; emit({ type: "edit-mode", mode: "edit" }); }
      try { return Promise.resolve(apply()); }
      catch (cause) { if (startingEdit) endEdit(); error(cause); return Promise.resolve(fallback); }
    }
    const operation = reserve("permission"), handler = latest.current.onEditRequest;
    const request = { document: session.getSnapshot().document };
    emit({ type: "edit-mode", mode: "requesting" });
    return Promise.resolve().then(() => current(operation) && writable() ? handler(request, { requestId: crypto.randomUUID(), signal: operation.signal }) : false)
      .then(allowed => {
        if (!current(operation) || !writable()) return fallback;
        if (allowed !== true) throw new Error("他のユーザーが編集中のため変更できません。");
        state.edit = true; emit({ type: "edit-mode", mode: "edit" }); return apply();
      }).catch(cause => { if (current(operation)) { endEdit(); error(cause); } return fallback; }).finally(() => release(operation));
  }
  function execute(command: DocumentCommand | readonly DocumentCommand[], options: { historyGroup?: string; source?: "command" | "import"; isCurrent?: () => boolean } = {}): Promise<DocumentCommandResult | null> {
    if (!writable() || control.current.busy || options.isCurrent?.() === false) return Promise.resolve(null);
    const commands = Array.isArray(command) ? command as readonly DocumentCommand[] : [command as DocumentCommand];
    const before = session.getSnapshot().document;
    try {
      const preview = executeDocumentCommands(before, commands);
      if (serializeDocument(preview.document) === serializeDocument(before)) return Promise.resolve(null);
      assertDocumentFeatures(before, preview.document, commands, resolveDocumentFeatures(latest.current.features));
    } catch (cause) { error(cause); return Promise.resolve(null); }
    return perform(() => {
      if (!writable() || session.getSnapshot().document !== before || options.isCurrent?.() === false) throw new Error("文書が変更されました。もう一度操作してください。");
      const preview = executeDocumentCommands(before, commands);
      assertDocumentFeatures(before, preview.document, commands, resolveDocumentFeatures(latest.current.features));
      const result = session.execute(commands, options); setNotice(null); notifyChange(options.source ?? "command"); return result;
    }, null);
  }
  function history(direction: "undo" | "redo", isCurrent?: () => boolean) {
    if (isCurrent?.() === false || !resolveDocumentFeatures(latest.current.features).history || !(direction === "undo" ? session.getSnapshot().canUndo : session.getSnapshot().canRedo)) return Promise.resolve(false);
    return perform(() => {
      if (!writable() || !resolveDocumentFeatures(latest.current.features).history || isCurrent?.() === false) return false;
      const changed = session[direction](); if (changed) { setNotice(null); notifyChange(direction); } return changed;
    }, false);
  }
  async function save() {
    if (!writable() || control.current.busy || !session.getSnapshot().dirty) return false;
    const operation = reserve("save"), document = session.getSnapshot().document, handler = latest.current.onSave!;
    emit({ type: "save", phase: "start" });
    try {
      const allowed = await latest.current.onBeforeSave?.(document);
      if (!current(operation) || !writable()) return false;
      if (allowed === false) { emit({ type: "save", phase: "cancelled" }); return false; }
      const result = await handler(document);
      if (!current(operation) || !writable()) return false;
      session.markSaved(result === undefined ? undefined : normalizeDocument(result));
      if (session.getSnapshot().document !== document && serializeDocument(session.getSnapshot().document) !== serializeDocument(document)) notifyChange("save");
      setNotice({ kind: "success", text: "保存しました。" }); emit({ type: "save", phase: "success" }); endEdit(); return true;
    } catch (cause) { if (current(operation)) { error(cause); emit({ type: "save", phase: "error", error: cause instanceof Error ? cause.message : "保存に失敗しました。" }); } return false; }
    finally { release(operation); }
  }
  function discard() {
    if (!writable() || (control.current.busy && control.current.kind !== "permission")) return;
    const changed = session.getSnapshot().dirty;
    invalidate(); session.discard(); setNotice(null);
    if (changed) notifyChange("command");
  }
  async function importFile(input: string | Blob | ArrayBuffer | Uint8Array, format: "dcon" | "docx", options: DocumentImportOptions = {}) {
    if (!writable() || control.current.busy || !resolveDocumentFeatures(latest.current.features).import) return;
    const operation = reserve("import"), before = session.getSnapshot().document;
    try {
      const requestedPage = record(options, "Document import options", ["pageNumber"]).pageNumber;
      if (requestedPage !== undefined && (typeof requestedPage !== "number" || !Number.isSafeInteger(requestedPage) || requestedPage < 1)) throw new Error("ページ番号は1以上の整数を指定してください。");
      let document: DocumentModel, warnings: readonly string[] = [];
      if (format === "docx") { const result = await importDocumentDocx(input as Blob | ArrayBuffer | Uint8Array, { signal: operation.signal }); document = result.document; warnings = result.warnings; }
      else {
        if (typeof input !== "string" && (!(input instanceof Blob) || input.size > DOCUMENT_LIMITS.jsonLength)) throw new Error("40 MiB以下のDCONファイルを選択してください。");
        document = parseDocument(typeof input === "string" ? input : await input.text());
      }
      const position = requestedPage === undefined ? undefined : pagePosition(document, requestedPage as number);
      if (!current(operation) || !writable() || !resolveDocumentFeatures(latest.current.features).import || session.getSnapshot().document !== before) return;
      // Hand the reservation to the edit-permission path; this operation must not later release that newer reservation.
      release(operation);
      if (serializeDocument(document) === serializeDocument(before)) {
        if (position !== undefined) {
          session.select({ from: position, to: position });
          setPageReveal({ document: before, position }); setNotice(null);
        }
        return;
      }
      const commands: DocumentCommand[] = [{ type: "document.replace", document }];
      if (position !== undefined) commands.push({ type: "transaction.apply", steps: [], selection: { from: position, to: position } });
      const result = await execute(commands, { source: "import" }), after = session.getSnapshot();
      // The batch already selected the target before notifying the host. A later host
      // selection/navigation wins; only reveal an import selection that is still current.
      if (position !== undefined && result && after.document === result.document && after.selection.from === position && after.selection.to === position && control.current.epoch === operation.epoch && !operation.signal.aborted && writable() && resolveDocumentFeatures(latest.current.features).import) {
        setPageReveal({ document: after.document, position }); setNotice(null);
      }
      if (result && control.current.mounted && writable() && resolveDocumentFeatures(latest.current.features).import) {
        setNotice({ kind: warnings.length ? "info" : "success", text: warnings.length ? warnings.join("\n") : "文書を読み込みました。" }); emit({ type: "import", format, warnings });
      }
    } catch (cause) { if (current(operation)) error(cause); }
    finally { release(operation); }
  }
  async function exportFile(format: "dcon" | "docx") {
    if (!control.current.mounted || control.current.busy || !resolveDocumentFeatures(latest.current.features).export) throw new Error("現在は書き出しできません。");
    const document = session.getSnapshot().document, operation = reserve("export");
    try {
      const result = format === "dcon" ? { blob: new Blob([serializeDocument(document)], { type: "application/json" }), warnings: [] } : await exportDocumentDocx(document, { signal: operation.signal });
      if (!current(operation) || !resolveDocumentFeatures(latest.current.features).export) throw new Error("書き出しを中止しました。");
      emit({ type: "export", format, warnings: result.warnings });
      if (result.warnings.length) setNotice({ kind: "info", text: result.warnings.join("\n") });
      return result.blob as Blob;
    } catch (cause) { if (current(operation)) error(cause); throw cause; }
    finally { release(operation); }
  }
  const select = (selection: DocumentSelection) => { if (!control.current.mounted) return; try { session.select(selection); } catch (cause) { error(cause); } };
  function goToPage(pageNumber: number): boolean {
    if (!control.current.mounted) return false;
    try {
      const document = session.getSnapshot().document, position = pagePosition(document, pageNumber);
      session.select({ from: position, to: position }); setPageReveal({ document, position }); setNotice(null); return true;
    } catch (cause) { error(cause); return false; }
  }
  const search = useDocumentSearch(snapshot.document, features.search, location => {
    if (!control.current.mounted || !resolveDocumentFeatures(latest.current.features).search) return;
    session.select({ from: location.match.from, to: location.match.to });
    setPageReveal({ document: session.getSnapshot().document, position: location.match.from });
  });
  useImperativeHandle(props.ref, () => ({ openSearch: search.openSearch, closeSearch: search.closeSearch, getRibbonDisplayMode: ribbon.getRibbonDisplayMode, setRibbonDisplayMode: ribbon.setRibbonDisplayMode, getDocument: () => session.getSnapshot().document, getSelection: () => ({ ...session.getSnapshot().selection }), select, goToPage, execute, undo: () => history("undo"), redo: () => history("redo"), save, discard,
    importNative: (input, options) => importFile(input, "dcon", options), importDocx: (input, options) => importFile(input, "docx", options), exportNative: () => exportFile("dcon"), exportDocx: () => exportFile("docx"),
  }));
  return { ...snapshot, ...ribbon, search, session, features, readOnly, editable: !readOnly && !busy, busy, notice, setNotice, error, execute, select, goToPage, pageReveal, history, save, discard, importFile, exportFile };
}
export type DocumentEditor = ReturnType<typeof useDocumentEditor>;
