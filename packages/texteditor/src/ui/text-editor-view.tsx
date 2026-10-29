"use client";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Search, Replace, Undo2, Redo2, Save, Download, Upload, Command, WrapText, FileText, Code2, Eye, X, LockKeyhole } from "lucide-react";
import { createPrimaryColorPalette } from "../core";
import { findTextEditorMatches, decodeTextEditorBytes, TEXT_EDITOR_LIMITS } from "../model/index";
import { TEXT_EDITOR_ACTIONS } from "../actions";
import type { EditorAdapterHandle, TextEditorAction, TextEditorSelection, TextEditorSearchQuery, TextEditorSearchDisplay } from "../editor-adapter";
import type { TextEditorHeaderActionsContext, TextEditorProps, TextEditorImportOptions, TextEditorExport, TextEditorViewMode } from "../props";
import { record } from "../model/validation";
import { createTextEditorSearchQuery } from "./search-panel";
import { useTextEditor } from "../state/use-text-editor";
import { CodeEditor } from "./code-editor";
import { MarkdownEditor } from "./markdown-editor";

function HeaderActions({ render, context }: {
  render: TextEditorProps["renderHeaderActions"];
  context: TextEditorHeaderActionsContext;
}) {
  return <div className="lxte-header-actions">{render ? render(context) : context.defaultActions}</div>;
}

