import { cellAddress } from "../address";
import { rangesIntersect } from "../merges";
import { normalizeNamedRangeRectangle, normalizeRangeName } from "../named-ranges";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import type { SpreadsheetTable, SpreadsheetTableColumn } from "./types";

export const MAX_SPREADSHEET_TABLES = SPREADSHEET_LIMITS.tables;
type TableSheet = Pick<SpreadsheetSheet, "cells" | "rowCount" | "columnCount" | "merges">;
const key = (name: string) => name.toLocaleLowerCase("en-US");
function validId(value: unknown): value is string {
  return typeof value === "string" && !!value && value.length <= 200 && !/\0/.test(value);
}

/** Header labels must be plain text. A leading apostrophe is the model's literal marker. */
export function tableHeaderLabel(value: string): string {
  if (typeof value !== "string" || value.startsWith("=")) throw new Error("テーブルのヘッダには数式ではなく文字列を指定してください");
  const label = value.startsWith("'") ? value.slice(1) : value;
  if (!label.trim() || label.length > 255 || /[\r\n\0]/.test(label))
    throw new Error("テーブルのヘッダは改行のない1〜255文字の文字列で指定してください");
  return label;
}

export function validateTableHeaderLabels(headers: readonly string[]): void {
  const names = new Set<string>();
  for (const name of headers) {
    if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\r\n\0]/.test(name))
      throw new Error("テーブルのヘッダは改行のない1〜255文字の文字列で指定してください");
    if (names.has(key(name))) throw new Error("テーブルのヘッダ名は重複できません");
    names.add(key(name));
  }
}

function headerNames(table: SpreadsheetTable, cells: Readonly<Record<string, SpreadsheetCell>>): string[] {
  return table.columns.map((_, index) => tableHeaderLabel(cells[cellAddress(table.range.top, table.range.left + index)]?.value ?? ""));
}

export function normalizeTables(input: readonly SpreadsheetTable[] | undefined, sheet: TableSheet): readonly SpreadsheetTable[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > MAX_SPREADSHEET_TABLES) throw new Error("テーブルの形式または件数が正しくありません");
  const result: SpreadsheetTable[] = [];
  for (const table of input) {
    if (!table || typeof table !== "object" || Array.isArray(table) || !validId(table.id)) throw new Error("テーブルのIDが正しくありません");
    const name = normalizeRangeName(table.name), range = normalizeNamedRangeRectangle(table.range, sheet);
    if (!Array.isArray(table.columns) || table.columns.length !== range.right - range.left + 1)
      throw new Error("テーブルの列定義と範囲の列数が一致していません");
    const ids = new Set<string>(), columns: SpreadsheetTableColumn[] = [];
    for (const column of table.columns) {
      if (!column || typeof column !== "object" || !validId(column.id) || ids.has(column.id)) throw new Error("テーブルの列IDが空、重複、または不正です");
      ids.add(column.id); columns.push(Object.freeze({ id: column.id, name: column.name }));
    }
    validateTableHeaderLabels(columns.map(column => column.name));
    const normalized = Object.freeze({ id: table.id, name, range, columns: Object.freeze(columns) });
    if (headerNames(normalized, sheet.cells).some((label, index) => label !== columns[index].name))
      throw new Error("テーブルの列名とヘッダセルの文字列が一致していません");
    if (result.some(other => rangesIntersect(other.range, range))) throw new Error("テーブルの範囲は重複できません");
    if (sheet.merges?.some(merge => rangesIntersect(merge, range))) throw new Error("テーブルには結合セルを含められません");
    result.push(normalized);
  }
  return result.length ? Object.freeze(result) : undefined;
}

/** Update column names after ordinary header edits; reject invalid tables before publishing a transaction. */
export function reconcileWorkbookTables(sheets: readonly SpreadsheetSheet[]): readonly SpreadsheetSheet[] {
  let changed = false;
  const result = sheets.map(sheet => {
    if (!sheet.tables?.length) return sheet;
    let sheetChanged = false;
    const tables = sheet.tables.map(table => {
      const names = headerNames(table, sheet.cells);
      validateTableHeaderLabels(names);
      if (names.every((name, index) => name === table.columns[index].name)) return table;
      sheetChanged = true;
      return Object.freeze({ ...table, columns: Object.freeze(table.columns.map((column, index) => Object.freeze({ ...column, name: names[index] }))) });
    });
    if (!sheetChanged) return sheet;
    changed = true;
    return Object.freeze({ ...sheet, tables: Object.freeze(tables) });
  });
  return changed ? Object.freeze(result) : sheets;
}

/** Validate identities, geometry, header agreement and the workbook-wide name namespace. */
export function assertWorkbookTables(workbook: SpreadsheetWorkbook): void {
  const ids = new Set<string>(), names = new Set((workbook.namedRanges ?? []).map(item => key(item.name)));
  let count = 0;
  for (const sheet of workbook.sheets) {
    for (const table of normalizeTables(sheet.tables, sheet) ?? []) {
      if (++count > MAX_SPREADSHEET_TABLES) throw new Error("テーブルの数はブック全体で1,000件までです");
      if (ids.has(table.id)) throw new Error("テーブルのIDはブック内で一意にしてください");
      if (names.has(key(table.name))) throw new Error("テーブル名と名前付き範囲名はブック内で重複できません");
      ids.add(table.id); names.add(key(table.name));
    }
  }
}

export function tablesEqual(left: readonly SpreadsheetTable[] = [], right: readonly SpreadsheetTable[] = []): boolean {
  return left === right || (left.length === right.length && left.every((table, index) => {
    const other = right[index];
    return table.id === other.id && table.name === other.name && table.range.top === other.range.top &&
      table.range.bottom === other.range.bottom && table.range.left === other.range.left && table.range.right === other.range.right &&
      table.columns.length === other.columns.length && table.columns.every((column, columnIndex) =>
        column.id === other.columns[columnIndex].id && column.name === other.columns[columnIndex].name);
  }));
}
