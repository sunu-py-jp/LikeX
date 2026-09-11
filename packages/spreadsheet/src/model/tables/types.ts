import type { SpreadsheetMergedRange } from "../types";

export type SpreadsheetTableColumn = Readonly<{ id: string; name: string }>;
/** A rectangular table with one header row. Values and formatting remain in sheet.cells. */
export type SpreadsheetTable = Readonly<{
  id: string;
  name: string;
  range: SpreadsheetMergedRange;
  columns: readonly SpreadsheetTableColumn[];
}>;
