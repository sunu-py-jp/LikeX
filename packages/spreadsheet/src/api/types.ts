import type { MaybePromise } from "../core";
import type { SpreadsheetDiscardOptions, SpreadsheetEditIntent, SpreadsheetEditState, SpreadsheetImportExcelOptions, SpreadsheetImportNativeOptions } from "./lifecycle";
import type { SpreadsheetExcelImportResult, SpreadsheetNativeImportResult } from "../import/types";
import type { SpreadsheetExcelExportOptions, SpreadsheetNativeExportOptions } from "../export/types";
import type { SpreadsheetCommand, SpreadsheetCommandResult, SpreadsheetWorkbookSnapshot } from "../commands/types";
import type { SpreadsheetReadApi } from "../model/query-reader";
import type { SpreadsheetHistoryState } from "../history/workbook-history";
import type { SpreadsheetSelectionApi } from "./selection";
export type { SpreadsheetSelectionApi, SpreadsheetSelectionOptions, SpreadsheetSelectedDrawing } from "./selection";

export type * from "../commands/types";

export type SpreadsheetHandle = SpreadsheetReadApi & SpreadsheetSelectionApi & Readonly<{
  execute(command: SpreadsheetCommand): SpreadsheetCommandResult;
  batch(commands: readonly SpreadsheetCommand[]): SpreadsheetCommandResult;
  executeAsync(command: SpreadsheetCommand): Promise<SpreadsheetCommandResult>;
  batchAsync(commands: readonly SpreadsheetCommand[]): Promise<SpreadsheetCommandResult>;
  getWorkbook(): SpreadsheetWorkbookSnapshot;
  /** View magnification in percent, independent of workbook data and history. */
  getZoom(): number;
  /** Clamps to 25–200%. Returns false when disabled or the number is not finite. */
  setZoom(percent: number): boolean;
  /** Uses the same edit permission and history as GUI actions. Unfinished input is not discarded. */
  undo(): MaybePromise<boolean>;
  redo(): MaybePromise<boolean>;
  getHistoryState(): SpreadsheetHistoryState;
  getEditState(): SpreadsheetEditState;
  requestEdit(intent?: SpreadsheetEditIntent): MaybePromise<boolean>;
  cancelEditRequest(): void;
  endEdit(): boolean;
  save(): Promise<boolean>;
  /** Generates an XLSX Blob from the committed draft without saving or downloading it. Rejects unfinished edits. */
  exportExcel(options?: SpreadsheetExcelExportOptions): Promise<Blob>;
  /** Replaces the draft as one undoable edit; never saves. Dirty/pending input requires explicit consent. */
  importExcel(input: Blob | ArrayBuffer | Uint8Array, options?: SpreadsheetImportExcelOptions): Promise<SpreadsheetExcelImportResult>;
  /** Generates a self-contained .spon JSON Blob; does not save or download. */
  exportNative(options?: SpreadsheetNativeExportOptions): Promise<Blob>;
  /** Reads native SPON v1 JSON regardless of filename; warnings are empty for native imports. */
  importNative(input: Blob, options?: SpreadsheetImportNativeOptions): Promise<SpreadsheetNativeImportResult>;
  refresh(options?: SpreadsheetDiscardOptions): Promise<boolean>;
  discard(options?: SpreadsheetDiscardOptions): boolean;
}>;
