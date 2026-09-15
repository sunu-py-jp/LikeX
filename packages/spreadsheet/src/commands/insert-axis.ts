import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { cellAddress } from "../model/address";
import { isFormulaValue } from "../model/cell-value";
import { SPREADSHEET_LIMITS, type SpreadsheetWorkbook } from "../model/types";
import { insertAxisWithValues, insertColumns, insertRows } from "../model/workbook/structure";
import type { SpreadsheetCommand } from "./types";
import { rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

type InsertCommand = Extract<SpreadsheetCommand, { type: "rows.insert" | "columns.insert" }>;

/** Shared with receipts so omitted count follows exactly the same insertion contract. */
export function getAxisInsertCount(command: InsertCommand): number {
  if (command.values === undefined) return command.count ?? 1;
  if (!Array.isArray(command.values) || command.values.length === 0)
    return rejectCommand("INVALID_COMMAND", "挿入する値は1件以上の二次元配列で指定してください");
  if (command.count !== undefined && command.count !== command.values.length)
    return rejectCommand("INVALID_COMMAND", "挿入数と値の配列の件数を一致させてください");
  return command.values.length;
}

function insertCellValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value === null) return "";
  return rejectCommand("INVALID_COMMAND", "挿入するセルの値は文字列・有限の数値・真偽値・nullで指定してください");
}

/** One structural edit and its initial values reach the ordinary final validation boundary together. */
export function insertCommandAxis(workbook: SpreadsheetWorkbook, command: InsertCommand,
  features: SpreadsheetFeatureSettings): SpreadsheetWorkbook {
  const rows = command.type === "rows.insert";
  requireCommandFeature(features, rows ? "insertRows" : "insertColumns");
  const sheet = requireCommandSheet(workbook, command.sheetId), count = getAxisInsertCount(command);
  if (command.values === undefined)
    return (rows ? insertRows : insertColumns)(workbook, sheet.id, command.index, count);
  // Bound traversal before building addresses; the shared structural model checks the full geometry.
  if (count > (rows ? SPREADSHEET_LIMITS.rows : SPREADSHEET_LIMITS.columns))
    return rejectCommand("VALIDATION_FAILED", "行数または列数が上限を超えています");
  const values: Record<string, string> = Object.create(null);
  let populated = 0;
  for (let outer = 0; outer < count; outer++) {
    const lane = command.values[outer];
    if (!Object.hasOwn(command.values, outer) || !Array.isArray(lane))
      return rejectCommand("INVALID_COMMAND", "挿入する値は欠けた要素のない二次元配列で指定してください");
    if (lane.length > (rows ? sheet.columnCount : sheet.rowCount))
      return rejectCommand("INVALID_TARGET", "挿入する値がシートの範囲外です");
    for (let inner = 0; inner < lane.length; inner++) {
      if (!Object.hasOwn(lane, inner)) return rejectCommand("INVALID_COMMAND", "挿入する値の配列に欠けた要素があります");
      const value = insertCellValue(lane[inner]);
      if (isFormulaValue(value)) requireCommandFeature(features, "formulas");
      // Inserted cells start empty. Omitted trailing values and explicit empty values need no allocation.
      if (value === "") continue;
      if (++populated > SPREADSHEET_LIMITS.cells) return rejectCommand("VALIDATION_FAILED", "保存できるセル数の上限を超えています");
      values[cellAddress(rows ? command.index + outer : inner, rows ? inner : command.index + outer)] = value;
    }
  }
  return insertAxisWithValues(workbook, sheet.id, rows ? "row" : "column", command.index, count, values);
}
