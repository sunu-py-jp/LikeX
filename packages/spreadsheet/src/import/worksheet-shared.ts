import { parseCellAddress } from "../model/address";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";
import { child, type XmlNode } from "./xml";

export function omitted(context: ImportContext, sheet: SpreadsheetSheet, message: string, count = 1): void {
  context.warn({ code: "omitted", sheetName: sheet.name, message, count });
}
export function adjusted(context: ImportContext, sheet: SpreadsheetSheet, message: string): void {
  context.warn({ code: "adjusted", sheetName: sheet.name, message });
}
export function readRange(value: string | undefined): SpreadsheetMergedRange | undefined {
  if (!value) return;
  const parts = value.split(":"), first = parseCellAddress(parts[0]), last = parseCellAddress(parts[1] ?? parts[0]);
  if (parts.length > 2 || !first || !last || first.row > last.row || first.column > last.column) return;
  return { top: first.row, left: first.column, bottom: last.row, right: last.column };
}
export function growSheet(sheet: SpreadsheetSheet, row: number, column: number): SpreadsheetSheet {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= SPREADSHEET_LIMITS.rows || column >= SPREADSHEET_LIMITS.columns)
    throw new Error("Excelのオブジェクトが対応するシート範囲を超えています");
  return { ...sheet, rowCount: Math.max(sheet.rowCount, row + 1), columnCount: Math.max(sheet.columnCount, column + 1) };
}
export function worksheetDefaultSizes(node: XmlNode) {
  const format = child(node, "sheetFormatPr");
  const row = Number(format?.attributes.defaultRowHeight ?? 15) / 0.75;
  const column = Math.round(Number(format?.attributes.defaultColWidth ?? 8.43) * 7 + 5);
  if (!Number.isFinite(row) || row < 0 || !Number.isFinite(column) || column < 0) throw new Error("Excelの標準の行高・列幅が不正です");
  const rowSize = Math.min(1000, Math.max(16, row)), columnSize = Math.min(1000, Math.max(24, column));
  return { row: rowSize, column: columnSize, adjusted: row !== rowSize || column !== columnSize };
}
