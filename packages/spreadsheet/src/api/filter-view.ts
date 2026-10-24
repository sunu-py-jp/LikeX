import type { SpreadsheetAutoFilter } from "../model/types";

/** Temporary filtering, including in read-only views. Stored data and history are unchanged. */
export type SpreadsheetFilterViewApi = Readonly<{
  getFilterView(sheetId: string): SpreadsheetAutoFilter | undefined;
  /** null hides the filter controls and shows every row. Invalid/busy requests return false. */
  setFilterView(sheetId: string, filter: SpreadsheetAutoFilter | null): boolean;
  /** Return to the filter stored in the workbook. */
  resetFilterView(sheetId: string): boolean;
  /** Original zero-based row indices currently hidden by the effective filter. */
  getFilteredRows(sheetId: string): readonly number[];
}>;
