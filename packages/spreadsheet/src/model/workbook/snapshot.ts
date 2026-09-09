import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { fail } from "./validation";
import { assertWorkbookDataValidation, type SpreadsheetDataValidation } from "../data-validation";

export function freezeCell(value: string, format?: SpreadsheetCellFormat, validation?: SpreadsheetDataValidation): SpreadsheetCell {
  return Object.freeze({ value, ...(format ? { format } : {}), ...(validation ? { validation } : {}) });
}
/** Finish an immutable transaction and enforce workbook-wide resource limits. */
export function finishWorkbook(sheets: readonly SpreadsheetSheet[], workbook?: SpreadsheetWorkbook,
  resources = workbook?.resources): SpreadsheetWorkbook {
  if (sheets.reduce((count, sheet) => count + Object.keys(sheet.cells).length, 0) > SPREADSHEET_LIMITS.cells)
    fail("保存できるセル数の上限を超えています");
  if (sheets.reduce((count, sheet) => count + (sheet.drawings?.length ?? 0), 0) > SPREADSHEET_LIMITS.drawings)
    fail("描画オブジェクトの数が上限を超えています");
  if (sheets.reduce((count, sheet) => count + Object.keys(sheet.comments ?? {}).length, 0) > SPREADSHEET_LIMITS.comments)
    fail("コメントの数が上限を超えています");
  if (sheets.reduce((count, sheet) => count + (sheet.merges?.length ?? 0), 0) > SPREADSHEET_LIMITS.merges)
    fail("結合範囲の数が上限を超えています");
  const result = Object.freeze({ schemaVersion: 1 as const, sheets: Object.freeze([...sheets]), ...(resources ? { resources } : {}) });
  assertWorkbookDataValidation(result);
  return result;
}
export function replaceWorkbookSheet(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet): SpreadsheetWorkbook {
  return finishWorkbook(workbook.sheets.map(item => item.id === sheet.id ? Object.freeze(sheet) : item), workbook);
}
export function getWorkbookSheet(workbook: SpreadsheetWorkbook, id: string): SpreadsheetSheet {
  return workbook.sheets.find(sheet => sheet.id === id) ?? fail("シートが見つかりません");
}
