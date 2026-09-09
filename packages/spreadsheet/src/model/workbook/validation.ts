import { cellAddress, parseCellAddress } from "../address";
import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";

export const fail = (message: string): never => { throw new Error(message); };
export function validateDimension(value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail("行数または列数が上限を超えています");
  return value;
}
export function normalizeSheetName(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 31 || /[\[\]:*?/\\\u0000-\u001f]/.test(value) || /^'|'$/.test(value.trim()))
    return fail("シート名は31文字以内で、空欄や [ ] : * ? / \\ を含めないでください");
  return value.trim();
}
export function ensureUniqueSheetName(workbook: SpreadsheetWorkbook, name: string, except?: string) {
  if (workbook.sheets.some(sheet => sheet.id !== except && sheet.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")))
    fail("同じ名前のシートがあります");
}
export function normalizeCellFormat(value: SpreadsheetCellFormat | undefined): SpreadsheetCellFormat | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("セルの書式が正しくありません");
  const result: SpreadsheetCellFormat = {};
  for (const key of ["bold", "italic", "underline"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "boolean") fail("セルの書式が正しくありません");
    result[key] = value[key];
  }
  for (const key of ["color", "background"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "string" || value[key].length > 100 || /[;{}<>]/.test(value[key])) fail("セルの色が正しくありません");
    if (value[key]) result[key] = value[key];
  }
  if (value.align !== undefined) {
    if (!["left", "center", "right"].includes(value.align)) fail("文字の配置が正しくありません");
    result.align = value.align;
  }
  if (value.numberFormat !== undefined) {
    if (!["general", "number", "currency", "percent"].includes(value.numberFormat)) fail("数値の書式が正しくありません");
    result.numberFormat = value.numberFormat;
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}
export function validateCellValue(value: string) {
  if (typeof value !== "string" || value.length > SPREADSHEET_LIMITS.cellLength) fail("セルの値は100,000文字以内の文字列で指定してください");
  return value;
}
export function normalizeSizes(input: Readonly<Record<number, number>> | undefined, count: number, row = false) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("行列のサイズが正しくありません");
  const result: Record<number, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(value) || value < (row ? 16 : 24) || value > 1000)
      fail("行列のサイズが範囲外です");
    result[index] = value;
  }
  return Object.freeze(result);
}
export function canonicalCellAddress(sheet: SpreadsheetSheet, address: string): string {
  const position = parseCellAddress(address);
  if (!position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) return fail("セルの位置がシートの範囲外です");
  return cellAddress(position.row, position.column);
}
