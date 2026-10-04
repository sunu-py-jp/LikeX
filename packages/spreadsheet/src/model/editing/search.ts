import { createTextSearchMatcher } from "../core-text-search";
import { filterCellValueWrites, type SpreadsheetWriteConflictPolicy } from "../workbook/write-conflicts";
import { expandCellAddresses } from "../cell-addresses";
import { getWorkbookSheet } from "../workbook/snapshot";
import type { SpreadsheetSearchMatch, SpreadsheetSearchQuery } from "../../api/editing-commands";
import { parseCellAddress } from "../address";
import { calculateWorkbook } from "../formula";
import { effectiveCellFormat, formatCellValue } from "../formatting";
import { createConditionalFormatter } from "../conditional-formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetWorkbook } from "../types";
import { setCellValues } from "../workbook/cells";
import type { SpreadsheetReadRangeInput } from "../query";
import { copyQuerySnapshot, type QuerySnapshot } from "../query-snapshot";
import { requireRange, requireSheet, requireWorkbook } from "../query-validation";

type Calculated = Readonly<Record<string, Readonly<Record<string, SpreadsheetCalculatedValue>>>>;
export type SpreadsheetSearchOptions = Readonly<{
  sheetId?: string;
  /** Inclusive same-sheet rectangle. Requires sheetId; searches populated cells without a 10,000-cell allocation limit. */
  range?: SpreadsheetReadRangeInput;
  calculated?: Calculated;
}>;
export type SpreadsheetSheetSearchQuery = Readonly<{ text: string; matchCase?: boolean; wholeName?: boolean; useRegex?: boolean }>;
export type SpreadsheetSheetSearchMatch = Readonly<{ sheetId: string; name: string; index: number; rowCount: number; columnCount: number }>;

/** Text or explicit regular-expression name search in workbook/tab order; index is zero-based and results are immutable snapshots. */
export function findSpreadsheetSheets(workbook: QuerySnapshot<SpreadsheetWorkbook>, query: SpreadsheetSheetSearchQuery): readonly SpreadsheetSheetSearchMatch[] {
  requireWorkbook(workbook);
  if (!query || typeof query.text !== "string" || query.text.length > 100_000 ||
    query.matchCase !== undefined && typeof query.matchCase !== "boolean" || query.wholeName !== undefined && typeof query.wholeName !== "boolean")
    throw new Error("シート名の検索条件が正しくありません");
  const matcher = createTextSearchMatcher({ text: query.text, matchCase: query.matchCase, wholeText: query.wholeName, useRegex: query.useRegex });
  const matches: SpreadsheetSheetSearchMatch[] = [];
  workbook.sheets.forEach((item, index) => {
    const sheet = requireSheet(workbook, item.id);
    if (typeof sheet.name !== "string") throw new Error("シート名が正しくありません");
    if (matcher.test(sheet.name))
      matches.push({ sheetId: sheet.id, name: sheet.name, index, rowCount: sheet.rowCount, columnCount: sheet.columnCount });
  });
  return copyQuerySnapshot(matches);
}

