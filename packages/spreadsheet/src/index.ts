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
export { exportSpreadsheetXlsx } from "./export/export-xlsx";
export type { SpreadsheetExcelExportOptions } from "./export/types";
export type {
  SpreadsheetBeforeSaveHandler, SpreadsheetRefreshHandler,
  SpreadsheetEditHandler, SpreadsheetEditIntent, SpreadsheetEditRequest, SpreadsheetEditResult,
  SpreadsheetEditState, SpreadsheetDiscardOptions, SpreadsheetEvent, SpreadsheetEventHandler,
  SpreadsheetChangeSource,
} from "./api/lifecycle";
export type { OperationContext as SpreadsheetOperationContext, EditMode as SpreadsheetEditMode } from "./core";
export type { ContextMenuExecutionMode } from "./core";
export type { SpreadsheetContextMenuContext, SpreadsheetContextMenuChange, SpreadsheetContextMenuItem, SpreadsheetContextMenuProvider } from "./api/context-menu";
export type { SpreadsheetFormattingCommand } from "./api/formatting-commands";
export type { SpreadsheetEditingCommand, SpreadsheetSearchQuery, SpreadsheetSearchMatch, SpreadsheetPasteMode, SpreadsheetPastePayload } from "./api/editing-commands";
export { findSpreadsheetCells } from "./model/editing/search";
export type { SpreadsheetDataValidationCommand } from "./api/data-validation-commands";
export type { SpreadsheetDataValidation } from "./model/data-validation";
export { setCellDataValidation } from "./model/workbook/data-validation";
export type { SpreadsheetConditionalFormatRule } from "./model/conditional-formatting";
export type { SpreadsheetCellBorder, SpreadsheetCellBorders } from "./model/formatting";
