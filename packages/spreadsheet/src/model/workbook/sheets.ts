import { rewriteFormulaReferences, type FormulaReference } from "../formula";
import { pruneImageResources } from "../image-resources";
import { SPREADSHEET_LIMITS, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { finishWorkbook, freezeCell, getWorkbookSheet } from "./snapshot";
import { ensureUniqueSheetName, fail, normalizeSheetName } from "./validation";

let nextId = 1;
export function addSheet(workbook: SpreadsheetWorkbook, suppliedName?: string): SpreadsheetWorkbook {
  if (workbook.sheets.length >= SPREADSHEET_LIMITS.sheets) return fail("シート数の上限に達しています");
  let index = 1;
  while (workbook.sheets.some(sheet => sheet.name.toLowerCase() === `sheet${index}`)) index++;
  const name = normalizeSheetName(suppliedName ?? `Sheet${index}`);
  ensureUniqueSheetName(workbook, name);
  let id: string;
  do { id = `sheet-${++nextId}`; } while (workbook.sheets.some(sheet => sheet.id === id));
  return finishWorkbook([...workbook.sheets, Object.freeze({ id, name, cells: Object.freeze({}), rowCount: 100, columnCount: 26 })], workbook);
}
function replaceSheetReferences(workbook: SpreadsheetWorkbook, name: string, replacement?: string): readonly SpreadsheetSheet[] {
  return workbook.sheets.map(sheet => {
    let changed = false;
    const cells = { ...sheet.cells };
    for (const [address, cell] of Object.entries(cells)) {
      const matches = (reference: FormulaReference) => reference.sheet?.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US");
      const value = rewriteFormulaReferences(cell.value, reference => matches(reference)
        ? replacement === undefined ? "#REF!" : `'${replacement.replaceAll("'", "''")}'!${reference.address}` : undefined,
      replacement === undefined ? (first, last) => matches(first) || matches(last) ? "#REF!" : undefined : undefined);
      if (value !== cell.value) { changed = true; cells[address] = freezeCell(value, cell.format); }
    }
    return changed ? Object.freeze({ ...sheet, cells: Object.freeze(cells) }) : sheet;
  });
}
export function renameSheet(workbook: SpreadsheetWorkbook, sheetId: string, value: string): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), name = normalizeSheetName(value);
  ensureUniqueSheetName(workbook, name, sheetId);
  if (name === sheet.name) return workbook;
  return finishWorkbook(replaceSheetReferences(workbook, sheet.name, name).map(item => item.id === sheetId ? Object.freeze({ ...item, name }) : item), workbook);
}
export function deleteSheet(workbook: SpreadsheetWorkbook, sheetId: string): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (workbook.sheets.length <= 1) return fail("最後のシートは削除できません");
  const sheets = replaceSheetReferences(workbook, sheet.name).filter(item => item.id !== sheetId);
  return finishWorkbook(sheets, undefined, pruneImageResources(workbook.resources, sheets));
}
