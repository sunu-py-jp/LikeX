import { DOMSerializer, type DOMOutputSpec } from "prosemirror-model";
import { normalizeDocument } from "../model/document";
import { documentSchema } from "../model/schema";
import { documentNodeRange, getDocumentPage } from "../model/pages";
import type { DocumentCanvasAttributes, DocumentModel, DocumentNode, DocumentRootNode } from "../model/types";

/** Rendering budgets are separate from the native document's validation limits. */
const limits = { nodes: 512, text: 8_000, rows: 32, shapes: 32, connectors: 32 };
const clip = (text: string, length: number) => {
  const end = Math.min(length, text.length);
  return text.slice(0, end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) ? end - 1 : end);
};

/** A disposable rendering prefix; never published or saved as a document model. */
export function documentThumbnailContent(document: DocumentModel, pageNumber = 1): DocumentRootNode {
  document = normalizeDocument(document);
  const page = getDocumentPage(document, pageNumber);
  if (!page) throw new Error(`明示的な改ページで区切られた${pageNumber}ページ目がありません。`);
  const { from, to } = page;
  let nodes = 0, characters = 0, rows = 0, stopped = false;
  const takeText = (value: string) => {
    const accepted = clip(value, limits.text - characters);
    characters += accepted.length;
    if (accepted.length < value.length || characters >= limits.text) stopped = true;
    return accepted;
  };
  function visit(node: DocumentNode): DocumentNode | undefined {
    if (stopped || nodes >= limits.nodes) return undefined;
    const range = documentNodeRange(document, node);
    if (node.type === "page_break" || range.to <= from || range.from >= to) return undefined;
    if (node.type === "table_row" && ++rows > limits.rows) { stopped = true; return undefined; }
    nodes++;
    if (node.type === "text") { const text = takeText(node.text); return text ? { ...node, text } : undefined; }
    if (node.type === "shape") return { ...node, attrs: { ...node.attrs, text: takeText(node.attrs.text ?? "") } };
    if (node.type === "drawing_canvas") {
      const attrs = node.attrs as DocumentCanvasAttributes;
      const shapes = (attrs.shapes ?? []).slice(0, limits.shapes).map(shape => ({ ...shape, text: takeText(shape.text ?? "") }));
      const ids = new Set(shapes.map(shape => shape.id));
      const connectors = (attrs.connectors ?? []).filter(line => [line.start, line.end].every(end => !end.binding || ids.has(end.binding.targetId))).slice(0, limits.connectors);
      return { ...node, attrs: { ...attrs, shapes, connectors } };
    }
    if (!("content" in node) || !node.content) return node;
    const content: DocumentNode[] = [];
    let first = -1;
    for (const [index, child] of node.content.entries()) {
      const next = visit(child);
      if (next) { if (first < 0) first = index; content.push(next); }
      else if (node.type === "table_row" && nodes < limits.nodes) { nodes++; content.push({ ...child, content: [] } as DocumentNode); }
      if (stopped || nodes >= limits.nodes) break;
    }
    if (first < 0 && node.content.length && !["doc", "paragraph", "heading"].includes(node.type)) return undefined;
    return { ...node, ...(node.type === "ordered_list" && first > 0 ? { attrs: { ...node.attrs, order: (node.attrs?.order ?? 1) + first } } : {}), content } as DocumentNode;
  }
  return visit(document.content) as DocumentRootNode ?? { type: "doc", content: [] };
}

/** Uses the editor's toDOM rules, but never creates EditorView, EditorState, or a session. */
export function renderDocumentThumbnail(host: HTMLElement, content: DocumentRootNode, bottomMargin: number, instanceId: string): void {
  const ownerDocument = host.ownerDocument;
  const base = DOMSerializer.fromSchema(documentSchema);
  const images: { dom: HTMLImageElement; src: string }[] = [];
  const serializer = new DOMSerializer({ ...base.nodes, image: node => {
    const specification = documentSchema.nodes.image.spec.toDOM!(node) as [string, Record<string, unknown>];
    const { src, ...attrs } = specification[1];
    const dom = DOMSerializer.renderSpec(ownerDocument, [specification[0], attrs]).dom as HTMLImageElement;
    dom.style.aspectRatio = `${node.attrs.width} / ${node.attrs.height}`;
    dom.draggable = false;
    images.push({ dom, src: String(src) });
    return dom;
  } }, base.marks);
  const compound = new Set(["doc", "bullet_list", "ordered_list", "list_item", "table", "table_row", "table_cell", "table_header"]);
  let full = false;
  const bottom = () => {
    const bounds = host.getBoundingClientRect();
    const scale = host.offsetHeight ? bounds.height / host.offsetHeight : 1;
    return bounds.bottom - bottomMargin * scale;
  };
  function append(node: DocumentNode, target: HTMLElement) {
    if (full) return;
    const shell = compound.has(node.type);
    const model = documentSchema.nodeFromJSON(shell ? { ...node, content: undefined } : node);
    const rendered: { dom: HTMLElement | Text; contentDOM?: HTMLElement } = shell ? DOMSerializer.renderSpec(ownerDocument, model.type.spec.toDOM!(model) as DOMOutputSpec) : { dom: serializer.serializeNode(model, { document: ownerDocument }) };
    target.appendChild(rendered.dom);
    const element = rendered.dom as HTMLElement;
    if (element.getBoundingClientRect().top >= bottom()) {
      element.remove(); full = true; return;
    }
    if (shell && "content" in node) for (const child of node.content ?? []) {
      append(child, (rendered.contentDOM ?? element) as HTMLElement);
      if (full) break;
    }
    if (element.getBoundingClientRect().bottom >= bottom()) full = true;
  }
  host.replaceChildren();
  for (const block of content.content) { append(block, host); if (full) break; }
  // Local SVG marker IDs must also be unique when the same document is previewed twice.
  const ids = new Map<string, string>();
  for (const element of host.querySelectorAll("[id]")) { const original = element.id; const unique = `${instanceId}-${original}`; ids.set(original, unique); element.id = unique; }
  for (const element of host.querySelectorAll("[marker-start],[marker-end]")) for (const name of ["marker-start", "marker-end"]) {
    const value = element.getAttribute(name), original = value?.match(/^url\(#(.+)\)$/)?.[1];
    if (original && ids.has(original)) element.setAttribute(name, `url(#${ids.get(original)})`);
  }
  for (const image of images) if (host.contains(image.dom) && image.dom.getBoundingClientRect().top < bottom()) image.dom.src = image.src;
}
