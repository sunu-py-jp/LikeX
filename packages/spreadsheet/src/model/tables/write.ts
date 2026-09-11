import type { SpreadsheetTableWriteOptions } from "../../api/table-commands";
import { cellAddress, parseCellAddress } from "../address";
import { rangesIntersect } from "../merges";
import { normalizeRangeName } from "../named-ranges";
import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { getWorkbookSheet, freezeCell, replaceWorkbookSheet } from "../workbook/snapshot";
import { normalizeCellFormat, validateCellValue } from "../workbook/validation";
import { clearCellRange } from "../workbook/clear";
import { filterCellValueWrites, WriteConflictError } from "../workbook/write-conflicts";
import { tableDataRows, tableHeaderCellValue } from "./data";
import { validateTableHeaderLabels } from "./normalize";
import type { SpreadsheetTable } from "./types";

export type SpreadsheetTableWritePlan = Readonly<{
  range: SpreadsheetMergedRange;
  headers: readonly string[];
  values: Readonly<Record<string, string>>;
  headerStyle?: SpreadsheetCellFormat;
}>;
const gridBorder = Object.freeze({ style: "solid" as const, width: 1 as const, color: "#d1d5db" });
const gridBorders = Object.freeze({ top: gridBorder, bottom: gridBorder, left: gridBorder, right: gridBorder });

/** Compute and validate the entire rectangle before applying values or table metadata. */
export function prepareSpreadsheetTableWrite(sheet: SpreadsheetSheet, options: SpreadsheetTableWriteOptions,
  structured: boolean): SpreadsheetTableWritePlan {
  if (!Array.isArray(options.headers) || options.headers.length < 1 || options.headers.length > SPREADSHEET_LIMITS.columns)
    throw new Error("表のヘッダは1列以上の文字列配列で指定してください");
  for (const header of options.headers) validateCellValue(header);
  const rows = tableDataRows(options.data, options.headers.length);
  const headers = [...options.headers];
  let numberStart: number | undefined;
  if (options.rowNumbers !== undefined && options.rowNumbers !== false) {
    if (!options.rowNumbers || typeof options.rowNumbers !== "object" || Array.isArray(options.rowNumbers))
      throw new Error("連番列の設定が正しくありません");
    numberStart = options.rowNumbers.start ?? 1;
    if (!Number.isSafeInteger(numberStart) || !Number.isSafeInteger(numberStart + Math.max(0, rows.length - 1)))
      throw new Error("連番は安全な整数の範囲で指定してください");
    const header = options.rowNumbers.header ?? "No.";
    validateCellValue(header); headers.unshift(header);
  }
  if (structured) validateTableHeaderLabels(headers);
  const { target } = options;
  if (!target || !Number.isInteger(target.row) || !Number.isInteger(target.column) || target.row < 0 || target.column < 0)
    throw new Error("表の開始位置は0始まりの行・列で指定してください");
  const range = Object.freeze({ top: target.row, left: target.column,
    bottom: target.row + rows.length, right: target.column + headers.length - 1 });
  if (range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) throw new Error("表がシートの範囲を超えています。行・列が足りません");
  if ((rows.length + 1) * headers.length > SPREADSHEET_LIMITS.clipboardCells)
    throw new Error("ヘッダと連番を含む表全体は10,000セル以内で指定してください");
  if (sheet.merges?.some(merge => rangesIntersect(range, merge))) throw new Error("表の書き込み先には結合セルを含められません");
  if (structured && sheet.tables?.some(table => rangesIntersect(range, table.range))) throw new Error("既存のテーブルと重なる位置には挿入できません");
  const values: Record<string, string> = Object.create(null);
  for (let column = 0; column < headers.length; column++) values[cellAddress(target.row, target.column + column)] = validateCellValue(tableHeaderCellValue(headers[column]));
  for (let row = 0; row < rows.length; row++) {
    if (numberStart !== undefined) values[cellAddress(target.row + row + 1, target.column)] = String(numberStart + row);
    for (let column = 0; column < rows[row].length; column++)
      values[cellAddress(target.row + row + 1, target.column + column + (numberStart !== undefined ? 1 : 0))] = rows[row][column];
  }
  if (Object.values(values).reduce((total, value) => total + value.length, 0) > SPREADSHEET_LIMITS.clipboardCharacters)
    throw new Error("ヘッダと連番を含む表全体は10 Mi文字以内で指定してください");
  const headerStyle = options.headerStyle === undefined ? undefined : normalizeCellFormat(options.headerStyle);
  return Object.freeze({ range, headers: Object.freeze(headers), values: Object.freeze(values), ...(headerStyle ? { headerStyle } : {}) });
}

export function writeSpreadsheetTable(workbook: SpreadsheetWorkbook, options: SpreadsheetTableWriteOptions,
  table?: Readonly<{ id: string; name: string }>) {
  const sheet = getWorkbookSheet(workbook, options.sheetId);
  const plan = prepareSpreadsheetTableWrite(sheet, options, !!table);
  if (table) normalizeRangeName(table.name);
  const filtered = filterCellValueWrites(sheet, plan.values, options.onConflict);
  if (table && filtered.skippedAddresses.length) {
    const skipped = new Set(filtered.skippedAddresses), headers = plan.headers.map((_, index) => cellAddress(plan.range.top, plan.range.left + index));
    const conflicts = headers.filter(address => skipped.has(address));
    if (conflicts.length) throw new WriteConflictError(conflicts);
  }
  const cells = { ...sheet.cells };
  let changedCount = 0;
  for (const [address, value] of Object.entries(filtered.values)) {
    const previous = cells[address];
    if ((previous?.value ?? "") !== value) changedCount++;
    const isHeader = parseCellAddress(address)!.row === plan.range.top;
    const format = normalizeCellFormat({ ...previous?.format, borders: { ...previous?.format?.borders, ...gridBorders },
      ...(isHeader ? plan.headerStyle : {}) });
    cells[address] = freezeCell(value, format, previous?.validation);
  }
  const metadata: SpreadsheetTable | undefined = table ? Object.freeze({ id: table.id, name: table.name, range: plan.range,
    columns: Object.freeze(plan.headers.map((name, index) => Object.freeze({ id: `column-${index + 1}`, name }))) }) : undefined;
  const next = replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells),
    ...(metadata ? { tables: Object.freeze([...(sheet.tables ?? []), metadata]) } : {}) });
  return Object.freeze({ workbook: next, range: plan.range, ...(metadata ? { tableId: metadata.id } : {}),
    write: Object.freeze({ changedCount, skippedCount: filtered.skippedAddresses.length, skippedAddresses: filtered.skippedAddresses }) });
}

/** Remove only the definition by default; clearing values/all is an explicit additional operation. */
export function deleteSpreadsheetTable(workbook: SpreadsheetWorkbook, sheetId: string, tableId: string,
  clear: "none" | "values" | "all" = "none"): SpreadsheetWorkbook {
  if (!["none", "values", "all"].includes(clear)) throw new Error("テーブル削除時のクリア方式が正しくありません");
  const sheet = getWorkbookSheet(workbook, sheetId), table = sheet.tables?.find(item => item.id === tableId);
  if (!table) throw new Error("削除するテーブルが見つかりません");
  const tables = sheet.tables!.filter(item => item.id !== tableId);
  const next = replaceWorkbookSheet(workbook, { ...sheet, tables: tables.length ? Object.freeze(tables) : undefined });
  return clear === "none" ? next : clearCellRange(next, sheetId, table.range, clear);
}
