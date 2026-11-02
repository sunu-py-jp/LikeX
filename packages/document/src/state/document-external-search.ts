import { getDocumentPage } from "../model/pages";
import { getBlocks } from "../model/query";
import type { DocumentModel } from "../model/types";
import type { DocumentExternalSearchTarget } from "../props";
import type { DocumentSearchLocation } from "./use-document-search";

/** Resolve stable block IDs each time; absolute document positions are never supplied by a host. */
export function resolveDocumentExternalTarget(document: DocumentModel, target: DocumentExternalSearchTarget, blocks = getBlocks(document)): DocumentSearchLocation {
  if (!target || typeof target.blockId !== "string" || !target.blockId) throw new Error("検索結果のブロックIDが不正です。");
  const block = blocks.find(block => block.id === target.blockId);
  if (!block) throw new Error("検索結果の対象が削除されています。検索結果を更新してください。");
  const node = block.node;
  const inline = node.type === "paragraph" || node.type === "heading";
  let text: string, kind: DocumentSearchLocation["kind"];
  if (inline) { text = (node.content ?? []).map(child => child.type === "text" ? child.text : child.type === "hard_break" ? "\n" : "").join(""); kind = node.type; }
  else if (node.type === "shape") { text = node.attrs.text ?? ""; kind = "shape"; }
  else if (node.type === "drawing_canvas") {
    const shape = node.attrs.shapes?.find(shape => shape.id === target.canvasShapeId);
    if (!shape) throw new Error("検索結果のキャンバス内図形が見つかりません。");
    text = shape.text ?? ""; kind = "canvas-shape";
  } else throw new Error("このブロックは検索結果の移動対象にできません。");
  if (target.canvasShapeId !== undefined && node.type !== "drawing_canvas") throw new Error("キャンバス内図形の指定が不正です。");
  const textFrom = target.textFrom ?? 0, textTo = target.textTo ?? text.length;
  if (!Number.isSafeInteger(textFrom) || !Number.isSafeInteger(textTo) || textFrom < 0 || textFrom > textTo || textTo > text.length)
    throw new Error("検索結果の文字位置が現在の本文と一致しません。検索結果を更新してください。");
  if (target.expectedText !== undefined && target.expectedText !== text) throw new Error("検索後に本文が変更されています。検索結果を更新してください。");
  const from = inline ? block.contentFrom : block.from, to = inline ? block.contentTo : block.to;
  const positionAt = (offset: number, afterBoundary: boolean) => {
    let position = from + offset, textOffset = 0;
    if (inline) for (const child of node.content ?? []) {
      if (child.type === "rendered_page_break") {
        if (textOffset < offset || textOffset === offset && afterBoundary) position++;
      } else textOffset += child.type === "text" ? child.text.length : 1;
    }
    return position;
  };
  const match = { keyword: text.slice(textFrom, textTo), textFrom, textTo, from: inline ? positionAt(textFrom, true) : from, to: inline ? positionAt(textTo, textFrom === textTo) : to };
  let pageNumber = 1;
  while ((getDocumentPage(document, pageNumber + 1)?.from ?? Infinity) <= match.from) pageNumber++;
  return { blockId: block.id, canvasShapeId: target.canvasShapeId, pageNumber, kind, from, to, text, matches: [match], match };
}
