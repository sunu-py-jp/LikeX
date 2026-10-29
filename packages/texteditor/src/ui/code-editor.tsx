"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Text, Transaction } from "@codemirror/state";
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, showDialog } from "@codemirror/view";
import { addCursorAbove, addCursorBelow, copyLineDown, copyLineUp, cursorMatchingBracket, defaultKeymap, deleteLine, indentLess, indentMore, indentWithTab, moveLineDown, moveLineUp, selectAll, selectLine, selectParentSyntax, simplifySelection } from "@codemirror/commands";
import { closeSearchPanel, findNext, findPrevious, highlightSelectionMatches, openSearchPanel, search, searchPanelOpen, selectNextOccurrence, selectSelectionMatches, replaceNext, replaceAll, selectMatches } from "@codemirror/search";
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorAdapterHandle, EditorAdapterProps, TextEditorAction, TextEditorPanel, TextEditorSelection } from "../editor-adapter";
import { anchoredRectangularSelection } from "./rectangular-selection";
import { createCompactSearchPanel, openCompactReplacePanel, getCodeEditorSearch, setCodeEditorSearch, textEditorSearchPolicy, searchAllowed, replaceAllowed } from "./search-panel";

export type CodeEditorProps = EditorAdapterProps & {
  wordWrap: boolean;
  markdown?: boolean;
  onToggleWordWrap?(): void;
};

const externalChange = Annotation.define<boolean>();
const mutatingActions = new Set<TextEditorAction>(["moveLineUp", "moveLineDown", "copyLineUp", "copyLineDown", "deleteLine", "indent", "outdent", "undo", "redo", "replace", "replaceNext", "replaceAll"]);
type Callbacks = Pick<CodeEditorProps, "onUndo" | "onRedo" | "onCommandPalette" | "onToggleWordWrap" | "searchEnabled" | "replaceEnabled">;
const searchActions = new Set<TextEditorAction>(["find", "replace", "findNext", "findPrevious", "replaceNext", "replaceAll", "selectSearchMatches"]);
const replaceActions = new Set<TextEditorAction>(["replace", "replaceNext", "replaceAll"]);
type LineDialog = ReturnType<typeof showDialog>;
const lineDialogs = new WeakMap<EditorView, LineDialog>();

/** Keep the public dialog close effect so hosts can dismiss the same UI as the keyboard. */
export function openCodeGoToLine(view: EditorView): boolean {
  if (lineDialogs.has(view)) return true;
  const dialog = showDialog(view, { class: "cm-goto-line", label: view.state.phrase("Go to line"),
    input: { type: "text", name: "line", value: String(view.state.doc.lineAt(view.state.selection.main.head).number) },
    focus: true, submitLabel: view.state.phrase("go") });
  lineDialogs.set(view, dialog);
  void dialog.result.then(form => {
    if (lineDialogs.get(view) !== dialog) return;
    lineDialogs.delete(view);
    const input = form?.elements.namedItem("line") as HTMLInputElement | null;
    const match = input && /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(input.value);
    if (!match) { view.dispatch({ effects: dialog.close }); return; }
    const state = view.state, current = state.doc.lineAt(state.selection.main.head);
    const [, sign, value, column, percent] = match;
    let line = value ? Number(value) : current.number;
    if (value && percent) line = Math.round(state.doc.lines * (line / 100 * (sign === "-" ? -1 : 1) + (sign ? current.number / state.doc.lines : 0)));
    else if (value && sign) line = current.number + line * (sign === "-" ? -1 : 1);
    const target = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)));
    const offset = target.from + Math.max(0, Math.min(column ? Number(column.slice(1)) : 0, target.length));
    view.dispatch({ effects: [dialog.close, EditorView.scrollIntoView(offset, { y: "center" })], selection: EditorSelection.cursor(offset) });
  });
  return true;
}

export function closeCodeGoToLine(view: EditorView): boolean {
  const dialog = lineDialogs.get(view);
  if (!dialog) return false;
  lineDialogs.delete(view); view.dispatch({ effects: dialog.close }); return true;
}

export function getCodeEditorPanels(view: EditorView): readonly TextEditorPanel[] {
  return [...(searchPanelOpen(view.state) ? ["search" as const] : []), ...(lineDialogs.has(view) ? ["goToLine" as const] : [])];
}

