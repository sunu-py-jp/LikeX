"use client";
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { Bold, Italic, Code, Link2, Heading1, Heading2, Heading3, List, ListOrdered, Quote, CodeSquare, Minus, Pilcrow, FileCode2, ListChecks } from "lucide-react";
import type { EditorAdapterProps, TextEditorAction, TextEditorSelection } from "../editor-adapter";
import { getMarkdownCompatibilityWarnings, isSafeMarkdownUrl, markdownCommand, markdownSchema, markdownSelectionAfterReplace, markdownTaskCommand, parseMarkdownDocument, richSelectionCommand, serializeMarkdownDocument } from "../markdown";
import type { MarkdownAction } from "../markdown";

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
const richSelection = (view: EditorView): TextEditorSelection => ({ coordinateSpace: "rich", ranges: [{ anchor: view.state.selection.anchor, head: view.state.selection.head }], mainIndex: 0 });

export function MarkdownEditor(props: MarkdownEditorProps) {
  const { value, editable, formatting, onSourceMode, ref: editorRef } = props;
  const mount = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), menuElement = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props), currentText = useRef(props.value), observedValue = useRef(props.value), submitted = useRef(new Set<string>()), generation = useRef(0), alive = useRef(false);
  const flow = useRef({ pending: false, queued: null as string | null });
  const [ready, setReady] = useState(false), [menu, updateMenu] = useState<SlashMenu | null>(null), menuRef = useRef<SlashMenu | null>(null);
  const [link, setLink] = useState<string | null>(null), [error, setError] = useState("");
  const warnings = useMemo(() => getMarkdownCompatibilityWarnings(value), [value]), canEdit = editable && warnings.length === 0;
  const policy = useRef(canEdit);
  const focused = useRef(false);
  function setMenu(value: SlashMenu | null) { menuRef.current = value; updateMenu(value); }
  const filteredBlocks = (query: string) => blocks.filter(item => `${item.title} ${item.keywords}`.toLowerCase().includes(query.toLowerCase()));

  function refreshMenu(view: EditorView) {
    if (!policy.current || latest.current.formatting === false || !view.state.selection.empty) { setMenu(null); return; }
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
    if (action === "indent" || action === "outdent") return richSelectionCommand(action)(view.state, view.dispatch);
    if (!action.startsWith("markdown.") || latest.current.formatting === false) return false;
    if (action === "markdown.link") {
      if (view.state.selection.empty) { setError("リンクにする文字を選択してください。"); return false; }
      const mark = view.state.selection.$from.marks().find(item => item.type === markdownSchema.marks.link);
      setLink(mark?.attrs.href ?? "https://"); setError(""); return true;
    }
    const result = markdownCommand(action as MarkdownAction)(view.state, view.dispatch); view.focus(); return result;
  }

  function chooseBlock(action: MarkdownAction) {
    const view = viewRef.current, current = menuRef.current;
    if (!view || !current || !policy.current || latest.current.formatting === false) return;
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
    if (editingChanged && canEdit) refreshMenu(view);
    if (props.value === observedValue.current) return;
    observedValue.current = props.value;
    if (props.value === currentText.current) { submitted.current.clear(); return; }
    if (submitted.current.has(props.value)) { submitted.current.delete(props.value); return; }
    if (props.value !== currentText.current) {
      generation.current++; flow.current.pending = false; flow.current.queued = null; currentText.current = props.value; submitted.current.clear();
      view.updateState(view.state.apply(markdownSelectionAfterReplace(view.state, parseMarkdownDocument(props.value))));
      setMenu(null);
    }
  });

  useEffect(() => {
    if (!mount.current) return;
    alive.current = true;
    generation.current++;
    const pending = flow.current;
    function restore() {
      const target = viewRef.current; currentText.current = latest.current.value; submitted.current.clear(); pending.queued = null;
      if (target) target.updateState(target.state.apply(markdownSelectionAfterReplace(target.state, parseMarkdownDocument(latest.current.value))));
      setMenu(null);
    }
    function flush() {
      if (pending.pending || pending.queued === null || !alive.current) return;
      const text = pending.queued, revision = generation.current; pending.queued = null; pending.pending = true; submitted.current.add(text);
      void Promise.resolve().then(() => latest.current.onChange(text)).then(accepted => {
        if (alive.current && revision === generation.current && !accepted) restore();
      }).catch(() => {
        if (!alive.current || revision !== generation.current) return;
        restore(); setError("変更を反映できませんでした。");
      }).finally(() => {
        if (!alive.current || revision !== generation.current) return;
        pending.pending = false; flush();
      });
    }
    const inline = (action: MarkdownAction) => () => run(action);
    const view = new EditorView(mount.current, {
      state: EditorState.create({ doc: parseMarkdownDocument(latest.current.value), plugins: [
        keymap({
          "Mod-z": () => { latest.current.onUndo(); return true; }, "Shift-Mod-z": () => { latest.current.onRedo(); return true; },
          "Mod-y": () => { latest.current.onRedo(); return true; }, "Mod-a": state => richSelectionCommand("selectAll")(state, viewRef.current?.dispatch),
          "Mod-b": inline("markdown.bold"), "Mod-i": inline("markdown.italic"), "Mod-e": inline("markdown.code"), "Mod-k": inline("markdown.link"),
          "Mod-Alt-1": inline("markdown.heading1"), "Mod-Alt-2": inline("markdown.heading2"), "Mod-Alt-3": inline("markdown.heading3"),
          "Shift-Mod-7": inline("markdown.orderedList"), "Shift-Mod-8": inline("markdown.bulletList"),
          "Mod-Enter": exitCode,
          Enter: chainCommands(splitListItem(markdownSchema.nodes.list_item), baseKeymap.Enter),
          Tab: sinkListItem(markdownSchema.nodes.list_item), "Shift-Tab": liftListItem(markdownSchema.nodes.list_item),
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
        if (!focused.current || !policy.current || latest.current.formatting === false || !(selection instanceof TextSelection) || !selection.empty)
          return DecorationSet.empty;
        const { $from } = selection;
        if ($from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), {
          class: "lxte-empty-paragraph", "data-placeholder": "/ でブロックを追加",
        })]);
      },
      handleDOMEvents: {
        focus(current) { focused.current = true; current.setProps({}); return false; },
        blur(current) { focused.current = false; current.setProps({}); return false; },
      },
      handleTextInput(current, from, to, text) {
        if (latest.current.formatting !== false) return false;
        if (policy.current) current.dispatch(current.state.tr.insertText(text, from, to));
        return true;
      },
      handlePaste(current, event) {
        if (latest.current.formatting !== false) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        if (policy.current) current.dispatch(current.state.tr.insertText(text));
        return true;
      },
      handleKeyDown(_view, event) {
        return handleMenuKey(event);
      },
      handleClick(current, _position, event) {
        const checkbox = (event.target as HTMLElement).closest?.(".lxte-task-checkbox");
        if (checkbox) {
          if (!policy.current) return true;
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
        const state = current.state.apply(transaction); current.updateState(state);
        try { latest.current.onSelectionChange?.(richSelection(current)); } catch { /* Selection observers cannot cancel edits. */ }
        refreshMenu(current);
        if (!transaction.docChanged) return;
        const text = serializeMarkdownDocument(state.doc);
        currentText.current = text; pending.queued = text; flush();
      },
    });
    viewRef.current = view; currentText.current = latest.current.value; setReady(true);
    return () => { alive.current = false; focused.current = false; view.destroy(); viewRef.current = null; };
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
  }));

  const menuItems = menu ? filteredBlocks(menu.query) : [];
  return <div className="lxte-markdown-editor" onKeyDownCapture={event => {
    // Options are outside ProseMirror, so own these keys even if focus moved
    // into the menu. Keep browser/editor cursor movement from scrolling below it.
    if ((event.target as HTMLElement).closest?.(".lxte-rich-document, .lxte-slash-menu") && handleMenuKey(event.nativeEvent)) { event.preventDefault(); event.stopPropagation(); }
  }}>
    {warnings.length > 0 && <div className="lxte-rich-compatibility" role="status"><span>{warnings.join("・")}を含む文書です。内容を保つためソースで編集できます。</span>{onSourceMode && <button type="button" onClick={onSourceMode}><FileCode2 size={15} />ソースで編集</button>}</div>}
    {formatting !== false && <div className="lxte-format-toolbar" role="toolbar" aria-label="Markdownの書式">
      <span className="lxte-block-picker"><select aria-label="ブロックの種類" disabled={!canEdit} value="" onChange={event => { run(event.target.value as MarkdownAction); }}><option value="">ブロック</option>{blocks.map(item => <option key={item.action} value={item.action}>{item.title}</option>)}</select></span>
      {([
        ["markdown.bold", "太字", Bold], ["markdown.italic", "斜体", Italic], ["markdown.code", "インラインコード", Code], ["markdown.link", "リンク", Link2],
        ["markdown.bulletList", "箇条書き", List], ["markdown.orderedList", "番号付きリスト", ListOrdered], ["markdown.quote", "引用", Quote],
      ] as const).map(([action, label, Icon]) => <button type="button" key={action} aria-label={label} title={label} disabled={!canEdit} onMouseDown={event => event.preventDefault()} onClick={() => run(action)}><Icon size={17} /></button>)}
    </div>}
    {link !== null && <form className="lxte-link-form" onSubmit={event => {
      event.preventDefault(); const view = viewRef.current;
      if (!view || !policy.current) return;
      if (link && !isSafeMarkdownUrl(link)) { setError("有効なリンク先を入力してください。"); return; }
      markdownCommand("markdown.link", { href: link })(view.state, view.dispatch); setLink(null); setError(""); view.focus();
    }}><label>リンク先<input autoFocus type="text" value={link} onChange={event => setLink(event.target.value)} placeholder="https://example.com" onKeyDown={event => { if (event.key === "Escape") setLink(null); }} /></label><button type="submit" disabled={!canEdit}>適用</button><button type="button" onClick={() => setLink(null)}>閉じる</button></form>}
    {error && <div className="lxte-rich-error" role="alert">{error}<button type="button" onClick={() => setError("")}>閉じる</button></div>}
    <div className="lxte-rich-scroll" ref={wrapper}>
      <div className="lxte-rich-page"><div ref={mount} />{!ready && <pre className="lxte-rich-fallback">{value}</pre>}</div>
      {menu && <div ref={menuElement} className="lxte-slash-menu" role="listbox" aria-label="ブロックを追加" style={{ top: menu.top, left: menu.left, maxHeight: menu.maxHeight }}>
        <div className="lxte-slash-title">ブロックを追加</div>
        {menuItems.length === 0 ? <p>一致するブロックがありません。</p> : menuItems.map((item, index) => <button key={item.action} type="button" role="option" aria-selected={index === menu.index} onMouseDown={event => event.preventDefault()} onClick={() => chooseBlock(item.action)}><item.Icon size={20} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}
      </div>}
    </div>
  </div>;
}
