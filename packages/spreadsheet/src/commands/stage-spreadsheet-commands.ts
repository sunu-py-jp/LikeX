import type { SpreadsheetCommand, SpreadsheetCommandFailure, SpreadsheetCommandReceipt, SpreadsheetCommandSuccess } from "./types";
import { cellAddress, parseCellAddress } from "../model/address";
import { workbooksEqual } from "../model/equality";
import { mergedCellPosition } from "../model/merges";
import { deleteColumns, deleteRows, deleteSheet, formatCells, insertColumns, insertRows, mergeCells, moveSheet, renameSheet,
  resizeColumn, setCellComment, setCellValues, unmergeCells } from "../model/workbook";
import { addSheetWithId } from "../model/workbook/sheets";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { applyDrawingCommand } from "./drawings";
import { applyDataValidationCommand } from "./data-validation";
import { stageFormattingCommand } from "./formatting";
import { stageEditingCommand } from "./editing";
import { commandKeys, commandRecord, rejectCommand, requireCommandAddress, requireCommandFeature, requireCommandSheet,
  SpreadsheetCommandError, validateCommand } from "./validation";

export const MAX_SPREADSHEET_COMMANDS = 1_000;
export type StagedSpreadsheetCommands = (SpreadsheetCommandSuccess & { readonly workbook: SpreadsheetWorkbook }) | SpreadsheetCommandFailure;

function applyCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand, features: SpreadsheetFeatureSettings,
  nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandReceipt } {
  if (command.type === "sheets.add") {
    requireCommandFeature(features, "createSheet");
    const sheetId = nextId();
    return { workbook: addSheetWithId(workbook, command.name, sheetId), receipt: { type: command.type, sheetId } };
  }
  const sheet = requireCommandSheet(workbook, command.sheetId);
  const result = (next: SpreadsheetWorkbook, extra: Partial<SpreadsheetCommandReceipt> = {}) =>
    ({ workbook: next, receipt: { type: command.type, sheetId: sheet.id, ...extra } });
  switch (command.type) {
    case "cells.validation":
      return applyDataValidationCommand(workbook, command, features);
    case "rows.resize":
    case "dimensions.resize":
      requireCommandFeature(features, "resize");
      return result(stageFormattingCommand(workbook, command));
    case "conditionalFormats.set":
      requireCommandFeature(features, "conditionalFormatting");
      return result(stageFormattingCommand(workbook, command));
    case "cells.replace":
    case "cells.fill":
    case "cells.paste":
    case "sheets.duplicate":
      return stageEditingCommand(workbook, command, features, nextId) ?? rejectCommand("INVALID_COMMAND", "編集コマンドを実行できませんでした");
    case "cells.set": {
      const values = commandRecord(command.values, "セルの値");
      for (const [address, value] of Object.entries(values)) {
        requireCommandAddress(sheet, address);
        if (typeof value !== "string") return rejectCommand("INVALID_COMMAND", "セルの値は文字列で指定してください");
        if (value.startsWith("=")) requireCommandFeature(features, "formulas");
      }
      return result(setCellValues(workbook, sheet.id, command.values));
    }
    case "cells.format":
      requireCommandFeature(features, "formatting");
      if (!Array.isArray(command.addresses)) return rejectCommand("INVALID_COMMAND", "セルのアドレスは配列で指定してください");
      for (const address of command.addresses) requireCommandAddress(sheet, address);
      commandKeys(commandRecord(command.format, "セル書式"), ["bold", "italic", "underline", "align", "color", "background", "numberFormat",
        "fontFamily", "fontSize", "wrap", "verticalAlign", "borders", "decimalPlaces", "useGrouping", "negativeFormat"], "セル書式");
      return result(formatCells(workbook, sheet.id, command.addresses, command.format));
    case "rows.insert":
      requireCommandFeature(features, "insertRows");
      return result(insertRows(workbook, sheet.id, command.index, command.count));
    case "rows.delete":
      requireCommandFeature(features, "deleteRows");
      return result(deleteRows(workbook, sheet.id, command.index, command.count));
    case "columns.insert":
      requireCommandFeature(features, "insertColumns");
      return result(insertColumns(workbook, sheet.id, command.index, command.count));
    case "columns.delete":
      requireCommandFeature(features, "deleteColumns");
      return result(deleteColumns(workbook, sheet.id, command.index, command.count));
    case "columns.resize":
      requireCommandFeature(features, "resize");
      return result(resizeColumn(workbook, sheet.id, command.column, command.width));
    case "cells.merge":
      requireCommandFeature(features, "mergeCells");
      return result(mergeCells(workbook, sheet.id, command.range, { discardValues: command.discardContent }));
    case "cells.unmerge":
      requireCommandFeature(features, "mergeCells");
      return result(unmergeCells(workbook, sheet.id, command.range));
    case "comments.set": {
      requireCommandFeature(features, "comments");
      requireCommandAddress(sheet, command.address);
      const position = mergedCellPosition(sheet, parseCellAddress(command.address)!);
      const existing = sheet.comments?.[cellAddress(position.row, position.column)];
      if (command.comment === null) return result(setCellComment(workbook, sheet.id, command.address, null),
        existing ? { commentId: existing.id } : {});
      commandKeys(commandRecord(command.comment, "コメント"), ["text", "author"], "コメント");
      const commentId = existing?.id ?? nextId();
      return result(setCellComment(workbook, sheet.id, command.address, { ...command.comment, id: commentId }), { commentId });
    }
    case "sheets.rename":
      requireCommandFeature(features, "renameSheet");
      return result(renameSheet(workbook, sheet.id, command.name));
    case "sheets.delete":
      requireCommandFeature(features, "deleteSheet");
      return result(deleteSheet(workbook, sheet.id));
    case "sheets.move":
      requireCommandFeature(features, "reorderSheets");
      return result(moveSheet(workbook, sheet.id, command.index));
    default:
      return applyDrawingCommand(workbook, command, features, nextId);
  }
}

/** Stage an entire ordered batch without publishing state, history, notifications, or partial successes. */
export function stageSpreadsheetCommands(workbook: SpreadsheetWorkbook, commands: readonly SpreadsheetCommand[],
  features: SpreadsheetFeatureSettings, nextId: () => string): StagedSpreadsheetCommands {
  let commandIndex: number | undefined;
  try {
    if (!Array.isArray(commands)) return rejectCommand("INVALID_COMMAND", "コマンドは配列で指定してください");
    if (commands.length > MAX_SPREADSHEET_COMMANDS) return rejectCommand("VALIDATION_FAILED", "一度に実行できるコマンドは1,000件までです");
    let staged = workbook;
    const results: SpreadsheetCommandReceipt[] = [];
    for (let index = 0; index < commands.length; index++) {
      commandIndex = index;
      const command = validateCommand(commands[index]);
      const applied = applyCommand(staged, command, features, nextId);
      staged = applied.workbook;
      results.push(Object.freeze(applied.receipt));
    }
    const changed = !workbooksEqual(workbook, staged);
    return Object.freeze({ ok: true, changed, workbook: changed ? staged : workbook, results: Object.freeze(results) });
  } catch (cause) {
    return Object.freeze({ ok: false, code: cause instanceof SpreadsheetCommandError ? cause.code : "VALIDATION_FAILED",
      message: cause instanceof Error ? cause.message : "コマンドを実行できませんでした",
      ...(commandIndex !== undefined ? { commandIndex } : {}) });
  }
}
