import { resolveExcelImportFormat } from "../import/excel-format";
import { importSpreadsheetXls as importXls } from "../import/legacy/import-xls";
import type { SpreadsheetExcelImportInput, SpreadsheetExcelImportOptions } from "../import/types";
import { createSpreadsheetExcelFontMeasurer } from "./excel-font-measurer";
import { importSpreadsheetXlsx } from "./import-xlsx";

/** Browser entry: measure the workbook's default font before building its grid. */
export async function importSpreadsheetXls(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}) {
  return importXls(input, { ...options,
    columnWidthMeasurement: options.columnWidthMeasurement ?? createSpreadsheetExcelFontMeasurer() });
}
/** Browser entry for either Excel format; see the model entry for the routing rules. */
export async function importSpreadsheetExcel(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}) {
  options.signal?.throwIfAborted();
  return await resolveExcelImportFormat(input, options.signal) === "xlsx" ? importSpreadsheetXlsx(input, options) : importSpreadsheetXls(input, options);
}
