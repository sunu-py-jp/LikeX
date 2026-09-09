"use client";

export { default, default as Spreadsheet } from "./spreadsheet";
export type {
  SpreadsheetProps,
  SpreadsheetFeatures,
  SpreadsheetColorMode,
  SpreadsheetSelection,
  SpreadsheetSelectionRange,
  SpreadsheetSaveHandler,
} from "./props";
export * from "./model";
export type {
  SpreadsheetHandle, SpreadsheetCommand, SpreadsheetCommandAnchor,
  SpreadsheetCommandResult, SpreadsheetCommandSuccess, SpreadsheetCommandFailure,
  SpreadsheetCommandErrorCode, SpreadsheetCommandReceipt, SpreadsheetWorkbookSnapshot,
  SpreadsheetImageCommandPatch, SpreadsheetShapeCommandPatch, SpreadsheetTextBoxCommandPatch,
} from "./api/types";
export { readImageResource as prepareSpreadsheetImage } from "./state/read-image";
export type { SpreadsheetImagePreparationOptions } from "./state/read-image";
