import type { SpreadsheetPrintCommand } from "../api/print-commands";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { normalizeSpreadsheetPrintSettings } from "../model/print-settings";
import type { SpreadsheetPrintSettings, SpreadsheetWorkbook } from "../model/types";
import { replaceWorkbookSheet } from "../model/workbook/snapshot";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

export function stagePrintCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetPrintCommand,
  features: SpreadsheetFeatureSettings): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } {
  requireCommandFeature(features, "printArea");
  const sheet = requireCommandSheet(workbook, command.sheetId);
  const next: { -readonly [K in keyof SpreadsheetPrintSettings]: SpreadsheetPrintSettings[K] } = { ...sheet.printSettings };
  if (command.type === "print.setArea") {
    if (command.range === undefined) return rejectCommand("INVALID_COMMAND", "印刷範囲を指定してください");
    next.area = command.range;
  }
  else if (command.type === "print.clearArea") delete next.area;
  else if (command.type === "print.setBreaks") {
    if (command.rows !== undefined) next.rowBreaks = command.rows;
    if (command.columns !== undefined) next.columnBreaks = command.columns;
  } else {
    if (command.paperSize !== undefined) next.paperSize = command.paperSize;
    if (command.orientation !== undefined) next.orientation = command.orientation;
    if (command.scale !== undefined) next.scale = command.scale;
    if (command.margins !== undefined) next.margins = command.margins;
  }
  const printSettings = normalizeSpreadsheetPrintSettings(next, sheet), updated = { ...sheet, printSettings };
  if (!printSettings) delete updated.printSettings;
  return { workbook: replaceWorkbookSheet(workbook, updated), receipt: { type: command.type, sheetId: sheet.id,
    ...(printSettings?.area ? { range: printSettings.area } : {}) } };
}
