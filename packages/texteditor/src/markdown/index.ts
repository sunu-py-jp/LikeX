import { Fragment, Schema, type Node as MarkdownNode, type NodeSpec, type MarkSpec } from "prosemirror-model";
import { AllSelection, EditorState, Selection, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer, schema } from "prosemirror-markdown";
import { checkedOffset, checkedText, record } from "../model/validation";

export type MarkdownAction = "markdown.paragraph" | "markdown.heading1" | "markdown.heading2" | "markdown.heading3"
  | "markdown.bulletList" | "markdown.orderedList" | "markdown.taskList" | "markdown.quote" | "markdown.codeBlock"
  | "markdown.divider" | "markdown.bold" | "markdown.italic" | "markdown.code" | "markdown.link";
export type MarkdownSelection = { from: number; to: number };
export type MarkdownCommandOptions = { href?: string; title?: string };
const markdownActions: ReadonlySet<string> = new Set([
  "markdown.paragraph", "markdown.heading1", "markdown.heading2", "markdown.heading3",
  "markdown.bulletList", "markdown.orderedList", "markdown.taskList", "markdown.quote", "markdown.codeBlock",
  "markdown.divider", "markdown.bold", "markdown.italic", "markdown.code", "markdown.link",
]);

function validateMarkdownCommand(action: MarkdownAction, options: MarkdownCommandOptions): void {
  if (typeof action !== "string" || !markdownActions.has(action)) throw new Error("未対応のMarkdown書式操作です。");
  const raw = record(options, ["href", "title"], "Markdown書式設定");
  if (action !== "markdown.link" && (raw.href !== undefined || raw.title !== undefined)) throw new Error("URLとタイトルはリンク操作でのみ指定できます。");
  if (raw.href !== undefined) {
    const href = checkedText(raw.href, "リンクURL");
    if (href !== "" && !isSafeMarkdownUrl(href)) throw new Error("リンクにはhttp(s)・メール・電話・相対URLを指定してください。");
  }
  if (raw.title !== undefined) checkedText(raw.title, "リンクタイトル");
}

/** Reject active-content URLs, including controls that browsers strip before navigation. */
export function isSafeMarkdownUrl(value: unknown, image = false): value is string {
  if (typeof value !== "string" || !value || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (/^(https?:)/i.test(value)) return true;
  if (!image && /^(mailto:|tel:)/i.test(value)) return true;
  return !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("//") && !value.includes("\\");
}

const safeLink: MarkSpec = {
  ...schema.spec.marks.get("link"),
  attrs: { href: {}, title: { default: null } },
  parseDOM: [{ tag: "a[href]", getAttrs: element => {
    const href = element.getAttribute("href");
    return isSafeMarkdownUrl(href) ? { href, title: element.getAttribute("title") } : false;
  } }],
  toDOM: mark => isSafeMarkdownUrl(mark.attrs.href)
    ? ["a", { href: mark.attrs.href, title: mark.attrs.title, rel: "noopener noreferrer", target: "_blank" }, 0]
    : ["span", 0],
};
const safeImage: NodeSpec = {
  ...schema.spec.nodes.get("image"),
  inline: true, group: "inline",
  attrs: { src: {}, alt: { default: null }, title: { default: null } },
  parseDOM: [{ tag: "img[src]", getAttrs: element => {
    const src = element.getAttribute("src");
    return isSafeMarkdownUrl(src, true) ? { src, alt: element.getAttribute("alt"), title: element.getAttribute("title") } : false;
  } }],
  toDOM: node => isSafeMarkdownUrl(node.attrs.src, true)
    ? ["img", { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title, loading: "lazy", referrerpolicy: "no-referrer" }]
    : ["span", { class: "lxte-image-placeholder" }, node.attrs.alt || "画像"],
};
const taskListItem: NodeSpec = {
  ...schema.spec.nodes.get("list_item"), content: "block+", defining: true,
  attrs: { checked: { default: null } },
  parseDOM: [{ tag: "li", getAttrs: element => ({ checked: element.hasAttribute("data-task-checked") ? element.getAttribute("data-task-checked") === "true" : null }) }],
  toDOM: node => node.attrs.checked === null ? ["li", 0]
    : ["li", { class: "lxte-task-item", "data-task-checked": String(node.attrs.checked) },
      ["button", { type: "button", contenteditable: "false", class: "lxte-task-checkbox", role: "checkbox", "aria-checked": String(node.attrs.checked), "aria-label": node.attrs.checked ? "未完了にする" : "完了にする" }, node.attrs.checked ? "✓" : ""], ["div", 0]],
};

/** CommonMark schema shared by the visual editor and DOM-free formatting commands. */
export const markdownSchema = new Schema({
  nodes: schema.spec.nodes.update("image", safeImage).update("list_item", taskListItem),
  marks: schema.spec.marks.update("link", safeLink),
});
const parser = new MarkdownParser(markdownSchema, defaultMarkdownParser.tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: { block: "list_item", getAttrs: (_token, tokens, index) => {
    const inline = tokens[index + 2], match = inline?.type === "inline" && /^\[([ xX])\]\s/.exec(inline.content);
    return { checked: match ? match[1] !== " " : null };
  } },
});
const serializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  list_item(state, node) { if (node.attrs.checked !== null) state.write(node.attrs.checked ? "[x] " : "[ ] "); state.renderContent(node); },
}, defaultMarkdownSerializer.marks);

