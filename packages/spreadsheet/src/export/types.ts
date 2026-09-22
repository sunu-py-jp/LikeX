import type { SpreadsheetImageRasterizer } from "./portable-types";

export type SpreadsheetNativeExportOptions = Readonly<{ signal?: AbortSignal }>;

export type SpreadsheetExcelExportOptions = Readonly<{
  /** Stops preparation and packaging. Does not alter the workbook. */
  signal?: AbortSignal;
  /** PNG conversion for images that cannot be embedded directly. Defaults to browser Canvas. */
  rasterizeImage?: SpreadsheetImageRasterizer;
}>;
