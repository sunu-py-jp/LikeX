import type { SpreadsheetCellPosition, SpreadsheetMergedRange } from "../../model/types";

export type PrintAreaHandle = "move" | "top" | "bottom" | "left" | "right" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Cell-snapped movement retains the area size; resizing never reverses a boundary. */
export function adjustPrintArea(area: SpreadsheetMergedRange, handle: PrintAreaHandle, delta: SpreadsheetCellPosition,
  rowCount: number, columnCount: number): SpreadsheetMergedRange {
  if (handle === "move") {
    const rows = clamp(delta.row, -area.top, rowCount - 1 - area.bottom);
    const columns = clamp(delta.column, -area.left, columnCount - 1 - area.right);
    return { top: area.top + rows, bottom: area.bottom + rows, left: area.left + columns, right: area.right + columns };
  }
  return {
    top: handle.startsWith("top") ? clamp(area.top + delta.row, 0, area.bottom) : area.top,
    bottom: handle.startsWith("bottom") ? clamp(area.bottom + delta.row, area.top, rowCount - 1) : area.bottom,
    left: handle === "left" || handle.endsWith("Left") ? clamp(area.left + delta.column, 0, area.right) : area.left,
    right: handle === "right" || handle.endsWith("Right") ? clamp(area.right + delta.column, area.left, columnCount - 1) : area.right,
  };
}

export function printGridIndex(offsets: readonly number[], value: number): number {
  let low = 0, high = offsets.length - 1;
  while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (offsets[middle] <= value) low = middle; else high = middle - 1; }
  return clamp(low, 0, offsets.length - 1);
}

/** Binary search keeps scrolling independent of the total number of printed pages. */
export function visiblePrintSegments<T extends { start: number; end: number }>(segments: readonly T[], offsets: readonly number[], start: number, end: number): { segment: T; index: number }[] {
  let low = 0, high = segments.length;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (offsets[segments[middle].end + 1] < start) low = middle + 1; else high = middle; }
  const result: { segment: T; index: number }[] = [];
  for (let index = low; index < segments.length && offsets[segments[index].start] <= end; index++) {
    const segment = segments[index];
    if (offsets[segment.end + 1] > offsets[segment.start]) result.push({ segment, index });
  }
  return result;
}