function recognizeTasks(node: MarkdownNode): MarkdownNode {
  if (node.isLeaf) return node;
  const children: MarkdownNode[] = []; node.forEach(child => children.push(recognizeTasks(child)));
  const content = Fragment.from(children), first = content.firstChild;
  if (node.type.name === "list_item" && node.attrs.checked !== null && first?.type.name === "paragraph") {
    const match = /^\[([ xX])\]\s/.exec(first.textContent);
    if (match) {
      children[0] = first.copy(first.content.cut(match[0].length));
      return node.type.create({ ...node.attrs, checked: match[1] !== " " }, children, node.marks);
    }
  }
  return node.copy(content);
}

export function parseMarkdownDocument(source: string): MarkdownNode {
  return recognizeTasks(parser.parse(checkedText(source, "Markdown")));
}
export function serializeMarkdownDocument(document: MarkdownNode): string {
  document.check();
  return checkedText(serializer.serialize(document), "Markdown");
}

/** Extensions outside this editor's CommonMark scope remain editable in source mode. */
export function getMarkdownCompatibilityWarnings(source: string): string[] {
  const warnings = new Set<string>();
  // Tokenization distinguishes code fences/inline code from extension-like text.
  const tokens = defaultMarkdownParser.tokenizer.parse(checkedText(source, "Markdown"), {});
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    const text = maskInlineLiterals(token.content);
    if (hasHtmlTag(text)) warnings.add("HTML");
    if (/~~[^~]+~~/.test(text)) warnings.add("取り消し線");
    if (/(?:^|\n)\s*\|?\s*:?-{3,}:?\s*\|[| :\-]*$/.test(text)
      || /(?:^|\n)\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|?)+/m.test(text)) warnings.add("表");
  }
  return [...warnings];
}

function maskInlineLiterals(source: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "\\") { output += " "; index += 2; continue; }
    if (source[index] === "`") {
      let end = index + 1; while (source[end] === "`") end++;
      const delimiter = source.slice(index, end), close = source.indexOf(delimiter, end);
      if (close >= 0) { output += " "; index = close + delimiter.length; continue; }
      output += delimiter; index = end; continue;
    }
    output += source[index++];
  }
  return output;
}
function hasHtmlTag(source: string): boolean {
  for (let index = source.indexOf("<"); index >= 0; index = source.indexOf("<", index + 1)) {
    if (!/[a-z/!]/i.test(source[index + 1] ?? "")) continue;
    const end = source.indexOf(">", index + 1);
    if (end < 0) return false;
    // CommonMark autolinks remain supported; active/raw HTML stays in source mode.
    if (!/^<(?:https?:\/\/|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@)/i.test(source.slice(index, end + 1))) return true;
    index = end;
  }
  return false;
}

