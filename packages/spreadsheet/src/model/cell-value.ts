import type { SpreadsheetCell, SpreadsheetCellFormat } from "./types";

/** Stored text format changes interpretation without rewriting the original value. */
export function isFormulaValue(value: string, format?: SpreadsheetCellFormat): boolean {
  return format?.numberFormat !== "text" && value.startsWith("=");
}
export function isFormulaCell(cell?: SpreadsheetCell): boolean {
  return !!cell && isFormulaValue(cell.value, cell.format);
}
/** The leading apostrophe keeps the same escaping meaning in every number format. */
export function cellTextValue(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}
