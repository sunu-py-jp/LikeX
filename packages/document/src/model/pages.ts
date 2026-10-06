import { normalizeDocument } from "./document";
import { number } from "./validation";
import type { DocumentModel, DocumentNode, DocumentPageInfo } from "./types";

type Range = Readonly<{ from: number; to: number }>;
type Index = { pages: readonly DocumentPageInfo[]; ranges: WeakMap<DocumentNode, Range> };
const indexes = new WeakMap<DocumentModel, Index>();
const leaves = new Set(["hard_break", "image", "shape", "drawing_canvas", "page_break"]);

/** Explicit breaks follow document order, including breaks inside lists and tables. */
function pageIndex(input: DocumentModel): Index {
  const document = normalizeDocument(input), cached = indexes.get(document);
  if (cached) return cached;
  const pages: DocumentPageInfo[] = [], ranges = new WeakMap<DocumentNode, Range>();
  let start = 0;
  function walk(node: DocumentNode, from: number): number {
    let to: number;
    if (node.type === "text") to = from + node.text.length;
    else if (leaves.has(node.type)) to = from + 1;
    else {
      to = from + (node.type === "doc" ? 0 : 1);
      if ("content" in node) for (const child of node.content ?? []) to = walk(child, to);
      if (node.type !== "doc") to++;
    }
    ranges.set(node, Object.freeze({ from, to }));
    if (node.type === "page_break") {
      pages.push(Object.freeze({ pageNumber: pages.length + 1, from: start, to: from }));
      start = to;
    }
    return to;
  }
  const end = walk(document.content, 0);
  pages.push(Object.freeze({ pageNumber: pages.length + 1, from: start, to: end }));
  const result = { pages: Object.freeze(pages), ranges }; indexes.set(document, result); return result;
}

/** 1-based explicit-break page; positions exclude the break itself. No automatic pagination. */
export function getDocumentPage(document: DocumentModel, pageNumber = 1): DocumentPageInfo | undefined {
  number(pageNumber, "Page number", 1, Number.MAX_SAFE_INTEGER, true);
  return pageIndex(document).pages[pageNumber - 1];
}

/** Internal layout projection uses the same positions as the public page query. */
export function documentNodeRange(document: DocumentModel, node: DocumentNode): Range {
  return pageIndex(document).ranges.get(node)!;
}
