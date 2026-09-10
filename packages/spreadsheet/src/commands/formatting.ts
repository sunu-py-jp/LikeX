import type { SpreadsheetFormattingCommand } from "../api/formatting-commands";
import { conditionalFormatsEqual, normalizeConditionalFormats } from "../model/conditional-formatting";
import { normalizeSizes } from "../model/workbook/validation";
import type { SpreadsheetWorkbook } from "../model/types";
import { getWorkbookSheet, replaceWorkbookSheet } from "../model/workbook/snapshot";
export function stageFormattingCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetFormattingCommand): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, command.sheetId);
  if (command.type === "dimensions.resize") {
    const rows = normalizeSizes(command.rowHeights, sheet.rowCount, true), columns = normalizeSizes(command.columnWidths, sheet.columnCount);
    const changedRows = rows && Object.entries(rows).some(([key, value]) => (sheet.rowHeights?.[Number(key)] ?? 28) !== value);
    const changedColumns = columns && Object.entries(columns).some(([key, value]) => (sheet.columnWidths?.[Number(key)] ?? 100) !== value);
    if (!changedRows && !changedColumns) return workbook;
    return replaceWorkbookSheet(workbook, { ...sheet, ...(changedRows ? { rowHeights: Object.freeze({ ...sheet.rowHeights, ...rows }) } : {}), ...(changedColumns ? { columnWidths: Object.freeze({ ...sheet.columnWidths, ...columns }) } : {}) });
  }
  if (command.type === "rows.resize") {
    if (!Number.isInteger(command.row) || command.row < 0 || command.row >= sheet.rowCount || !Number.isFinite(command.height) || command.height < 16 || command.height > 1000) throw new Error("行の高さは16〜1000pxで指定してください");
    if ((sheet.rowHeights?.[command.row] ?? 28) === command.height) return workbook;
    return replaceWorkbookSheet(workbook, { ...sheet, rowHeights: Object.freeze({ ...sheet.rowHeights, [command.row]: command.height }) });
  }
  const conditionalFormats = normalizeConditionalFormats(command.rules, sheet);
  if (conditionalFormatsEqual(sheet.conditionalFormats, conditionalFormats)) return workbook;
  return replaceWorkbookSheet(workbook, { ...sheet, conditionalFormats });
}
