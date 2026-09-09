import type { SpreadsheetMergedRange, SpreadsheetSheet } from "../../model/types";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../../model/sheet-dimensions";

export const COLUMN_WIDTH = DEFAULT_COLUMN_WIDTH;
export const ROW_HEIGHT = DEFAULT_ROW_HEIGHT;
export const ROW_HEADER_WIDTH = 48;
export type ColumnWidthPreview = { column: number; value: number };
export type GridViewport = { top: number; height: number };

export function columnGeometry(sheet: SpreadsheetSheet, preview?: ColumnWidthPreview | null) {
  const widths = Array.from({ length: sheet.columnCount }, (_, column) => preview?.column === column ? preview.value : sheet.columnWidths?.[column] ?? COLUMN_WIDTH);
  const columnOffsets = [ROW_HEADER_WIDTH];
  for (const width of widths) columnOffsets.push(columnOffsets[columnOffsets.length - 1] + width);
  return { widths, columnOffsets, gridWidth: columnOffsets.at(-1)! };
}

export function createRowOffsets(sheet: Pick<SpreadsheetSheet, "rowCount" | "rowHeights">) {
  const offsets = [ROW_HEIGHT];
  for (let row = 0; row < sheet.rowCount; row++) offsets.push(offsets[row] + (sheet.rowHeights?.[row] ?? ROW_HEIGHT));
  return offsets;
}

export function visibleGridRows(sheet: SpreadsheetSheet, rowOffsets: readonly number[], viewport: GridViewport, focusedRow: number) {
  const rowAt = (position: number) => {
    let low = 0, high = rowOffsets.length - 1;
    while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (rowOffsets[middle] <= position) low = middle; else high = middle - 1; }
    return low;
  };
  const start = Math.max(0, rowAt(viewport.top) - 5);
  const end = Math.min(sheet.rowCount, rowAt(viewport.top + viewport.height) + 7);
  const rows = Array.from({ length: end - start }, (_, index) => start + index);
  // Keep the active input mounted for focus/IME, and merges beginning above the viewport visible.
  if (!rows.includes(focusedRow)) rows.push(focusedRow);
  for (const merge of sheet.merges ?? []) {
    if (merge.top < start && merge.bottom >= start && !rows.includes(merge.top)) rows.push(merge.top);
  }
  return rows.sort((a, b) => a - b);
}

export function visibleMergedCells(sheet: SpreadsheetSheet, rows: readonly number[]) {
  const merged = new Map<number, SpreadsheetMergedRange>();
  for (const merge of sheet.merges ?? []) for (const row of rows) {
    if (row < merge.top || row > merge.bottom) continue;
    for (let column = merge.left; column <= merge.right; column++) merged.set(row * sheet.columnCount + column, merge);
  }
  return merged;
}
