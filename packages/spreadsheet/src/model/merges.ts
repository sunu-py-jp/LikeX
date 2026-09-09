import { parseCellAddress } from "./address";
import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition, type SpreadsheetMergedRange, type SpreadsheetSheet } from "./types";

type MergeSheet = Pick<SpreadsheetSheet, "merges">;
type SheetDimensions = Pick<SpreadsheetSheet, "rowCount" | "columnCount">;

export function rangesIntersect(a: SpreadsheetMergedRange, b: SpreadsheetMergedRange): boolean {
  return a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left;
}
export function rangeContains(outer: SpreadsheetMergedRange, inner: SpreadsheetMergedRange): boolean {
  return outer.top <= inner.top && outer.left <= inner.left && outer.bottom >= inner.bottom && outer.right >= inner.right;
}
export function getMergedRange(sheet: MergeSheet, position: Readonly<SpreadsheetCellPosition>): SpreadsheetMergedRange | undefined {
  return sheet.merges?.find(range => position.row >= range.top && position.row <= range.bottom &&
    position.column >= range.left && position.column <= range.right);
}
export function mergedCellPosition(sheet: MergeSheet, position: Readonly<SpreadsheetCellPosition>): SpreadsheetCellPosition {
  const merge = getMergedRange(sheet, position);
  return merge ? { row: merge.top, column: merge.left } : { ...position };
}
/** Expand to contain every intersected merge, including merges reached by a previous expansion. */
export function expandRangeForMerges(sheet: MergeSheet, range: SpreadsheetMergedRange): SpreadsheetMergedRange {
  let result = { ...range }, expanded: boolean;
  do {
    expanded = false;
    for (const merge of sheet.merges ?? []) {
      if (!rangesIntersect(result, merge) || rangeContains(result, merge)) continue;
      result = { top: Math.min(result.top, merge.top), left: Math.min(result.left, merge.left),
        bottom: Math.max(result.bottom, merge.bottom), right: Math.max(result.right, merge.right) };
      expanded = true;
    }
  } while (expanded);
  return result;
}

/** Whether merging would remove any content outside the retained top-left cell. */
export function mergedContentWouldBeDiscarded(sheet: Pick<SpreadsheetSheet, "cells" | "comments">, range: SpreadsheetMergedRange): boolean {
  const covered = (address: string) => {
    const position = parseCellAddress(address)!;
    return position.row >= range.top && position.row <= range.bottom && position.column >= range.left && position.column <= range.right &&
      (position.row !== range.top || position.column !== range.left);
  };
  return Object.entries(sheet.cells).some(([address, cell]) => !!cell.value && covered(address)) ||
    Object.keys(sheet.comments ?? {}).some(covered);
}

export function validateMergedRange(range: SpreadsheetMergedRange, sheet: SheetDimensions, allowSingleCell = false): void {
  if (!range || typeof range !== "object" || Array.isArray(range) ||
    ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) ||
    range.top < 0 || range.left < 0 || range.bottom < range.top || range.right < range.left ||
    range.bottom >= sheet.rowCount || range.right >= sheet.columnCount ||
    (!allowSingleCell && range.top === range.bottom && range.left === range.right))
    throw new Error("結合範囲はシート内の2セル以上の長方形で指定してください");
}

export function normalizeMerges(input: readonly SpreadsheetMergedRange[] | undefined,
  sheet: SheetDimensions): readonly SpreadsheetMergedRange[] | undefined {
  if (input === undefined || (Array.isArray(input) && input.length === 0)) return undefined;
  if (!Array.isArray(input) || input.length > SPREADSHEET_LIMITS.merges) throw new Error("結合範囲の数が上限を超えているか、形式が正しくありません");
  for (const range of input) validateMergedRange(range, sheet);
  const result = input.map(range => {
    return Object.freeze({ top: range.top, left: range.left, bottom: range.bottom, right: range.right });
  }).sort((a, b) => a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right);
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length && result[j].top <= result[i].bottom; j++)
    if (rangesIntersect(result[i], result[j])) throw new Error("結合範囲は重複できません");
  return Object.freeze(result);
}

/** Validate sparse cells without materializing the potentially large merged area. */
export function validateMergedContents(sheet: Pick<SpreadsheetSheet, "merges" | "cells" | "comments">): void {
  if (!sheet.merges?.length) return;
  const rows = new Map<number, readonly SpreadsheetMergedRange[]>();
  const covered = (address: string) => {
    const position = parseCellAddress(address)!;
    let ranges = rows.get(position.row);
    if (!ranges) {
      ranges = sheet.merges!.filter(range => range.top <= position.row && range.bottom >= position.row);
      rows.set(position.row, ranges);
    }
    return ranges.some(range => position.column >= range.left && position.column <= range.right &&
      (position.row !== range.top || position.column !== range.left));
  };
  for (const [address, cell] of Object.entries(sheet.cells))
    if (cell.value && covered(address)) throw new Error("結合セルの値は左上のセルにだけ保存してください");
  for (const address of Object.keys(sheet.comments ?? {}))
    if (covered(address)) throw new Error("結合セルのコメントは左上のセルにだけ保存してください");
}

export function mergesEqual(a: readonly SpreadsheetMergedRange[] = [], b: readonly SpreadsheetMergedRange[] = []): boolean {
  return a === b || (a.length === b.length && a.every((range, index) => {
    const other = b[index];
    return range.top === other.top && range.left === other.left && range.bottom === other.bottom && range.right === other.right;
  }));
}
