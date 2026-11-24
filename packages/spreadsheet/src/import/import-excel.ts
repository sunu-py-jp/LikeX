import { resolveExcelImportFormat } from "./excel-format";
import { importSpreadsheetXlsx } from "./import-xlsx";
import { importSpreadsheetXls } from "./legacy/import-xls";
import type { SpreadsheetExcelImportInput, SpreadsheetExcelImportOptions, SpreadsheetExcelImportResult } from "./types";

/**
 * Imports an Excel workbook in either supported format. The content decides the reader:
 * a .xlsx (OOXML) package or an Excel 97–2003 .xls workbook.
 */
export async function importSpreadsheetExcel(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}): Promise<SpreadsheetExcelImportResult> {
  options.signal?.throwIfAborted();
  if (await resolveExcelImportFormat(input, options.signal) === "xlsx") return importSpreadsheetXlsx(input, options);
  return importSpreadsheetXls(input, options);
}
