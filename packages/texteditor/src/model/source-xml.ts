import { parser } from "@lezer/xml";
import type { SyntaxNode, Tree } from "@lezer/common";
import type { TextEditorDiagnostic, TextEditorRangeEdit } from "./types";
import { applySourceEdits, sourceDiagnostic, sourceLineEnding, SOURCE_MAX_DEPTH } from "./source-format-utils";
import { TEXT_EDITOR_LIMITS } from "./validation";

type Span = { from: number; to: number };
type XmlSource = { tree: Tree; doctypes: Span[]; diagnostics: TextEditorDiagnostic[] };
const whitespace = /^[\t\n\r ]*$/;

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/** Hide DTD internals from the editor grammar without resolving any declaration. */
function maskDoctypes(text: string): { masked: string; doctypes: Span[]; error?: Span } {
  const doctypes: Span[] = [], pieces: string[] = []; let copied = 0;
  for (let cursor = 0; cursor < text.length;) {
    const from = text.indexOf("<", cursor);
    if (from < 0) break;
    const delimiter = text.startsWith("<!--", from) ? "-->" : text.startsWith("<![CDATA[", from) ? "]]>" : text.startsWith("<?", from) ? "?>" : undefined;
    if (delimiter) {
      const close = text.indexOf(delimiter, from + 2); cursor = close < 0 ? text.length : close + delimiter.length; continue;
    }
    if (!text.startsWith("<!DOCTYPE", from) || !/[\t\r\n ]/.test(text[from + 9] ?? "")) {
      let quote = "", end = from + 1;
      for (; end < text.length; end++) {
        if (quote) { if (text[end] === quote) quote = ""; }
        else if (text[end] === '"' || text[end] === "'") quote = text[end];
        else if (text[end] === ">") break;
      }
      cursor = end + 1; continue;
    }
    let quote = "", depth = 0, end = from + 9;
    for (; end < text.length; end++) {
      const character = text[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (text.startsWith("<!--", end)) {
        const close = text.indexOf("-->", end + 4);
        if (close < 0) return { masked: text, doctypes, error: { from, to: text.length } };
        end = close + 2;
      } else if (character === "[") depth++;
      else if (character === "]") depth--;
      else if (character === ">" && depth === 0) break;
    }
    if (end >= text.length) return { masked: text, doctypes, error: { from, to: text.length } };
    const to = end + 1;
    doctypes.push({ from, to }); pieces.push(text.slice(copied, from), text.slice(from, to).replace(/[^\r\n]/g, " "));
    copied = to; cursor = to;
  }
  return { masked: pieces.length ? pieces.join("") + text.slice(copied) : text, doctypes };
}

export function inspectXmlSource(text: string): XmlSource {
  const { masked, doctypes, error } = maskDoctypes(text);
  const tree = parser.parse(masked), diagnostics: TextEditorDiagnostic[] = [];
  const fail = (from: number, to: number, message: string) => diagnostics.push(sourceDiagnostic(text, from, to, `XML構文エラー: ${message}`));
  if (error) { fail(error.from, error.to, "DOCTYPE宣言が閉じられていません。"); return { tree, doctypes, diagnostics }; }
  const roots = children(tree.topNode).filter(node => node.name === "Element");
  if (roots.length !== 1) {
    const node = roots[1]; fail(node?.from ?? 0, node?.to ?? 0, roots.length ? "ルート要素は1つだけ指定してください。" : "ルート要素がありません。");
    return { tree, doctypes, diagnostics };
  }
  if (doctypes.length > 1 || doctypes.some(span => span.from > roots[0].from)) {
    const span = doctypes.find(span => span.from > roots[0].from) ?? doctypes[1];
    fail(span.from, span.to, "DOCTYPE宣言はルート要素の前に1つだけ指定してください。");
    return { tree, doctypes, diagnostics };
  }
  for (const node of children(tree.topNode)) {
    if (node.name === "Text" && !whitespace.test(masked.slice(node.from, node.to).replace(/^\uFEFF/, "")) || ["Cdata", "EntityReference", "CharacterReference"].includes(node.name)) {
      fail(node.from, node.to, "ルート要素の外側に本文があります。"); return { tree, doctypes, diagnostics };
    }
  }
  const stack = [{ node: tree.topNode, depth: 0 }];
  while (stack.length && !diagnostics.length) {
    const { node, depth } = stack.pop()!;
    if (depth > SOURCE_MAX_DEPTH) { fail(node.from, node.to, "入れ子が深すぎるため構文確認・整形できません。"); break; }
    const raw = text.slice(node.from, node.to);
    if (node.type.isError || node.name === "MismatchedCloseTag" || node.name === "MissingCloseTag") {
      fail(node.from, node.to, node.name === "MismatchedCloseTag" ? "開始タグと終了タグの名前が一致しません。" : "タグ・属性・引用符が正しく閉じられているか確認してください。"); break;
    }
    if (node.name === "DoctypeDecl") { fail(node.from, node.to, "DOCTYPE宣言の大文字・空白・区切りを確認してください。"); break; }
    if (["OpenTag", "CloseTag", "SelfClosingTag"].includes(node.name) && /^<\/?\s/.test(raw)) {
      fail(node.from, node.to, "タグ名の前に空白は指定できません。"); break;
    }
    if (node.name === "OpenTag" || node.name === "SelfClosingTag") {
      const names = new Set<string>();
      let previous = node.getChild("TagName")?.to ?? node.from;
      for (const attr of node.getChildren("Attribute")) {
        const name = attr.getChild("AttributeName")!, value = attr.getChild("AttributeValue");
        const label = text.slice(name.from, name.to);
        if (names.has(label)) { fail(name.from, name.to, `属性「${label}」が重複しています。`); break; }
        if (!/^[\t\n\r ]+$/.test(text.slice(previous, attr.from))) { fail(attr.from, attr.to, "属性の前には空白が必要です。"); break; }
        if (value && text.slice(value.from, value.to).includes("<")) { fail(value.from, value.to, "属性値の < は &lt; で指定してください。"); break; }
        names.add(label); previous = attr.to;
      }
    }
    if (node.name === "Comment" && raw.slice(4, -3).includes("--")) fail(node.from, node.to, "コメント内に -- は指定できません。");
    if (node.name === "Text" && raw.includes("]]>")) fail(node.from + raw.indexOf("]]>"), node.from + raw.indexOf("]]>" ) + 3, "本文中の ]]> は利用できません。");
    if (node.name === "ProcessingInst") {
      const instruction = /^<\?([^\s?]+)([\s\S]*?)\?>$/.exec(raw);
      if (!instruction || !/^[\p{L}_:][\p{L}\p{N}_.:\-\u00b7]*$/u.test(instruction[1])) fail(node.from, node.to, "処理命令の名前が正しくありません。");
      else if (instruction[1].toLowerCase() === "xml") {
        const declaration = /^<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/;
        if (node.from !== (text.startsWith("\uFEFF") ? 1 : 0) || !declaration.test(raw)) fail(node.from, node.to, "XML宣言は文書の先頭に正しい形式で1つだけ指定してください。");
      }
    }
    if (node.name === "CharacterReference") {
      const value = raw.startsWith("&#x") ? Number.parseInt(raw.slice(3, -1), 16) : Number.parseInt(raw.slice(2, -1), 10);
      if (!validXmlCodePoint(value)) fail(node.from, node.to, "文字参照がXMLで利用できる文字ではありません。");
    }
    if (node.name === "EntityReference" && !["&amp;", "&lt;", "&gt;", "&apos;", "&quot;"].includes(raw) && !doctypes.length)
      fail(node.from, node.to, `未定義の実体参照 ${raw}`);
    for (const child of children(node).reverse()) stack.push({ node: child, depth: depth + (child.name === "Element" ? 1 : 0) });
  }
  if (!diagnostics.length) {
    for (let offset = 0; offset < text.length; offset++) {
      const code = text.codePointAt(offset)!;
      if (!validXmlCodePoint(code)) { fail(offset, offset + 1, "XMLで利用できない文字があります。"); break; }
      if (code > 0xffff) offset++;
    }
  }
  return { tree, doctypes, diagnostics };
}

function validXmlCodePoint(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff;
}

export function formatXmlSource(text: string, indent: number, inspected: XmlSource): string {
  const edits: TextEditorRangeEdit[] = [], eol = sourceLineEnding(text);
  let outputLength = text.length;
  const gap = (from: number, to: number, value: string) => {
    if (whitespace.test(text.slice(from, to)) && text.slice(from, to) !== value) {
      outputLength += value.length - (to - from);
      if (outputLength > TEXT_EDITOR_LIMITS.textLength) throw new RangeError("整形後の本文が文字数上限を超えています。");
      edits.push({ from, to, text: value });
    }
  };
  const top = [...children(inspected.tree.topNode).filter(node => node.name !== "Text"), ...inspected.doctypes].sort((a, b) => a.from - b.from);
  for (let index = 1; index < top.length; index++) gap(top[index - 1].to, top[index].from, eol);
  const stack = children(inspected.tree.topNode).filter(node => node.name === "Element").map(node => ({ node, depth: 0 }));
  while (stack.length) {
    const { node, depth } = stack.pop()!, all = children(node);
    const open = all.find(child => child.name === "OpenTag"), close = all.find(child => child.name === "CloseTag");
    if (!open || !close) continue;
    const attrs = open.getChildren("Attribute");
    if (attrs.some(attr => {
      const name = attr.getChild("AttributeName"), value = attr.getChild("AttributeValue");
      // An entity-encoded or otherwise unresolved value might mean preserve.
      // Only an explicit default value permits whitespace changes here.
      return name && value && text.slice(name.from, name.to) === "xml:space" && text.slice(value.from + 1, value.to - 1) !== "default";
    })) continue;
    const contents = all.filter(child => child !== open && child !== close);
    // In mixed content whitespace is data. Preserve the complete subtree, also
    // for CDATA/entities and inherited xml:space, rather than trimming text.
    if (contents.some(child => ["Cdata", "EntityReference", "CharacterReference"].includes(child.name) || child.name === "Text" && !whitespace.test(text.slice(child.from, child.to)))) continue;
    const items = contents.filter(child => child.name !== "Text");
    if (!items.length) continue;
    gap(open.to, items[0].from, eol + " ".repeat((depth + 1) * indent));
    for (let index = 1; index < items.length; index++) gap(items[index - 1].to, items[index].from, eol + " ".repeat((depth + 1) * indent));
    gap(items.at(-1)!.to, close.from, eol + " ".repeat(depth * indent));
    for (const child of items) if (child.name === "Element") stack.push({ node: child, depth: depth + 1 });
  }
  return applySourceEdits(text, edits);
}
