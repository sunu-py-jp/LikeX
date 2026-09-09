import type { SpreadsheetSearchMatch, SpreadsheetSearchQuery } from "../../api/editing-commands";
import { parseCellAddress } from "../address";
import { calculateWorkbook } from "../formula";
import { effectiveCellFormat, formatCellValue } from "../formatting";
import { createConditionalFormatter } from "../conditional-formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetWorkbook } from "../types";
import { setCellValues } from "../workbook/cells";

type Calculated = Readonly<Record<string, Readonly<Record<string, SpreadsheetCalculatedValue>>>>;
function pattern(query: SpreadsheetSearchQuery): RegExp | null {
  if (!query || typeof query.text !== "string" || query.text.length > 100_000) throw new Error("検索する文字列を正しく指定してください");
  if (query.matchCase !== undefined && typeof query.matchCase !== "boolean" || query.wholeCell !== undefined && typeof query.wholeCell !== "boolean" ||
    query.lookIn !== undefined && !["values", "formulas"].includes(query.lookIn)) throw new Error("検索の設定が正しくありません");
  if (!query.text) return null;
  const escaped = query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(query.wholeCell ? `^${escaped}$` : escaped, query.matchCase ? "gu" : "giu");
}
/** Literal text search over populated cells; formula mode searches raw expressions. */
export function findSpreadsheetCells(workbook: SpreadsheetWorkbook, query: SpreadsheetSearchQuery,
  options: { sheetId?: string; calculated?: Calculated } = {}): readonly SpreadsheetSearchMatch[] {
  const matcher = pattern(query);
  if (!matcher) return [];
  const calculated = query.lookIn === "formulas" ? undefined : options.calculated ?? calculateWorkbook(workbook);
  return workbook.sheets.filter(sheet => !options.sheetId || sheet.id === options.sheetId).flatMap(sheet => {
    const display = query.lookIn === "formulas" ? undefined : createConditionalFormatter(sheet, calculated?.[sheet.id]);
    return Object.entries(sheet.cells).map(([address, cell]) => ({ address, cell, position: parseCellAddress(address)! }))
      .sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column).flatMap(({ address, cell, position }) => {
      const calculatedValue = calculated?.[sheet.id]?.[address];
      const format = display?.(position.row, position.column, calculatedValue, effectiveCellFormat(cell)).format;
      const matchedText = query.lookIn === "formulas" ? cell.value : formatCellValue(calculatedValue, format);
      matcher.lastIndex = 0;
      return matcher.test(matchedText) ? [{ sheetId: sheet.id, address, value: cell.value, matchedText }] : [];
    });
  });
}
export function replaceSpreadsheetText(value: string, query: SpreadsheetSearchQuery, replacement: string): string {
  if (typeof replacement !== "string" || replacement.length > 100_000) throw new Error("置換後の文字列を正しく指定してください");
  const matcher = pattern(query);
  return matcher ? value.replace(matcher, () => replacement) : value;
}
export function replaceSpreadsheetCells(workbook: SpreadsheetWorkbook, sheetId: string, query: SpreadsheetSearchQuery,
  replacement: string, addresses?: readonly string[]): SpreadsheetWorkbook {
  const selected = addresses ? new Set(addresses) : undefined;
  const values: Record<string, string> = {};
  const calculated = query.lookIn === "formulas" ? undefined : calculateWorkbook(workbook);
  for (const match of findSpreadsheetCells(workbook, query, { sheetId, calculated })) {
    if (!selected || selected.has(match.address)) {
      const value = replaceSpreadsheetText(match.matchedText, query, replacement);
      values[match.address] = query.lookIn !== "formulas" && value && (typeof calculated?.[sheetId]?.[match.address] === "string" || value.startsWith("=") || value.startsWith("'")) ? `'${value}` : value;
    }
  }
  return setCellValues(workbook, sheetId, values);
}
