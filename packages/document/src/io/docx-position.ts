import type { DocumentBlockPosition, DocumentPage } from "../model/types";
import { attr, child, textContent, type XmlNode } from "./docx-reader";

const EMU_PER_MM = 36_000;
/** A drawing may reach this far into the text area and still count as standing clear of it. */
const CLEARANCE = 0.5;
type Box = { start: number; size: number };

/** One axis of an anchored drawing in mm from the page edge; the origin of a paragraph is not known here. */
function axis(node: XmlNode | undefined, boxes: Readonly<Record<string, Box | "text">>, starts: readonly string[], ends: readonly string[], extent: number): { from: string; offset: number } | undefined {
  const from = attr(node, "relativeFrom") ?? "", box = boxes[from], align = child(node, "align"), offset = child(node, "posOffset");
  if (!node || !box) return undefined;
  if (align) {
    const side = textContent(align).trim();
    if (box === "text") return undefined;
    if (starts.includes(side)) return { from, offset: box.start };
    if (side === "center") return { from, offset: box.start + (box.size - extent) / 2 };
    return ends.includes(side) ? { from, offset: box.start + box.size - extent } : undefined;
  }
  const value = offset ? Number(textContent(offset).trim()) / EMU_PER_MM : NaN;
  return Number.isFinite(value) ? { from, offset: box === "text" ? value : box.start + value } : undefined;
}

/**
 * The place of an anchored drawing, where the document model can show it there: the drawing stands clear
 * of the text area (beside it, or in the margin above or below it), or it lies in front of the text without
 * moving it. Text does not flow around a block, so a drawing that shares the text area with wrapped text is
 * left in the text, as is one behind the text. Sizes are in mm.
 */
export function readDocxPosition(anchor: XmlNode | undefined, page: DocumentPage, width: number, height: number): DocumentBlockPosition | undefined {
  if (!anchor) return undefined;
  const { margins } = page, textWidth = page.width - margins.left - margins.right, textHeight = page.height - margins.top - margins.bottom;
  let horizontal: { from: string; offset: number } | undefined, vertical: { from: string; offset: number } | undefined;
  if (["1", "true"].includes(attr(anchor, "simplePos") ?? "")) {
    const point = child(anchor, "simplePos"), x = Number(attr(point, "x")) / EMU_PER_MM, y = Number(attr(point, "y")) / EMU_PER_MM;
    if (Number.isFinite(x) && Number.isFinite(y)) { horizontal = { from: "page", offset: x }; vertical = { from: "page", offset: y }; }
  } else {
    const left: Box = { start: 0, size: margins.left }, right: Box = { start: page.width - margins.right, size: margins.right };
    horizontal = axis(child(anchor, "positionH"), { page: { start: 0, size: page.width }, margin: { start: margins.left, size: textWidth }, column: { start: margins.left, size: textWidth },
      leftMargin: left, insideMargin: left, rightMargin: right, outsideMargin: right }, ["left", "inside"], ["right", "outside"], width);
    const top: Box = { start: 0, size: margins.top }, bottom: Box = { start: page.height - margins.bottom, size: margins.bottom };
    vertical = axis(child(anchor, "positionV"), { page: { start: 0, size: page.height }, margin: { start: margins.top, size: textHeight }, topMargin: top, insideMargin: top,
      bottomMargin: bottom, outsideMargin: bottom, paragraph: "text", line: "text" }, ["top", "inside"], ["bottom", "outside"], height);
  }
  if (!horizontal || !vertical) return undefined;
  const fromText = ["paragraph", "line"].includes(vertical.from);
  const clear = horizontal.offset + width <= margins.left + CLEARANCE || horizontal.offset >= page.width - margins.right - CLEARANCE ||
    !fromText && (vertical.offset + height <= margins.top + CLEARANCE || vertical.offset >= page.height - margins.bottom - CLEARANCE);
  const behind = ["1", "true"].includes(attr(anchor, "behindDoc") ?? "");
  if (!clear && (behind || !child(anchor, "wrapNone"))) return undefined;
  // Positions keep the origin they were given from, so that they follow a later change of the margins.
  const fromMargin = ["margin", "column"].includes(horizontal.from);
  const position: DocumentBlockPosition = {
    horizontal: { from: fromMargin ? "margin" : "page", offset: horizontal.offset - (fromMargin ? margins.left : 0) },
    vertical: { from: fromText ? "paragraph" : vertical.from === "margin" ? "margin" : "page", offset: vertical.offset - (vertical.from === "margin" ? margins.top : 0) },
  };
  return [position.horizontal.offset, position.vertical.offset].every(value => Math.abs(value) <= 1200) ? position : undefined;
}

/**
 * Rewrites the inline drawing of a block as a run anchored at its place on the page, for the paragraph
 * that follows it. The drawing lies in front of the text, which it does not move.
 */
export function writeDocxAnchoredRun(block: string, position: DocumentBlockPosition, order: number): string {
  const emu = (value: number) => Math.round(value * EMU_PER_MM);
  return block.replace(/^<w:p>/, "").replace(/<\/w:p>$/, "")
    .replace(/<wp:inline [^>]*>/, `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${order}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
      `<wp:positionH relativeFrom="${position.horizontal.from}"><wp:posOffset>${emu(position.horizontal.offset)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="${position.vertical.from}"><wp:posOffset>${emu(position.vertical.offset)}</wp:posOffset></wp:positionV>`)
    .replace(/(<wp:extent [^>]*\/>)/, "$1<wp:wrapNone/>").replace("</wp:inline>", "</wp:anchor>");
}
