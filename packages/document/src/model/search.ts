import { createKeywordSearchMatcher, type KeywordSearchQuery } from "./core-text-search";
import { normalizeDocument } from "./document";
import { documentNodeRange } from "./pages";
import { choice, number, record } from "./validation";
import type { DocumentModel, DocumentNode } from "./types";

export type { KeywordSearchQuery } from "./core-text-search";
export type DocumentSearchOptions = {
  /** AND/OR applies across an explicit-break page by default, or within each text block. */
  matchBy?: "page" | "block";
  /** Maximum returned locations, 1–10,000; defaults to 1,000. */
  limit?: number;
};
export type DocumentSearchTextMatch = {
  keyword: string;
  /** UTF-16 offsets within the containing result's text. */
  textFrom: number;
  textTo: number;
  /** ProseMirror text positions, or the whole node range for shape/canvas text. */
  from: number;
  to: number;
};
export type DocumentSearchMatch = {
  /** One-based explicit-break page; not Word's automatic pagination. */
  pageNumber: number;
  blockId: string;
  kind: "paragraph" | "heading" | "shape" | "canvas-shape";
  /** A canvas shape shares its parent block's ProseMirror node range. */
  canvasShapeId?: string;
  /** ProseMirror content range for paragraphs/headings; node range for shapes/canvases. */
  from: number;
  to: number;
  text: string;
  matches: DocumentSearchTextMatch[];
};
export type DocumentSearchResult = {
  matches: DocumentSearchMatch[];
  /** More matching locations exist than the requested limit. */
  truncated: boolean;
};
type Fragment = Omit<DocumentSearchMatch, "matches">;

/** Searches validated document text without React, DOM, rendering, or OCR. */
export function searchDocument(document: DocumentModel, query: KeywordSearchQuery, options: DocumentSearchOptions = {}): DocumentSearchResult {
  const settings = record(options, "Document search options", ["matchBy", "limit"]);
  const matchBy = settings.matchBy === undefined ? "page" : choice(settings.matchBy, ["page", "block"], "Document search scope");
  const limit = settings.limit === undefined ? 1_000 : number(settings.limit, "Document search limit", 1, 10_000, true);
  const matcher = createKeywordSearchMatcher(query), source = normalizeDocument(document);
  const result: DocumentSearchResult = { matches: [], truncated: false };
  let pageNumber = 1, positionCount = 0, fragments: Fragment[] = [];
  function flush() {
    const pageMatches = matchBy === "page" && matcher.test(fragments.map(fragment => fragment.text));
    for (const fragment of fragments) {
      if (!pageMatches && (matchBy !== "block" || !matcher.test(fragment.text))) continue;
      const positions = matcher.find(fragment.text);
      if (!positions.length) continue;
      if (result.matches.length >= limit) { result.truncated = true; continue; }
      positionCount += positions.length;
      if (positionCount > 100_000) throw new Error("文書検索結果の一致位置は合計100,000件までです。");
      const inline = fragment.kind === "paragraph" || fragment.kind === "heading";
      result.matches.push({ ...fragment, matches: positions.map(position => ({
        keyword: position.keyword, textFrom: position.from, textTo: position.to,
        from: inline ? fragment.from + position.from : fragment.from,
        to: inline ? fragment.from + position.to : fragment.to,
      })) });
    }
    fragments = [];
  }
  function walk(node: DocumentNode) {
    if (node.type === "page_break") { flush(); pageNumber++; return; }
    if (node.type === "paragraph" || node.type === "heading") {
      const range = documentNodeRange(source, node);
      // Mark boundaries add no text; hard_break occupies one UTF-16 character and one PM position.
      const text = (node.content ?? []).map(child => child.type === "text" ? child.text : "\n").join("");
      fragments.push({ pageNumber, blockId: node.attrs!.id!, kind: node.type, from: range.from + 1, to: range.to - 1, text });
      return;
    }
    if (node.type === "shape" || node.type === "drawing_canvas") {
      const range = documentNodeRange(source, node), blockId = node.attrs.id!;
      if (node.type === "shape") fragments.push({ pageNumber, blockId, kind: "shape", ...range, text: node.attrs.text ?? "" });
      else for (const shape of node.attrs.shapes ?? []) fragments.push({ pageNumber, blockId, kind: "canvas-shape", canvasShapeId: shape.id, ...range, text: shape.text ?? "" });
      return;
    }
    if ("content" in node) for (const child of node.content ?? []) walk(child);
  }
  walk(source.content); flush();
  return result;
}
