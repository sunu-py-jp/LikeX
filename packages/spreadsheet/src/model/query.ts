import { cellAddress, parseCellAddress } from "./address";
import { copyQuerySnapshot, type QuerySnapshot } from "./query-snapshot";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetComment, type SpreadsheetDrawing,
  type SpreadsheetImageDrawing, type SpreadsheetImageResource, type SpreadsheetMergedRange, type SpreadsheetShapeDrawing,
  type SpreadsheetSheet, type SpreadsheetTextDrawing, type SpreadsheetWorkbook } from "./types";

/** Inclusive zero-based coordinates, or one same-sheet A1 address/range such as A1:C5. */
export type SpreadsheetReadRangeInput = SpreadsheetMergedRange | string;
/** Rows followed by columns; absent stored cells are null, and formulas retain their raw input text. */
export type SpreadsheetReadRange = readonly (readonly (QuerySnapshot<SpreadsheetCell> | null)[])[];
type QueryWorkbook = QuerySnapshot<SpreadsheetWorkbook>;
type QuerySheet = QuerySnapshot<SpreadsheetSheet>;

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
