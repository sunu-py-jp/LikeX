import type { SpreadsheetDrawing, SpreadsheetDrawingAnchor } from "../model";

export type DrawingGeometry = { columnOffsets: readonly number[]; rowOffsets: readonly number[] };
export type DrawingRectangle = { left: number; top: number; width: number; height: number };
type DrawingSize = Pick<DrawingRectangle, "width" | "height">;

/** Keep an image's display-frame ratio. Corner drags project onto its diagonal;
 * property fields supply one dimension. GUI bounds apply to the longest side. */
export function resizeImageDimensions(initial: DrawingSize, requested: Partial<DrawingSize>, constrain = false): DrawingSize {
  const { width, height } = initial;
  if ((requested.width === undefined || requested.width === width) &&
    (requested.height === undefined || requested.height === height)) return { width, height };
  if (!constrain && requested.height === undefined && requested.width !== undefined)
    return { width: requested.width, height: requested.width * (height / width) };
  if (!constrain && requested.width === undefined && requested.height !== undefined)
    return { width: requested.height * (width / height), height: requested.height };
  const longest = Math.max(width, height), unitWidth = width / longest, unitHeight = height / longest;
  const proposed = requested.width !== undefined && requested.height !== undefined
    ? (requested.width * unitWidth + requested.height * unitHeight) / (unitWidth * unitWidth + unitHeight * unitHeight)
    : requested.width !== undefined ? requested.width / unitWidth : requested.height! / unitHeight;
  const next = constrain ? Math.max(16, Math.min(10_000, proposed)) : proposed;
  // Assign the bounded side directly: repeated scaling can otherwise exceed 10,000 by epsilon.
  return width >= height ? { width: next, height: next * unitHeight } : { width: next * unitWidth, height: next };
}

export function drawingRectangle(drawing: SpreadsheetDrawing, geometry: DrawingGeometry): DrawingRectangle {
  return { left: (geometry.columnOffsets[drawing.anchor.column] ?? 48) + drawing.anchor.offsetX,
    top: (geometry.rowOffsets[drawing.anchor.row] ?? 28) + drawing.anchor.offsetY, width: drawing.width, height: drawing.height };
}

export function drawingAnchor(left: number, top: number, geometry: DrawingGeometry): SpreadsheetDrawingAnchor {
  const locate = (position: number, offsets: readonly number[]) => {
    const pixel = Math.max(offsets[0], Math.min(offsets.at(-1)! - 1, position));
    let low = 0, high = offsets.length - 2;
    while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (offsets[middle] <= pixel) low = middle; else high = middle - 1; }
    return { index: low, offset: Math.round((pixel - offsets[low]) * 100) / 100 };
  };
  const x = locate(left, geometry.columnOffsets), y = locate(top, geometry.rowOffsets);
  return { row: y.index, column: x.index, offsetX: x.offset, offsetY: y.offset };
}

export function boundedDrawingRectangle(rectangle: DrawingRectangle, geometry: DrawingGeometry): DrawingRectangle {
  return { left: Math.max(geometry.columnOffsets[0], Math.min(geometry.columnOffsets.at(-1)! - 1, rectangle.left)),
    top: Math.max(geometry.rowOffsets[0], Math.min(geometry.rowOffsets.at(-1)! - 1, rectangle.top)),
    width: Math.max(16, Math.min(10_000, rectangle.width)), height: Math.max(16, Math.min(10_000, rectangle.height)) };
}
