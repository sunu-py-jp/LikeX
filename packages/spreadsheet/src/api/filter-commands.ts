import type { SpreadsheetMergedRange } from "../model/types";

export type SpreadsheetFilterCommand =
  | Readonly<{ type: "filters.setRange"; sheetId: string; range: SpreadsheetMergedRange;
      /** Defaults to true for a single header row. Extends to the last populated row in the selected columns. */
      inferRows?: boolean }>
  | Readonly<{ type: "filters.setValues"; sheetId: string; column: number;
      /** Displayed cell strings. null clears this column; [] excludes every detail row; "" selects blanks. */
      values: readonly string[] | null }>
  | Readonly<{ type: "filters.clear" | "filters.remove"; sheetId: string }>;