/** The command dispatcher is shared by keyboard bindings and the public UI handle. */
export function runCodeEditorAction(view: EditorView, action: TextEditorAction, callbacks: Callbacks): boolean {
  if (view.state.readOnly && mutatingActions.has(action)) return false;
  if (searchActions.has(action) && (callbacks.searchEnabled === false || !searchAllowed(view.state))) return false;
  if (replaceActions.has(action) && (callbacks.replaceEnabled === false || !replaceAllowed(view.state))) return false;
  switch (action) {
    case "selectAll": return selectAll(view);
    case "selectLine": return selectLine(view);
    case "selectNextOccurrence": return selectNextOccurrence(view);
    case "selectAllOccurrences": {
      if (view.state.selection.main.empty && !selectNextOccurrence(view)) return false;
      if (view.state.selection.ranges.length > 1) view.dispatch({ selection: EditorSelection.create([view.state.selection.main]) });
      return selectSelectionMatches(view);
    }
    case "addCursorAbove": return addCursorAbove(view);
    case "addCursorBelow": return addCursorBelow(view);
    case "simplifySelection": return closeCodeGoToLine(view) || closeSearchPanel(view) || simplifySelection(view);
    case "moveLineUp": return moveLineUp(view);
    case "moveLineDown": return moveLineDown(view);
    case "copyLineUp": return copyLineUp(view);
    case "copyLineDown": return copyLineDown(view);
    case "deleteLine": return deleteLine(view);
    case "indent": return indentMore(view);
    case "outdent": return indentLess(view);
    case "undo": callbacks.onUndo(); return true;
    case "redo": callbacks.onRedo(); return true;
    case "find": return openSearchPanel(view);
    case "replace": return openCompactReplacePanel(view);
    case "findNext": return findNext(view);
    case "findPrevious": return findPrevious(view);
    case "closeSearch": return closeSearchPanel(view);
    case "replaceNext": return replaceNext(view);
    case "replaceAll": return replaceAll(view);
    case "selectSearchMatches": return selectMatches(view);
    case "goToLine": return openCodeGoToLine(view);
    case "selectParentSyntax": return selectParentSyntax(view);
    case "cursorMatchingBracket": return cursorMatchingBracket(view);
    case "toggleWordWrap": if (!callbacks.onToggleWordWrap) return false; callbacks.onToggleWordWrap(); return true;
    case "commandPalette": if (!callbacks.onCommandPalette) return false; callbacks.onCommandPalette(); return true;
    default: return false;
  }
}

/** Convert CodeMirror's one-character newlines to source UTF-16 coordinates. */
export function codeSelectionToSource(state: EditorState): TextEditorSelection {
  const extra = state.lineBreak.length - 1;
  const position = (offset: number) => offset + extra * (state.doc.lineAt(offset).number - 1);
  return { coordinateSpace: "source", ranges: state.selection.ranges.map(range => ({ anchor: position(range.anchor), head: position(range.head) })), mainIndex: state.selection.mainIndex };
}

export function sourcePositionToCode(state: EditorState, sourceOffset: number): number {
  const extra = state.lineBreak.length - 1;
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > state.doc.length + extra * (state.doc.lines - 1)) throw new RangeError("選択位置がテキストの範囲外です。");
  if (!extra) return sourceOffset;
  let low = 1, high = state.doc.lines;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), start = state.doc.line(middle).from + extra * (middle - 1);
    if (start <= sourceOffset) low = middle; else high = middle - 1;
  }
  const line = state.doc.line(low);
  return Math.min(line.to, sourceOffset - extra * (low - 1));
}

function separator(value: string): string { return value.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }

