import type { SpreadsheetCellFormat } from "../types";

/** Measurements use sheet CSS pixels, before the grid's zoom is applied. */
export type CellMeasurementStyle = {
  fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string; lineHeight: number;
  letterSpacing: number; wordSpacing: number; paddingX: number; paddingY: number;
  borderLeft: number; borderRight: number; borderTop: number; borderBottom: number;
  checkboxWidth: number; checkboxHeight: number; listWidth: number;
};
export type TextMeasurer = ((text: string, format?: SpreadsheetCellFormat) => number) & { cellStyle?: CellMeasurementStyle };
export const DEFAULT_CELL_MEASUREMENT: CellMeasurementStyle = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
  fontSize: 13, fontWeight: "400", fontStyle: "normal", lineHeight: 1.4,
  letterSpacing: 0, wordSpacing: 0, paddingX: 14, paddingY: 0,
  borderLeft: 0, borderRight: 1, borderTop: 0, borderBottom: 1,
  checkboxWidth: 16, checkboxHeight: 16, listWidth: 24,
};
export const estimateTextWidth: TextMeasurer = (text, format) => Array.from(text).reduce((width, character) =>
  width + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.58) * (format?.fontSize ?? 13), 0) * (format?.bold ? 1.06 : 1);
