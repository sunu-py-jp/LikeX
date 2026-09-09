import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetCellPosition, SpreadsheetMergedRange } from "../model/types";

export type SpreadsheetSearchQuery = Readonly<{ text: string; matchCase?: boolean; wholeCell?: boolean; lookIn?: "values" | "formulas" }>;
export type SpreadsheetSearchMatch = Readonly<{ sheetId: string; address: string; value: string; matchedText: string }>;
export type SpreadsheetPasteMode = "all" | "values" | "formulas" | "formats";
export type SpreadsheetPastePayload = Readonly<{
  values: readonly (readonly string[])[];
  displayedValues?: readonly (readonly string[])[];
  /** Distinguishes literal strings such as 00123 or =text from calculated numbers/booleans. */
  valueTypes?: readonly (readonly ("string" | "number" | "boolean")[])[];
  formats?: readonly (readonly (SpreadsheetCellFormat | undefined)[])[];
  validations?: readonly (readonly (SpreadsheetCell["validation"] | undefined)[])[];
  source?: Readonly<SpreadsheetCellPosition & { sheetId: string }>;
}>;
export type SpreadsheetEditingCommand =
  | Readonly<{ type: "cells.replace"; sheetId: string; query: SpreadsheetSearchQuery; replacement: string; addresses?: readonly string[] }>
  | Readonly<{ type: "cells.fill"; sheetId: string; source: SpreadsheetMergedRange; target: SpreadsheetMergedRange; mode?: "auto" | "copy" | "series" }>
  | Readonly<{ type: "cells.paste"; sheetId: string; target: Readonly<SpreadsheetCellPosition>; payload: SpreadsheetPastePayload; mode?: SpreadsheetPasteMode }>
  | Readonly<{ type: "sheets.duplicate"; sheetId: string; name?: string }>;
