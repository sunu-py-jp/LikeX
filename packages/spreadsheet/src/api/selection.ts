import type { SpreadsheetCellPosition } from "../model/types";
import type { SpreadsheetSelection, SpreadsheetSelectionRange } from "../props";

export type SpreadsheetSelectionOptions = Readonly<{
  /** Scroll the chosen cell/drawing into view. Omitted/false preserves scroll and keyboard focus. */
  reveal?: boolean;
}>;
export type SpreadsheetSelectedDrawing = Readonly<{ sheetId: string; drawingId: string }>;

/** Mounted view state only. Invalid targets, unfinished input and unmounted views return false. */
export type SpreadsheetSelectionApi = Readonly<{
  getSelection(): SpreadsheetSelection;
  getSelectedDrawing(): SpreadsheetSelectedDrawing | null;
  selectSheet(sheetId: string, options?: SpreadsheetSelectionOptions): boolean;
  selectCell(sheetId: string, position: Readonly<SpreadsheetCellPosition>, options?: SpreadsheetSelectionOptions): boolean;
  selectRange(sheetId: string, range: SpreadsheetSelectionRange, options?: SpreadsheetSelectionOptions): boolean;
  selectRanges(sheetId: string, ranges: readonly SpreadsheetSelectionRange[], options?: SpreadsheetSelectionOptions): boolean;
  selectRows(sheetId: string, start: number, end?: number, options?: SpreadsheetSelectionOptions): boolean;
  selectColumns(sheetId: string, start: number, end?: number, options?: SpreadsheetSelectionOptions): boolean;
  selectDrawing(sheetId: string, drawingId: string, options?: SpreadsheetSelectionOptions): boolean;
  /** Remove drawing/multiple-range selection; retain the current active cell. Never clears cell data. */
  clearSelection(options?: SpreadsheetSelectionOptions): boolean;
  /** Scroll the current cell/drawing into view without changing selection or keyboard focus. */
  revealSelection(): boolean;
}>;