export function CodeEditor({ ref, ...props }: CodeEditorProps) {
  const container = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null), latest = useRef(props);
  const controls = useRef({ editable: new Compartment(), wrap: new Compartment(), language: new Compartment(), separator: new Compartment(), searchPolicy: new Compartment() });
  const flow = useRef({ mounted: false, generation: 0, pending: false, queued: null as string | null, submitted: new Set<string>(), lastProp: props.value });
  const observed = useRef({ search: "", panels: "", pending: false });
  function notifyPending(value: boolean) {
    if (observed.current.pending === value) return;
    observed.current.pending = value;
    try { latest.current.onPendingChange?.(value); } catch { /* Observers do not cancel input. */ }
  }
  function notifyPanels(view: EditorView) {
    const panels = getCodeEditorPanels(view), key = panels.join(",");
    if (key !== observed.current.panels) { observed.current.panels = key; try { latest.current.onPanelsChange?.(panels); } catch { /* Observers do not cancel panel changes. */ } }
  }
  function notifySearch(view: EditorView) {
    const state = getCodeEditorSearch(view), key = JSON.stringify(state);
    if (key !== observed.current.search) { observed.current.search = key; try { latest.current.onSearchChange?.(state); } catch { /* Observers do not cancel search. */ } }
    notifyPanels(view);
  }
  function searchPolicy() { return textEditorSearchPolicy.of({ search: latest.current.searchEnabled, replace: latest.current.replaceEnabled,
    onChange() { if (viewRef.current) notifySearch(viewRef.current); } }); }
  useLayoutEffect(() => { latest.current = props; });

  useEffect(() => {
    if (!container.current) return;
    const pending = flow.current, config = controls.current;
    pending.mounted = true;
    const callbacks: Callbacks = {
      onUndo: () => latest.current.onUndo(), onRedo: () => latest.current.onRedo(),
      onCommandPalette: () => latest.current.onCommandPalette?.(), onToggleWordWrap: () => latest.current.onToggleWordWrap?.(),
      get searchEnabled() { return latest.current.searchEnabled; }, get replaceEnabled() { return latest.current.replaceEnabled; },
    };
    const action = (name: TextEditorAction) => (view: EditorView) => { const result = runCodeEditorAction(view, name, callbacks); notifySearch(view); return result; };
    const bindings = [
      { key: "Mod-z", run: action("undo"), preventDefault: true },
      { key: "Mod-Shift-z", run: action("redo"), preventDefault: true },
      { key: "Mod-y", run: action("redo"), preventDefault: true },
      { key: "Mod-a", run: action("selectAll") },
      { key: "Mod-d", run: action("selectNextOccurrence"), preventDefault: true },
      { key: "Mod-Shift-l", run: action("selectAllOccurrences"), preventDefault: true },
      { key: "Mod-l", run: action("selectLine"), preventDefault: true },
      { key: "Mod-f", run: action("find"), preventDefault: true },
      { key: "F3", run: action("findNext"), shift: action("findPrevious"), preventDefault: true },
      { key: "Mod-h", run: action("replace"), preventDefault: true },
      { key: "Mod-Shift-h", run: action("replace"), preventDefault: true },
      { key: "Mod-g", run: action("goToLine"), preventDefault: true },
      { key: "Mod-Alt-g", run: action("goToLine"), preventDefault: true },
      { key: "Alt-z", run: action("toggleWordWrap"), preventDefault: true },
      { key: "Mod-Shift-p", run: action("commandPalette"), preventDefault: true },
      { key: "F1", run: action("commandPalette"), preventDefault: true },
      { key: "Escape", run: action("simplifySelection") },
    ];
    const view = new EditorView({ parent: container.current, state: EditorState.create({
      doc: Text.of(latest.current.value.split(/\r\n|\r|\n/)),
      extensions: [
        config.separator.of(EditorState.lineSeparator.of(separator(latest.current.value))),
        config.editable.of([EditorState.readOnly.of(!latest.current.editable), EditorView.editable.of(latest.current.editable)]),
        config.wrap.of(latest.current.wordWrap ? EditorView.lineWrapping : []),
        config.language.of(latest.current.markdown ? markdown() : []),
        config.searchPolicy.of(searchPolicy()),
        EditorState.allowMultipleSelections.of(true),
        EditorView.clickAddsSelectionRange.of(event => event.altKey && !event.shiftKey),
        anchoredRectangularSelection,
        crosshairCursor({ key: "Alt" }), drawSelection(), dropCursor(),
        lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
        indentUnit.of("  "), indentOnInput(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search({ top: true, createPanel: createCompactSearchPanel }), highlightSelectionMatches(),
        EditorState.phrases.of({ "Find": "検索", "Replace": "置換", "next": "次へ", "previous": "前へ", "all": "すべて選択", "match case": "大文字小文字", "by word": "単語単位", "regexp": "正規表現", "replace": "置換", "replace all": "すべて置換", "close": "閉じる", "Go to line": "行へ移動", "go": "移動", "No matches": "該当なし" }),
        Prec.highest(keymap.of(bindings)), keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ "aria-label": "テキストエディター", "aria-multiline": "true", spellcheck: "false", tabindex: "0" }),
        EditorState.transactionFilter.of(transaction => transaction.docChanged && transaction.startState.readOnly && !transaction.annotation(externalChange) ? [] : transaction),
        EditorView.updateListener.of(update => {
          notifySearch(update.view);
          if (update.selectionSet || update.docChanged) latest.current.onSelectionChange?.(codeSelectionToSource(update.state));
          if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(externalChange))) {
            pending.queued = update.state.sliceDoc();
            notifyPending(true);
            flush();
          }
        }),
      ],
    }) });
    viewRef.current = view;
    function restore() {
      if (!pending.mounted || viewRef.current !== view) return;
      pending.queued = null;
      pending.submitted.clear();
      syncValue(view, latest.current.value, config.separator);
    }
    function flush() {
      if (pending.pending || pending.queued === null || !pending.mounted) return;
      const value = pending.queued, generation = pending.generation;
      pending.queued = null; pending.pending = true; pending.submitted.add(value);
      Promise.resolve().then(() => pending.mounted && generation === pending.generation ? latest.current.onChange(value) : false).then(accepted => {
        if (!pending.mounted || generation !== pending.generation) return;
        if (!accepted && latest.current.value !== value) restore();
      }, () => { if (generation === pending.generation) restore(); }).finally(() => {
        if (!pending.mounted || generation !== pending.generation) return;
        pending.pending = false;
        if (pending.queued !== null) flush();
        else { pending.submitted.clear(); notifyPending(false); }
      });
    }
    latest.current.onSelectionChange?.(codeSelectionToSource(view.state));
    return () => { pending.mounted = false; pending.generation++; pending.pending = false; pending.queued = null; pending.submitted.clear(); lineDialogs.delete(view); notifyPending(false); viewRef.current = null; view.destroy(); };
    // The mounted view reads current props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const config = controls.current;
    view.dispatch({ effects: [
      config.editable.reconfigure([EditorState.readOnly.of(!props.editable), EditorView.editable.of(props.editable)]),
      config.wrap.reconfigure(props.wordWrap ? EditorView.lineWrapping : []),
      config.language.reconfigure(props.markdown ? markdown() : []),
      config.searchPolicy.reconfigure(searchPolicy()),
    ] });
    if (props.searchEnabled === false) closeSearchPanel(view);
    notifySearch(view);
    // The configuration callbacks read current props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.editable, props.wordWrap, props.markdown, props.searchEnabled, props.replaceEnabled]);

  useLayoutEffect(() => {
    const view = viewRef.current, pending = flow.current;
    if (!view || props.value === pending.lastProp) return;
    pending.lastProp = props.value;
    if (pending.submitted.has(props.value)) return;
    pending.generation++; pending.pending = false; pending.queued = null; pending.submitted.clear();
    notifyPending(false);
    syncValue(view, props.value, controls.current.separator);
  }, [props.value]);

  useImperativeHandle(ref, () => ({
    isReady: () => !!viewRef.current,
    focus() { viewRef.current?.focus(); },
    runCommand(command) { const view = viewRef.current; if (!view) return false; const result = runCodeEditorAction(view, command, latest.current); notifySearch(view); if (result && !["find", "replace", "goToLine", "commandPalette"].includes(command)) view.focus(); return result; },
    getSelection() { return viewRef.current ? codeSelectionToSource(viewRef.current.state) : { coordinateSpace: "source", ranges: [{ anchor: 0, head: 0 }], mainIndex: 0 }; },
    setSearch(query, display) { const view = viewRef.current; if (!view) return false; const result = setCodeEditorSearch(view, query, display); notifySearch(view); return result; },
    getSearch() { return viewRef.current ? getCodeEditorSearch(viewRef.current) : { query: "", replacement: "", caseSensitive: false, wholeWord: false, regex: false, open: false, replace: false, valid: false }; },
    getOpenPanels() { return viewRef.current ? getCodeEditorPanels(viewRef.current) : []; },
    closePanel(panel) { const view = viewRef.current; if (!view) return false; const result = panel === "search" ? closeSearchPanel(view) : panel === "goToLine" ? closeCodeGoToLine(view) : false; notifySearch(view); return result; },
    setSelection(selection) {
      const view = viewRef.current;
      if (!view || selection.coordinateSpace !== "source" || !selection.ranges.length || selection.ranges.length > 10000 || !Number.isInteger(selection.mainIndex) || selection.mainIndex < 0 || selection.mainIndex >= selection.ranges.length) return;
      const ranges = selection.ranges.map(range => EditorSelection.range(sourcePositionToCode(view.state, range.anchor), sourcePositionToCode(view.state, range.head)));
      view.dispatch({ selection: EditorSelection.create(ranges, selection.mainIndex), scrollIntoView: true });
    },
    goToLine(line, column = 1) {
      const view = viewRef.current;
      if (!view || !Number.isInteger(line) || line < 1 || line > view.state.doc.lines || !Number.isInteger(column) || column < 1) return false;
      const target = view.state.doc.line(line), offset = Math.min(target.to, target.from + column - 1);
      view.dispatch({ selection: EditorSelection.cursor(offset), scrollIntoView: true }); view.focus(); return true;
    },
    // Imperative methods read live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } satisfies EditorAdapterHandle), []);

  return <div ref={container} className="lxte-code-editor" />;
}

function syncValue(view: EditorView, source: string, lineSeparator: Compartment) {
  const previous = view.state.doc.toString(), value = source.replace(/\r\n?/g, "\n");
  let from = 0, oldTo = previous.length, newTo = value.length;
  while (from < oldTo && from < newTo && previous.charCodeAt(from) === value.charCodeAt(from)) from++;
  while (oldTo > from && newTo > from && previous.charCodeAt(oldTo - 1) === value.charCodeAt(newTo - 1)) { oldTo--; newTo--; }
  view.dispatch({ changes: from === oldTo && from === newTo ? undefined : { from, to: oldTo, insert: Text.of(value.slice(from, newTo).split("\n")) },
    effects: lineSeparator.reconfigure(EditorState.lineSeparator.of(separator(source))), annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] });
}
