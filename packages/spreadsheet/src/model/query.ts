import { cellAddress, parseCellAddress } from "./address";
import { copyQuerySnapshot, type QuerySnapshot } from "./query-snapshot";
import { namedRangeAddress, normalizeNamedRangeRectangle, normalizeRangeName, type SpreadsheetNamedRangeInfo } from "./named-ranges";
import type { SpreadsheetTable } from "./tables/types";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetComment, type SpreadsheetDrawing,
  type SpreadsheetImageDrawing, type SpreadsheetImageResource, type SpreadsheetMergedRange, type SpreadsheetShapeDrawing,
  type SpreadsheetSheet, type SpreadsheetTextDrawing, type SpreadsheetWorkbook } from "./types";

/** Inclusive zero-based coordinates, or one same-sheet A1 address/range such as A1:C5. */
export type SpreadsheetReadRangeInput = SpreadsheetMergedRange | string;
/** Rows followed by columns; absent stored cells are null, and formulas retain their raw input text. */
export type SpreadsheetReadRange = readonly (readonly (QuerySnapshot<SpreadsheetCell> | null)[])[];
type QueryWorkbook = QuerySnapshot<SpreadsheetWorkbook>;
type QuerySheet = QuerySnapshot<SpreadsheetSheet>;
export type SpreadsheetTableInfo = SpreadsheetTable & Readonly<{ sheetId: string; address: string }>;

function validateId(id: string): void {
  if (typeof id !== "string" || !id || id.length > 200 || /\0/.test(id)) throw new Error("読み取る対象のIDが正しくありません");
}

function requireWorkbook(workbook: QueryWorkbook): void {
  if (!workbook || !Array.isArray(workbook.sheets) || !workbook.sheets.length || workbook.sheets.length > SPREADSHEET_LIMITS.sheets ||
    (workbook.schemaVersion !== undefined && workbook.schemaVersion !== 1)) throw new Error("ブックの形式が正しくありません");
}

function requireSheet(workbook: QueryWorkbook, sheetId: string): QuerySheet {
  requireWorkbook(workbook); validateId(sheetId);
  const matches: readonly QuerySheet[] = workbook.sheets.filter(sheet => sheet?.id === sheetId);
  if (matches.length !== 1) throw new Error("シートが見つからないか、同じIDのシートが重複しています");
  const sheet = matches[0];
  if (!Number.isInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > SPREADSHEET_LIMITS.rows ||
    !Number.isInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > SPREADSHEET_LIMITS.columns)
    throw new Error("シートの行数または列数が正しくありません");
  return sheet;
}

