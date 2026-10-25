import type { SpreadsheetLookupCommand, SpreadsheetLookupWriteReport } from "../../api/lookup-commands";
import { cellAddress } from "../address";
import { createConditionalFormatter } from "../conditional-formatting";
import { getCellFormat } from "../format-ranges";
import { effectiveCellFormat, formatCellValue } from "../formatting";
import { withFormatRangeContext } from "../formatting/range-context";
import { calculateWorkbook } from "../formula";
import { getMergedRange, rangesIntersect } from "../merges";
import { normalizeRangeName } from "../named-ranges";
import { requireRange, requireSheet } from "../query-validation";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { validateCellValue } from "../workbook/validation";

type Axis = "rows" | "columns";
type Search = Readonly<{ axis: Axis; index: number; value: string }>;
type Update = Readonly<{ index: number; value: string }>;
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const onlyKeys = (value: object, keys: readonly string[]) => Reflect.ownKeys(value).every(key => typeof key === "string" && keys.includes(key));
function object(value: unknown, keys: readonly string[], message: string): asserts value is Record<string, unknown> {
  if (!plainObject(value) || !onlyKeys(value, keys)) throw new Error(message);
}
function index(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= count)
    throw new Error("検索・書き込み位置は範囲内の0始まりの行番号・列番号で指定してください");
  return value;
}
function text(value: unknown): string {
  return validateCellValue(value as string);
}
function resolveRange(workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet, input: unknown): SpreadsheetMergedRange {
  if (typeof input === "string") return requireRange(sheet, input);
  if (plainObject(input) && Object.hasOwn(input, "namedRange")) {
    object(input, ["namedRange"], "名前付き範囲の指定が正しくありません");
    const name = normalizeRangeName(input.namedRange as string).toLocaleLowerCase("en-US");
    const matches = (workbook.namedRanges ?? []).filter(item => item.name.toLocaleLowerCase("en-US") === name);
    if (matches.length !== 1 || matches[0].sheetId !== sheet.id)
      throw new Error("指定したシートの名前付き範囲が見つかりません");
    return requireRange(sheet, matches[0].range);
  }
  object(input, ["top", "left", "bottom", "right"], "検索範囲は同じシート内の長方形または名前付き範囲で指定してください");
  return requireRange(sheet, input as unknown as SpreadsheetMergedRange);
}
function searchLine(range: SpreadsheetMergedRange, search: Search): SpreadsheetMergedRange {
  return search.axis === "rows" ? { ...range, left: range.left + search.index, right: range.left + search.index }
    : { ...range, top: range.top + search.index, bottom: range.top + search.index };
}
/** Checking the entire search line first keeps first-match scans fast without hiding invalid merged references. */
function validateSearchLine(sheet: SpreadsheetSheet, range: SpreadsheetMergedRange): void {
  for (const merge of sheet.merges ?? []) {
    if (!rangesIntersect(merge, range)) continue;
    const top = Math.max(merge.top, range.top), bottom = Math.min(merge.bottom, range.bottom);
    const left = Math.max(merge.left, range.left), right = Math.min(merge.right, range.right);
    if (top !== bottom || left !== right || top !== merge.top || left !== merge.left)
      throw new Error("検索対象に結合セルの左上以外のセルが含まれています");
  }
}

