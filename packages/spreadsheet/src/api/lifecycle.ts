import type { ContextMenuExecutionEvent, EditEndReason, EditMode, EditRequestHandler, EventHandler, MaybePromise, OperationContext, RequestHandler } from "../core";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetCommand, SpreadsheetWorkbookSnapshot } from "./types";

export type SpreadsheetChangeSource = "ui" | "api" | "undo" | "redo";
export type SpreadsheetEditIntent = Readonly<{
  source?: "ui" | "api";
  action?: SpreadsheetCommand["type"] | "batch" | "paste" | "undo" | "redo" | "save" | "edit";
  sheetId?: string;
  commands?: readonly SpreadsheetCommand["type"][];
}>;
export type SpreadsheetEditRequest = Readonly<{
  source: "ui" | "api";
  action: NonNullable<SpreadsheetEditIntent["action"]>;
  sheetId?: string;
  commands?: readonly SpreadsheetCommand["type"][];
  workbook: SpreadsheetWorkbookSnapshot;
}>;
export type SpreadsheetEditHandler = EditRequestHandler<SpreadsheetEditRequest, SpreadsheetWorkbook, "workbook">;
export type SpreadsheetEditResult = Awaited<ReturnType<SpreadsheetEditHandler>>;
export type SpreadsheetEditState = Readonly<{
  mode: EditMode;
  requestId: string | null;
  error: string | null;
}>;
export type SpreadsheetSaveHandler = RequestHandler<SpreadsheetWorkbook, void | SpreadsheetWorkbook>;
export type SpreadsheetBeforeSaveHandler = RequestHandler<SpreadsheetWorkbook, void | boolean>;
export type SpreadsheetRefreshHandler = (context: OperationContext) => MaybePromise<SpreadsheetWorkbook>;
/** Explicit consent to replace both committed changes and unfinished input. */
export type SpreadsheetDiscardOptions = Readonly<{ discardChanges?: boolean }>;
export type SpreadsheetEvent =
  | ContextMenuExecutionEvent
  | Readonly<{ type: "change"; source: SpreadsheetChangeSource; workbook: SpreadsheetWorkbookSnapshot; commands?: readonly SpreadsheetCommand["type"][] }>
  | Readonly<{ type: "save"; status: "start" | "success"; requestId: string; workbook: SpreadsheetWorkbookSnapshot }>
  | Readonly<{ type: "save"; status: "error"; requestId: string; message: string }>
  | Readonly<{ type: "save"; status: "cancelled"; requestId: string; reason: "validation" | "aborted" }>
  | Readonly<{ type: "refresh"; status: "start"; requestId: string }>
  | Readonly<{ type: "refresh"; status: "success"; requestId: string; workbook: SpreadsheetWorkbookSnapshot }>
  | Readonly<{ type: "refresh"; status: "error"; requestId: string; message: string }>
  | Readonly<{ type: "refresh"; status: "cancelled"; requestId: string }>
  | Readonly<{ type: "discard"; workbook: SpreadsheetWorkbookSnapshot }>
  | Readonly<{ type: "edit-mode"; mode: EditMode; reason: "request" | "granted" | "denied" | "error" | EditEndReason; requestId: string; request: SpreadsheetEditRequest; message?: string }>
  | Readonly<{ type: "selection"; selection: SpreadsheetSelection }>
  | Readonly<{ type: "drawing-selection"; sheetId: string; drawingId: string | null }>
  | Readonly<{ type: "clipboard"; action: "copy" | "cut" | "paste"; sheetId: string; selection?: SpreadsheetSelection }>
  | Readonly<{ type: "unsaved-changes"; dirty: boolean; pending: boolean; hasUnsavedChanges: boolean }>;
export type SpreadsheetEventHandler = EventHandler<SpreadsheetEvent>;
