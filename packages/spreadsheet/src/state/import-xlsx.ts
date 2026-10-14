import { importSpreadsheetXlsx as importModel } from "../import/import-xlsx";
import type { SpreadsheetExcelImportInput, SpreadsheetExcelImportOptions } from "../import/types";
import { createSpreadsheetExcelFontMeasurer } from "./excel-font-measurer";

/** Browser entry: measure the workbook's Normal font before building its grid. */
export function importSpreadsheetXlsx(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}) {
  return importModel(input, { ...options,
    columnWidthMeasurement: options.columnWidthMeasurement ?? createSpreadsheetExcelFontMeasurer() });
}