function record(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}の形式が正しくありません`);
}

function requireAddress(sheet: QuerySheet, address: string): string {
  const position = parseCellAddress(address);
  if (!position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) throw new Error("読み取るセルがシートの範囲外です");
  return cellAddress(position.row, position.column);
}

function storedCell(sheet: QuerySheet, address: string): QuerySnapshot<SpreadsheetCell> | undefined {
  const cell = Object.hasOwn(sheet.cells, address) ? sheet.cells[address] : undefined;
  if (cell !== undefined) {
    record(cell, "セル");
    if (typeof cell.value !== "string" || cell.value.length > SPREADSHEET_LIMITS.cellLength) throw new Error("セルの値は上限内の文字列で指定してください");
  }
  return cell;
}

function requireRange(sheet: QuerySheet, input: SpreadsheetReadRangeInput): SpreadsheetMergedRange {
  let range: SpreadsheetMergedRange;
  if (typeof input === "string") {
    const parts = input.split(":");
    if (parts.length > 2) throw new Error("読み取る範囲は同じシート内のA1表記で指定してください");
    const first = parseCellAddress(parts[0]), last = parseCellAddress(parts[1] ?? parts[0]);
    if (!first || !last) throw new Error("読み取る範囲は同じシート内のA1表記で指定してください");
    range = { top: first.row, left: first.column, bottom: last.row, right: last.column };
  } else range = input;
  if (!range || typeof range !== "object" || Array.isArray(range) ||
    ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) ||
    range.top < 0 || range.left < 0 || range.bottom < range.top || range.right < range.left ||
    range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) throw new Error("読み取る範囲はシート内の長方形で指定してください");
  if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > SPREADSHEET_LIMITS.rangeCells)
    throw new Error("一度に読み取る範囲は10,000セルまでです");
  return range;
}

/**
 * Read a stored physical cell. Empty/unrecorded cells are undefined; merged children are not redirected.
 * The value is raw input (including = formulas), not a calculated value. Invalid addresses/sheets throw.
 */
export function getCell(workbook: QueryWorkbook, sheetId: string, address: string): QuerySnapshot<SpreadsheetCell> | undefined {
  const sheet = requireSheet(workbook, sheetId), key = requireAddress(sheet, address);
  record(sheet.cells, "セル一覧");
  return copyQuerySnapshot(storedCell(sheet, key));
}

/** Read a rectangular matrix of physical cells, retaining blanks as null. Does not expand merged ranges. */
export function getRange(workbook: QueryWorkbook, sheetId: string, input: SpreadsheetReadRangeInput): SpreadsheetReadRange {
  const sheet = requireSheet(workbook, sheetId), range = requireRange(sheet, input);
  record(sheet.cells, "セル一覧");
  const rows: (QuerySnapshot<SpreadsheetCell> | null)[][] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    const cells: (QuerySnapshot<SpreadsheetCell> | null)[] = [];
    for (let column = range.left; column <= range.right; column++) cells.push(storedCell(sheet, cellAddress(row, column)) ?? null);
    rows.push(cells);
  }
  return copyQuerySnapshot(rows);
}

/** Return a detached, deeply frozen snapshot of the sheet. Image bytes remain in workbook.resources. */
export function getSheet(workbook: QueryWorkbook, sheetId: string): QuerySnapshot<SpreadsheetSheet> {
  return copyQuerySnapshot(requireSheet(workbook, sheetId));
}

function findDrawing(workbook: QueryWorkbook, sheetId: string, drawingId: string): QuerySnapshot<SpreadsheetDrawing> | undefined {
  const sheet = requireSheet(workbook, sheetId); validateId(drawingId);
  if (sheet.drawings === undefined) return undefined;
  if (!Array.isArray(sheet.drawings) || sheet.drawings.length > SPREADSHEET_LIMITS.drawings) throw new Error("描画オブジェクト一覧の形式が正しくありません");
  const matches: readonly QuerySnapshot<SpreadsheetDrawing>[] = sheet.drawings.filter(drawing => drawing?.id === drawingId);
  if (matches.length > 1) throw new Error("同じIDの描画オブジェクトが重複しています");
  const drawing = matches[0];
  if (drawing && !["image", "shape", "text"].includes(drawing.type)) throw new Error("描画オブジェクトの種類が正しくありません");
  return drawing;
}

/** Look up a sheet placement by drawingId, independently of the resourceId for embedded image bytes. */
export function getDrawing(workbook: QueryWorkbook, sheetId: string, drawingId: string): QuerySnapshot<SpreadsheetDrawing> | undefined {
  return copyQuerySnapshot(findDrawing(workbook, sheetId, drawingId));
}

/** Return an image placement, or undefined for a missing ID or a different drawing type. */
export function getImage(workbook: QueryWorkbook, sheetId: string, drawingId: string): QuerySnapshot<SpreadsheetImageDrawing> | undefined {
  const drawing = findDrawing(workbook, sheetId, drawingId);
  return drawing?.type === "image" ? copyQuerySnapshot(drawing) : undefined;
}

/** Return a shape placement, or undefined for a missing ID or a different drawing type. */
export function getShape(workbook: QueryWorkbook, sheetId: string, drawingId: string): QuerySnapshot<SpreadsheetShapeDrawing> | undefined {
  const drawing = findDrawing(workbook, sheetId, drawingId);
  return drawing?.type === "shape" ? copyQuerySnapshot(drawing) : undefined;
}

/** Return a text-box placement, or undefined for a missing ID or a different drawing type. */
export function getTextBox(workbook: QueryWorkbook, sheetId: string, drawingId: string): QuerySnapshot<SpreadsheetTextDrawing> | undefined {
  const drawing = findDrawing(workbook, sheetId, drawingId);
  return drawing?.type === "text" ? copyQuerySnapshot(drawing) : undefined;
}

/** Read the image bytes/metadata by workbook-wide resourceId, not by a sheet's drawingId. */
export function getImageResource(workbook: QueryWorkbook, resourceId: string): QuerySnapshot<SpreadsheetImageResource> | undefined {
  requireWorkbook(workbook); validateId(resourceId);
  if (workbook.resources === undefined) return undefined;
  record(workbook.resources, "画像リソース");
  const images = workbook.resources.images;
  if (images === undefined) return undefined;
  record(images, "画像リソース一覧");
  return copyQuerySnapshot(Object.hasOwn(images, resourceId) ? images[resourceId] : undefined);
}

/** Read the comment stored at the exact cell address; merged children are not redirected. */
export function getCellComment(workbook: QueryWorkbook, sheetId: string, address: string): QuerySnapshot<SpreadsheetComment> | undefined {
  const sheet = requireSheet(workbook, sheetId), key = requireAddress(sheet, address);
  if (sheet.comments === undefined) return undefined;
  record(sheet.comments, "コメント一覧");
  return copyQuerySnapshot(Object.hasOwn(sheet.comments, key) ? sheet.comments[key] : undefined);
}

/** Get a workbook-scoped name definition; matching is case insensitive, and absence is undefined. */
export function getNamedRange(workbook: QueryWorkbook, name: string): QuerySnapshot<SpreadsheetNamedRangeInfo> | undefined {
  requireWorkbook(workbook);
  const key = normalizeRangeName(name).toLocaleLowerCase("en-US");
  if (workbook.namedRanges === undefined) return undefined;
  if (!Array.isArray(workbook.namedRanges) || workbook.namedRanges.length > SPREADSHEET_LIMITS.namedRanges)
    throw new Error("名前付き範囲の形式または件数が正しくありません");
  const matches = workbook.namedRanges.filter(item => item && typeof item.name === "string" && item.name.toLocaleLowerCase("en-US") === key);
  if (matches.length > 1) throw new Error("同じ名前の名前付き範囲があります");
  const item = matches[0];
  if (!item) return undefined;
  validateId(item.id);
  const range = normalizeNamedRangeRectangle(item.range, requireSheet(workbook, item.sheetId));
  return copyQuerySnapshot({ id: item.id, name: item.name, sheetId: item.sheetId, range, address: namedRangeAddress(range) });
}

/** Get the current raw cell matrix by name. Uses the same limit/blank conventions as getRange. */
export function getRangeByName(workbook: QueryWorkbook, name: string): SpreadsheetReadRange | undefined {
  const item = getNamedRange(workbook, name);
  return item ? getRange(workbook, item.sheetId, item.range) : undefined;
}

function findTable(workbook: QueryWorkbook, matches: (table: QuerySnapshot<SpreadsheetTable>) => boolean): QuerySnapshot<SpreadsheetTableInfo> | undefined {
  requireWorkbook(workbook);
  let found: SpreadsheetTableInfo | undefined;
  for (const sheet of workbook.sheets) {
    if (sheet.tables === undefined) continue;
    if (!Array.isArray(sheet.tables) || sheet.tables.length > SPREADSHEET_LIMITS.tables) throw new Error("テーブル一覧の形式が正しくありません");
    for (const table of sheet.tables) {
      if (!table || !matches(table)) continue;
      if (found) throw new Error("同じIDまたは名前のテーブルが重複しています");
      validateId(table.id); normalizeRangeName(table.name);
      const range = normalizeNamedRangeRectangle(table.range, requireSheet(workbook, sheet.id));
      found = { ...table, range, sheetId: sheet.id, address: namedRangeAddress(range) };
    }
  }
  return copyQuerySnapshot(found);
}

/** Get a workbook-wide table by its stable ID, including its current sheet and rectangle. */
export function getTable(workbook: QueryWorkbook, tableId: string): QuerySnapshot<SpreadsheetTableInfo> | undefined {
  validateId(tableId);
  return findTable(workbook, table => table.id === tableId);
}

/** Table names, like named range names, are workbook-wide and case insensitive. */
export function getTableByName(workbook: QueryWorkbook, name: string): QuerySnapshot<SpreadsheetTableInfo> | undefined {
  const key = normalizeRangeName(name).toLocaleLowerCase("en-US");
  return findTable(workbook, table => typeof table.name === "string" && table.name.toLocaleLowerCase("en-US") === key);
}

/** Enumerate immutable sheet JSON in workbook/tab order. Empty arrays are never used for an invalid workbook. */
export function getSheets(workbook: QueryWorkbook): readonly QuerySnapshot<SpreadsheetSheet>[] {
  requireWorkbook(workbook);
  for (const sheet of workbook.sheets) requireSheet(workbook, sheet.id);
  return copyQuerySnapshot(workbook.sheets);
}

/** Enumerate names in definition order, optionally scoped to one sheet. Empty means no definitions. */
export function getNamedRanges(workbook: QueryWorkbook, sheetId?: string): readonly QuerySnapshot<SpreadsheetNamedRangeInfo>[] {
  requireWorkbook(workbook);
  if (sheetId !== undefined) requireSheet(workbook, sheetId);
  if (workbook.namedRanges === undefined) return Object.freeze([]);
  if (!Array.isArray(workbook.namedRanges) || workbook.namedRanges.length > SPREADSHEET_LIMITS.namedRanges)
    throw new Error("名前付き範囲の形式または件数が正しくありません");
  const ids = new Set<string>(), names = new Set<string>();
  const result: SpreadsheetNamedRangeInfo[] = [];
  for (const item of workbook.namedRanges) {
    if (!item) throw new Error("名前付き範囲の形式が正しくありません");
    validateId(item.id);
    const key = normalizeRangeName(item.name).toLocaleLowerCase("en-US");
    if (ids.has(item.id) || names.has(key)) throw new Error("名前付き範囲のIDまたは名前が重複しています");
    ids.add(item.id); names.add(key);
    const range = normalizeNamedRangeRectangle(item.range, requireSheet(workbook, item.sheetId));
    if (sheetId === undefined || sheetId === item.sheetId)
      result.push({ id: item.id, name: item.name, sheetId: item.sheetId, range, address: namedRangeAddress(range) });
  }
  return copyQuerySnapshot(result);
}

/** Enumerate sheet placements in drawing order; image resources remain in workbook.resources. */
export function getDrawings(workbook: QueryWorkbook, sheetId: string): readonly QuerySnapshot<SpreadsheetDrawing>[] {
  const sheet = requireSheet(workbook, sheetId);
  if (sheet.drawings === undefined) return Object.freeze([]);
  if (!Array.isArray(sheet.drawings) || sheet.drawings.length > SPREADSHEET_LIMITS.drawings) throw new Error("描画オブジェクト一覧の形式が正しくありません");
  const ids = new Set<string>();
  for (const drawing of sheet.drawings) {
    if (!drawing || !["image", "shape", "text"].includes(drawing.type)) throw new Error("描画オブジェクトの種類が正しくありません");
    validateId(drawing.id);
    if (ids.has(drawing.id)) throw new Error("同じIDの描画オブジェクトが重複しています");
    ids.add(drawing.id);
  }
  return copyQuerySnapshot(sheet.drawings);
}

export function getImages(workbook: QueryWorkbook, sheetId: string): readonly QuerySnapshot<SpreadsheetImageDrawing>[] {
  return Object.freeze(getDrawings(workbook, sheetId).filter((drawing): drawing is QuerySnapshot<SpreadsheetImageDrawing> => drawing.type === "image"));
}
export function getShapes(workbook: QueryWorkbook, sheetId: string): readonly QuerySnapshot<SpreadsheetShapeDrawing>[] {
  return Object.freeze(getDrawings(workbook, sheetId).filter((drawing): drawing is QuerySnapshot<SpreadsheetShapeDrawing> => drawing.type === "shape"));
}
export function getTextBoxes(workbook: QueryWorkbook, sheetId: string): readonly QuerySnapshot<SpreadsheetTextDrawing>[] {
  return Object.freeze(getDrawings(workbook, sheetId).filter((drawing): drawing is QuerySnapshot<SpreadsheetTextDrawing> => drawing.type === "text"));
}

/** Enumerate tables in sheet/table order, optionally limited to a single sheet. */
export function getTables(workbook: QueryWorkbook, sheetId?: string): readonly QuerySnapshot<SpreadsheetTableInfo>[] {
  requireWorkbook(workbook);
  if (sheetId !== undefined) requireSheet(workbook, sheetId);
  const result: SpreadsheetTableInfo[] = [], ids = new Set<string>(), names = new Set<string>();
  for (const sheet of workbook.sheets) {
    if (sheet.tables === undefined) continue;
    if (!Array.isArray(sheet.tables) || sheet.tables.length > SPREADSHEET_LIMITS.tables) throw new Error("テーブル一覧の形式が正しくありません");
    for (const table of sheet.tables) {
      if (!table) throw new Error("テーブルの形式が正しくありません");
      validateId(table.id);
      const key = normalizeRangeName(table.name).toLocaleLowerCase("en-US");
      if (ids.has(table.id) || names.has(key)) throw new Error("テーブルのIDまたは名前が重複しています");
      ids.add(table.id); names.add(key);
      const range = normalizeNamedRangeRectangle(table.range, requireSheet(workbook, sheet.id));
      if (sheetId === undefined || sheetId === sheet.id) result.push({ ...table, range, sheetId: sheet.id, address: namedRangeAddress(range) });
    }
  }
  if (ids.size > SPREADSHEET_LIMITS.tables) throw new Error("テーブルの件数が上限を超えています");
  return copyQuerySnapshot(result);
}
