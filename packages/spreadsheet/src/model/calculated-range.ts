import type { SpreadsheetWorkbookSnapshot } from "../commands/types";
import type { SpreadsheetReadRangeInput } from "./query";
import type { SpreadsheetCalculatedValue, SpreadsheetMergedRange, SpreadsheetWorkbook } from "./types";
import { createWorkbookCalculator } from "./formula";
import { cellAddress } from "./address";
import { requireRange, requireSheet } from "./query-validation";
import { normalizeWorkbook } from "./workbook/normalize";

/** Requested A1 addresses and computed values; blank cells have an empty string. */
export type SpreadsheetCalculatedRange = Readonly<Record<string, SpreadsheetCalculatedValue>>;

/** Internal path for views that have already validated their complete workbook. */
export function calculateNormalizedRange(workbook: SpreadsheetWorkbook, sheetId: string,
  range: SpreadsheetMergedRange): SpreadsheetCalculatedRange {
  const calculator = createWorkbookCalculator(workbook);
  const values: Record<string, SpreadsheetCalculatedValue> = Object.create(null);
  for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
    const address = cellAddress(row, column);
    values[address] = calculator.getCell(sheetId, address);
  }
  return Object.freeze(values);
}

/** Validate the workbook, then evaluate only this range and its dependencies (including other sheets). */
export function calculateSpreadsheetRange(input: SpreadsheetWorkbookSnapshot, sheetId: string,
  range: SpreadsheetReadRangeInput): SpreadsheetCalculatedRange {
  if (input === undefined) throw new Error("計算するブックを指定してください");
  const workbook = normalizeWorkbook(input as SpreadsheetWorkbook);
  const bounds = requireRange(requireSheet(workbook, sheetId), range, 10_000);
  return calculateNormalizedRange(workbook, sheetId, bounds);
}