function ancestorPosition(state: EditorState, name: string): number | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === name) return $from.before(depth);
  return undefined;
}
function listCommand(kind: "bullet_list" | "ordered_list"): Command {
  return (state, dispatch) => {
    if (ancestorPosition(state, kind) !== undefined) return liftListItem(markdownSchema.nodes.list_item)(state, dispatch);
    const other = ancestorPosition(state, kind === "bullet_list" ? "ordered_list" : "bullet_list");
    if (other !== undefined) { dispatch?.(state.tr.setNodeMarkup(other, markdownSchema.nodes[kind], { order: 1, tight: true })); return true; }
    return wrapInList(markdownSchema.nodes[kind], { order: 1, tight: true })(state, dispatch);
  };
}
function changingTaskBlock(command: Command): Command {
  return (state, dispatch) => {
    const transaction = state.tr;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
      if (node.type.name === "list_item" && node.attrs.checked !== null) transaction.setNodeMarkup(position, undefined, { ...node.attrs, checked: null });
    });
    const staged = transaction.docChanged ? state.apply(transaction) : state;
    return command(staged, dispatch && (result => {
      for (const step of result.steps) transaction.step(step);
      transaction.setSelection(Selection.fromJSON(transaction.doc, result.selection.toJSON()));
      dispatch(transaction);
    }));
  };
}

/** Pure ProseMirror command: the GUI and headless formatting API use the same logic. */
export function markdownCommand(action: MarkdownAction, options: MarkdownCommandOptions = {}): Command {
  validateMarkdownCommand(action, options);
  switch (action) {
    case "markdown.bold": return toggleMark(markdownSchema.marks.strong);
    case "markdown.italic": return toggleMark(markdownSchema.marks.em);
    case "markdown.code": return toggleMark(markdownSchema.marks.code);
    case "markdown.paragraph": return setBlockType(markdownSchema.nodes.paragraph);
    case "markdown.heading1": case "markdown.heading2": case "markdown.heading3":
      return changingTaskBlock(setBlockType(markdownSchema.nodes.heading, { level: Number(action.at(-1)) }));
    case "markdown.codeBlock": return changingTaskBlock(setBlockType(markdownSchema.nodes.code_block));
    case "markdown.bulletList": return listCommand("bullet_list");
    case "markdown.orderedList": return listCommand("ordered_list");
    case "markdown.taskList": return (state, dispatch) => {
      let staged = state, transaction = state.tr;
      if (ancestorPosition(state, "bullet_list") === undefined && ancestorPosition(state, "ordered_list") === undefined) {
        const wrapped = wrapInList(markdownSchema.nodes.bullet_list, { tight: true })(state, result => { transaction = result; staged = state.apply(result); });
        if (!wrapped) return false;
      }
      const positions: number[] = [];
      staged.doc.nodesBetween(staged.selection.from, staged.selection.to, (node, position) => { if (node.type.name === "list_item") positions.push(position); });
      for (const position of positions) {
        const node = transaction.doc.nodeAt(position)!;
        if (node.firstChild?.isTextblock && node.firstChild.type.name !== "paragraph") transaction.setNodeMarkup(position + 1, markdownSchema.nodes.paragraph);
        if (transaction.doc.nodeAt(position)?.firstChild?.type.name !== "paragraph") return false;
        transaction.setNodeMarkup(position, undefined, { ...node.attrs, checked: node.attrs.checked === null ? false : null });
      }
      dispatch?.(transaction); return positions.length > 0;
    };
    case "markdown.quote": return changingTaskBlock((state, dispatch) => ancestorPosition(state, "blockquote") !== undefined
      ? lift(state, dispatch) : wrapIn(markdownSchema.nodes.blockquote)(state, dispatch));
    case "markdown.divider": return changingTaskBlock((state, dispatch) => {
      const transaction = state.tr.replaceSelectionWith(markdownSchema.nodes.horizontal_rule.create());
      if (transaction.doc.lastChild?.type.name === "horizontal_rule") transaction.insert(transaction.doc.content.size, markdownSchema.nodes.paragraph.create());
      dispatch?.(transaction.scrollIntoView()); return true;
    });
    case "markdown.link": return (state, dispatch) => {
      if (state.selection.empty) return false;
      if (options.href === "") { dispatch?.(state.tr.removeMark(state.selection.from, state.selection.to, markdownSchema.marks.link)); return true; }
      if (!isSafeMarkdownUrl(options.href)) throw new Error("リンクにはhttp(s)・メール・電話・相対URLを指定してください。");
      dispatch?.(state.tr.addMark(state.selection.from, state.selection.to, markdownSchema.marks.link.create({ href: options.href, title: options.title ?? null })));
      return true;
    };
  }
}

