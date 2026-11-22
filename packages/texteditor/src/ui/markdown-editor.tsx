"use client";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorState, Selection, TextSelection, type Command } from "prosemirror-state";
import { Decoration, EditorView } from "prosemirror-view";
import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { Bold, Italic, Code, Link2, Heading1, Heading2, Heading3, List, ListOrdered, Quote, CodeSquare, Minus, Pilcrow, FileCode2, ListChecks } from "lucide-react";
import type { EditorAdapterProps, TextEditorAction, TextEditorPanel, TextEditorSelection } from "../editor-adapter";
import { getMarkdownCompatibilityWarnings, isSafeMarkdownUrl, markdownCommand, markdownSchema, markdownSelectionAfterReplace, markdownTaskCommand, parseMarkdownDocument, richSelectionCommand } from "../markdown";
import type { MarkdownAction } from "../markdown";
import { serializeMarkdownBlocks } from "../markdown/serializer";
import { checkedText } from "../model/validation";
import { createMarkdownViewport, type MarkdownViewport } from "./markdown-viewport";

export type MarkdownEditorProps = EditorAdapterProps & { onSourceMode?(): void; formatting?: boolean };
const blocks = [
  { action: "markdown.paragraph", title: "本文", description: "普通のテキスト", keywords: "text paragraph", Icon: Pilcrow },
  { action: "markdown.heading1", title: "見出し 1", description: "大きな見出し", keywords: "h1 heading", Icon: Heading1 },
  { action: "markdown.heading2", title: "見出し 2", description: "中くらいの見出し", keywords: "h2 heading", Icon: Heading2 },
  { action: "markdown.heading3", title: "見出し 3", description: "小さな見出し", keywords: "h3 heading", Icon: Heading3 },
  { action: "markdown.bulletList", title: "箇条書き", description: "点付きのリスト", keywords: "bullet list", Icon: List },
  { action: "markdown.orderedList", title: "番号付きリスト", description: "順番のあるリスト", keywords: "number list", Icon: ListOrdered },
  { action: "markdown.taskList", title: "チェックリスト", description: "完了をチェックできるリスト", keywords: "task todo check", Icon: ListChecks },
  { action: "markdown.quote", title: "引用", description: "引用文やメモ", keywords: "quote", Icon: Quote },
  { action: "markdown.codeBlock", title: "コードブロック", description: "コードを等幅で表示", keywords: "code", Icon: CodeSquare },
  { action: "markdown.divider", title: "区切り線", description: "セクションを区切る", keywords: "divider rule", Icon: Minus },
] as const;
type SlashMenu = { from: number; to: number; query: string; index: number; top: number; left: number; maxHeight: number };
/** The source shown until the editor has mounted. A long document only needs its first screens there. */
const FALLBACK_LENGTH = 20_000;
const mac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
/**
 * Moves to the start or end of the document through the model. The browser's own shortcut stops
 * at the last rendered block when the rest of a large document is not on the page.
 */
const documentEdge = (end: boolean, extend: boolean): Command => (state, dispatch) => {
  const target = end ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
  dispatch?.(state.tr.setSelection(extend ? TextSelection.between(state.selection.$anchor, target.$head) : target).scrollIntoView());
  return true;
};
const edgeKeys = Object.fromEntries((mac ? [["Mod-ArrowUp", false], ["Mod-ArrowDown", true]] as const : [["Mod-Home", false], ["Mod-End", true]] as const)
  .flatMap(([key, end]) => [[key, documentEdge(end, false)], [`Shift-${key}`, documentEdge(end, true)]]));
