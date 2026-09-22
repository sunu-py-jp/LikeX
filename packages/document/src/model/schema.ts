import { inspectDocumentImage } from "./image-source";
import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

const id = { default: null };
const alignment = { default: "left" };
const blockAttrs = (dom: HTMLElement) => ({ id: dom.getAttribute("data-document-id"), align: dom.style.textAlign || "left" });
const blockDomAttrs = (attrs: Record<string, unknown>) => ({ "data-document-id": attrs.id, style: attrs.align === "left" ? null : `text-align:${attrs.align}` });
const cellAttrs = { id, colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, backgroundColor: { default: null } };
const cellSpec = (tag: "td" | "th"): NodeSpec => ({
  content: "block+", attrs: cellAttrs, isolating: true,
  parseDOM: [{ tag, getAttrs: node => ({ id: node.getAttribute("data-document-id"), colspan: Number(node.getAttribute("colspan") || 1), rowspan: Number(node.getAttribute("rowspan") || 1), backgroundColor: node.style.backgroundColor || null }) }],
  toDOM: node => [tag, { colspan: node.attrs.colspan, rowspan: node.attrs.rowspan, style: [node.attrs.backgroundColor ? `background-color:${node.attrs.backgroundColor}` : null, Array.isArray(node.attrs.colwidth) ? `width:${node.attrs.colwidth.reduce((sum: number, width: number) => sum + width, 0)}px` : null].filter(Boolean).join(";"), "data-document-id": node.attrs.id }, 0],
});
const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block", attrs: { id, align: alignment }, parseDOM: [{ tag: "p", getAttrs: blockAttrs }], toDOM: node => ["p", blockDomAttrs(node.attrs), 0] },
  heading: { content: "inline*", group: "block", defining: true, attrs: { id, align: alignment, level: { default: 1 } }, parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, getAttrs: (node: HTMLElement) => ({ ...blockAttrs(node), level }) })), toDOM: node => [`h${node.attrs.level}`, blockDomAttrs(node.attrs), 0] },
  text: { group: "inline" },
  hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  bullet_list: { content: "list_item+", group: "block", attrs: { id }, parseDOM: [{ tag: "ul" }], toDOM: node => ["ul", { "data-document-id": node.attrs.id }, 0] },
  ordered_list: { content: "list_item+", group: "block", attrs: { id, order: { default: 1 } }, parseDOM: [{ tag: "ol", getAttrs: node => ({ order: Number(node.getAttribute("start") || 1) }) }], toDOM: node => ["ol", { start: node.attrs.order, "data-document-id": node.attrs.id }, 0] },
  list_item: { content: "paragraph block*", defining: true, attrs: { id }, parseDOM: [{ tag: "li" }], toDOM: node => ["li", { "data-document-id": node.attrs.id }, 0] },
  table: { content: "table_row+", group: "block", isolating: true, attrs: { id }, parseDOM: [{ tag: "table" }], toDOM: node => ["table", { "data-document-id": node.attrs.id }, ["tbody", 0]] },
  table_row: { content: "(table_cell | table_header)*", attrs: { id }, parseDOM: [{ tag: "tr" }], toDOM: node => ["tr", { "data-document-id": node.attrs.id }, 0] },
  table_cell: cellSpec("td"), table_header: cellSpec("th"),
  image: { group: "block", atom: true, draggable: true, attrs: { id, src: {}, alt: { default: "" }, width: { default: 320 }, height: { default: 200 } }, parseDOM: [{ tag: "img[src]", getAttrs: node => {
    try {
      const image = inspectDocumentImage(node.getAttribute("src"));
      const specifiedWidth = node.getAttribute("width"), specifiedHeight = node.getAttribute("height");
      const width = specifiedWidth ? Number(specifiedWidth) : specifiedHeight ? Number(specifiedHeight) * image.width / image.height : Math.min(image.width, 480);
      const height = specifiedHeight ? Number(specifiedHeight) : width * image.height / image.width;
      return { src: image.src, alt: node.getAttribute("alt") || "", width, height };
    } catch { return false; }
  } }], toDOM: node => ["img", { ...node.attrs, id: undefined, "data-document-id": node.attrs.id }] },
  page_break: { group: "block", atom: true, attrs: { id }, parseDOM: [{ tag: "div[data-page-break]" }], toDOM: node => ["div", { "data-page-break": "true", "data-document-id": node.attrs.id, contenteditable: "false" }] },
};
const marks: Record<string, MarkSpec> = {
  strong: { parseDOM: [{ tag: "strong" }, { tag: "b", getAttrs: node => node.style.fontWeight !== "normal" && null }, { style: "font-weight", getAttrs: value => /^(bold(er)?|[6-9]\d{2,})$/.test(value) && null }], toDOM: () => ["strong", 0] },
  em: { parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
  underline: { parseDOM: [{ tag: "u" }, { style: "text-decoration", getAttrs: value => value.includes("underline") && null }], toDOM: () => ["u", 0] },
  strike: { parseDOM: [{ tag: "s" }, { tag: "del" }, { style: "text-decoration", getAttrs: value => value.includes("line-through") && null }], toDOM: () => ["s", 0] },
  text_style: {
    attrs: { fontFamily: { default: null }, fontSize: { default: null }, color: { default: null }, backgroundColor: { default: null } },
    parseDOM: [{ tag: "span[style]", getAttrs: node => ({ fontFamily: node.style.fontFamily || null, fontSize: node.style.fontSize ? parseFloat(node.style.fontSize) * (node.style.fontSize.endsWith("px") ? 0.75 : 1) : null, color: node.style.color || null, backgroundColor: node.style.backgroundColor || null }) }],
    toDOM: mark => ["span", { style: [mark.attrs.fontFamily && `font-family:${mark.attrs.fontFamily}`, mark.attrs.fontSize && `font-size:${mark.attrs.fontSize}pt`, mark.attrs.color && `color:${mark.attrs.color}`, mark.attrs.backgroundColor && `background-color:${mark.attrs.backgroundColor}`].filter(Boolean).join(";") }, 0],
  },
  link: { attrs: { href: {}, title: { default: null } }, inclusive: false, parseDOM: [{ tag: "a[href]", getAttrs: node => ({ href: node.getAttribute("href"), title: node.getAttribute("title") }) }], toDOM: mark => ["a", { ...mark.attrs, rel: "noopener noreferrer", target: "_blank" }, 0] },
};
/** Shared document grammar; loading this schema never creates a DOM element. */
export const documentSchema = new Schema({ nodes, marks });
