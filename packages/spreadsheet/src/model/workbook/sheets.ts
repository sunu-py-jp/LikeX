import { isFormulaCell } from "../cell-value";
import { rewriteFormulaReferences, type FormulaReference } from "../formula";
import { pruneImageResources } from "../image-resources";
import { SPREADSHEET_LIMITS, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { DEFAULT_SHEET_SIZE } from "../sheet-dimensions";
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
  return finishWorkbook([...workbook.sheets, Object.freeze({ id, name, cells: Object.freeze({}), ...DEFAULT_SHEET_SIZE })], workbook);
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
      if (!isFormulaCell(cell)) continue;
      const matches = (reference: FormulaReference) => reference.sheet?.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US");
      const value = rewriteFormulaReferences(cell.value, reference => matches(reference)
        ? replacement === undefined ? "#REF!" : `'${replacement.replaceAll("'", "''")}'!${reference.address}` : undefined,
      replacement === undefined ? (first, last) => matches(first) || matches(last) ? "#REF!" : undefined : undefined);
      if (value !== cell.value) { changed = true; cells[address] = freezeCell(value, cell.format, cell.validation); }
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
  return finishWorkbook(sheets, workbook, pruneImageResources(workbook.resources, sheets),
    (workbook.namedRanges ?? []).filter(item => item.sheetId !== sheetId));
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

/** Duplicate content with fresh identities; qualified self references follow the new sheet. */
export function duplicateSheetWithIds(workbook: SpreadsheetWorkbook, sheetId: string, suppliedName: string | undefined,
  nextIdentity: () => string): { workbook: SpreadsheetWorkbook; sheetId: string } {
  if (workbook.sheets.length >= SPREADSHEET_LIMITS.sheets) return fail("シート数の上限に達しています");
  const source = getWorkbookSheet(workbook, sheetId);
  let name: string;
  if (suppliedName !== undefined) { name = normalizeSheetName(suppliedName); ensureUniqueSheetName(workbook, name); }
  else {
    let index = 2;
    do { const suffix = ` (${index++})`; name = `${source.name.slice(0, 31 - suffix.length)}${suffix}`; }
    while (workbook.sheets.some(sheet => sheet.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")));
  }
  const occupied = new Set(workbook.sheets.flatMap(sheet => [sheet.id, ...(sheet.drawings?.map(drawing => drawing.id) ?? []),
    ...(sheet.tables?.flatMap(table => [table.id, ...table.columns.map(column => column.id)]) ?? []),
    ...Object.values(sheet.comments ?? {}).map(comment => comment.id)]));
  const identity = () => {
    const id = nextIdentity();
    if (typeof id !== "string" || !id || id.length > 200 || /\0/.test(id) || occupied.has(id)) return fail("複製用の ID が空、重複、または不正です");
    occupied.add(id); return id;
  };
  const id = identity();
  const cells = Object.fromEntries(Object.entries(source.cells).map(([address, cell]) => [address, Object.freeze({ ...cell,
    value: isFormulaCell(cell) ? rewriteFormulaReferences(cell.value, reference => reference.sheet?.toLocaleLowerCase("en-US") === source.name.toLocaleLowerCase("en-US")
      ? `'${name.replaceAll("'", "''")}'!${reference.address}` : undefined) : cell.value,
  })]));
  const tableNames = new Set([...(workbook.namedRanges ?? []).map(item => item.name.toLocaleLowerCase("en-US")),
    ...workbook.sheets.flatMap(sheet => (sheet.tables ?? []).map(item => item.name.toLocaleLowerCase("en-US")))]);
  const duplicated: SpreadsheetSheet = Object.freeze({ ...source, id, name, cells: Object.freeze(cells),
    ...(source.tables ? { tables: Object.freeze(source.tables.map(table => {
      let tableName: string, suffix = 2;
      do { const ending = `_${suffix++}`; tableName = `${table.name.slice(0, 255 - ending.length)}${ending}`; }
      while (tableNames.has(tableName.toLocaleLowerCase("en-US")));
      tableNames.add(tableName.toLocaleLowerCase("en-US"));
      return Object.freeze({ ...table, id: identity(), name: tableName,
        columns: Object.freeze(table.columns.map(column => Object.freeze({ ...column, id: identity() }))) });
    })) } : {}),
    ...(source.drawings ? { drawings: Object.freeze(source.drawings.map(drawing => Object.freeze({ ...drawing, id: identity(), anchor: Object.freeze({ ...drawing.anchor }) }))) } : {}),
    ...(source.comments ? { comments: Object.freeze(Object.fromEntries(Object.entries(source.comments).map(([address, comment]) => [address, Object.freeze({ ...comment, id: identity() })]))) } : {}),
  });
  const sheets = [...workbook.sheets];
  sheets.splice(sheets.indexOf(source) + 1, 0, duplicated);
  return { workbook: finishWorkbook(sheets, workbook), sheetId: id };
}
