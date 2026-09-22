import { createZipArchive, type ZipArchiveEntry } from "../core";
import { normalizeDocument } from "../model/document";
import type { DocumentModel } from "../model/types";
import { OFFICE_PACKAGE_LIMITS } from "../ooxml";
import { PIC, R, header, namespaces, relationships, twips, xml, type Link } from "./docx-xml";
import type { DocumentDocxExportResult, DocumentDocxOptions } from "./types";

export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; attrs?: Record<string, unknown>; text?: string; marks?: Mark[]; content?: Node[] };
const str = (value: unknown): string => typeof value === "string" ? value : "";
const hex = (value: unknown): string => { const color = str(value).replace(/^#/, ""); return (color.length === 3 ? [...color].map(c => c + c).join("") : color).toUpperCase(); };
const part = (path: string, value: string): ZipArchiveEntry => ({ path, content: new Blob([value], { type: "application/xml" }) });

/** Standard WordprocessingML; writes no scripts, native-model sidecar, or external requests. */
export async function exportDocumentDocx(input: DocumentModel, options: DocumentDocxOptions = {}): Promise<DocumentDocxExportResult> {
  options.signal?.throwIfAborted();
  const document = normalizeDocument(input), entries: ZipArchiveEntry[] = [], warnings = new Set<string>();
  const types = new Map<string, string>(), links: Link[] = [{ id: "rIdStyles", type: `${R}/styles`, target: "styles.xml" }];
  const images = new Map<string, { id: string; path: string }>(), numbering: string[] = [];
  const add = (path: string, type: string, source: string) => {
    if (new TextEncoder().encode(source).length > OFFICE_PACKAGE_LIMITS.entryBytes) throw new Error("DOCXの本文または書式が出力上限を超えています");
    entries.push(part(path, source)); types.set(path, type);
  };
  let drawingId = 0;

  function run(node: Node): string {
    if (node.type === "hard_break") return "<w:r><w:br/></w:r>";
    let properties = "", link: Mark | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === "strong") properties += "<w:b/>";
      else if (mark.type === "em") properties += "<w:i/>";
      else if (mark.type === "underline") properties += '<w:u w:val="single"/>';
      else if (mark.type === "strike") properties += "<w:strike/>";
      else if (mark.type === "link") link = mark;
      else if (mark.type === "text_style") {
        const style = mark.attrs ?? {};
        if (style.color) properties += `<w:color w:val="${hex(style.color)}"/>`;
        if (style.backgroundColor) properties += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(style.backgroundColor)}"/>`;
        if (style.fontFamily) properties += `<w:rFonts w:ascii="${xml(str(style.fontFamily))}" w:hAnsi="${xml(str(style.fontFamily))}" w:eastAsia="${xml(str(style.fontFamily))}"/>`;
        if (style.fontSize) properties += `<w:sz w:val="${Math.round(Number(style.fontSize) * 2)}"/><w:szCs w:val="${Math.round(Number(style.fontSize) * 2)}"/>`;
      }
    }
    const text = (node.text ?? "").split(/(\t|\n)/).map(value => value === "\t" ? "<w:tab/>" : value === "\n" ? "<w:br/>" : `<w:t xml:space="preserve">${xml(value)}</w:t>`).join("");
    const output = `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${text}</w:r>`;
    if (!link?.attrs?.href) return output;
    const id = `rIdLink${links.length}`;
    links.push({ id, type: `${R}/hyperlink`, target: str(link.attrs.href), external: true });
    return `<w:hyperlink r:id="${id}"${link.attrs.title ? ` w:tooltip="${xml(str(link.attrs.title))}"` : ""}>${output}</w:hyperlink>`;
  }

  function paragraph(node: Node, list?: { id: number; level: number }): string {
    const attrs = node.attrs ?? {}, alignment = attrs.align === "justify" ? "both" : str(attrs.align) || "left";
    const properties = `${node.type === "heading" ? `<w:pStyle w:val="Heading${Number(attrs.level)}"/>` : ""}<w:jc w:val="${alignment}"/>${list ? `<w:numPr><w:ilvl w:val="${Math.min(list.level, 8)}"/><w:numId w:val="${list.id}"/></w:numPr>` : ""}`;
    return `<w:p><w:pPr>${properties}</w:pPr>${(node.content ?? []).map(run).join("")}</w:p>`;
  }

  function image(node: Node): string {
    const attrs = node.attrs ?? {}, src = str(attrs.src);
    let image = images.get(src);
    if (!image) {
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(src);
      if (!match) throw new Error("DOCXに出力する画像はPNGまたはJPEGを指定してください");
      const number = images.size + 1, path = `word/media/image${number}.${match[1] === "image/png" ? "png" : "jpg"}`;
      image = { id: `rIdImage${number}`, path }; images.set(src, image);
      const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
      entries.push({ path, content: new Blob([bytes], { type: match[1] }) }); types.set(path, match[1]);
      links.push({ id: image.id, type: `${R}/image`, target: path.slice(5) });
    }
    const width = Math.round(Number(attrs.width) * 9525), height = Math.round(Number(attrs.height) * 9525), id = ++drawingId;
    const description = xml(str(attrs.alt));
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Image ${id}" descr="${description}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}" descr="${description}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  function table(node: Node): string {
    const rows = node.content ?? [], active = new Map<number, { remaining: number; span: number }>();
    const rowXml = rows.map(row => {
      if ((row.content ?? []).some(cell => cell.type === "table_header") && !(row.content ?? []).every(cell => cell.type === "table_header")) warnings.add("一部だけ見出しセルになっている行は通常の表の行として出力しました");
      let col = 0, output = "";
      const continuations = () => {
        while (active.has(col)) {
          const previous = active.get(col)!;
          output += `<w:tc><w:tcPr>${previous.span > 1 ? `<w:gridSpan w:val="${previous.span}"/>` : ""}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
          active.delete(col); if (previous.remaining > 1) active.set(col, { remaining: previous.remaining - 1, span: previous.span });
          col += previous.span;
        }
      };
      for (const cell of row.content ?? []) {
        continuations();
        const attrs = cell.attrs ?? {}, span = Number(attrs.colspan ?? 1), rowspan = Number(attrs.rowspan ?? 1);
        const widths = Array.isArray(attrs.colwidth) ? attrs.colwidth as number[] : [];
        const properties = `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ""}${widths.length ? `<w:tcW w:w="${Math.round(widths.reduce((a, b) => a + b, 0) * 15)}" w:type="dxa"/>` : ""}${attrs.backgroundColor ? `<w:shd w:val="clear" w:fill="${hex(attrs.backgroundColor)}"/>` : ""}`;
        let content = (cell.content ?? []).map(child => block(child)).join("") || "<w:p/>";
        if (!content.endsWith("</w:p>") && !content.endsWith("<w:p/>")) content += "<w:p/>";
        output += `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
        if (rowspan > 1) active.set(col, { remaining: rowspan - 1, span });
        col += span;
      }
      continuations();
      return `<w:tr>${(row.content ?? []).every(cell => cell.type === "table_header") ? '<w:trPr><w:tblHeader/></w:trPr>' : ""}${output}</w:tr>`;
    }).join("");
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="C7CDD5"/>`).join("");
    const first = rows[0]?.content ?? [];
    const grid = first.flatMap(cell => {
      const attrs = cell.attrs ?? {}, widths = Array.isArray(attrs.colwidth) ? attrs.colwidth as number[] : [];
      return Array.from({ length: Number(attrs.colspan ?? 1) }, (_, index) => `<w:gridCol w:w="${Math.round((widths[index] ?? 120) * 15)}"/>`);
    }).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`;
  }

  function block(node: Node, list?: { id: number; level: number }): string {
    if (node.type === "paragraph" || node.type === "heading") return paragraph(node, list);
    if (node.type === "image") return image(node);
    if (node.type === "page_break") return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (node.type === "table") return table(node);
    if (node.type === "bullet_list" || node.type === "ordered_list") {
      const id = numbering.length + 1, ordered = node.type === "ordered_list", start = Number(node.attrs?.order ?? 1);
      numbering.push(`<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="${start}"/><w:numFmt w:val="${ordered ? "decimal" : "bullet"}"/><w:lvlText w:val="${ordered ? `%${level + 1}.` : "•"}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(level + 1) * 720}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`);
      const level = list ? list.level + 1 : 0;
      if (level > 8) warnings.add("9段を超える箇条書きのインデントは9段に揃えて出力しました");
      return (node.content ?? []).map(item => (item.content ?? []).map((child, index) => {
        if (index > 0 && !["bullet_list", "ordered_list"].includes(child.type)) warnings.add("複数段落・画像・表を含むリスト項目の後続部分は通常の本文として出力しました");
        return block(child, index === 0 || ["bullet_list", "ordered_list"].includes(child.type) ? { id, level } : undefined);
      }).join("")).join("");
    }
    throw new Error(`DOCX出力に対応していない要素です: ${node.type}`);
  }

  const content = (document.content.content as Node[]).map(node => block(node)).join("");
  const { width, height, margins } = document.page;
  const section = `<w:sectPr><w:pgSz w:w="${twips(width)}" w:h="${twips(height)}"${width > height ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  add("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", `${header}<w:document ${namespaces}><w:body>${content}${section}</w:body></w:document>`);
  add("word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml", `${header}<w:styles ${namespaces}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[1, 2, 3, 4, 5, 6].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24, 22, 22][level - 1]}"/></w:rPr></w:style>`).join("")}</w:styles>`);
  if (numbering.length) {
    links.push({ id: "rIdNumbering", type: `${R}/numbering`, target: "numbering.xml" });
    add("word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml", `${header}<w:numbering ${namespaces}>${numbering.join("")}</w:numbering>`);
  }
  add("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml", `${header}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(document.title)}</dc:title></cp:coreProperties>`);
  entries.push(part("word/_rels/document.xml.rels", relationships(links)), part("_rels/.rels", relationships([
    { id: "rIdDocument", type: `${R}/officeDocument`, target: "word/document.xml" },
    { id: "rIdCore", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
  ])));
  entries.push(part("[Content_Types].xml", `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...types].map(([path, type]) => `<Override PartName="/${xml(path)}" ContentType="${xml(type)}"/>`).join("")}</Types>`));
  options.signal?.throwIfAborted();
  const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    const blob = await createZipArchive(entries, { type: DOCX_MIME_TYPE, signal: controller.signal });
    options.signal?.throwIfAborted();
    if (blob.size > OFFICE_PACKAGE_LIMITS.inputBytes) throw new Error("DOCXのサイズが出力上限（32 MiB）を超えています");
    return { blob, warnings: [...warnings] };
  } finally { options.signal?.removeEventListener("abort", abort); }
}
