import { parseCellAddress } from "../address";
import { rangesIntersect } from "../merges";
import { moveCells } from "../workbook/move-cells";
import { getWorkbookSheet } from "../workbook/snapshot";
import type { SpreadsheetMergedRange, SpreadsheetMoveSource, SpreadsheetMoveTarget, SpreadsheetWorkbook } from "../types";
import { stageTransferCapacity, validateTransferRange } from "./transfer-capacity";

/** Validate against the original source dimensions before growing a same-sheet destination. */
export function getCellMoveRange(workbook: SpreadsheetWorkbook, source: SpreadsheetMoveSource, target: SpreadsheetMoveTarget): SpreadsheetMergedRange {
  const from = getWorkbookSheet(workbook, source.sheetId);
  getWorkbookSheet(workbook, target.sheetId);
  if (![source.top, source.left, source.bottom, source.right, target.row, target.column].every(Number.isInteger) ||
    source.top < 0 || source.left < 0 || source.bottom < source.top || source.right < source.left ||
    source.bottom >= from.rowCount || source.right >= from.columnCount || target.row < 0 || target.column < 0)
    throw new Error("切り取り元・貼り付け先の範囲が正しくありません");
  const destination = { top: target.row, left: target.column, bottom: target.row + source.bottom - source.top,
    right: target.column + source.right - source.left };
  validateTransferRange(destination);
  return destination;
}

/** The same cut semantics for GUI and commands; metadata moves intact rather than being recopied. */
export function moveSpreadsheetCells(workbook: SpreadsheetWorkbook, source: SpreadsheetMoveSource, target: SpreadsheetMoveTarget,
  policy: Readonly<{ formulas: boolean; mergeCells: boolean }>): SpreadsheetWorkbook {
  const destination = getCellMoveRange(workbook, source, target);
  const expanded = stageTransferCapacity(workbook, target.sheetId, destination);
  const next = moveCells(expanded, source, target); // Validate geometry and references before traversing caller ranges.
  const from = workbook.sheets.find(sheet => sheet.id === source.sheetId)!, to = workbook.sheets.find(sheet => sheet.id === target.sheetId)!;
  if (!policy.formulas && Object.entries(from.cells).some(([address, cell]) => {
    const position = parseCellAddress(address)!;
    return position.row >= source.top && position.row <= source.bottom && position.column >= source.left &&
      position.column <= source.right && cell.value.startsWith("=");
  })) throw new Error("数式の入力は無効です");
  if (!policy.mergeCells && ((from.merges ?? []).some(merge => rangesIntersect(source, merge)) ||
    (to.merges ?? []).some(merge => rangesIntersect(destination, merge)))) throw new Error("セルの結合の変更は無効です");
  return next;
}
