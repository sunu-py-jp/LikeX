import type { SpreadsheetTableCommand } from "../api/table-commands";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { getSpreadsheetGridWriteDimensions } from "../model/grid/write";
import { SPREADSHEET_LIMITS, type SpreadsheetWorkbook } from "../model/types";
import { insertColumns, insertRows } from "../model/workbook/structure";
import { rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

type GridWriteCommand = Exclude<SpreadsheetTableCommand, { type: "tables.delete" }>;

/** Insert the complete output footprint before planning against the shifted sheet's real metadata. */
export function insertGridCommandAxes(workbook: SpreadsheetWorkbook, command: GridWriteCommand,
  features: SpreadsheetFeatureSettings): SpreadsheetWorkbook {
  const mode = command.insert;
  if (mode === undefined || mode === "none") return workbook;
  if (mode !== "rows" && mode !== "columns" && mode !== "both")
    return rejectCommand("INVALID_COMMAND", "表の挿入方式はnone・rows・columns・bothで指定してください");
  const rows = mode === "rows" || mode === "both", columns = mode === "columns" || mode === "both";
  if (rows) requireCommandFeature(features, "insertRows");
  if (columns) requireCommandFeature(features, "insertColumns");
  const sheet = requireCommandSheet(workbook, command.sheetId), { target } = command;
  if (!Number.isSafeInteger(target.row) || !Number.isSafeInteger(target.column) || target.row < 0 || target.column < 0
    || target.row > sheet.rowCount || (!rows && target.row === sheet.rowCount)
    || target.column > sheet.columnCount || (!columns && target.column === sheet.columnCount))
    return rejectCommand("INVALID_TARGET", "表の開始位置がシートの範囲外です。末尾への配置には対象の行・列の挿入が必要です");
  const { height, width } = getSpreadsheetGridWriteDimensions(command);
  if ((rows ? sheet.rowCount + height > SPREADSHEET_LIMITS.rows : target.row + height > sheet.rowCount)
    || (columns ? sheet.columnCount + width > SPREADSHEET_LIMITS.columns : target.column + width > sheet.columnCount))
    return rejectCommand("INVALID_TARGET", "表の挿入後の行・列がシートの範囲または上限を超えています");
  // Each operation is immutable. The enclosing staging transaction publishes neither step if writing later fails.
  const next = rows ? insertRows(workbook, sheet.id, target.row, height) : workbook;
  return columns ? insertColumns(next, sheet.id, target.column, width) : next;
}
