import type { SpreadsheetConditionalFormatRule } from "../model/conditional-formatting";
import type { SpreadsheetCellBorder } from "../model/formatting";
import type { SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetBorderPreset } from "../model/workbook/borders";
export type SpreadsheetFormattingCommand =
  | { type: "cells.borders"; sheetId: string; ranges: readonly SpreadsheetMergedRange[]; preset: SpreadsheetBorderPreset; border?: SpreadsheetCellBorder }
  | { type: "dimensions.autoFit"; sheetId: string; axis: "row" | "column"; indices: readonly number[] }
  | { type: "rows.resize"; sheetId: string; row: number; height: number }
  | { type: "dimensions.resize"; sheetId: string; rowHeights?: Readonly<Record<number, number>>; columnWidths?: Readonly<Record<number, number>> }
  | { type: "conditionalFormats.set"; sheetId: string; rules: readonly SpreadsheetConditionalFormatRule[] };
