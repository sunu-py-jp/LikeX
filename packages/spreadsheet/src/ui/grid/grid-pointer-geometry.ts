import type { DragBounds, DragPoint } from "../../core";
import { ROW_HEADER_WIDTH, ROW_HEIGHT } from "./grid-geometry";

export type GridPointerGeometry = { columnOffsets: readonly number[]; rowOffsets: readonly number[] };
function cellAt(offsets: readonly number[], coordinate: number) {
  let low = 0, high = offsets.length - 2;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (offsets[middle] <= coordinate) low = middle; else high = middle - 1; }
  return low;
}
/** Sticky headers are not part of the scrollable cell target area. */
export function gridBodyBounds(bounds: DragBounds, scale: number): DragBounds {
  return { right: bounds.right, bottom: bounds.bottom,
    left: Math.min(bounds.right - 1, bounds.left + ROW_HEADER_WIDTH * scale), top: Math.min(bounds.bottom - 1, bounds.top + ROW_HEIGHT * scale) };
}
/** Clamp hit testing to the visible edge; scrolling reveals the next cells under a stationary pointer. */
export function gridCellAtPointer(geometry: GridPointerGeometry, point: DragPoint, bounds: DragBounds, scroll: { scrollLeft: number; scrollTop: number }, scale: number) {
  const body = gridBodyBounds(bounds, scale);
  const x = Math.max(body.left, Math.min(bounds.right - 1, point.x)), y = Math.max(body.top, Math.min(bounds.bottom - 1, point.y));
  return { row: cellAt(geometry.rowOffsets, (y - bounds.top) / scale + scroll.scrollTop),
    column: cellAt(geometry.columnOffsets, (x - bounds.left) / scale + scroll.scrollLeft) };
}
