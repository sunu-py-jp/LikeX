import type { SpreadsheetMergedRange, SpreadsheetPrintSettings } from "../model/types";

export type SpreadsheetPrintCommand =
  | Readonly<{ type: "print.setArea"; sheetId: string; range: SpreadsheetMergedRange }>
  | Readonly<{ type: "print.clearArea"; sheetId: string }>
  | Readonly<{ type: "print.setLayout"; sheetId: string; paperSize?: SpreadsheetPrintSettings["paperSize"];
      orientation?: SpreadsheetPrintSettings["orientation"]; scale?: number; margins?: SpreadsheetPrintSettings["margins"] }>
  | Readonly<{ type: "print.setBreaks"; sheetId: string;
      /** Zero-based starts of the next pages; [] clears that axis, omitted preserves it. */
      rows?: readonly number[]; columns?: readonly number[] }>;