/** Keys that let the browser move the caret: arrows, paging, line ends and the macOS Ctrl+letter movements. */
const movesCaret = (event: KeyboardEvent) => /^(Arrow|Page|Home$|End$)/.test(event.key) || mac && event.ctrlKey && "npfbae".includes(event.key.toLowerCase());
const richSelection = (view: EditorView): TextEditorSelection => ({ coordinateSpace: "rich", ranges: [{ anchor: view.state.selection.anchor, head: view.state.selection.head }], mainIndex: 0 });

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, editable, formatting, onSourceMode, ref: editorRef } = props;
  const mount = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), menuElement = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props), currentText = useRef(props.value), observedValue = useRef(props.value), generation = useRef(0), alive = useRef(false);
  // Markdown this editor wrote and has not seen come back yet, with the warnings found while writing it.
  const [submitted] = useState(() => new Map<string, readonly string[]>()), viewport = useRef<MarkdownViewport | null>(null);
  const flow = useRef({ pending: false, queued: null as { text: string; warnings: readonly string[] } | null });
  const [ready, setReady] = useState(false), [menu, updateMenu] = useState<SlashMenu | null>(null), menuRef = useRef<SlashMenu | null>(null);
  const [link, updateLink] = useState<string | null>(null), linkRef = useRef<string | null>(null), [error, setError] = useState("");
  const observed = useRef({ panels: "", pending: false });
  // A value this editor wrote was checked block by block when it was serialized; anything else is checked in full.
  const warnings = useMemo(() => submitted.get(value) ?? getMarkdownCompatibilityWarnings(value), [value, submitted]), canEdit = editable && warnings.length === 0;
  const policy = useRef(canEdit);
  const focused = useRef(false);
  function formattingAllowed() { return latest.current.formatting !== false && latest.current.formattingEnabled !== false; }
  function openPanels(): readonly TextEditorPanel[] { return [...(linkRef.current !== null ? ["link" as const] : []), ...(menuRef.current ? ["blocks" as const] : [])]; }
  function notifyPanels() {
    const panels = openPanels(), key = panels.join(",");
    if (observed.current.panels === key) return;
    observed.current.panels = key;
    try { latest.current.onPanelsChange?.(panels); } catch { /* Panel observers do not cancel the interaction. */ }
  }
  function setMenu(value: SlashMenu | null) { menuRef.current = value; updateMenu(value); notifyPanels(); }
  function setLink(value: string | null) { linkRef.current = value; updateLink(value); notifyPanels(); }
  function notifyPending(value: boolean) {
    if (observed.current.pending === value) return;
    observed.current.pending = value;
    try { latest.current.onPendingChange?.(value); } catch { /* Pending observers do not cancel changes. */ }
  }
  const filteredBlocks = (query: string) => blocks.filter(item => `${item.title} ${item.keywords}`.toLowerCase().includes(query.toLowerCase()));

  function refreshMenu(view: EditorView) {
    if (!policy.current || !formattingAllowed() || !view.state.selection.empty) { setMenu(null); return; }
    const { $from } = view.state.selection, match = /^\/([^\n/]*)$/.exec($from.parent.textContent);
    if ($from.parent.type.name !== "paragraph" || !match || $from.parentOffset !== $from.parent.content.size) { setMenu(null); return; }
    const rect = wrapper.current?.getBoundingClientRect(), point = view.coordsAtPos($from.pos);
    const offset = wrapper.current?.scrollTop ?? 0, viewportHeight = rect?.height ?? 600;
    const menuHeight = Math.min(340, 37 + filteredBlocks(match[1]).length * 48);
    const edge = Math.min(8, viewportHeight / 2), bottomEdge = viewportHeight - edge;
    const below = Math.max(edge, Math.min(point.bottom - (rect?.top ?? 0) + 6, bottomEdge));
    const above = Math.max(edge, Math.min(point.top - (rect?.top ?? 0) - 6, bottomEdge));
    const spaceBelow = bottomEdge - below, spaceAbove = above - edge;
    const opensBelow = spaceBelow >= Math.min(menuHeight, 180) || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(menuHeight, opensBelow ? spaceBelow : spaceAbove);
    const top = opensBelow ? below : above - maxHeight;
    setMenu({ from: $from.start(), to: $from.end(), query: match[1], index: menuRef.current?.query === match[1] ? menuRef.current.index : 0,
      top: top + offset, maxHeight,
      left: Math.max(8, Math.min(point.left - (rect?.left ?? 0), (rect?.width ?? 600) - 285)) });
  }

  function run(action: TextEditorAction): boolean {
    const view = viewRef.current;
    if (!view) return false;
    if (action === "undo") { latest.current.onUndo(); return true; }
    if (action === "redo") { latest.current.onRedo(); return true; }
    if (action === "commandPalette") { latest.current.onCommandPalette?.(); return true; }
    if (action === "selectAll" || action === "selectLine") { const result = richSelectionCommand(action)(view.state, view.dispatch); view.focus(); return result; }
    if (!policy.current) return false;
    if (action === "indent" || action === "outdent") return formattingAllowed() && richSelectionCommand(action)(view.state, view.dispatch);
    if (!action.startsWith("markdown.") || !formattingAllowed()) return false;
    if (action === "markdown.link") {
      if (view.state.selection.empty) { setError("リンクにする文字を選択してください。"); return false; }
      const mark = view.state.selection.$from.marks().find(item => item.type === markdownSchema.marks.link);
      setLink(mark?.attrs.href ?? "https://"); setError(""); return true;
    }
    const result = markdownCommand(action as MarkdownAction)(view.state, view.dispatch); view.focus(); return result;
  }

  function chooseBlock(action: MarkdownAction) {
    const view = viewRef.current, current = menuRef.current;
    if (!view || !current || !policy.current || !formattingAllowed()) return;
    const transaction = view.state.tr.delete(current.from, current.to), staged = view.state.apply(transaction);
    markdownCommand(action)(staged, result => { for (const step of result.steps) transaction.step(step); transaction.setSelection(Selection.fromJSON(transaction.doc, result.selection.toJSON())); });
    setMenu(null); view.dispatch(transaction.scrollIntoView()); view.focus();
  }

  function handleMenuKey(event: { key: string; isComposing?: boolean }): boolean {
    const current = menuRef.current;
    if (!current || event.isComposing) return false;
    const items = filteredBlocks(current.query);
    if (event.key === "Escape") { setMenu(null); return true; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = Math.max(1, items.length);
      setMenu({ ...current, index: (current.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count });
      return true;
    }
    if (event.key === "Enter" && items[current.index]) { chooseBlock(items[current.index].action); return true; }
    return false;
  }

  useLayoutEffect(() => {
    const list = menuElement.current, selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    // scrollIntoView would also move the document/page. Only move this list.
    const top = selected.offsetTop, bottom = top + selected.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [menu?.index, menu?.query, menu?.maxHeight]);

  useLayoutEffect(() => {
    const editingChanged = policy.current !== canEdit;
    latest.current = props; policy.current = canEdit;
    const view = viewRef.current;
    if (!view) return;
    view.setProps({ editable: () => policy.current });
    if (!canEdit || !formattingAllowed()) { if (menuRef.current) setMenu(null); if (linkRef.current !== null) setLink(null); }
    if (editingChanged && canEdit) refreshMenu(view);
    if (props.value === observedValue.current) return;
    observedValue.current = props.value;
    if (props.value === currentText.current) { submitted.clear(); return; }
    if (submitted.has(props.value)) { submitted.delete(props.value); return; }
    if (props.value !== currentText.current) {
      generation.current++; flow.current.pending = false; flow.current.queued = null; currentText.current = props.value; submitted.clear();
      notifyPending(false);
      viewport.current?.updateState(view.state.apply(markdownSelectionAfterReplace(view.state, parseMarkdownDocument(props.value))));
      setMenu(null);
    }
  });

  useEffect(() => {
    if (!mount.current) return;
    alive.current = true;
    generation.current++;
    const pending = flow.current;
    function restore() {
      const target = viewRef.current; currentText.current = latest.current.value; submitted.clear(); pending.queued = null;
      if (target) windowing.updateState(target.state.apply(markdownSelectionAfterReplace(target.state, parseMarkdownDocument(latest.current.value))));
      setMenu(null);
    }
    function flush() {
      if (pending.pending || pending.queued === null || !alive.current) return;
      const text = pending.queued.text, revision = generation.current; submitted.set(text, pending.queued.warnings); pending.queued = null; pending.pending = true;
      void Promise.resolve().then(() => alive.current && revision === generation.current ? latest.current.onChange(text) : false).then(accepted => {
        if (alive.current && revision === generation.current && !accepted) restore();
      }).catch(() => {
        if (!alive.current || revision !== generation.current) return;
        restore(); setError("変更を反映できませんでした。");
      }).finally(() => {
        if (!alive.current || revision !== generation.current) return;
        pending.pending = false;
        if (pending.queued !== null) flush(); else notifyPending(false);
      });
    }
    const inline = (action: MarkdownAction) => () => run(action);
    const windowing = createMarkdownViewport(() => wrapper.current), initial = parseMarkdownDocument(latest.current.value);
    const view = new EditorView(mount.current, {
      nodeViews: windowing.nodeViews(initial),
      state: EditorState.create({ doc: initial, plugins: [
        keymap({
          "Mod-z": () => { latest.current.onUndo(); return true; }, "Shift-Mod-z": () => { latest.current.onRedo(); return true; },
          "Mod-y": () => { latest.current.onRedo(); return true; }, "Mod-a": state => richSelectionCommand("selectAll")(state, viewRef.current?.dispatch),
          "Mod-b": inline("markdown.bold"), "Mod-i": inline("markdown.italic"), "Mod-e": inline("markdown.code"), "Mod-k": inline("markdown.link"),
          "Mod-Alt-1": inline("markdown.heading1"), "Mod-Alt-2": inline("markdown.heading2"), "Mod-Alt-3": inline("markdown.heading3"),
          "Shift-Mod-7": inline("markdown.orderedList"), "Shift-Mod-8": inline("markdown.bulletList"),
          "Mod-Enter": exitCode, ...edgeKeys,
          Enter: chainCommands(splitListItem(markdownSchema.nodes.list_item), baseKeymap.Enter),
          Tab: (state, dispatch) => !formattingAllowed() || sinkListItem(markdownSchema.nodes.list_item)(state, dispatch),
          "Shift-Tab": (state, dispatch) => !formattingAllowed() || liftListItem(markdownSchema.nodes.list_item)(state, dispatch),
        }),
        inputRules({ rules: [
          textblockTypeInputRule(/^(#{1,6})\s$/, markdownSchema.nodes.heading, match => ({ level: match[1].length })),
          textblockTypeInputRule(/^```\s$/, markdownSchema.nodes.code_block),
          wrappingInputRule(/^>\s$/, markdownSchema.nodes.blockquote),
          wrappingInputRule(/^\s*([-+*])\s$/, markdownSchema.nodes.bullet_list),
          wrappingInputRule(/^(\d+)\.\s$/, markdownSchema.nodes.ordered_list, match => ({ order: +match[1] })),
          new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type === markdownSchema.nodes.list_item)
              return state.tr.delete(start, end).setNodeMarkup($from.before(depth), undefined, { checked: match[1] !== " " });
            return null;
          }),
        ] }),
        keymap(baseKeymap),
      ] }),
      editable: () => policy.current,
      attributes: { class: "lxte-rich-document", "aria-label": "Markdownの本文", role: "textbox", "aria-multiline": "true", tabindex: "0" },
      decorations(state) {
        const { selection } = state;
        if (!focused.current || !policy.current || !formattingAllowed() || !(selection instanceof TextSelection) || !selection.empty)
          return windowing.decorations(state, []);
        const { $from } = selection;
        if ($from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return windowing.decorations(state, []);
        return windowing.decorations(state, [Decoration.node($from.before(), $from.after(), {
          class: "lxte-empty-paragraph", "data-placeholder": "/ でブロックを追加",
        })]);
      },
      handleDOMEvents: {
        focus(current) { focused.current = true; current.setProps({}); return false; },
        blur(current) { focused.current = false; current.setProps({}); return false; },
      },
      handleTextInput(current, from, to, text) {
        if (formattingAllowed()) return false;
        if (policy.current) current.dispatch(current.state.tr.insertText(text, from, to));
        return true;
      },
      handlePaste(current, event) {
        if (formattingAllowed()) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        if (policy.current) current.dispatch(current.state.tr.insertText(text));
        return true;
      },
      handleKeyDown(_view, event) {
        if (handleMenuKey(event)) return true;
        // Page keys move the caret on Windows and Linux; on macOS they only scroll.
        if (movesCaret(event)) windowing.prepareNavigation(!mac && event.key.startsWith("Page"));
        return false;
      },
      handleClick(current, _position, event) {
        const checkbox = (event.target as HTMLElement).closest?.(".lxte-task-checkbox");
        if (checkbox) {
          if (!policy.current || !formattingAllowed()) return true;
          const position = current.posAtDOM(checkbox.closest("li")!, 0), resolved = current.state.doc.resolve(position);
          for (let depth = resolved.depth; depth > 0; depth--) if (resolved.node(depth).type === markdownSchema.nodes.list_item) {
            markdownTaskCommand(resolved.before(depth))(current.state, current.dispatch); break;
          }
          return true;
        }
        const anchor = (event.target as HTMLElement).closest?.("a");
        if (anchor && policy.current && !(event.ctrlKey || event.metaKey)) return true;
        return false;
      },
      dispatchTransaction(transaction) {
        const current = viewRef.current;
        if (!current || transaction.docChanged && !policy.current) return;
        const state = current.state.apply(transaction); windowing.updateState(state);
        try { latest.current.onSelectionChange?.(richSelection(current)); } catch { /* Selection observers cannot cancel edits. */ }
        refreshMenu(current);
        if (!transaction.docChanged) return;
        // The document comes from editor transactions, so it is valid; only the size limit is checked here.
        const written = serializeMarkdownBlocks(state.doc, true);
        currentText.current = checkedText(written.text, "Markdown"); pending.queued = written; notifyPending(true); flush();
      },
    });
    viewRef.current = view; viewport.current = windowing; windowing.attach(view); currentText.current = latest.current.value; setReady(true);
    return () => { alive.current = false; focused.current = false; pending.pending = false; pending.queued = null; notifyPending(false); windowing.destroy(); viewport.current = null; view.destroy(); viewRef.current = null; };
    // The view is created once; callbacks read current options through latest/policy refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(editorRef, () => ({
    isReady: () => !!viewRef.current,
    focus: () => viewRef.current?.focus(), runCommand: run,
    getSelection: () => viewRef.current ? richSelection(viewRef.current) : { coordinateSpace: "rich", ranges: [{ anchor: 1, head: 1 }], mainIndex: 0 },
    setSelection(selection) {
      const view = viewRef.current, range = selection.ranges[selection.mainIndex];
      if (!view || selection.coordinateSpace !== "rich" || !range) return;
      if (selection.ranges.length !== 1 || ![range.anchor, range.head].every(position => Number.isInteger(position) && position >= 0 && position <= view.state.doc.content.size)) throw new RangeError("Markdownの選択位置が不正です。リッチ編集では1つの範囲を指定してください。");
      view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(range.anchor), view.state.doc.resolve(range.head))).scrollIntoView());
    },
    goToLine: () => false,
    getOpenPanels: openPanels,
    closePanel(panel) {
      if (panel === "link" && linkRef.current !== null) { setLink(null); return true; }
      if (panel === "blocks" && menuRef.current) { setMenu(null); return true; }
      return false;
    },
  }));

  const menuItems = menu ? filteredBlocks(menu.query) : [];
  return <div className="lxte-markdown-editor" onKeyDownCapture={event => {
    // Options are outside ProseMirror, so own these keys even if focus moved
    // into the menu. Keep browser/editor cursor movement from scrolling below it.
    if ((event.target as HTMLElement).closest?.(".lxte-rich-document, .lxte-slash-menu") && handleMenuKey(event.nativeEvent)) { event.preventDefault(); event.stopPropagation(); }
  }}>
    {warnings.length > 0 && <div className="lxte-rich-compatibility" role="status"><span>{warnings.join("・")}を含む文書です。内容を保つためソースで編集できます。</span>{onSourceMode && <button type="button" onClick={onSourceMode}><FileCode2 size={15} />ソースで編集</button>}</div>}
    {formatting !== false && props.formattingEnabled !== false && <div className="lxte-format-toolbar" role="toolbar" aria-label="Markdownの書式">
      <span className="lxte-block-picker"><select aria-label="ブロックの種類" disabled={!canEdit} value="" onChange={event => { run(event.target.value as MarkdownAction); }}><option value="">ブロック</option>{blocks.map(item => <option key={item.action} value={item.action}>{item.title}</option>)}</select></span>
      {([
        ["markdown.bold", "太字", Bold], ["markdown.italic", "斜体", Italic], ["markdown.code", "インラインコード", Code], ["markdown.link", "リンク", Link2],
        ["markdown.bulletList", "箇条書き", List], ["markdown.orderedList", "番号付きリスト", ListOrdered], ["markdown.quote", "引用", Quote],
      ] as const).map(([action, label, Icon]) => <button type="button" key={action} aria-label={label} title={label} disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => run(action)}><Icon size={17} /></button>)}
    </div>}
    {link !== null && <form className="lxte-link-form" onSubmit={event => {
      event.preventDefault(); const view = viewRef.current;
      if (!view || !policy.current || !formattingAllowed()) return;
      if (link && !isSafeMarkdownUrl(link)) { setError("有効なリンク先を入力してください。"); return; }
      markdownCommand("markdown.link", { href: link })(view.state, view.dispatch); setLink(null); setError(""); view.focus();
    }}><label>リンク先<input autoFocus type="text" value={link} onChange={event => setLink(event.target.value)} placeholder="https://example.com" onKeyDown={event => { if (event.key === "Escape") setLink(null); }} /></label><button type="submit" disabled={!canEdit}>適用</button><button type="button" onClick={() => setLink(null)}>閉じる</button></form>}
    {error && <div className="lxte-rich-error" role="alert">{error}<button type="button" onClick={() => setError("")}>閉じる</button></div>}
    <div className="lxte-rich-scroll" ref={wrapper}>
      <div className="lxte-rich-page"><div ref={mount} />{!ready && <pre className="lxte-rich-fallback">{value.length > FALLBACK_LENGTH ? value.slice(0, FALLBACK_LENGTH) : value}</pre>}</div>
      {menu && <div ref={menuElement} className="lxte-slash-menu" role="listbox" aria-label="ブロックを追加" style={{ top: menu.top, left: menu.left, maxHeight: menu.maxHeight }}>
        <div className="lxte-slash-title">ブロックを追加</div>
        {menuItems.length === 0 ? <p>一致するブロックがありません。</p> : menuItems.map((item, index) => <button key={item.action} type="button" role="option" aria-selected={index === menu.index} onMouseDown={event => event.preventDefault()} onClick={() => chooseBlock(item.action)}><item.Icon size={20} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}
      </div>}
    </div>
  </div>;
}
