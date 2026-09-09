import type { SpreadsheetDataValidation } from "../model/data-validation";

export type SpreadsheetDataValidationCommand = Readonly<{
  type: "cells.validation";
  sheetId: string;
  addresses: readonly string[];
  /** null removes the rule; cell values and formatting are preserved. */
  validation: SpreadsheetDataValidation | null;
}>;
