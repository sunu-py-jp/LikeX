// OOXML widths use the Normal font's maximum digit width. Calibri 11pt at
// 96dpi is 7px; keep that deterministic fallback when no font metrics exist.
// https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column
import type { SpreadsheetExcelColumnWidthMetrics } from "./import/types";

export const DEFAULT_XLSX_COLUMN_WIDTH_METRICS: SpreadsheetExcelColumnWidthMetrics = Object.freeze({ maximumDigitWidth: 7, pixelRatio: 1 });

/** Stored col/defaultColWidth values already include the 5px margin/grid allowance. */
export function xlsxColumnWidthToPixels(width: number, metrics = DEFAULT_XLSX_COLUMN_WIDTH_METRICS): number {
  const { maximumDigitWidth, pixelRatio } = metrics;
  // Excel quantizes the grid in the measurement environment. Preserve fractional CSS
  // pixels after that step, rather than truncating again before display scaling.
  return Math.floor(((256 * width + Math.floor(128 / maximumDigitWidth)) / 256) * maximumDigitWidth) / pixelRatio;
}

/** Inverse OOXML encoding; pixel dimensions are quantized to 1/256 digit widths. */
export function pixelsToXlsxColumnWidth(pixels: number): number {
  const { maximumDigitWidth } = DEFAULT_XLSX_COLUMN_WIDTH_METRICS;
  return Math.floor(pixels / maximumDigitWidth * 256) / 256;
}

/** baseColWidth counts characters only, unlike col/defaultColWidth. */
export function xlsxBaseColumnWidthToPixels(characters: number, metrics = DEFAULT_XLSX_COLUMN_WIDTH_METRICS): number {
  return (characters * metrics.maximumDigitWidth + Math.round(5 * metrics.pixelRatio)) / metrics.pixelRatio;
}

/** Ordinary omitted defaults describe an 8.43-character column plus its padding. */
export function xlsxDefaultColumnWidthToPixels(metrics = DEFAULT_XLSX_COLUMN_WIDTH_METRICS): number {
  const { maximumDigitWidth, pixelRatio } = metrics;
  const padding = Math.round(5 * pixelRatio);
  const storedWidth = Math.floor((8.43 * maximumDigitWidth + padding) / maximumDigitWidth * 256) / 256;
  return xlsxColumnWidthToPixels(storedWidth, metrics);
}
