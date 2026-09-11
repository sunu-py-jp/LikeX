import type { SpreadsheetNamedRangeCommand } from "../api/named-range-commands";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { addNamedRangeWithId, removeNamedRange, requireNamedRange, updateNamedRange } from "../model/workbook/named-ranges";
import { clearCommandCells } from "./clear-cells";
import type { SpreadsheetWorkbook } from "../model/types";
import { requireCommandFeature } from "./validation";

/** Named definitions and optional clearing share one staged workbook transaction. */
export function stageNamedRangeCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetNamedRangeCommand,
  features: SpreadsheetFeatureSettings, nextId: () => string) {
  requireCommandFeature(features, "namedRanges");
  const namedRangeId = command.type === "namedRanges.add" ? nextId() : command.namedRangeId;
  let next: SpreadsheetWorkbook;
  switch (command.type) {
    case "namedRanges.add":
      next = addNamedRangeWithId(workbook, command.sheetId, command.name, command.range, namedRangeId);
      break;
    case "namedRanges.update":
      next = updateNamedRange(workbook, command.sheetId, namedRangeId, { name: command.name, range: command.range });
      break;
    case "namedRanges.clear": {
      const item = requireNamedRange(workbook, command.sheetId, namedRangeId);
      const mode = command.mode ?? "values";
      if (mode !== "values" && mode !== "all") throw new Error("クリア方式が正しくありません");
      next = clearCommandCells(workbook, command.sheetId, item.range, mode, features);
      break;
    }
    case "namedRanges.delete": {
      const item = requireNamedRange(workbook, command.sheetId, namedRangeId);
      const mode = command.clear ?? "none";
      if (mode !== "none" && mode !== "values" && mode !== "all") throw new Error("クリア方式が正しくありません");
      const cleared = mode === "none" ? workbook : clearCommandCells(workbook, command.sheetId, item.range, mode, features);
      next = removeNamedRange(cleared, command.sheetId, namedRangeId);
      break;
    }
  }
  return { workbook: next, receipt: { type: command.type, sheetId: command.sheetId, namedRangeId } };
}
