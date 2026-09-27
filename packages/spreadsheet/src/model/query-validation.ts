import { parseCellAddress } from "./address";
import type { SpreadsheetReadRangeInput } from "./query";
import type { QuerySnapshot } from "./query-snapshot";
import { SPREADSHEET_FORMAT, SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "./types";

export function validateId(id: string): void {
  if (typeof id !== "string" || !id || id.length > 200 || /\0/.test(id)) throw new Error("読み取る対象のIDが正しくありません");
}

export function requireWorkbook(workbook: QuerySnapshot<SpreadsheetWorkbook>): void {
  if (!workbook || !Array.isArray(workbook.sheets) || !workbook.sheets.length || workbook.sheets.length > SPREADSHEET_LIMITS.sheets ||
    (workbook.format !== undefined && workbook.format !== SPREADSHEET_FORMAT) ||
    (workbook.schemaVersion !== undefined && workbook.schemaVersion !== 1)) throw new Error("ブックの形式が正しくありません");
}

export function requireSheet(workbook: QuerySnapshot<SpreadsheetWorkbook>, sheetId: string): QuerySnapshot<SpreadsheetSheet> {
  requireWorkbook(workbook); validateId(sheetId);
  const matches = workbook.sheets.filter(sheet => sheet?.id === sheetId);
  if (matches.length !== 1) throw new Error("シートが見つからないか、同じIDのシートが重複しています");
  const sheet = matches[0];
  if (!Number.isInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > SPREADSHEET_LIMITS.rows ||
    !Number.isInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > SPREADSHEET_LIMITS.columns)
    throw new Error("シートの行数または列数が正しくありません");
  return sheet;
}

/** Validate an inclusive rectangle without allocating cells; callers may impose an allocation limit. */
export function requireRange(sheet: QuerySnapshot<SpreadsheetSheet>, input: SpreadsheetReadRangeInput, maxCells?: number): SpreadsheetMergedRange {
  let range: SpreadsheetMergedRange;
  if (typeof input === "string") {
    const parts = input.split(":");
    if (parts.length > 2) throw new Error("読み取る範囲は同じシート内のA1表記で指定してください");
    const first = parseCellAddress(parts[0]), last = parseCellAddress(parts[1] ?? parts[0]);
    if (!first || !last) throw new Error("読み取る範囲は同じシート内のA1表記で指定してください");
    range = { top: first.row, left: first.column, bottom: last.row, right: last.column };
  } else range = input;
  if (!range || typeof range !== "object" || Array.isArray(range) ||
    ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) ||
    range.top < 0 || range.left < 0 || range.bottom < range.top || range.right < range.left ||
    range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) throw new Error("読み取る範囲はシート内の長方形で指定してください");
  if (maxCells !== undefined && (range.bottom - range.top + 1) * (range.right - range.left + 1) > maxCells)
    throw new Error("一度に読み取る範囲は10,000セルまでです");
  return { top: range.top, left: range.left, bottom: range.bottom, right: range.right };
}
