import { parseTsv, stringifyTsv, SPREADSHEET_LIMITS } from "../../model";
import { copySpreadsheetCells } from "../../model/editing/copy";
import { getCellPasteRange } from "../../model/editing/paste";
import type { SpreadsheetCalculatedValue, SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";
import type { SpreadsheetFeatures, SpreadsheetSelection } from "../../props";
import type { SpreadsheetCommand } from "../../commands/types";
import type { SpreadsheetPasteMode, SpreadsheetPastePayload } from "../../api/editing-commands";
import { isMultiRangeSelection, selectionBounds } from "../selection";

/** Selection and clipboard token handling stay in the UI adapter; data transfer is a public command. */
export type CellTransferContext = {
  workbook: SpreadsheetWorkbook;
  activeSheet: SpreadsheetSheet;
  selection: SpreadsheetSelection;
  calculated: Readonly<Record<string, Readonly<Record<string, SpreadsheetCalculatedValue>>>>;
  features: Required<Pick<SpreadsheetFeatures, "mergeCells" | "formulas" | "formatting" | "comments">> & { dataValidation?: boolean; checkboxes?: boolean };
};
export type CopiedCells = SpreadsheetPastePayload & {
  token: string; text: string;
  sheetId: string; top: number; left: number; cut: boolean; workbook: SpreadsheetWorkbook;
};

export const SINGLE_RANGE_CLIPBOARD_MESSAGE = "コピー・切り取り・貼り付けは、1つの連続した範囲を選択してください";
export function assertSingleClipboardRange(selection: SpreadsheetSelection): void {
  if (isMultiRangeSelection(selection)) throw new Error(SINGLE_RANGE_CLIPBOARD_MESSAGE);
}

export function captureCopiedCells(context: CellTransferContext, cut: boolean): Omit<CopiedCells, "token"> {
  assertSingleClipboardRange(context.selection);
  const range = selectionBounds(context.selection);
  const payload = copySpreadsheetCells(context.workbook, context.activeSheet.id, range,
    { features: context.features, kind: cut ? "cut" : "copy" });
  return { ...payload, text: stringifyTsv(payload.displayedValues!), sheetId: context.activeSheet.id,
    top: range.top, left: range.left, cut, workbook: context.workbook };
}

/** Build commands from a selected destination; no workbook changes are performed by this adapter. */
export function prepareCellPaste(context: CellTransferContext, text: string, internal: CopiedCells | null, mode: SpreadsheetPasteMode = "all") {
  assertSingleClipboardRange(context.selection);
  if (text.length > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("貼り付けるテキストが上限を超えています");
  if (mode !== "all" && internal?.cut) throw new Error("切り取りした範囲には通常の貼り付けを使用してください");
  const values = internal?.values ?? parseTsv(text), width = Math.max(0, ...values.map(row => row.length));
  if (!values.length || !width) return;
  const { top, left } = selectionBounds(context.selection), target = { row: top, column: left };
  if (internal?.cut && internal.workbook === context.workbook) {
    const source = { sheetId: internal.sheetId, top: internal.top, left: internal.left,
      bottom: internal.top + values.length - 1, right: internal.left + width - 1 };
    const command: SpreadsheetCommand = { type: "cells.move", sheetId: context.activeSheet.id, source, target };
    return { destination: { top, left, bottom: top + values.length - 1, right: left + width - 1 }, commands: [command] };
  }
  const payload: SpreadsheetPastePayload = internal ? { values, displayedValues: internal.displayedValues, valueTypes: internal.valueTypes,
    formats: internal.formats, validations: internal.validations, comments: internal.comments, merges: internal.merges, source: internal.source } : { values };
  const destination = getCellPasteRange(context.activeSheet, target, payload);
  if (!destination) return;
  const command: SpreadsheetCommand = { type: "cells.paste", sheetId: context.activeSheet.id, target, payload, mode };
  return { destination, commands: [command] };
}