/** Resolve literal row/column keys against the pre-write workbook, without allocating the surrounding rectangle. Internal API. */
export function resolveSpreadsheetLookupWrite(workbook: SpreadsheetWorkbook, command: SpreadsheetLookupCommand): Readonly<{
  values: Readonly<Record<string, string>>; lookup: SpreadsheetLookupWriteReport;
}> {
  object(command, ["type", "sheetId", "range", "lookup", "updates", "value", "lookIn", "matchCase", "onMultiple", "onNotFound", "onConflict"],
    "検索によるセル書き込みの指定が正しくありません");
  if (command.type !== "cells.setByLookup") throw new Error("検索によるセル書き込みのコマンドが正しくありません");
  if (command.lookIn !== undefined && !["values", "formulas"].includes(command.lookIn)
    || command.matchCase !== undefined && typeof command.matchCase !== "boolean"
    || command.onMultiple !== undefined && !["error", "first", "all"].includes(command.onMultiple)
    || command.onNotFound !== undefined && !["error", "skip"].includes(command.onNotFound)
    || command.onConflict !== undefined && !["error", "overwrite", "skip"].includes(command.onConflict))
    throw new Error("検索によるセル書き込みの設定が正しくありません");
  const sheet = withFormatRangeContext(requireSheet(workbook, command.sheetId));
  const range = resolveRange(workbook, sheet, command.range);
  const height = range.bottom - range.top + 1, width = range.right - range.left + 1;
  const input = command.lookup as unknown;
  object(input, ["axis", "row", "column", "value"], "検索の行・列の指定が正しくありません");
  const axis = input.axis === undefined ? "rows" : input.axis, searches: Search[] = [], updates: Update[] = [];
  let intersectionValue: string | undefined;
  if (axis === "both") {
    object(input, ["axis", "row", "column"], "行・列の交点の検索条件が正しくありません");
    object(input.row, ["column", "value"], "行の検索条件が正しくありません");
    object(input.column, ["row", "value"], "列の検索条件が正しくありません");
    searches.push({ axis: "rows", index: index(input.row.column, width), value: text(input.row.value) },
      { axis: "columns", index: index(input.column.row, height), value: text(input.column.value) });
    if (Object.hasOwn(command, "updates")) throw new Error("交点への書き込みにはupdatesではなくvalueを指定してください");
    intersectionValue = text((command as { value: unknown }).value);
  } else if (axis === "rows" || axis === "columns") {
    const key = axis === "rows" ? "column" : "row", count = axis === "rows" ? width : height;
    object(input, ["axis", key, "value"], "検索の行・列の指定が正しくありません");
    searches.push({ axis, index: index(input[key], count), value: text(input.value) });
    if (Object.hasOwn(command, "value")) throw new Error("行・列への書き込みにはvalueではなくupdatesを指定してください");
    const entries = (command as { updates: unknown }).updates;
    if (!Array.isArray(entries) || !entries.length || entries.length > SPREADSHEET_LIMITS.clipboardCells)
      throw new Error("書き込み先は1〜10,000件の一覧で指定してください");
    const seen = new Set<number>();
    for (const entry of entries) {
      object(entry, [key, "value"], "書き込み先の指定が正しくありません");
      const position = index(entry[key], count), value = text(entry.value);
      if (seen.has(position)) throw new Error("同じ書き込み先が重複して指定されています");
      seen.add(position); updates.push({ index: position, value });
    }
  } else throw new Error("検索方向はrows、columns、bothのいずれかで指定してください");
  for (const search of searches) validateSearchLine(sheet, searchLine(range, search));

  const calculated = command.lookIn === "formulas" ? undefined : calculateWorkbook(workbook);
  const display = command.lookIn === "formulas" ? undefined : createConditionalFormatter(sheet, calculated?.[sheet.id]);
  const fold = (value: string) => command.matchCase ? value : value.toLocaleLowerCase("en-US");
  const multiple = command.onMultiple ?? "error";
  const matchLimit = multiple === "first" ? 1 : multiple === "error" ? 2 : SPREADSHEET_LIMITS.clipboardCells + 1;
  const matches = searches.map(search => {
    const found: number[] = [], expected = fold(search.value);
    const start = search.axis === "rows" ? range.top : range.left, end = search.axis === "rows" ? range.bottom : range.right;
    for (let position = start; position <= end; position++) {
      const row = search.axis === "rows" ? position : range.top + search.index;
      const column = search.axis === "columns" ? position : range.left + search.index;
      const address = cellAddress(row, column), cell = sheet.cells[address];
      const value = calculated?.[sheet.id]?.[address];
      const format = display?.(row, column, value, effectiveCellFormat(cell, getCellFormat(sheet, row, column))).format;
      const actual = command.lookIn === "formulas" ? cell?.value ?? "" : formatCellValue(value, format);
      if (fold(actual) === expected) found.push(position);
      if (found.length === matchLimit) break;
    }
    return found;
  });
  const values: Record<string, string> = Object.create(null), addresses: string[] = [];
  const result = (matchedRows: readonly number[], matchedColumns: readonly number[]) => Object.freeze({
    values: Object.freeze(values), lookup: Object.freeze({ range: Object.freeze(range), matchedRows: Object.freeze([...matchedRows]),
      matchedColumns: Object.freeze([...matchedColumns]), addresses: Object.freeze(addresses) }),
  });
  if (matches.some(found => !found.length)) {
    if (command.onNotFound === "skip") return result([], []);
    throw new Error("検索条件に一致する行または列が見つかりません");
  }
  if (multiple === "error" && matches.some(found => found.length > 1))
    throw new Error("検索条件に一致する行または列が複数あります。onMultipleを指定してください");
  const rows = axis === "columns" ? [] : matches[0], columns = axis === "rows" ? [] : matches[axis === "both" ? 1 : 0];
  const count = axis === "both" ? rows.length * columns.length : matches[0].length * updates.length;
  if (count > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度に書き込める検索結果は10,000セルまでです");
  const add = (row: number, column: number, value: string) => {
    const merge = getMergedRange(sheet, { row, column });
    if (merge && (row !== merge.top || column !== merge.left))
      throw new Error("書き込み先に結合セルの左上以外のセルが含まれています");
    const address = cellAddress(row, column);
    if (Object.hasOwn(values, address)) throw new Error("同じ書き込み先が重複して指定されています");
    values[address] = value; addresses.push(address);
  };
  if (axis === "both") for (const row of rows) for (const column of columns) add(row, column, intersectionValue!);
  else if (axis === "rows") for (const row of rows) for (const update of updates) add(row, range.left + update.index, update.value);
  else for (const column of columns) for (const update of updates) add(range.top + update.index, column, update.value);
  return result(rows, columns);
}
