import type { SpreadsheetConditionalFormatRule } from "../model/conditional-formatting";
export type SpreadsheetFormattingCommand =
  | { type: "rows.resize"; sheetId: string; row: number; height: number }
  | { type: "dimensions.resize"; sheetId: string; rowHeights?: Readonly<Record<number, number>>; columnWidths?: Readonly<Record<number, number>> }
  | { type: "conditionalFormats.set"; sheetId: string; rules: readonly SpreadsheetConditionalFormatRule[] };
