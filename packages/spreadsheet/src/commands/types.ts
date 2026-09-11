import type { SpreadsheetDrawingPastePayload } from "../model/editing/copy-drawing";
import type { SpreadsheetCellFormat, SpreadsheetImageDrawing, SpreadsheetImageResource, SpreadsheetMergedRange,
  SpreadsheetShapeDrawing, SpreadsheetTextDrawing, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFormattingCommand } from "../api/formatting-commands";
import type { SpreadsheetEditingCommand } from "../api/editing-commands";
import type { SpreadsheetDataValidationCommand } from "../api/data-validation-commands";
import type { SpreadsheetTableCommand } from "../api/table-commands";
import type { SpreadsheetNamedRangeCommand } from "../api/named-range-commands";
import type { SpreadsheetClearMode, SpreadsheetCellRangeInput } from "../model/workbook/clear";
import type { SpreadsheetWriteConflictPolicy } from "../model/workbook/write-conflicts";

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
  | SpreadsheetFormattingCommand | SpreadsheetEditingCommand | SpreadsheetDataValidationCommand | SpreadsheetTableCommand | SpreadsheetNamedRangeCommand
  | { type: "cells.set"; sheetId: string; values: Record<string, string>; onConflict?: SpreadsheetWriteConflictPolicy }
  | { type: "cells.clear"; sheetId: string; range: SpreadsheetCellRangeInput; mode?: SpreadsheetClearMode }
  | { type: "cells.delete"; sheetId: string; range: SpreadsheetCellRangeInput }
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
  | { type: "drawings.paste"; sheetId: string; payload: SpreadsheetDrawingPastePayload; anchor?: SpreadsheetCommandAnchor }
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

/** Zero-based positions immediately below/right of the command target, not an empty-cell search. */
export type SpreadsheetCommandPlacement = Readonly<{ nextRow: number; nextColumn: number }>;

type DrawingPlacementCommand = "drawings.paste" | "images.insert" | "images.update" | "shapes.insert" | "shapes.update" | "textBoxes.insert" | "textBoxes.update";
/** Actual raw-value changes across affected sheets; skipped addresses belong to the destination sheet. */
export type SpreadsheetWriteReport = Readonly<{ changedCount: number; skippedCount: number; skippedAddresses: readonly string[] }>;

type CommandReceiptPlacement<Type extends SpreadsheetCommand["type"]> =
  Type extends DrawingPlacementCommand | "cells.fill" | "cells.move" | "tables.insert" | "cells.writeTable" ? { placement: SpreadsheetCommandPlacement }
    : Type extends "cells.set" | "cells.paste" ? { placement?: SpreadsheetCommandPlacement }
      : Type extends "rows.insert" ? { placement: Readonly<{ nextRow: number; nextColumn?: never }> }
        : Type extends "columns.insert" ? { placement: Readonly<{ nextRow?: never; nextColumn: number }> }
          : { placement?: never };

/**
 * Coordinates describe the state immediately after this command. Later commands do not revise them.
 * Empty cells.set/cells.paste targets have no placement; non-positional commands omit it entirely.
 */
export type SpreadsheetCommandReceipt = {
  [Type in SpreadsheetCommand["type"]]: Readonly<{
    type: Type;
    sheetId: string;
    drawingId?: string;
    resourceId?: string;
    commentId?: string;
    namedRangeId?: string;
    tableId?: string;
    range?: SpreadsheetMergedRange;
    write?: SpreadsheetWriteReport;
  } & CommandReceiptPlacement<Type> & (Type extends DrawingPlacementCommand ? { drawingId: string } : object)
    & (Type extends "images.insert" | "images.update" ? { resourceId: string } : object)
    & (Type extends SpreadsheetNamedRangeCommand["type"] ? { namedRangeId: string } : object)
    & (Type extends "tables.insert" | "tables.delete" ? { tableId: string } : object)
    & (Type extends "tables.insert" | "tables.delete" | "cells.writeTable" ? { range: SpreadsheetMergedRange } : object)
    & (Type extends "cells.set" | "cells.paste" | "cells.fill" | "cells.move" | "cells.replace" | "cells.clear" | "cells.delete" | "tables.insert" | "cells.writeTable"
      ? { write: SpreadsheetWriteReport } : object)>;
}[SpreadsheetCommand["type"]];

export type SpreadsheetCommandErrorCode = "NOT_MOUNTED" | "READ_ONLY" | "SAVING" | "PENDING_EDIT" | "BUSY"
  | "FEATURE_DISABLED" | "INVALID_COMMAND" | "INVALID_TARGET" | "VALIDATION_FAILED"
  | "WRITE_CONFLICT"
  | "REFRESHING" | "EDIT_REQUIRED" | "EDIT_PENDING" | "EDIT_DENIED" | "EDIT_CANCELLED" | "STALE_TARGET";
export type SpreadsheetCommandFailure = Readonly<{
  ok: false;
  code: SpreadsheetCommandErrorCode;
  message: string;
  /** Zero-based index of the rejected command, when failure belongs to a particular command. */
  commandIndex?: number;
  /** Conflicting cell addresses in the failed command. */
  conflicts?: readonly string[];
}>;
export type SpreadsheetCommandSuccess = Readonly<{
  ok: true;
  changed: boolean;
  results: readonly SpreadsheetCommandReceipt[];
}>;
export type SpreadsheetCommandResult = SpreadsheetCommandSuccess | SpreadsheetCommandFailure;