export function TextEditorView({ ref, ...props }: TextEditorProps) {
  const { controller, snapshot } = useTextEditor(props), { model, features } = snapshot;
  const mode = props.mode ?? model.mode;
  const [sourceMode, setSourceMode] = useState(props.initialViewMode === "source"), [wordWrap, setWordWrap] = useState(props.initialWordWrap ?? true);
  const wrapRef = useRef(wordWrap);
  const [selection, setSelection] = useState<TextEditorSelection | null>(null);
  const adapter = useRef<EditorAdapterHandle>(null), input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const root = useRef<HTMLElement>(null), paletteInput = useRef<HTMLInputElement>(null);
  const [palette, setPalette] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const pending = useRef<{ target: TextEditorViewMode; documentId: string; run(editor: EditorAdapterHandle): boolean; resolve(value: boolean): void } | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const showingSource = mode === "text" || sourceMode;
  const live = useRef({ props, mode, showingSource });
  useLayoutEffect(() => { live.current = { props, mode, showingSource }; });
  const canEdit = snapshot.editable && features.editing;
  const theme = props.colorMode === "dark" || props.colorMode === "system" && systemDark ? "dark" : "light";
  const colors = createPrimaryColorPalette(props.primaryColor, theme) ?? createPrimaryColorPalette("#28664f", theme)!;
  useEffect(() => {
    const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
    if (!media) return;
    const changed = () => setSystemDark(media.matches); changed(); media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const task = pending.current;
    if (task && adapter.current) {
      pending.current = null;
      task.resolve(task.documentId === controller.getModel().id && task.target === (showingSource ? "source" : "rich") && task.run(adapter.current));
    }
  }, [showingSource, model.id, controller]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.resolve(false); pending.current = null; }; }, []);
  useEffect(() => { if (palette) paletteInput.current?.focus(); }, [palette]);
  const actions = TEXT_EDITOR_ACTIONS.filter(item => (!item.markdown || mode === "markdown" && !showingSource) && (!item.edits || canEdit) && (!['undo','redo'].includes(item.id) || features.history)).filter(item => `${item.label} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
  const lineStarts = useMemo(() => { const starts = [0]; for (const match of model.text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length); return starts; }, [model.text]);
  const textStats = { lines: lineStarts.length, characters: model.text.length };
  const currentRange = selection?.ranges[selection.mainIndex];
  const caretOffset = selection?.coordinateSpace === "source" && currentRange ? Math.min(model.text.length, currentRange.head) : 0;
  let low = 0, high = lineStarts.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (lineStarts[middle] <= caretOffset) low = middle; else high = middle - 1; }
  const caretLine = low + 1, caretColumn = caretOffset - lineStarts[low] + 1;
  function openPalette() { setQuery(""); setActive(0); setPalette(true); }
  function closePalette() { setPalette(false); adapter.current?.focus(); }
  function changeWordWrap(next: boolean): boolean {
    if (!mounted.current || typeof next !== "boolean") return false;
    if (next === wrapRef.current) return true;
    wrapRef.current = next; setWordWrap(next);
    try { live.current.props.onWordWrapChange?.(next); } catch { /* Observer only. */ }
    return true;
  }
  function toggleWrap() { changeWordWrap(!wrapRef.current); }
  function changeViewMode(next: TextEditorViewMode) {
    setSourceMode(next === "source");
  }
  const observedViewMode = useRef<TextEditorViewMode>(showingSource ? "source" : "rich");
  useEffect(() => {
    const next = showingSource ? "source" : "rich";
    if (observedViewMode.current === next) return;
    observedViewMode.current = next;
    try { live.current.props.onViewModeChange?.(next); } catch { /* Observer only. */ }
  }, [showingSource]);
  function withView(target: TextEditorViewMode, run: (editor: EditorAdapterHandle) => boolean): Promise<boolean> {
    if (!mounted.current) return Promise.resolve(false);
    if (!["source", "rich"].includes(target) || target === "rich" && live.current.mode !== "markdown") return Promise.resolve(false);
    pending.current?.resolve(false);
    pending.current = null;
    if (target === (live.current.showingSource ? "source" : "rich") && adapter.current && adapter.current.isReady?.() !== false) {
      changeViewMode(target); return Promise.resolve(run(adapter.current));
    }
    return new Promise(resolve => { pending.current = { target, documentId: controller.getModel().id, run, resolve }; changeViewMode(target); });
  }
  function withSource(run: (editor: EditorAdapterHandle) => boolean) { return withView("source", run); }
  async function runCommand(command: TextEditorAction): Promise<boolean> {
    if (!mounted.current) return false;
    const current = controller.getSnapshot();
    const info = TEXT_EDITOR_ACTIONS.find(item => item.id === command);
    if (!info) return false;
    if (info?.edits && (!current.editable || !current.features.editing)) return false;
    if (command === "commandPalette") { openPalette(); return true; }
    if (command === "toggleWordWrap") { toggleWrap(); return true; }
    if (command === "undo") return controller.undo();
    if (command === "redo") return controller.redo();
    if (command === "closeSearch") return closeSearch();
    if (command.startsWith("markdown.")) return live.current.mode === "markdown" && !live.current.showingSource && !!adapter.current?.runCommand(command);
    if (!live.current.showingSource && ["selectAll", "selectLine", "indent", "outdent"].includes(command)) return !!adapter.current?.runCommand(command);
    return withSource(editor => {
      const state = controller.getSnapshot();
      if (info?.edits && (!state.editable || !state.features.editing)) return false;
      editor.focus(); return editor.runCommand(command);
    });
  }
  function closeSearch(): boolean { return mounted.current && live.current.showingSource && !!adapter.current?.runCommand("closeSearch"); }
  async function setSearch(query: TextEditorSearchQuery, display: TextEditorSearchDisplay = {}): Promise<boolean> {
    try { const validated = createTextEditorSearchQuery(query, display); if (query.query && !validated.valid) return false; } catch { return false; }
    query = { ...query }; display = { ...display };
    if (display.replace && (!controller.getSnapshot().editable || !controller.getSnapshot().features.editing)) return false;
    return withSource(editor => {
      const current = controller.getSnapshot();
      if (display.replace && (!current.editable || !current.features.editing)) return false;
      return editor.setSearch?.(query, display) ?? false;
    });
  }
  function importFile(file: Blob, options: TextEditorImportOptions = {}) {
    return controller.prepare(async before => {
      record(options, ["title", "mode"], "読み込み設定");
      const { title, mode: importedMode } = options;
      if (!(file instanceof Blob)) throw new Error("読み込むファイルをBlobで指定してください。");
      if (file.size > TEXT_EDITOR_LIMITS.fileBytes) throw new Error("ファイルのサイズが上限を超えています。");
      const text = decodeTextEditorBytes(await file.arrayBuffer());
      const name = "name" in file && typeof file.name === "string" ? file.name : before.title;
      return { type: "document.replace" as const, document: { ...before, text, title: title ?? name, mode: importedMode ?? before.mode } };
    }, { feature: "import" });
  }
  function exportFile(): TextEditorExport | null {
    if (!mounted.current || !controller.getSnapshot().features.export) return null;
    const document = controller.getModel(), effectiveMode = live.current.props.mode ?? document.mode;
    return {
      blob: new Blob([document.text], { type: effectiveMode === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }),
      fileName: `${(live.current.props.title ?? document.title).replace(/[\\/:*?"<>|]/g, "_").replace(/\.(md|txt)$/i, "") || "Untitled"}.${effectiveMode === "markdown" ? "md" : "txt"}`,
    };
  }
  useImperativeHandle(ref, () => ({
    getDocument: controller.getModel, getText: () => controller.getModel().text,
    getState: () => {
      const current = controller.getSnapshot(), editable = current.editable && current.features.editing;
      return Object.freeze({ mode: live.current.props.mode ?? current.model.mode, viewMode: live.current.showingSource ? "source" as const : "rich" as const, wordWrap: wrapRef.current,
        readOnly: current.readOnly, editable, busy: current.busy !== null, dirty: current.dirty,
        canSave: current.editable && current.dirty, canUndo: editable && current.features.history && current.canUndo,
        canRedo: editable && current.features.history && current.canRedo, features: current.features });
    },
    execute: controller.execute, replace: document => controller.execute({ type: "document.replace", document }, { source: "import" }),
    find: options => findTextEditorMatches(controller.getModel(), options),
    runCommand, focus: () => adapter.current?.focus(), getSelection: () => adapter.current?.isReady?.() === false ? null : adapter.current?.getSelection() ?? null,
    setSelection: next => { if (!mounted.current || !adapter.current || adapter.current.isReady?.() === false || !next || !Array.isArray(next.ranges) || !next.ranges.length || next.ranges.length > 10000 || !Number.isInteger(next.mainIndex) || next.mainIndex < 0 || next.mainIndex >= next.ranges.length || next.ranges.some(range => !range || !Number.isInteger(range.anchor) || !Number.isInteger(range.head) || range.anchor < 0 || range.head < 0) || next.coordinateSpace !== (live.current.showingSource ? "source" : "rich")) return false; try { adapter.current.setSelection(next); return true; } catch { return false; } },
    goToLine: (line, column) => withSource(editor => editor.goToLine(line, column)),
    setViewMode: next => withView(next, () => true), setWordWrap: changeWordWrap,
    setSearch, getSearch: () => live.current.showingSource ? adapter.current?.getSearch?.() ?? null : null, closeSearch,
    importFile, exportFile, download,
    save: controller.save, undo: controller.undo, redo: controller.redo,
    cancelPending: () => { pending.current?.resolve(false); pending.current = null; controller.cancelPending(); },
  }));
  const editorProps = {
    value: model.text, editable: canEdit, ref: adapter,
    onChange: async (text: string) => {
      if (text === controller.getModel().text) return true;
      return !!await controller.execute({ type: "text.set", text }, { historyGroup: "typing" });
    },
    onSelectionChange: (next: TextEditorSelection) => { setSelection(next); try { props.onSelectionChange?.(next); } catch { /* Selection observers do not reject edits. */ } },
    onUndo: () => { void controller.undo(); }, onRedo: () => { void controller.redo(); }, onCommandPalette: openPalette,
  };
  function download(): boolean {
    const exported = exportFile();
    if (!exported || typeof globalThis.document === "undefined") return false;
    const url = URL.createObjectURL(exported.blob), anchor = globalThis.document.createElement("a");
    anchor.href = url; anchor.download = exported.fileName;
    try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    return true;
  }
  const canSave = snapshot.editable && snapshot.dirty;
  const canUndo = canEdit && features.history && snapshot.canUndo;
  const canRedo = canEdit && features.history && snapshot.canRedo;
  const defaultActions = <>
    {features.history && !snapshot.readOnly && <div className="lxte-history" role="group" aria-label="操作履歴"><button type="button" aria-label="元に戻す" title="元に戻す" disabled={!canUndo} onClick={() => void controller.undo()}><Undo2 size={16} /></button><button type="button" aria-label="やり直す" title="やり直す" disabled={!canRedo} onClick={() => void controller.redo()}><Redo2 size={16} /></button></div>}
    {snapshot.readOnly && <span className="lxte-readonly"><LockKeyhole size={13} />閲覧専用</span>}
    {!snapshot.readOnly && <button type="button" className="lxte-save" disabled={!canSave} onClick={() => void controller.save()}><Save size={15} />{snapshot.busy === "save" ? "保存中…" : "保存"}</button>}
  </>;
  const headerContext: TextEditorHeaderActionsContext = {
    defaultActions, readOnly: snapshot.readOnly, busy: snapshot.busy !== null, dirty: snapshot.dirty,
    canSave, canUndo, canRedo, save: controller.save, undo: controller.undo, redo: controller.redo, runCommand,
  };
  return <section ref={root} data-likex-texteditor="" data-theme={theme} data-mode={mode} className={`lxte-root ${props.className ?? ""}`} style={{ "--lxte-primary": colors.primary, "--lxte-on-primary": colors.onPrimary, "--lxte-accent": colors.accent, "--lxte-selection": colors.selection, ...props.style } as CSSProperties} onKeyDownCapture={event => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void controller.save(); }
    else if (mod && event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); event.stopPropagation(); openPalette(); }
    else if (event.altKey && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); toggleWrap(); }
    else if (!showingSource && target.closest(".ProseMirror") && mod && ["f", "h"].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); void runCommand(event.key.toLowerCase() === "f" ? "find" : "replace"); }
  }}>
    <header className="lxte-header" style={props.headerStyle} data-custom-color={props.headerStyle?.color ? "" : undefined}><div className="lxte-file"><FileText size={18} /><strong>{props.title ?? model.title}</strong>{snapshot.dirty && <span className="lxte-dirty" title="未保存" aria-label="未保存" />}</div><div className="lxte-header-end">
      {mode === "markdown" && <div className="lxte-view-switch" role="group" aria-label="Markdownの表示"><button type="button" aria-label="文章表示" title="文章表示" aria-pressed={!sourceMode} onClick={() => void withView("rich", () => true)}><Eye size={16} aria-hidden="true" /></button><button type="button" aria-label="ソース表示" title="ソース表示" aria-pressed={sourceMode} onClick={() => void withView("source", () => true)}><Code2 size={16} aria-hidden="true" /></button></div>}
      <HeaderActions render={props.renderHeaderActions} context={headerContext} />
    </div></header>
    {props.showToolbar && <nav className="lxte-toolbar" aria-label="テキスト編集の操作">
      <button type="button" onClick={() => void runCommand("find")} title="検索 (Ctrl / ⌘ F)"><Search size={15} />検索</button>
      <button type="button" disabled={!canEdit} onClick={() => void runCommand("replace")} title="置換 (Ctrl / ⌘ H)"><Replace size={15} />置換</button>
      <button type="button" onClick={openPalette} title="コマンド一覧 (Ctrl / ⌘ Shift P)"><Command size={15} />コマンド</button>
      <span className="lxte-toolbar-spacer" />
      {showingSource && <button type="button" aria-label="行の折り返し" aria-pressed={wordWrap} title="行の折り返し (Alt Z)" onClick={toggleWrap}><WrapText size={16} /></button>}
      {features.import && <button type="button" aria-label="ファイルを開く" title="ファイルを開く" disabled={!canEdit} onClick={() => input.current?.click()}><Upload size={16} /></button>}
      {features.export && <button type="button" aria-label="ファイルをダウンロード" title="ファイルをダウンロード" onClick={download}><Download size={16} /></button>}
      <input ref={input} hidden type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" aria-label="テキストファイル" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void importFile(file);
      }} />
    </nav>}
    <div className="lxte-workspace">{showingSource ? <CodeEditor {...editorProps} wordWrap={wordWrap} markdown={mode === "markdown"} onToggleWordWrap={toggleWrap} /> : <MarkdownEditor {...editorProps} formatting={!snapshot.readOnly && features.editing} onSourceMode={() => void withView("source", () => true)} />}</div>
    <footer className="lxte-status">{showingSource && <span>{caretLine} 行、{caretColumn} 列{selection && selection.ranges.length > 1 && ` · ${selection.ranges.length} カーソル`}</span>}<span>{textStats.lines.toLocaleString()} 行 · {textStats.characters.toLocaleString()} 文字</span></footer>
    {snapshot.notice && <div role="status" className={`lxte-notice lxte-notice-${snapshot.notice.kind}`}><span>{snapshot.notice.text}</span><button type="button" aria-label="通知を閉じる" onClick={() => controller.setNotice(null)}><X size={14} /></button></div>}
    {palette && <div className="lxte-palette-layer" onPointerDown={event => { if (event.target === event.currentTarget) closePalette(); }}><div className="lxte-palette" role="dialog" aria-label="コマンド一覧" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePalette(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); setActive(current => Math.min(current + 1, actions.length - 1)); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setActive(current => Math.max(current - 1, 0)); }
      else if (event.key === "Enter" && actions[active]) { event.preventDefault(); closePalette(); void runCommand(actions[active].id); }
    }}><div className="lxte-palette-input"><Command size={17} /><input ref={paletteInput} aria-label="コマンドを検索" placeholder="操作を検索…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /><button type="button" aria-label="コマンド一覧を閉じる" onClick={closePalette}><X size={17} /></button></div><div className="lxte-palette-list">{actions.map((item, index) => <button type="button" key={item.id} className={index === active ? "lxte-command-active" : ""} onClick={() => { closePalette(); void runCommand(item.id); }}><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}{!actions.length && <p>一致する操作がありません。</p>}</div><div className="lxte-palette-footer">↑↓ で選択 · Enter で実行 · Esc で閉じる</div></div></div>}
  </section>;
}
