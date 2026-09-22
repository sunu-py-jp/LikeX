import { documentSchema } from "./schema";
import { inspectDocumentImage } from "./image-source";
import { serializeStableJson } from "../json";
import { DOCUMENT_LIMITS, choice, color, fontFamily, identifier, link, number, record, text } from "./validation";
import type { DocumentInput, DocumentMark, DocumentModel, DocumentNode, DocumentPage, DocumentRootNode, DocumentTextStyle } from "./types";

const normalizedDocuments = new WeakSet<DocumentModel>();
const serializedDocuments = new WeakMap<DocumentModel, string>();
function assertJsonByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > DOCUMENT_LIMITS.jsonLength) throw new Error("The .dcon file exceeds its 40 MiB UTF-8 size limit.");
  }
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeTree(child); Object.freeze(value); }
  return value;
}
const imageCache = new Map<string, ReturnType<typeof inspectDocumentImage>>();
let imageCacheBytes = 0;
function cachedImage(input: unknown) {
  if (typeof input === "string" && imageCache.has(input)) return imageCache.get(input)!;
  const image = inspectDocumentImage(input);
  imageCache.set(image.src, image); imageCacheBytes += image.bytes;
  while (imageCache.size > 32 || imageCacheBytes > 20 * 1024 * 1024) {
    const oldest = imageCache.keys().next().value!;
    imageCacheBytes -= imageCache.get(oldest)!.bytes; imageCache.delete(oldest);
  }
  return image;
}
export const DOCUMENT_FILE_EXTENSION = ".dcon";
export const DEFAULT_DOCUMENT_PAGE: Readonly<DocumentPage> = Object.freeze({ width: 210, height: 297, margins: Object.freeze({ top: 20, right: 20, bottom: 20, left: 20 }) });
export function normalizeDocumentPage(input: unknown): DocumentPage {
  const value = record(input, "Page", ["width", "height", "margins"]);
  const margins = record(value.margins, "Page margins", ["top", "right", "bottom", "left"]);
  const result: DocumentPage = { width: number(value.width, "Page width", 25, 1200), height: number(value.height, "Page height", 25, 1200), margins: { top: number(margins.top, "Top margin", 0, 500), right: number(margins.right, "Right margin", 0, 500), bottom: number(margins.bottom, "Bottom margin", 0, 500), left: number(margins.left, "Left margin", 0, 500) } };
  if (result.margins.left + result.margins.right >= result.width - 10 || result.margins.top + result.margins.bottom >= result.height - 10) throw new Error("Page margins must leave at least 10 mm of content space.");
  return result;
}
export function normalizeDocumentMark(input: unknown): DocumentMark {
  const value = record(input, "Text mark", ["type", "attrs"]);
  const type = choice(value.type, ["strong", "em", "underline", "strike", "text_style", "link"], "Text mark");
  if (type === "text_style") {
    const attrs = record(value.attrs ?? {}, "Text style", ["fontFamily", "fontSize", "color", "backgroundColor"]);
    const style: DocumentTextStyle = {};
    if (attrs.fontFamily != null) style.fontFamily = fontFamily(attrs.fontFamily);
    if (attrs.fontSize != null) style.fontSize = number(attrs.fontSize, "Font size", 4, 240);
    if (attrs.color != null) style.color = color(attrs.color);
    if (attrs.backgroundColor != null) style.backgroundColor = color(attrs.backgroundColor);
    return { type, attrs: style };
  }
  if (type === "link") {
    const attrs = record(value.attrs, "Link attributes", ["href", "title"]);
    return { type, attrs: { href: link(attrs.href), title: attrs.title == null ? null : text(attrs.title, "Link title", 1000) } };
  }
  record(value.attrs ?? {}, "Text mark attributes", []);
  return { type };
}
const attrKeys: Record<string, string[]> = {
  paragraph: ["id", "align"], heading: ["id", "align", "level"], bullet_list: ["id"], ordered_list: ["id", "order"], list_item: ["id"], table: ["id"], table_row: ["id"], table_cell: ["id", "colspan", "rowspan", "colwidth", "backgroundColor"], table_header: ["id", "colspan", "rowspan", "colwidth", "backgroundColor"], image: ["id", "src", "alt", "width", "height"], page_break: ["id"], hard_break: [], text: [], doc: [],
};
function normalizeContent(input: unknown): DocumentRootNode {
  const ids = new Set<string>();
  let nodeCount = 0, textLength = 0, imageBytes = 0;
  const walk = (item: unknown, depth: number): DocumentNode => {
    if (depth > DOCUMENT_LIMITS.depth || ++nodeCount > DOCUMENT_LIMITS.nodes) throw new Error("The document structure exceeds its limits.");
    const value = record(item, "Document node", ["type", "attrs", "text", "marks", "content"]);
    const type = choice(value.type, Object.keys(attrKeys), "Document node");
    const originalAttrs = record(value.attrs ?? {}, "Node attributes", attrKeys[type]);
    const attrs: Record<string, unknown> = {};
    if (attrKeys[type].includes("id")) {
      const originalId = originalAttrs.id == null ? null : identifier(originalAttrs.id);
      attrs.id = originalId && !ids.has(originalId) ? originalId : crypto.randomUUID();
      ids.add(attrs.id as string);
    }
    if (type === "paragraph" || type === "heading") attrs.align = choice(originalAttrs.align ?? "left", ["left", "center", "right", "justify"], "Alignment");
    if (type === "heading") attrs.level = number(originalAttrs.level ?? 1, "Heading level", 1, 6, true);
    if (type === "ordered_list") attrs.order = number(originalAttrs.order ?? 1, "List start", 1, 1_000_000, true);
    if (type === "table_cell" || type === "table_header") {
      attrs.colspan = number(originalAttrs.colspan ?? 1, "Column span", 1, 100, true);
      attrs.rowspan = number(originalAttrs.rowspan ?? 1, "Row span", 1, 500, true);
      attrs.backgroundColor = originalAttrs.backgroundColor == null ? null : color(originalAttrs.backgroundColor);
      attrs.colwidth = null;
      if (originalAttrs.colwidth != null) {
        if (!Array.isArray(originalAttrs.colwidth) || originalAttrs.colwidth.length !== attrs.colspan) throw new Error("Cell column widths must match the column span.");
        attrs.colwidth = originalAttrs.colwidth.map(width => number(width, "Cell column width", 1, 5000));
      }
    }
    if (type === "image") {
      const image = cachedImage(originalAttrs.src);
      imageBytes += image.bytes;
      if (imageBytes > DOCUMENT_LIMITS.totalImageBytes) throw new Error("Embedded images exceed the document size limit.");
      const width = originalAttrs.width == null ? originalAttrs.height == null ? Math.min(image.width, 480) : number(originalAttrs.height, "Image height", 1, 16_384) * image.width / image.height : number(originalAttrs.width, "Image width", 1, 16_384);
      const height = originalAttrs.height == null ? width * image.height / image.width : number(originalAttrs.height, "Image height", 1, 16_384);
      Object.assign(attrs, { src: image.src, alt: text(originalAttrs.alt ?? "", "Image alternative text", 4000), width: number(width, "Image width", 1, 16_384), height: number(height, "Image height", 1, 16_384) });
    }
    const result: Record<string, unknown> = { type };
    if (Object.keys(attrs).length) result.attrs = attrs;
    if (type === "text") {
      result.text = text(value.text, "Document text", DOCUMENT_LIMITS.textLength);
      if (!(result.text as string).length) throw new Error("Text nodes must not be empty.");
      textLength += (result.text as string).length;
      if (textLength > DOCUMENT_LIMITS.textLength) throw new Error("Document text exceeds the size limit.");
    } else if (value.text !== undefined) throw new Error("Only text nodes may contain text.");
    if (value.marks !== undefined) {
      if (!Array.isArray(value.marks) || value.marks.length > 6 || !["text", "hard_break"].includes(type)) throw new Error("Text marks are invalid.");
      const marks = value.marks.map(normalizeDocumentMark);
      if (new Set(marks.map(mark => mark.type)).size !== marks.length) throw new Error("Duplicate text mark types are not allowed.");
      if (marks.length) result.marks = marks;
    }
    if (value.content !== undefined) {
      if (!Array.isArray(value.content) || ["text", "hard_break", "image", "page_break"].includes(type) || value.content.length > DOCUMENT_LIMITS.nodes) throw new Error("Document node content is invalid.");
      result.content = value.content.map(child => walk(child, depth + 1));
    }
    return result as DocumentNode;
  };
  const root = walk(input, 0);
  if (root.type !== "doc") throw new Error("The document content root must be doc.");
  const doc = documentSchema.nodeFromJSON(root);
  doc.check();
  // A rectangular table avoids silently losing irregular/spanning cells during DOCX conversion.
  doc.descendants(node => {
    if (node.type.name !== "table") return;
    if (node.childCount > 500) throw new Error("Tables support at most 500 rows.");
    const occupancy: number[] = [];
    let expectedWidth = -1;
    node.forEach((row, _offset, rowIndex) => {
      let column = 0;
      row.forEach(cell => {
        while ((occupancy[column] ?? 0) > rowIndex) column++;
        const span = cell.attrs.colspan as number, rows = cell.attrs.rowspan as number;
        if (column + span > 100 || rowIndex + rows > node.childCount) throw new Error("The table span exceeds its bounds.");
        for (let index = column; index < column + span; index++) {
          if ((occupancy[index] ?? 0) > rowIndex) throw new Error("Table cells cannot overlap.");
          occupancy[index] = rowIndex + rows;
        }
        column += span;
      });
      let width = occupancy.length;
      while (width > 0 && occupancy[width - 1] <= rowIndex) width--;
      if (width < 1) throw new Error("Table rows must contain at least one column.");
      if (expectedWidth < 0) expectedWidth = width;
      if (width !== expectedWidth || occupancy.slice(0, expectedWidth).some(until => until <= rowIndex)) throw new Error("Table rows must have matching widths.");
    });
  });
  // ProseMirror attributes have a null prototype; public JSON must also be safe as Next.js server-to-client props.
  const json = structuredClone(doc.toJSON()) as DocumentRootNode;
  const restoreEmptyRows = (node: DocumentNode) => {
    if (node.type === "table_row" && !node.content) node.content = [];
    if ("content" in node) node.content?.forEach(restoreEmptyRows);
  };
  restoreEmptyRows(json);
  return json;
}
/** Validate and clone a document, assigning IDs only to new or duplicated blocks. */
export function normalizeDocument(input: unknown): DocumentModel {
  if (normalizedDocuments.has(input as DocumentModel)) return input as DocumentModel;
  const value = record(input, "Document", ["format", "version", "id", "title", "page", "content"]);
  if (value.format !== "likex.document" || value.version !== 1) throw new Error("Unsupported LikeDocument format or version.");
  const result = freezeTree<DocumentModel>({ format: "likex.document", version: 1, id: identifier(value.id), title: text(value.title, "Document title", 1000), page: normalizeDocumentPage(value.page), content: normalizeContent(value.content) });
  normalizedDocuments.add(result);
  return result;
}
export function createDocument(input: DocumentInput = {}): DocumentModel {
  record(input, "Document input", ["id", "title", "page", "content"]);
  return normalizeDocument({ format: "likex.document", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "無題の文書", page: { ...DEFAULT_DOCUMENT_PAGE, ...input.page, margins: { ...DEFAULT_DOCUMENT_PAGE.margins, ...input.page?.margins } }, content: input.content ?? { type: "doc", content: [{ type: "paragraph" }] } });
}
export function parseDocument(json: string): DocumentModel {
  if (typeof json !== "string" || json.length > DOCUMENT_LIMITS.jsonLength) throw new Error("The .dcon file exceeds the size limit.");
  assertJsonByteLength(json);
  return normalizeDocument(JSON.parse(json));
}
const keyOrder = ["format", "version", "id", "title", "page", "width", "height", "margins", "top", "right", "bottom", "left", "content", "type", "attrs", "text", "marks"];
/** Fixed LF indentation and visual block order; no timestamp or new ID is added to an existing normalized document. */
export function serializeDocument(document: DocumentModel): string {
  const normalized = normalizeDocument(document);
  const cached = serializedDocuments.get(normalized);
  if (cached) return cached;
  const result = serializeStableJson(normalized, { space: 2, maxLength: DOCUMENT_LIMITS.jsonLength, compareKeys: (a, b) => { const left = keyOrder.indexOf(a), right = keyOrder.indexOf(b); return (left < 0 ? 100 : left) - (right < 0 ? 100 : right); } }) + "\n";
  assertJsonByteLength(result); serializedDocuments.set(normalized, result); return result;
}
