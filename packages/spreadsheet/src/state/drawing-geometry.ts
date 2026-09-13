import type { SpreadsheetDrawing, SpreadsheetDrawingAnchor } from "../model";

export type DrawingGeometry = { columnOffsets: readonly number[]; rowOffsets: readonly number[] };
export type DrawingRectangle = { left: number; top: number; width: number; height: number };
export type DrawingResizeCorner = "nw" | "ne" | "sw" | "se";
export type DrawingResizeRectangle = DrawingRectangle & { flipX: boolean; flipY: boolean };
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

/** Resize around the opposite corner. Crossing it toggles the starting orientation.
 * Only the anchor must stay on the sheet; right/bottom overflow remains supported. */
export function resizeDrawingRectangle(initial: DrawingRectangle, corner: DrawingResizeCorner,
  delta: { x: number; y: number }, geometry: DrawingGeometry,
  options: { preserveAspectRatio?: boolean; flipX?: boolean; flipY?: boolean; axis?: "x" | "y" } = {}): DrawingResizeRectangle {
  const flips = { flipX: !!options.flipX, flipY: !!options.flipY };
  if (delta.x === 0 && delta.y === 0) return { ...initial, ...flips };
  const east = corner.endsWith("e"), south = corner.startsWith("s");
  const longest = Math.max(initial.width, initial.height);
  const unitX = options.preserveAspectRatio ? initial.width / longest : 1;
  const unitY = options.preserveAspectRatio ? initial.height / longest : 1;
  const axis = (position: number, size: number, forward: boolean, change: number, offsets: readonly number[], unit: number) => {
    const fixed = position + (forward ? 0 : size), originalDirection = forward ? 1 : -1;
    const distance = originalDirection * size + change;
    let direction = distance === 0 ? originalDirection : Math.sign(distance), requested = Math.abs(distance);
    const limits = (side: number) => side > 0
      ? { min: 16 * unit, max: fixed >= offsets[0] && fixed <= offsets.at(-1)! - 1 ? 10_000 * unit : 0 }
      : { min: Math.max(16 * unit, fixed - (offsets.at(-1)! - 1)), max: Math.min(10_000 * unit, fixed - offsets[0]) };
    let bounds = limits(direction);
    if (bounds.max < bounds.min) {
      // Crossing a sheet boundary cannot move the fixed corner or lose the handle.
      direction = -direction; bounds = limits(direction); requested = 0;
    }
    return { fixed, direction, requested, ...bounds, flipped: direction !== originalDirection };
  };
  const horizontal = (change: number) => axis(initial.left, initial.width, east, change, geometry.columnOffsets, unitX);
  const vertical = (change: number) => axis(initial.top, initial.height, south, change, geometry.rowOffsets, unitY);
  let x = horizontal(delta.x), y = vertical(delta.y);
  let width: number, height: number;
  if (options.preserveAspectRatio) {
    // A large off-sheet frame can require more space than a crossed axis has.
    // Keep that axis on its starting side rather than breaking ratio or anchor bounds.
    if (x.min / unitX > y.max / unitY) y = vertical(0);
    if (y.min / unitY > x.max / unitX) x = horizontal(0);
    const proposed = options.axis === "x" ? x.requested / unitX : options.axis === "y" ? y.requested / unitY
      : (x.requested * unitX + y.requested * unitY) / (unitX * unitX + unitY * unitY);
    const size = Math.max(x.min / unitX, y.min / unitY, Math.min(proposed, x.max / unitX, y.max / unitY));
    width = size * unitX; height = size * unitY;
  } else {
    width = Math.max(x.min, Math.min(x.max, x.requested));
    height = Math.max(y.min, Math.min(y.max, y.requested));
  }
  return { left: x.fixed - (x.direction < 0 ? width : 0), top: y.fixed - (y.direction < 0 ? height : 0),
    width, height, flipX: flips.flipX !== x.flipped, flipY: flips.flipY !== y.flipped };
}
