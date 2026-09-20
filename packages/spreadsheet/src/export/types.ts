export type SpreadsheetNativeExportOptions = Readonly<{ signal?: AbortSignal }>;

export type SpreadsheetExcelExportOptions = Readonly<{
  /** Stops preparation and packaging. Does not alter the workbook. */
  signal?: AbortSignal;
}>;
