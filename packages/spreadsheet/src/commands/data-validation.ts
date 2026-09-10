import type { SpreadsheetDataValidationCommand } from "../api/data-validation-commands";
import type { SpreadsheetCommandReceipt } from "./types";
import { setCellDataValidation } from "../model/workbook/data-validation";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { rejectCommand, requireCommandAddress, requireCommandFeature, requireCommandSheet } from "./validation";

export function applyDataValidationCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetDataValidationCommand,
  features: SpreadsheetFeatureSettings): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandReceipt } {
  requireCommandFeature(features, "dataValidation");
  if (command.validation?.type === "checkbox") requireCommandFeature(features, "checkboxes");
  const sheet = requireCommandSheet(workbook, command.sheetId);
  if (!Array.isArray(command.addresses)) return rejectCommand("INVALID_COMMAND", "セルのアドレスは配列で指定してください");
  for (const address of command.addresses) requireCommandAddress(sheet, address);
  return { workbook: setCellDataValidation(workbook, sheet.id, command.addresses, command.validation),
    receipt: { type: command.type, sheetId: sheet.id } };
}
