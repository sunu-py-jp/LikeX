import type { SpreadsheetCommand } from "./types";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { fillSpreadsheetCells } from "../model/editing/fill";
import { pasteSpreadsheetCells } from "../model/editing/paste";
import { findSpreadsheetCells, replaceSpreadsheetCells, replaceSpreadsheetText } from "../model/editing/search";
import { duplicateSheetWithIds } from "../model/workbook/sheets";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { commandKeys, commandRecord, rejectCommand, requireCommandAddress, requireCommandFeature, requireCommandSheet } from "./validation";

export function stageEditingCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand, features: SpreadsheetFeatureSettings,
  nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } | null {
  if (command.type !== "cells.replace" && command.type !== "cells.fill" && command.type !== "cells.paste" && command.type !== "sheets.duplicate") return null;
  const sheet = requireCommandSheet(workbook, command.sheetId);
  const finish = (next: SpreadsheetWorkbook, sheetId = sheet.id) => ({ workbook: next, receipt: { type: command.type, sheetId } });
  switch (command.type) {
    case "cells.replace": {
      requireCommandFeature(features, "replace");
      commandKeys(commandRecord(command.query, "検索条件"), ["text", "matchCase", "wholeCell", "lookIn"], "検索条件");
      if (command.addresses !== undefined) {
        if (!Array.isArray(command.addresses)) return rejectCommand("INVALID_COMMAND", "置換対象はセル番地の配列で指定してください");
        command.addresses.forEach(address => requireCommandAddress(sheet, address));
      }
      if (typeof command.replacement !== "string") return rejectCommand("INVALID_COMMAND", "置換後の文字列を指定してください");
      if (!features.formulas && command.query.lookIn === "formulas") for (const match of findSpreadsheetCells(workbook, command.query, { sheetId: sheet.id })) {
        if ((!command.addresses || command.addresses.includes(match.address)) && replaceSpreadsheetText(match.matchedText, command.query, command.replacement).startsWith("=")) requireCommandFeature(features, "formulas");
      }
      return finish(replaceSpreadsheetCells(workbook, sheet.id, command.query, command.replacement, command.addresses));
    }
    case "cells.fill":
      requireCommandFeature(features, "autoFill");
      return finish(fillSpreadsheetCells(workbook, sheet.id, command.source, command.target, command.mode,
        { formulas: features.formulas, formatting: features.formatting, dataValidation: features.dataValidation, checkboxes: features.checkboxes }));
    case "cells.paste":
      requireCommandFeature(features, "paste");
      if (command.mode && command.mode !== "all") requireCommandFeature(features, "pasteSpecial");
      commandKeys(commandRecord(command.target, "貼り付け先"), ["row", "column"], "貼り付け先");
      commandKeys(commandRecord(command.payload, "コピー内容"), ["values", "displayedValues", "valueTypes", "formats", "validations", "source"], "コピー内容");
      return finish(pasteSpreadsheetCells(workbook, sheet.id, command.target, command.payload, command.mode,
        { formulas: features.formulas, formatting: features.formatting, dataValidation: features.dataValidation, checkboxes: features.checkboxes }));
    case "sheets.duplicate": {
      requireCommandFeature(features, "duplicateSheet");
      const copied = duplicateSheetWithIds(workbook, sheet.id, command.name, nextId);
      return finish(copied.workbook, copied.sheetId);
    }
  }
}
