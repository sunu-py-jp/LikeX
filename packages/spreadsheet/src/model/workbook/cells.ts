import { cellAddress, parseCellAddress } from "../address";
import { getMergedRange, mergedCellPosition } from "../merges";
import type { SpreadsheetCellFormat, SpreadsheetWorkbook } from "../types";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { canonicalCellAddress, fail, normalizeCellFormat, validateCellValue } from "./validation";

export function setCellValue(workbook: SpreadsheetWorkbook, sheetId: string, address: string, value: string): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), position = mergedCellPosition(sheet, parseCellAddress(canonicalCellAddress(sheet, address))!);
  return setCellValues(workbook, sheetId, { [cellAddress(position.row, position.column)]: value });
}
export function setCellValues(workbook: SpreadsheetWorkbook, sheetId: string, values: Readonly<Record<string, string>>): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), cells = { ...sheet.cells };
  let changed = false;
  for (const [address, raw] of Object.entries(values)) {
    const key = canonicalCellAddress(sheet, address), value = validateCellValue(raw), previous = cells[key];
    const merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (value && merge && key !== cellAddress(merge.top, merge.left)) return fail("結合セルの値は左上のセルにだけ入力してください");
    if ((previous?.value ?? "") === value) continue;
    changed = true;
    if (!value && !previous?.format && !previous?.validation) delete cells[key];
    else cells[key] = freezeCell(value, previous?.format, previous?.validation);
  }
  return changed ? replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}

export function formatCells(workbook: SpreadsheetWorkbook, sheetId: string, addresses: readonly string[], format: Partial<SpreadsheetCellFormat>): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), cells = { ...sheet.cells };
  // Validate before examining cells so a bad request is rejected atomically.
  normalizeCellFormat(format);
  let changed = false;
  for (const address of addresses) {
    const key = canonicalCellAddress(sheet, address), previous = cells[key], next = normalizeCellFormat({ ...previous?.format, ...format });
    if (JSON.stringify(previous?.format) === JSON.stringify(next)) continue;
    changed = true;
    if (!previous?.value && !next && !previous?.validation) delete cells[key];
    else cells[key] = freezeCell(previous?.value ?? "", next, previous?.validation);
  }
  return changed ? replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) }) : workbook;
}
