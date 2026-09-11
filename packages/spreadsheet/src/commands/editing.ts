import { cellWriteReport } from "./cell-write-report";
import { filterCellValueWrites } from "../model/workbook/write-conflicts";
import { cellAddress, parseCellAddress } from "../model/address";
import type { SpreadsheetCommand } from "./types";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { fillSpreadsheetCells } from "../model/editing/fill";
import { pasteSpreadsheetCells } from "../model/editing/paste";
import { moveSpreadsheetCells } from "../model/editing/move";
import { findSpreadsheetCells, replaceSpreadsheetCells, replaceSpreadsheetText } from "../model/editing/search";
import { duplicateSheetWithIds } from "../model/workbook/sheets";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { commandKeys, commandRecord, rejectCommand, requireCommandAddress, requireCommandFeature, requireCommandSheet } from "./validation";

export function stageEditingCommand(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand, features: SpreadsheetFeatureSettings,
  nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } | null {
  if (command.type !== "cells.replace" && command.type !== "cells.fill" && command.type !== "cells.paste" && command.type !== "cells.move" && command.type !== "sheets.duplicate") return null;
  const sheet = requireCommandSheet(workbook, command.sheetId);
  const skippedAddresses = new Set<string>();
  const finish = (next: SpreadsheetWorkbook, sheetId = sheet.id) => ({ workbook: next, receipt: { type: command.type, sheetId,
    ...(command.type === "sheets.duplicate" ? {} : { write: cellWriteReport(workbook, next, [...skippedAddresses]) }) } });
  switch (command.type) {
    case "cells.replace": {
      requireCommandFeature(features, "replace");
      commandKeys(commandRecord(command.query, "検索条件"), ["text", "matchCase", "wholeCell", "lookIn"], "検索条件");
      if (command.addresses !== undefined) {
        if (!Array.isArray(command.addresses)) return rejectCommand("INVALID_COMMAND", "置換対象はセル番地の配列で指定してください");
        command.addresses.forEach(address => requireCommandAddress(sheet, address));
      }
      const addresses = command.addresses?.map(address => { const position = parseCellAddress(address)!; return cellAddress(position.row, position.column); });
      if (typeof command.replacement !== "string") return rejectCommand("INVALID_COMMAND", "置換後の文字列を指定してください");
      if (!features.formulas && command.query.lookIn === "formulas") for (const match of findSpreadsheetCells(workbook, command.query, { sheetId: sheet.id })) {
        if ((!addresses || addresses.includes(match.address)) && replaceSpreadsheetText(match.matchedText, command.query, command.replacement).startsWith("=")) requireCommandFeature(features, "formulas");
      }
      return finish(replaceSpreadsheetCells(workbook, sheet.id, command.query, command.replacement, addresses, { onConflict: command.onConflict, skippedAddresses }));
    }
    case "cells.fill":
      requireCommandFeature(features, "autoFill");
      return finish(fillSpreadsheetCells(workbook, sheet.id, command.source, command.target, command.mode,
        { formulas: features.formulas, formatting: features.formatting, dataValidation: features.dataValidation, checkboxes: features.checkboxes, onConflict: command.onConflict, skippedAddresses }));
    case "cells.paste":
      requireCommandFeature(features, "paste");
      if (command.mode && command.mode !== "all") requireCommandFeature(features, "pasteSpecial");
      commandKeys(commandRecord(command.target, "貼り付け先"), ["row", "column"], "貼り付け先");
      commandKeys(commandRecord(command.payload, "コピー内容"), ["values", "displayedValues", "valueTypes", "formats", "validations", "comments", "merges", "source"], "コピー内容");
      if (command.payload.source !== undefined) commandKeys(commandRecord(command.payload.source, "コピー元"), ["sheetId", "row", "column"], "コピー元");
      return finish(pasteSpreadsheetCells(workbook, sheet.id, command.target, command.payload, command.mode,
        { formulas: features.formulas, formatting: features.formatting, dataValidation: features.dataValidation, checkboxes: features.checkboxes,
          comments: features.comments, mergeCells: features.mergeCells, onConflict: command.onConflict, skippedAddresses }, nextId));
    case "cells.move": {
      requireCommandFeature(features, "cut");
      requireCommandFeature(features, "paste");
      commandKeys(commandRecord(command.source, "移動元"), ["sheetId", "top", "left", "bottom", "right"], "移動元");
      commandKeys(commandRecord(command.target, "移動先"), ["row", "column"], "移動先");
      requireCommandSheet(workbook, command.source.sheetId);
      const next = moveSpreadsheetCells(workbook, command.source, { ...command.target, sheetId: sheet.id }, features);
      const destination = next.sheets.find(item => item.id === sheet.id)!;
      const values: Record<string, string> = {};
      for (let r = 0; r <= command.source.bottom - command.source.top; r++) for (let c = 0; c <= command.source.right - command.source.left; c++) {
        const row = command.target.row + r, column = command.target.column + c;
        // Overlapping cut cells belong to the same transfer, not to an unrelated destination.
        if (command.source.sheetId === sheet.id && row >= command.source.top && row <= command.source.bottom &&
          column >= command.source.left && column <= command.source.right) continue;
        const address = cellAddress(row, column); values[address] = destination.cells[address]?.value ?? "";
      }
      const filtered = filterCellValueWrites(sheet, values, command.onConflict);
      filtered.skippedAddresses.forEach(address => skippedAddresses.add(address));
      // A cut is atomic: never erase a source cell whose destination was skipped.
      return finish(skippedAddresses.size ? workbook : next);
    }
    case "sheets.duplicate": {
      requireCommandFeature(features, "duplicateSheet");
      const copied = duplicateSheetWithIds(workbook, sheet.id, command.name, nextId);
      return finish(copied.workbook, copied.sheetId);
    }
  }
}
