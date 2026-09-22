import type { SpreadsheetConditionalFormatRule } from "../model/conditional-formatting";
export type SpreadsheetFormattingCommand =
  | { type: "dimensions.autoFit"; sheetId: string; axis: "row" | "column"; indices: readonly number[] }
  | { type: "rows.resize"; sheetId: string; row: number; height: number }
  | { type: "dimensions.resize"; sheetId: string; rowHeights?: Readonly<Record<number, number>>; columnWidths?: Readonly<Record<number, number>> }
  | { type: "conditionalFormats.set"; sheetId: string; rules: readonly SpreadsheetConditionalFormatRule[] };
