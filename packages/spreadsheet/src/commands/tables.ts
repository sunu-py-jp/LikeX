import type { SpreadsheetTableCommand } from "../api/table-commands";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import type { SpreadsheetWorkbook } from "../model/types";
import { isFormulaValue } from "../model/cell-value";
import { parseCellAddress } from "../model/address";
import { getCellFormat } from "../model/format-ranges";
import { deleteSpreadsheetTable, prepareSpreadsheetTableWrite, writeSpreadsheetTable } from "../model/tables/write";
import { prepareSpreadsheetGridWrite, writeSpreadsheetGrid } from "../model/grid/write";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { clearCommandCells } from "./clear-cells";
import { insertGridCommandAxes } from "./insert-grid-axes";
import { commandKeys, commandRecord, rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

export function stageTableCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetTableCommand,
  features: SpreadsheetFeatureSettings, nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } {
  let sheet = requireCommandSheet(workbook, command.sheetId);
  if (command.type !== "cells.writeGrid") requireCommandFeature(features, "tables");
  if (command.type === "tables.delete") {
    if (typeof command.tableId !== "string" || !command.tableId) return rejectCommand("INVALID_COMMAND", "tableIdを指定してください");
    const table = sheet.tables?.find(item => item.id === command.tableId);
    if (!table) return rejectCommand("INVALID_TARGET", "削除するテーブルが見つかりません");
    if (command.clear !== undefined && !["none", "values", "all"].includes(command.clear))
      return rejectCommand("INVALID_COMMAND", "テーブル削除時のクリア方式が正しくありません");
    const next = deleteSpreadsheetTable(workbook, sheet.id, table.id);
    return { workbook: command.clear === "values" || command.clear === "all"
      ? clearCommandCells(next, sheet.id, table.range, command.clear, features) : next,
      receipt: { type: command.type, sheetId: sheet.id, tableId: table.id, range: table.range } };
  }
  requireCommandFeature(features, "formatting");
  commandKeys(commandRecord(command.target, "表の開始位置"), ["row", "column"], "表の開始位置");
  const data = commandRecord(command.data, "表の明細");
  commandKeys(data, data.type === "rows" ? ["type", "values"] : ["type", "text"], "表の明細");
  if (command.headerStyle !== undefined) commandKeys(commandRecord(command.headerStyle, "ヘッダの書式"), ["background", "color"], "ヘッダの書式");
  if (command.type === "cells.writeGrid" && command.border !== undefined && command.border !== false)
    commandKeys(commandRecord(command.border, "格子罫線"), ["style", "width", "color"], "格子罫線");
  if (command.rowNumbers !== undefined && command.rowNumbers !== false)
    commandKeys(commandRecord(command.rowNumbers, "連番列の設定"), ["header", "start"], "連番列の設定");
  if (command.type === "tables.insert" && typeof command.name !== "string") return rejectCommand("INVALID_COMMAND", "テーブル名を指定してください");
  workbook = insertGridCommandAxes(workbook, command, features);
  sheet = requireCommandSheet(workbook, command.sheetId);
  const plan = command.type === "cells.writeGrid" ? prepareSpreadsheetGridWrite(sheet, command)
    : prepareSpreadsheetTableWrite(sheet, command, true);
  if (command.type === "cells.writeGrid" && "layout" in plan && plan.layout.merges.length)
    requireCommandFeature(features, "mergeCells");
  if (Object.entries(plan.values).some(([address, value]) => {
    const position = parseCellAddress(address)!;
    return isFormulaValue(value, getCellFormat(sheet, position.row, position.column));
  })) requireCommandFeature(features, "formulas");
  if (command.type === "cells.writeGrid") {
    const result = writeSpreadsheetGrid(workbook, command, "layout" in plan ? plan : undefined);
    return { workbook: result.workbook, receipt: { type: command.type, sheetId: sheet.id,
      range: result.range, layout: result.layout, write: result.write } };
  }
  const result = writeSpreadsheetTable(workbook, command, { id: nextId(), name: command.name });
  return { workbook: result.workbook, receipt: { type: command.type, sheetId: sheet.id,
    ...(result.tableId ? { tableId: result.tableId } : {}), range: result.range, write: result.write } };
}