/** Toggle one parsed task item. Position is the position immediately before the list item. */
export function markdownTaskCommand(position: number): Command {
  return (state, dispatch) => {
    if (!Number.isInteger(position) || position < 0 || position > state.doc.content.size) return false;
    const node = state.doc.nodeAt(position);
    if (node?.type !== markdownSchema.nodes.list_item || typeof node.attrs.checked !== "boolean") return false;
    dispatch?.(state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: !node.attrs.checked })); return true;
  };
}

/** Positions refer to the parsed rich document, not Markdown source offsets. */
export function applyMarkdownCommand(source: string, selection: MarkdownSelection, action: MarkdownAction, options: MarkdownCommandOptions = {}): { text: string; selection: MarkdownSelection; changed: boolean } {
  validateMarkdownCommand(action, options);
  const raw = record(selection, ["from", "to"], "Markdownの選択範囲");
  if (getMarkdownCompatibilityWarnings(source).length) throw new Error("このMarkdownの拡張記法はソースモードで編集してください。");
  const document = parseMarkdownDocument(source);
  const from = checkedOffset(raw.from, document.content.size), to = checkedOffset(raw.to, document.content.size);
  if (from > to)
    throw new RangeError("Markdownの選択位置が不正です。");
  let state = EditorState.create({ doc: document, selection: TextSelection.between(document.resolve(from), document.resolve(to)) });
  let changed = false;
  markdownCommand(action, options)(state, transaction => { state = state.apply(transaction); changed = transaction.docChanged; });
  return { text: changed ? serializeMarkdownDocument(state.doc) : source, selection: { from: state.selection.from, to: state.selection.to }, changed };
}

/** Toggle a task at the position immediately before its list_item node. */
export function applyMarkdownTaskCommand(source: string, position: number): { text: string; changed: boolean } {
  if (getMarkdownCompatibilityWarnings(source).length) throw new Error("このMarkdownの拡張記法はソースモードで編集してください。");
  const document = parseMarkdownDocument(source);
  checkedOffset(position, document.content.size);
  let state = EditorState.create({ doc: document });
  const changed = markdownTaskCommand(position)(state, transaction => { state = state.apply(transaction); });
  if (!changed) throw new Error("指定位置にチェックリスト項目がありません。");
  return { text: serializeMarkdownDocument(state.doc), changed };
}

export function richSelectionCommand(action: "selectAll" | "selectLine" | "indent" | "outdent"): Command {
  return (state, dispatch) => {
    if (action === "selectAll") { dispatch?.(state.tr.setSelection(new AllSelection(state.doc))); return true; }
    if (action === "selectLine") { const { $from } = state.selection; dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end()))); return true; }
    return (action === "indent" ? sinkListItem : liftListItem)(markdownSchema.nodes.list_item)(state, dispatch);
  };
}

export function markdownSelectionAfterReplace(state: EditorState, document: MarkdownNode): Transaction {
  const transaction = state.tr.replaceWith(0, state.doc.content.size, document.content);
  const from = Math.min(state.selection.from, transaction.doc.content.size), to = Math.min(state.selection.to, transaction.doc.content.size);
  transaction.setSelection(TextSelection.between(transaction.doc.resolve(from), transaction.doc.resolve(to)));
  return transaction;
}
