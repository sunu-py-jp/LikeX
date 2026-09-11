import type { SpreadsheetNamedRangeInput } from "../model/named-ranges";

export type SpreadsheetNamedRangeCommand =
  | Readonly<{ type: "namedRanges.add"; sheetId: string; name: string; range: SpreadsheetNamedRangeInput }>
  | Readonly<{ type: "namedRanges.update"; sheetId: string; namedRangeId: string; name?: string; range?: SpreadsheetNamedRangeInput }>
  | Readonly<{ type: "namedRanges.delete"; sheetId: string; namedRangeId: string; clear?: "none" | "values" | "all" }>
  | Readonly<{ type: "namedRanges.clear"; sheetId: string; namedRangeId: string; mode?: "values" | "all" }>;
