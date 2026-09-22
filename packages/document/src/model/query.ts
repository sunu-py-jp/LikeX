import { documentSchema } from "./schema";
import { normalizeDocument } from "./document";
import type { DocumentBlockInfo, DocumentImageNode, DocumentModel } from "./types";

/** Plain text follows document order, with newlines between text blocks. */
export function getDocumentText(document: DocumentModel): string {
  const doc = documentSchema.nodeFromJSON(normalizeDocument(document).content);
  return doc.textBetween(0, doc.content.size, "\n", node => node.type.name === "hard_break" || node.type.name === "page_break" ? "\n" : node.type.name === "image" ? node.attrs.alt : "");
}
/** Returns detached nodes with IDs and positions, including nested paragraphs/list/table resources. */
export function getBlocks(document: DocumentModel): DocumentBlockInfo[] {
  const doc = documentSchema.nodeFromJSON(normalizeDocument(document).content);
  const result: DocumentBlockInfo[] = [];
  doc.descendants((node, from) => {
    if (!node.attrs.id) return;
    result.push({ id: node.attrs.id, node: structuredClone(node.toJSON()), from, to: from + node.nodeSize, contentFrom: node.isLeaf ? from : from + 1, contentTo: node.isLeaf ? from + node.nodeSize : from + node.nodeSize - 1 });
  });
  return result;
}
export function getBlock(document: DocumentModel, id: string): DocumentBlockInfo | undefined {
  return getBlocks(document).find(block => block.id === id);
}
export function getImages(document: DocumentModel): (DocumentBlockInfo & { node: DocumentImageNode })[] {
  return getBlocks(document).filter((block): block is DocumentBlockInfo & { node: DocumentImageNode } => block.node.type === "image");
}
export function getImage(document: DocumentModel, id: string): (DocumentBlockInfo & { node: DocumentImageNode }) | undefined {
  return getImages(document).find(image => image.id === id);
}
