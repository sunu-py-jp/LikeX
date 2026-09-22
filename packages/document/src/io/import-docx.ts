import { normalizeDocument } from "../model/document";
import { openOfficePackage, officeXml, readOfficeRelationships, resolveOfficePart, type OfficePackageInput } from "../ooxml";
import { millimetres } from "./docx-xml";
import { child, children, attr, localName, textContent, descendants, relation, readStyles, readNumbering, runStyle, paragraphStyle, styleMarks, groupLists, type Node, type XmlNode, type Mark, type ListedBlock } from "./docx-reader";
import type { DocumentDocxImportResult, DocumentDocxOptions } from "./types";

const fail = (message: string): never => { throw new Error(`Word文書を読み込めません: ${message}`); };
const mainType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

/** Bounded, headless DOCX reader. Never executes fields/macros or fetches external resources. */
export async function importDocumentDocx(input: OfficePackageInput, options: DocumentDocxOptions = {}): Promise<DocumentDocxImportResult> {
  const { signal } = options; signal?.throwIfAborted();
  if (input && typeof input === "object" && "name" in input && typeof input.name === "string" && !/\.docx$/i.test(input.name)) return fail(".docx形式を指定してください");
  const archive = await openOfficePackage(input, signal), warnings = new Set<string>();
  const warn = (message: string) => { warnings.add(message); };
  const root = async (path: string) => { signal?.throwIfAborted(); return officeXml.parseXml(await archive.read(path)); };
  const typesRoot = await root("[Content_Types].xml");
  if (localName(typesRoot.name) !== "Types") return fail("Officeパッケージの形式が不正です");
  const types = new Map<string, string>(), defaults = new Map<string, string>();
  for (const entry of typesRoot.children) {
    const type = entry.attributes.ContentType ?? "";
    if (!type || /macroEnabled|vbaProject|encrypted/i.test(type)) return fail("マクロ・暗号化文書には対応していません");
    if (localName(entry.name) === "Override") {
      const path = resolveOfficePart("", entry.attributes.PartName ?? "");
      if (types.has(path)) return fail("コンテンツ形式が重複しています");
      types.set(path, type);
    } else if (localName(entry.name) === "Default") defaults.set(entry.attributes.Extension?.toLowerCase() ?? "", type);
  }
  if (archive.paths.some(path => /(?:^|\/)(?:vbaProject\.bin|EncryptedPackage|EncryptionInfo)$/i.test(path))) return fail("マクロ・暗号化文書には対応していません");
  const packageLinks = await readOfficeRelationships(archive, ""), main = relation(packageLinks, "officeDocument");
  if (!main || types.get(main.target) !== mainType) return fail(".docx形式の文書ではありません");
  const document = await root(main.target), links = await readOfficeRelationships(archive, main.target), body = child(document, "body");
  if (localName(document.name) !== "document" || !body) return fail("本文の構造が不正です");
  for (const path of archive.paths.filter(path => path.endsWith(".rels"))) {
    const match = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(path); if (!match) return fail("参照情報の場所が不正です");
    const source = `${match[1] ? `${match[1]}/` : ""}${match[2]}`;
    for (const link of (await readOfficeRelationships(archive, source)).values()) {
      if (/vbaProject|attachedTemplate/i.test(link.type)) return fail("マクロ・外部テンプレートには対応していません");
      if (link.external && !link.type.endsWith("/hyperlink")) warn("外部画像・外部データは取得せず省略しました");
    }
  }
  const styleLink = relation(links, "styles"), numberingLink = relation(links, "numbering");
  const styles = readStyles(styleLink ? await root(styleLink.target) : undefined, warn);
  const numbering = readNumbering(numberingLink ? await root(numberingLink.target) : undefined, warn);
  const core = relation(packageLinks, "core-properties"), title = core ? textContent(child(await root(core.target), "title")) : "";
  const embedded = new Map<string, string>();
  let elements = 0;

  async function readImage(source: XmlNode): Promise<Node | undefined> {
    const blip = descendants(source, "blip")[0], id = attr(blip, "embed"), link = links.get(id ?? "");
    if (!link || link.external || !link.type.endsWith("/image")) { warn("参照できない画像・外部画像を省略しました"); return undefined; }
    const type = types.get(link.target) ?? defaults.get(link.target.split(".").at(-1)?.toLowerCase() ?? "");
    if (!type || !["image/png", "image/jpeg"].includes(type)) { warn("PNG・JPEG以外の画像を省略しました"); return undefined; }
    let data = embedded.get(link.target);
    if (!data) {
      const bytes = await archive.read(link.target);
      const signature = type === "image/png" ? bytes.length >= 24 && bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i]) : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!signature) { warn("画像データの形式を確認できない画像を省略しました"); return undefined; }
      let binary = ""; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      data = `data:${type};base64,${btoa(binary)}`; embedded.set(link.target, data);
    }
    const extent = descendants(source, "extent")[0] ?? descendants(source, "ext")[0], width = Number(attr(extent, "cx")) / 9525, height = Number(attr(extent, "cy")) / 9525;
    if (![width, height].every(value => Number.isFinite(value) && value >= 1 && value <= 16384)) { warn("寸法が不正または大きすぎる画像を省略しました"); return undefined; }
    const properties = descendants(source, "docPr")[0] ?? descendants(source, "cNvPr")[0];
    if (descendants(source, "anchor").length) warn("浮動配置の画像は本文中の画像として読み込みました");
    if (descendants(source, "srcRect").some(rect => Object.values(rect.attributes).some(value => Number(value) !== 0)) || descendants(source, "xfrm").some(transform => ["rot", "flipH", "flipV"].some(name => Number(attr(transform, name) ?? 0) !== 0))) warn("画像の回転・反転・切り抜きを省略しました");
    return { type: "image", attrs: { src: data, width, height, alt: attr(properties, "descr") ?? attr(properties, "title") ?? "" } };
  }

  async function paragraph(source: XmlNode): Promise<ListedBlock[]> {
    const properties = child(source, "pPr"), id = attr(child(properties, "pStyle"), "val");
    const style = { ...styles.defaults, ...styles.resolve(id), ...paragraphStyle(properties) };
    const heading = /^(?:heading|見出し)\s*([1-6])$/i.exec(id ?? "");
    if (heading) style.level = Number(heading[1]);
    let inline: Node[] = [];
    const result: ListedBlock[] = [];
    const flush = (force = false) => {
      if (!inline.length && !force) return;
      result.push({ node: { type: style.level ? "heading" : "paragraph", attrs: { align: style.align ?? "left", ...(style.level ? { level: style.level } : {}) }, content: inline }, numId: style.numId, level: style.listLevel });
      inline = [];
    };
    if (onProperty(properties, "pageBreakBefore")) result.push({ node: { type: "page_break" } });
    async function visit(node: XmlNode, extraMarks: Mark[] = []) {
      const name = localName(node.name);
      if (name === "pPr") return;
      if (name === "del" || name === "moveFrom") { warn("変更履歴は承認後の本文として読み込みました"); return; }
      if (name === "ins" || name === "moveTo") warn("変更履歴は承認後の本文として読み込みました");
      if (name === "hyperlink") {
        const link = links.get(attr(node, "id") ?? ""), href = link?.external && link.type.endsWith("/hyperlink") ? link.target : attr(node, "anchor") ? `#${attr(node, "anchor")}` : undefined;
        if (href && /^(https?:\/\/|mailto:|tel:|#)/i.test(href) && !/[\u0000-\u0020<>]/.test(href)) extraMarks = [...extraMarks, { type: "link", attrs: { href, title: attr(node, "tooltip") ?? null } }];
        else if (href) warn("安全なURLでないリンクを本文だけに変換しました");
      }
      if (name === "r") {
        const runProperties = child(node, "rPr"), runId = attr(child(runProperties, "rStyle"), "val");
        const marks = [...styleMarks({ ...style, ...styles.resolve(runId), ...runStyle(runProperties) }), ...extraMarks];
        for (const item of node.children) {
          const tag = localName(item.name);
          if (tag === "t") { if (item.text) inline.push({ type: "text", text: item.text, ...(marks.length ? { marks } : {}) }); }
          else if (tag === "tab") inline.push({ type: "text", text: "\t", ...(marks.length ? { marks } : {}) });
          else if (tag === "br" || tag === "cr") {
            if (attr(item, "type") === "page") { flush(); result.push({ node: { type: "page_break" } }); }
            else inline.push({ type: "hard_break" });
          } else if (tag === "drawing") { flush(); const image = await readImage(item); if (image) result.push({ node: image }); else warn("図形・グラフ・SmartArtなどの描画要素を省略しました"); }
          else if (["pict", "object"].includes(tag)) warn("旧形式の図形・埋め込みオブジェクトを省略しました");
          else if (["instrText", "fldChar"].includes(tag)) warn("フィールドは計算せず、保存されている表示文字列を読み込みました");
          else if (["footnoteReference", "endnoteReference", "commentReference"].includes(tag)) warn("脚注・文末脚注・コメントを省略しました");
          else if (tag === "sym") warn("専用フォントによる記号を省略しました");
        }
        if (child(runProperties, "vertAlign")) warn("上付き・下付き文字を通常の文字として読み込みました");
        return;
      }
      if (name === "fldSimple") warn("フィールドは計算せず、保存されている表示文字列を読み込みました");
      for (const item of node.children) await visit(item, extraMarks);
    }
    for (const item of source.children) await visit(item);
    flush(result.length === 0);
    return result;
  }

  async function table(source: XmlNode): Promise<Node> {
    const rows: Node[] = [], spans = new Map<number, Node>(), grid = children(child(source, "tblGrid"), "gridCol").map(col => Number(attr(col, "w")) / 15);
    for (const row of children(source, "tr")) {
      const cells: Node[] = [], previous = new Map(spans); spans.clear();
      let col = 0;
      if (child(child(row, "trPr"), "gridBefore") || child(child(row, "trPr"), "gridAfter")) warn("行の前後に空き列がある表の配置を標準化しました");
      for (const cell of children(row, "tc")) {
        const properties = child(cell, "tcPr"), span = Number(attr(child(properties, "gridSpan"), "val") ?? 1), merge = child(properties, "vMerge");
        if (!Number.isSafeInteger(span) || span < 1 || span > 100) return fail("表の結合列数が不正です");
        if (merge && attr(merge, "val") !== "restart") {
          const origin = previous.get(col);
          if (origin && origin.attrs?.colspan === span) { origin.attrs!.rowspan = Number(origin.attrs!.rowspan ?? 1) + 1; spans.set(col, origin); col += span; continue; }
          warn("開始セルのない結合を通常のセルとして読み込みました");
        }
        const background = attr(child(properties, "shd"), "fill"), widths = grid.slice(col, col + span);
        const node: Node = { type: onProperty(child(row, "trPr"), "tblHeader") ? "table_header" : "table_cell", attrs: { colspan: span, rowspan: 1, ...(widths.length === span && widths.every(width => width >= 1 && width <= 5000) ? { colwidth: widths } : {}), ...(background && /^[\da-f]{6}$/i.test(background) ? { backgroundColor: `#${background.toUpperCase()}` } : {}) }, content: await blocks(cell) };
        if (!node.content?.length) node.content = [{ type: "paragraph" }];
        cells.push(node); if (merge) spans.set(col, node); col += span;
      }
      if (!cells.length) { if (spans.size) { rows.push({ type: "table_row", content: [] }); continue; } warn("空の表の行を省略しました"); continue; }
      rows.push({ type: "table_row", content: cells });
    }
    if (!rows.length) return { type: "paragraph" };
    const borders = descendants(source, "tcBorders").concat(descendants(source, "tblBorders"));
    if (borders.some(border => border.children.some(edge => attr(edge, "val") !== "single" || ![undefined, "4"].includes(attr(edge, "sz")) || ![undefined, "C7CDD5", "auto"].includes(attr(edge, "color"))))) warn("表の独自の罫線は標準の罫線で表示します");
    return { type: "table", content: rows };
  }

  async function blocks(source: XmlNode): Promise<Node[]> {
    const result: ListedBlock[] = [];
    for (const item of source.children) {
      if (++elements > 20000) return fail("文書の要素数が読み込み上限を超えています");
      if (elements % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const tag = localName(item.name);
      if (tag === "p") result.push(...await paragraph(item));
      else if (tag === "tbl") result.push({ node: await table(item) });
      else if (tag === "sdt") { const content = child(item, "sdtContent"); if (content) result.push(...(await blocks(content)).map(node => ({ node }))); warn("コンテンツコントロールは通常の本文として読み込みました"); }
      else if (tag === "altChunk") warn("外部形式の埋め込み本文を省略しました");
      else if (tag === "customXml" || tag === "ins") { result.push(...(await blocks(item)).map(node => ({ node }))); }
    }
    return groupLists(result, numbering);
  }

  const content = await blocks(body), sections = descendants(body, "sectPr"), section = sections.at(-1);
  if (sections.length > 1) warn("複数セクションの用紙設定は最後のセクションに統一しました");
  if (sections.some(item => children(item, "headerReference").length || children(item, "footerReference").length)) warn("ヘッダー・フッターを省略しました");
  if (sections.some(item => Number(attr(child(item, "cols"), "num") ?? 1) > 1)) warn("段組みは1段に変換しました");
  const size = child(section, "pgSz"), margin = child(section, "pgMar");
  const width = millimetres(attr(size, "w"), 210), height = millimetres(attr(size, "h"), 297);
  const margins = { top: millimetres(attr(margin, "top"), 20), right: millimetres(attr(margin, "right"), 20), bottom: millimetres(attr(margin, "bottom"), 20), left: millimetres(attr(margin, "left"), 20) };
  signal?.throwIfAborted();
  const model = normalizeDocument({ format: "likex.document", version: 1, id: "docx-document", title: title || "取り込んだ文書", page: { width, height, margins }, content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] } });
  return { document: model, warnings: [...warnings] };
}

function onProperty(properties: XmlNode | undefined, name: string): boolean {
  const node = child(properties, name); return !!node && !["false", "0", "off"].includes(attr(node, "val") ?? "");
}
