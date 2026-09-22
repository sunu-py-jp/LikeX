import type { OfficePackageBlob } from "../ooxml";
import type { SpreadsheetWorkbook } from "../model/types";
import { exportSpreadsheetXlsx as exportXlsx } from "./export-xlsx";
import type { SpreadsheetXlsxExportOptions } from "./portable-types";

/** Returns a real Blob through a portable declaration that does not require DOM typings. */
export function exportSpreadsheetXlsx(workbook: SpreadsheetWorkbook, options: SpreadsheetXlsxExportOptions = {}): Promise<OfficePackageBlob> {
  return exportXlsx(workbook, { ...options, signal: options.signal as AbortSignal | undefined });
}
