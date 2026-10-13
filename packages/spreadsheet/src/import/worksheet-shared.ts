import { parseCellAddress } from "../model/address";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";
import { child, type XmlNode } from "./xml";
import { xlsxBaseColumnWidthToPixels, xlsxColumnWidthToPixels } from "../xlsx-column-width";

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
  const sourceRow = Number(format?.attributes.defaultRowHeight ?? 15) / 0.75;
  const validRow = Number.isFinite(sourceRow) && sourceRow >= 0;
  const row = validRow ? sourceRow : 20;
  const storedWidth = format?.attributes.defaultColWidth, baseWidth = format?.attributes.baseColWidth;
  const width = Number(storedWidth ?? baseWidth ?? 0);
  const validWidth = Number.isFinite(width) && width >= 0 && (storedWidth !== undefined || Number.isInteger(width));
  // Excel/XlsxWriter omit both attributes for their ordinary 64px columns.
  const sourceColumn = validWidth ? storedWidth !== undefined ? xlsxColumnWidthToPixels(width) : baseWidth !== undefined ? xlsxBaseColumnWidthToPixels(width) : 64 : NaN;
  const validColumn = Number.isFinite(sourceColumn) && sourceColumn >= 0;
  const column = validColumn ? sourceColumn : 64;
  const rowSize = Math.min(1000, Math.max(1, row)), columnSize = Math.min(1000, Math.max(1, column));
  return { row: rowSize, column: columnSize, invalid: !validRow || !validColumn, adjusted: row !== rowSize || column !== columnSize };
}
