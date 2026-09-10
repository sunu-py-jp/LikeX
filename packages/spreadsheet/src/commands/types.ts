import type { SpreadsheetCellFormat, SpreadsheetImageDrawing, SpreadsheetImageResource, SpreadsheetMergedRange,
  SpreadsheetShapeDrawing, SpreadsheetTextDrawing, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFormattingCommand } from "../api/formatting-commands";
import type { SpreadsheetEditingCommand } from "../api/editing-commands";
import type { SpreadsheetDataValidationCommand } from "../api/data-validation-commands";

// A mapped type preserves tuple lengths as well as making ordinary arrays readonly.
type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

/** The immutable, committed local draft; unfinished editor text is not included. */
export type SpreadsheetWorkbookSnapshot = DeepReadonly<SpreadsheetWorkbook>;
/** Zero-based sheet position, with optional pixel offsets defaulting to zero. */
export type SpreadsheetCommandAnchor = Readonly<{ row: number; column: number; offsetX?: number; offsetY?: number }>;
export type SpreadsheetImageCommandPatch = DeepReadonly<Partial<Omit<SpreadsheetImageDrawing, "id" | "type" | "anchor">> & { anchor?: SpreadsheetCommandAnchor }>;
export type SpreadsheetShapeCommandPatch = DeepReadonly<Partial<Omit<SpreadsheetShapeDrawing, "id" | "type" | "anchor">> & { anchor?: SpreadsheetCommandAnchor }>;
export type SpreadsheetTextBoxCommandPatch = DeepReadonly<Partial<Omit<SpreadsheetTextDrawing, "id" | "type" | "anchor">> & { anchor?: SpreadsheetCommandAnchor }>;

/** Explicit targets make commands independent of the currently selected sheet or cells. */
export type SpreadsheetCommand = DeepReadonly<
  | SpreadsheetFormattingCommand | SpreadsheetEditingCommand | SpreadsheetDataValidationCommand
  | { type: "cells.set"; sheetId: string; values: Record<string, string> }
  | { type: "cells.format"; sheetId: string; addresses: readonly string[]; format: SpreadsheetCellFormat }
  | { type: "rows.insert" | "rows.delete" | "columns.insert" | "columns.delete"; sheetId: string; index: number; count?: number }
  | { type: "columns.resize"; sheetId: string; column: number; width: number }
  | { type: "cells.merge"; sheetId: string; range: SpreadsheetMergedRange; discardContent?: boolean }
  | { type: "cells.unmerge"; sheetId: string; range: SpreadsheetMergedRange }
  | { type: "images.insert"; sheetId: string; resource: SpreadsheetImageResource; anchor: SpreadsheetCommandAnchor; width?: number; height?: number; alt?: string }
  | { type: "shapes.insert"; sheetId: string; shape: SpreadsheetShapeDrawing["shape"]; anchor: SpreadsheetCommandAnchor;
      width?: number; height?: number; fill?: string; stroke?: string; strokeWidth?: number;
      text?: string; fontSize?: number; color?: string; bold?: boolean }
  | { type: "textBoxes.insert"; sheetId: string; anchor: SpreadsheetCommandAnchor; text?: string; width?: number; height?: number;
      fontSize?: number; color?: string; background?: string; bold?: boolean }
  | { type: "drawings.delete"; sheetId: string; drawingId: string }
  | { type: "images.update"; sheetId: string; drawingId: string; patch: SpreadsheetImageCommandPatch }
  | { type: "shapes.update"; sheetId: string; drawingId: string; patch: SpreadsheetShapeCommandPatch }
  | { type: "textBoxes.update"; sheetId: string; drawingId: string; patch: SpreadsheetTextBoxCommandPatch }
  | { type: "comments.set"; sheetId: string; address: string; comment: null | { text: string; author?: string } }
  | { type: "sheets.add"; name?: string }
  | { type: "sheets.rename"; sheetId: string; name: string }
  | { type: "sheets.delete"; sheetId: string }
  /** Move a sheet to its final zero-based position within the workbook. */
  | { type: "sheets.move"; sheetId: string; index: number }
>;

export type SpreadsheetCommandReceipt = Readonly<{
  type: SpreadsheetCommand["type"];
  sheetId: string;
  drawingId?: string;
  resourceId?: string;
  commentId?: string;
}>;
export type SpreadsheetCommandErrorCode = "NOT_MOUNTED" | "READ_ONLY" | "SAVING" | "PENDING_EDIT" | "BUSY"
  | "FEATURE_DISABLED" | "INVALID_COMMAND" | "INVALID_TARGET" | "VALIDATION_FAILED"
  | "REFRESHING" | "EDIT_REQUIRED" | "EDIT_PENDING" | "EDIT_DENIED" | "EDIT_CANCELLED" | "STALE_TARGET";
export type SpreadsheetCommandFailure = Readonly<{
  ok: false;
  code: SpreadsheetCommandErrorCode;
  message: string;
  /** Zero-based index of the rejected command, when failure belongs to a particular command. */
  commandIndex?: number;
}>;
export type SpreadsheetCommandSuccess = Readonly<{
  ok: true;
  changed: boolean;
  results: readonly SpreadsheetCommandReceipt[];
}>;
export type SpreadsheetCommandResult = SpreadsheetCommandSuccess | SpreadsheetCommandFailure;
