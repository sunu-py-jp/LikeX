import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetWorkbook } from "../types";
import { getWorkbookSheet } from "../workbook/snapshot";

/** Transfer geometry is bounded by the workbook limits, not the sheet's current capacity. */
export function validateTransferRange(range: SpreadsheetMergedRange): void {
  if (![range.top, range.left, range.bottom, range.right].every(Number.isInteger) ||
    range.top < 0 || range.left < 0 || range.bottom < range.top || range.right < range.left)
    throw new Error("貼り付け先の範囲が正しくありません");
  if (range.bottom >= SPREADSHEET_LIMITS.rows || range.right >= SPREADSHEET_LIMITS.columns)
    throw new Error("貼り付け先の行数または列数が上限を超えています");
  if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > SPREADSHEET_LIMITS.clipboardCells)
    throw new Error("一度に貼り付けできる範囲は10,000セルまでです");
}

/** Stage blank tail capacity without inserting coordinates or rewriting references.
 * The owning transfer must validate and publish its completed workbook atomically. */
export function stageTransferCapacity(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetMergedRange): SpreadsheetWorkbook {
  validateTransferRange(range);
  const sheet = getWorkbookSheet(workbook, sheetId);
  const rowCount = Math.max(sheet.rowCount, range.bottom + 1), columnCount = Math.max(sheet.columnCount, range.right + 1);
  if (rowCount === sheet.rowCount && columnCount === sheet.columnCount) return workbook;
  const expanded = Object.freeze({ ...sheet, rowCount, columnCount });
  return Object.freeze({ ...workbook, sheets: Object.freeze(workbook.sheets.map(item => item.id === sheetId ? expanded : item)) });
}
