import { createKeywordSearchMatcher, type KeywordSearchQuery, type KeywordTextMatch } from "./core-text-search";
import { collectSpreadsheetSearchCells, type SpreadsheetSearchOptions } from "./editing/search";
import { normalizeWorkbook } from "./workbook/normalize";
import { requireRange, requireSheet, requireWorkbook } from "./query-validation";
import { copyQuerySnapshot, type QuerySnapshot } from "./query-snapshot";
import type { SpreadsheetWorkbook } from "./types";

export type SpreadsheetKeywordSearchQuery = KeywordSearchQuery;
export type SpreadsheetKeywordSearchOptions = SpreadsheetSearchOptions & Readonly<{
  /** Default sheet: every keyword may occur in a different cell of the same sheet. */
  matchBy?: "sheet" | "cell";
  lookIn?: "values" | "formulas";
  /** Maximum returned cells, default 1000, maximum 10000. */
  limit?: number;
}>;
export type SpreadsheetKeywordSearchMatch = Readonly<{
  sheetId: string; sheetName: string; address: string;
  /** Stored input and searched text (formatted value, or raw formula/input). */
  value: string; text: string; matches: readonly KeywordTextMatch[];
}>;
export type SpreadsheetKeywordSearchResult = Readonly<{ matches: readonly SpreadsheetKeywordSearchMatch[]; truncated: boolean }>;

/** Headless, read-only AND/OR search. Does not search comments, drawings or sheet names. */
export function searchSpreadsheet(input: QuerySnapshot<SpreadsheetWorkbook>, query: SpreadsheetKeywordSearchQuery,
  options: SpreadsheetKeywordSearchOptions = {}): SpreadsheetKeywordSearchResult {
  const matcher = createKeywordSearchMatcher(query);
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    Object.keys(options).some(key => !["sheetId", "range", "calculated", "matchBy", "lookIn", "limit"].includes(key)))
    throw new Error("スプレッドシートの検索対象が正しくありません");
  const { matchBy = "sheet", lookIn = "values", limit = 1000 } = options;
  if (!["sheet", "cell"].includes(matchBy) || !["values", "formulas"].includes(lookIn) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("検索単位・対象、または結果件数の上限（1〜10,000）が正しくありません");
  requireWorkbook(input);
  const workbook = normalizeWorkbook(input);
  const sheets = options.sheetId === undefined ? workbook.sheets : [requireSheet(workbook, options.sheetId)];
  if (options.range !== undefined) {
    if (options.sheetId === undefined) throw new Error("範囲を検索する場合はシートIDも指定してください");
    requireRange(sheets[0], options.range);
  }
  if (matcher.empty) return Object.freeze({ matches: Object.freeze([]), truncated: false });
  const candidates = collectSpreadsheetSearchCells(workbook, lookIn, options);
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.sheetId);
    if (group) group.push(candidate); else groups.set(candidate.sheetId, [candidate]);
  }
  const names = new Map(sheets.map(sheet => [sheet.id, sheet.name]));
  const matches: SpreadsheetKeywordSearchMatch[] = [];
  let positionCount = 0;
  for (const [sheetId, cells] of groups) {
    if (matchBy === "sheet" && !matcher.test(cells.map(cell => cell.matchedText))) continue;
    for (const cell of cells) {
      if (matchBy === "cell" && !matcher.test(cell.matchedText)) continue;
      const positions = matcher.find(cell.matchedText);
      if (!positions.length) continue;
      if (matches.length === limit) return copyQuerySnapshot({ matches, truncated: true });
      positionCount += positions.length;
      if (positionCount > 100000) throw new Error("検索結果全体の一致位置は100,000件までです");
      matches.push({ sheetId, sheetName: names.get(sheetId)!, address: cell.address, value: cell.value, text: cell.matchedText, matches: positions });
    }
  }
  return copyQuerySnapshot({ matches, truncated: false });
}
