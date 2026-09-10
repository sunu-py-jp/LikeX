import type { MaybePromise } from "../core";
import type { SpreadsheetDiscardOptions, SpreadsheetEditIntent, SpreadsheetEditState } from "./lifecycle";
import type { SpreadsheetExcelExportOptions } from "../export/types";
import type { SpreadsheetCommand, SpreadsheetCommandResult, SpreadsheetWorkbookSnapshot } from "../commands/types";

export type * from "../commands/types";

export type SpreadsheetHandle = Readonly<{
  execute(command: SpreadsheetCommand): SpreadsheetCommandResult;
  batch(commands: readonly SpreadsheetCommand[]): SpreadsheetCommandResult;
  executeAsync(command: SpreadsheetCommand): Promise<SpreadsheetCommandResult>;
  batchAsync(commands: readonly SpreadsheetCommand[]): Promise<SpreadsheetCommandResult>;
  getWorkbook(): SpreadsheetWorkbookSnapshot;
  getEditState(): SpreadsheetEditState;
  requestEdit(intent?: SpreadsheetEditIntent): MaybePromise<boolean>;
  cancelEditRequest(): void;
  endEdit(): boolean;
  save(): Promise<boolean>;
  /** Generates an XLSX Blob from the committed draft without saving or downloading it. Rejects unfinished edits. */
  exportExcel(options?: SpreadsheetExcelExportOptions): Promise<Blob>;
  refresh(options?: SpreadsheetDiscardOptions): Promise<boolean>;
  discard(options?: SpreadsheetDiscardOptions): boolean;
}>;