export function createSpreadsheetSearchMatcher(query: SpreadsheetSearchQuery) {
  if (!query || typeof query.text !== "string" || query.text.length > 100_000) throw new Error("検索する文字列を正しく指定してください");
  if (query.lookIn !== undefined && !["values", "formulas"].includes(query.lookIn)) throw new Error("検索の設定が正しくありません");
  return createTextSearchMatcher({ text: query.text, matchCase: query.matchCase, wholeText: query.wholeCell, useRegex: query.useRegex });
}
/** Text or explicit regular-expression search over populated cells; formula mode searches raw expressions. */
export function findSpreadsheetCells(workbook: QuerySnapshot<SpreadsheetWorkbook>, query: SpreadsheetSearchQuery,
  options: SpreadsheetSearchOptions = {}): readonly SpreadsheetSearchMatch[] {
  requireWorkbook(workbook);
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("検索の対象が正しくありません");
  if (options.range !== undefined && options.sheetId === undefined) throw new Error("範囲を検索する場合はシートIDも指定してください");
  const sheets = options.sheetId === undefined ? workbook.sheets.map(sheet => requireSheet(workbook, sheet.id)) : [requireSheet(workbook, options.sheetId)];
  const range = options.range === undefined ? undefined : requireRange(sheets[0], options.range);
  const matcher = createSpreadsheetSearchMatcher(query);
  if (!query.text) return Object.freeze([]);
  const calculated = query.lookIn === "formulas" ? undefined : options.calculated ?? calculateWorkbook(workbook);
  const matches = sheets.flatMap(sheet => {
    const display = query.lookIn === "formulas" ? undefined : createConditionalFormatter(sheet, calculated?.[sheet.id]);
    return Object.entries(sheet.cells).map(([address, cell]) => ({ address, cell, position: parseCellAddress(address)! }))
      .filter(({ position }) => !range || position.row >= range.top && position.row <= range.bottom && position.column >= range.left && position.column <= range.right)
      .sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column).flatMap(({ address, cell, position }) => {
      const calculatedValue = calculated?.[sheet.id]?.[address];
      const format = display?.(position.row, position.column, calculatedValue, effectiveCellFormat(cell)).format;
      const matchedText = query.lookIn === "formulas" ? cell.value : formatCellValue(calculatedValue, format);
      return matcher.test(matchedText) ? [{ sheetId: sheet.id, address, value: cell.value, matchedText }] : [];
    });
  });
  return copyQuerySnapshot(matches);
}
export function replaceSpreadsheetText(value: string, query: SpreadsheetSearchQuery, replacement: string): string {
  if (typeof replacement !== "string" || replacement.length > 100_000) throw new Error("置換後の文字列を正しく指定してください");
  const matcher = createSpreadsheetSearchMatcher(query);
  return matcher.replace(value, replacement);
}
/** Optional addresses accept same-sheet A1 cells/ranges; omitted addresses search the entire sheet. */
export function replaceSpreadsheetCells(workbook: SpreadsheetWorkbook, sheetId: string, query: SpreadsheetSearchQuery,
  replacement: string, addresses?: readonly string[], options?: { onConflict?: SpreadsheetWriteConflictPolicy; skippedAddresses?: Set<string> }): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  const selected = addresses ? new Set(expandCellAddresses(sheet, addresses)) : undefined;
  const values: Record<string, string> = {};
  const matcher = createSpreadsheetSearchMatcher(query);
  const calculated = query.lookIn === "formulas" ? undefined : calculateWorkbook(workbook);
  for (const match of findSpreadsheetCells(workbook, query, { sheetId, calculated })) {
    if (!selected || selected.has(match.address)) {
      const value = matcher.replace(match.matchedText, replacement);
      values[match.address] = query.lookIn !== "formulas" && value && (typeof calculated?.[sheetId]?.[match.address] === "string" || value.startsWith("=") || value.startsWith("'")) ? `'${value}` : value;
    }
  }
  const filtered = filterCellValueWrites(getWorkbookSheet(workbook, sheetId), values, options?.onConflict);
  for (const address of filtered.skippedAddresses) options?.skippedAddresses?.add(address);
  return setCellValues(workbook, sheetId, filtered.values);
}

/** External search selects existing cells; it cannot supply new values or stale display text. */
export function validateSpreadsheetSearchMatches(workbook: QuerySnapshot<SpreadsheetWorkbook>, query: SpreadsheetSearchQuery,
  input: unknown, options: SpreadsheetSearchOptions = {}): readonly SpreadsheetSearchMatch[] {
  if (!Array.isArray(input) || input.length > 100_000) throw new Error("外部検索結果は100,000件以内のセル一覧で返してください");
  const calculated = query.lookIn === "formulas" ? undefined : options.calculated ?? calculateWorkbook(workbook);
  const sheets = new Map(workbook.sheets.map(sheet => [sheet.id, sheet]));
  const displays = new Map(workbook.sheets.map(sheet => [sheet.id, query.lookIn === "formulas" ? undefined : createConditionalFormatter(sheet, calculated?.[sheet.id])]));
  const seen = new Map<string, Set<string>>(), result: SpreadsheetSearchMatch[] = [];
  for (const match of input) {
    if (!match || typeof match !== "object" || typeof match.sheetId !== "string" || typeof match.address !== "string" ||
      typeof match.value !== "string" || typeof match.matchedText !== "string") throw new Error("外部検索結果のセル情報が正しくありません");
    const sheet = sheets.get(match.sheetId), position = parseCellAddress(match.address), cell = sheet?.cells[match.address];
    if (!sheet || !position || !cell || options.sheetId !== undefined && options.sheetId !== sheet.id || cell.value !== match.value)
      throw new Error("外部検索結果が現在のブックまたは検索範囲と一致しません。再検索してください");
    const value = calculated?.[sheet.id]?.[match.address];
    const format = displays.get(sheet.id)?.(position.row, position.column, value, effectiveCellFormat(cell)).format;
    const displayed = query.lookIn === "formulas" ? cell.value : formatCellValue(value, format);
    if (match.matchedText !== displayed) throw new Error("外部検索結果の表示値が現在のセルと一致しません。再検索してください");
    const addresses = seen.get(sheet.id) ?? new Set<string>();
    if (!addresses.has(match.address)) result.push({ sheetId: sheet.id, address: match.address, value: cell.value, matchedText: displayed });
    addresses.add(match.address); seen.set(sheet.id, addresses);
  }
  return copyQuerySnapshot(result);
}
