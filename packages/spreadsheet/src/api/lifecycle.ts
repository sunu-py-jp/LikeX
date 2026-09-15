import type { ContextMenuExecutionEvent, EditEndReason, EditMode, EditRequestHandler, EventHandler, MaybePromise, OperationContext, RequestHandler } from "../core";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetCommand, SpreadsheetWorkbookSnapshot } from "./types";
import type { SpreadsheetExcelImportOptions, SpreadsheetExcelImportResult, SpreadsheetExcelImportWarning } from "../import/types";

export type SpreadsheetChangeSource = "ui" | "api" | "undo" | "redo";
export type SpreadsheetEditIntent = Readonly<{
  source?: "ui" | "api";
  action?: SpreadsheetCommand["type"] | "batch" | "paste" | "undo" | "redo" | "save" | "edit" | "importExcel";
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
/** Import replaces the draft only. Saving remains an explicit host-owned operation. */
export type SpreadsheetImportExcelOptions = SpreadsheetExcelImportOptions & SpreadsheetDiscardOptions & Readonly<{
  /** Runs once after parsing and before permission/application. False cancels the import. */
  onReview?: (result: SpreadsheetExcelImportResult) => MaybePromise<boolean>;
}>;
export type SpreadsheetEvent =
  | Readonly<{ type: "zoom-change"; zoom: number; previousZoom: number }>
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
  | Readonly<{ type: "export"; format: "xlsx"; status: "start"; requestId: string; workbook: SpreadsheetWorkbookSnapshot }>
  /** Success means file generation finished, not that the browser wrote a download to disk. */
  | Readonly<{ type: "export"; format: "xlsx"; status: "success"; requestId: string; size: number }>
  | Readonly<{ type: "export"; format: "xlsx"; status: "error"; requestId: string; message: string }>
  | Readonly<{ type: "export"; format: "xlsx"; status: "cancelled"; requestId: string }>
  | Readonly<{ type: "import"; format: "xlsx"; status: "start" | "cancelled"; requestId: string; fileName?: string }>
  | Readonly<{ type: "import"; format: "xlsx"; status: "success"; requestId: string; fileName?: string; workbook: SpreadsheetWorkbookSnapshot; warnings: readonly SpreadsheetExcelImportWarning[] }>
  | Readonly<{ type: "import"; format: "xlsx"; status: "error"; requestId: string; fileName?: string; message: string }>
  | Readonly<{ type: "edit-mode"; mode: EditMode; reason: "request" | "granted" | "denied" | "error" | EditEndReason; requestId: string; request: SpreadsheetEditRequest; message?: string }>
  | Readonly<{ type: "selection"; selection: SpreadsheetSelection }>
  | Readonly<{ type: "drawing-selection"; sheetId: string; drawingId: string | null }>
  | Readonly<{ type: "clipboard"; action: "copy" | "cut" | "paste"; sheetId: string; drawingId?: string; selection?: SpreadsheetSelection }>
  | Readonly<{ type: "unsaved-changes"; dirty: boolean; pending: boolean; hasUnsavedChanges: boolean }>;
export type SpreadsheetEventHandler = EventHandler<SpreadsheetEvent>;
