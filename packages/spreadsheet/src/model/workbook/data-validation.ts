import { dataValidationsEqual, normalizeDataValidation, type SpreadsheetDataValidation } from "../data-validation";
import { getMergedRange } from "../merges";
import { cellAddress, parseCellAddress } from "../address";
import { expandCellAddresses } from "../cell-addresses";
import type { SpreadsheetWorkbook } from "../types";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { fail } from "./validation";

/** Set/remove a rule on A1 cells/ranges (at most 10,000 cells). Existing values must satisfy the new rule. */
export function setCellDataValidation(workbook: SpreadsheetWorkbook, sheetId: string, addresses: readonly string[], input: SpreadsheetDataValidation | null): SpreadsheetWorkbook {
  if (!Array.isArray(addresses) || addresses.length > 10_000) return fail("入力規則は一度に10,000セルまで設定できます");
  const rule = input === null ? undefined : normalizeDataValidation(input);
  if (input !== null && !rule) return fail("入力規則を指定してください");
  const sheet = getWorkbookSheet(workbook, sheetId), cells = { ...sheet.cells };
  let changed = false;
  for (const key of expandCellAddresses(sheet, addresses)) {
    const previous = cells[key], merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (merge && key !== cellAddress(merge.top, merge.left)) continue;
    if (dataValidationsEqual(previous?.validation, rule)) continue;
    changed = true;
    if (!previous?.value && !previous?.format && !rule) delete cells[key];
    else cells[key] = freezeCell(previous?.value ?? "", previous?.format, rule);
  }
  return changed ? replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}
