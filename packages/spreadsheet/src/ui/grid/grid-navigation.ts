import { cellAddress, parseCellAddress } from "../../model/address";
import { getMergedRange, mergedCellPosition } from "../../model/merges";
import type { SpreadsheetCellPosition, SpreadsheetSheet } from "../../model/types";

type PresenceIndex = { rows: Map<number, number[]>; columns: Map<number, number[]>; last: SpreadsheetCellPosition };
const presenceIndexes = new WeakMap<SpreadsheetSheet, PresenceIndex>();

/** Index sparse values once per immutable sheet; large empty grids need no cell materialization. */
function presenceIndex(sheet: SpreadsheetSheet): PresenceIndex {
  const cached = presenceIndexes.get(sheet);
  if (cached) return cached;
  const index: PresenceIndex = { rows: new Map(), columns: new Map(), last: { row: 0, column: 0 } };
  const include = (row: number, column: number) => {
    index.last.row = Math.max(index.last.row, row); index.last.column = Math.max(index.last.column, column);
  };
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address)!;
    if (cell.value || cell.format || cell.validation) include(position.row, position.column);
    if (!cell.value) continue;
    const row = index.rows.get(position.row) ?? [], column = index.columns.get(position.column) ?? [];
    row.push(position.column); column.push(position.row);
    index.rows.set(position.row, row); index.columns.set(position.column, column);
  }
  for (const address of Object.keys(sheet.comments ?? {})) {
    const position = parseCellAddress(address)!; include(position.row, position.column);
  }
  for (const merge of sheet.merges ?? []) include(merge.bottom, merge.right);
  presenceIndexes.set(sheet, index);
  return index;
}

/** Ctrl+Arrow: contiguous data edge, next nonempty cell across a gap, or the sheet boundary. */
export function nextDataCellPosition(sheet: SpreadsheetSheet, position: Readonly<SpreadsheetCellPosition>, rows: number, columns: number): SpreadsheetCellPosition {
  const anchor = mergedCellPosition(sheet, position), merge = getMergedRange(sheet, anchor);
  const vertical = rows !== 0, step = Math.sign(vertical ? rows : columns);
  if (!step) return anchor;
  const size = vertical ? sheet.rowCount : sheet.columnCount, fixed = vertical ? anchor.column : anchor.row;
  const origin = vertical ? anchor.row : anchor.column;
  const edge = merge ? vertical ? (step > 0 ? merge.bottom : merge.top) : (step > 0 ? merge.right : merge.left) : origin;
  let cursor = edge + step;
  if (cursor < 0 || cursor >= size) return anchor;
  const index = presenceIndex(sheet), occupied = new Uint8Array(size);
  for (const value of (vertical ? index.columns : index.rows).get(fixed) ?? []) occupied[value] = 1;
  for (const range of sheet.merges ?? []) {
    if (fixed < (vertical ? range.left : range.top) || fixed > (vertical ? range.right : range.bottom) ||
      !sheet.cells[cellAddress(range.top, range.left)]?.value) continue;
    occupied.fill(1, vertical ? range.top : range.left, (vertical ? range.bottom : range.right) + 1);
  }
  if (occupied[origin] && occupied[cursor]) {
    while (cursor + step >= 0 && cursor + step < size && occupied[cursor + step]) cursor += step;
  } else {
    while (cursor + step >= 0 && cursor + step < size && !occupied[cursor]) cursor += step;
  }
  return mergedCellPosition(sheet, vertical ? { row: cursor, column: fixed } : { row: fixed, column: cursor });
}

/** Ctrl+End includes stored formatting, validation, comments and complete merged ranges. */
export function lastUsedCellPosition(sheet: SpreadsheetSheet): SpreadsheetCellPosition {
  return mergedCellPosition(sheet, presenceIndex(sheet).last);
}

/** Page navigation follows visible height, including custom row sizes. */
export function pageRowPosition(rowOffsets: readonly number[], currentRow: number, direction: number, viewportHeight: number): number {
  const last = rowOffsets.length - 2;
  const offset = rowOffsets[currentRow] + Math.sign(direction) * Math.max(1, viewportHeight);
  let low = 0, high = last;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (rowOffsets[middle] <= offset) low = middle; else high = middle - 1; }
  return Math.max(0, Math.min(last, direction > 0 ? Math.max(currentRow + 1, low) : Math.min(currentRow - 1, low)));
}
