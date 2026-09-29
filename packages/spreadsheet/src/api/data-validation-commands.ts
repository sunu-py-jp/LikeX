import type { SpreadsheetDataValidation } from "../model/data-validation";

export type SpreadsheetDataValidationCommand = Readonly<{
  type: "cells.validation";
  sheetId: string;
  /** Same-sheet A1 cells/ranges, expanded and deduplicated; at most 10,000 cells. */
  addresses: readonly string[];
  /** null removes the rule; cell values and formatting are preserved. */
  validation: SpreadsheetDataValidation | null;
}>;
