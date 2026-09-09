import { rewriteFormulaReferences, type FormulaReference } from "../formula";
import { pruneImageResources } from "../image-resources";
import { SPREADSHEET_LIMITS, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { finishWorkbook, freezeCell, getWorkbookSheet } from "./snapshot";
import { ensureUniqueSheetName, fail, normalizeSheetName } from "./validation";

let nextId = 1;
function addedSheetName(workbook: SpreadsheetWorkbook, suppliedName?: string): string {
  if (workbook.sheets.length >= SPREADSHEET_LIMITS.sheets) return fail("シート数の上限に達しています");
  let index = 1;
  while (workbook.sheets.some(sheet => sheet.name.toLowerCase() === `sheet${index}`)) index++;
  const name = normalizeSheetName(suppliedName ?? `Sheet${index}`);
  ensureUniqueSheetName(workbook, name);
  return name;
}
function appendSheet(workbook: SpreadsheetWorkbook, name: string, id: string): SpreadsheetWorkbook {
  if (typeof id !== "string" || !id || id.length > 200 || /\0/.test(id) || workbook.sheets.some(sheet => sheet.id === id))
    return fail("シートの ID が空、重複、または不正です");
  return finishWorkbook([...workbook.sheets, Object.freeze({ id, name, cells: Object.freeze({}), rowCount: 100, columnCount: 26 })], workbook);
}
/** Internal command boundary: callers supply identity without consuming the legacy model sequence. */
export function addSheetWithId(workbook: SpreadsheetWorkbook, suppliedName: string | undefined, id: string): SpreadsheetWorkbook {
  return appendSheet(workbook, addedSheetName(workbook, suppliedName), id);
}
export function addSheet(workbook: SpreadsheetWorkbook, suppliedName?: string): SpreadsheetWorkbook {
  const name = addedSheetName(workbook, suppliedName);
  let id: string;
  do { id = `sheet-${++nextId}`; } while (workbook.sheets.some(sheet => sheet.id === id));
  return appendSheet(workbook, name, id);
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
/** Move an existing sheet to its final zero-based position without changing its contents or identity. */
export function moveSheet(workbook: SpreadsheetWorkbook, sheetId: string, index: number): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (!Number.isInteger(index) || index < 0 || index >= workbook.sheets.length)
    return fail("移動先はシート数の範囲内の0始まりの整数で指定してください");
  const previousIndex = workbook.sheets.indexOf(sheet);
  if (previousIndex === index) return workbook;
  const sheets = [...workbook.sheets];
  sheets.splice(previousIndex, 1);
  sheets.splice(index, 0, sheet);
  return finishWorkbook(sheets, workbook);
}
