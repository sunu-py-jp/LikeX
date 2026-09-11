import { getCell, getCellComment, getDrawing, getImage, getImageResource, getRange, getShape, getSheet, getTextBox,
  getNamedRange, getRangeByName, getTable, getTableByName,
  getSheets, getNamedRanges, getDrawings, getImages, getShapes, getTextBoxes, getTables,
  type SpreadsheetReadRangeInput } from "./query";
import type { QuerySnapshot } from "./query-snapshot";
import type { SpreadsheetWorkbook } from "./types";
import { createSpreadsheetSheetReader, type SpreadsheetSheetReadApi } from "./sheet-reader";

/** Queries shared by a mounted component and a headless session; all coordinates address stored data. */
export type SpreadsheetReadApi = Readonly<{
  getCell(sheetId: string, address: string): ReturnType<typeof getCell>;
  getRange(sheetId: string, range: SpreadsheetReadRangeInput): ReturnType<typeof getRange>;
  getSheet(sheetId: string): ReturnType<typeof getSheet>;
  getDrawing(sheetId: string, drawingId: string): ReturnType<typeof getDrawing>;
  getImage(sheetId: string, drawingId: string): ReturnType<typeof getImage>;
  getShape(sheetId: string, drawingId: string): ReturnType<typeof getShape>;
  getTextBox(sheetId: string, drawingId: string): ReturnType<typeof getTextBox>;
  getImageResource(resourceId: string): ReturnType<typeof getImageResource>;
  getCellComment(sheetId: string, address: string): ReturnType<typeof getCellComment>;
  getNamedRange(name: string): ReturnType<typeof getNamedRange>;
  getRangeByName(name: string): ReturnType<typeof getRangeByName>;
  getTable(tableId: string): ReturnType<typeof getTable>;
  getTableByName(name: string): ReturnType<typeof getTableByName>;
  getSheets(): ReturnType<typeof getSheets>;
  getNamedRanges(sheetId?: string): ReturnType<typeof getNamedRanges>;
  getDrawings(sheetId: string): ReturnType<typeof getDrawings>;
  getImages(sheetId: string): ReturnType<typeof getImages>;
  getShapes(sheetId: string): ReturnType<typeof getShapes>;
  getTextBoxes(sheetId: string): ReturnType<typeof getTextBoxes>;
  getTables(sheetId?: string): ReturnType<typeof getTables>;
  sheet(sheetId: string): SpreadsheetSheetReadApi;
}>;

/** Internal adapter: resolve the current workbook at call time, never retain a stale query snapshot. */
export function createSpreadsheetReader(getWorkbook: () => QuerySnapshot<SpreadsheetWorkbook>): SpreadsheetReadApi {
  return Object.freeze({
    getCell: (sheetId: string, address: string) => getCell(getWorkbook(), sheetId, address),
    getRange: (sheetId: string, range: SpreadsheetReadRangeInput) => getRange(getWorkbook(), sheetId, range),
    getSheet: (sheetId: string) => getSheet(getWorkbook(), sheetId),
    getDrawing: (sheetId: string, drawingId: string) => getDrawing(getWorkbook(), sheetId, drawingId),
    getImage: (sheetId: string, drawingId: string) => getImage(getWorkbook(), sheetId, drawingId),
    getShape: (sheetId: string, drawingId: string) => getShape(getWorkbook(), sheetId, drawingId),
    getTextBox: (sheetId: string, drawingId: string) => getTextBox(getWorkbook(), sheetId, drawingId),
    getImageResource: (resourceId: string) => getImageResource(getWorkbook(), resourceId),
    getCellComment: (sheetId: string, address: string) => getCellComment(getWorkbook(), sheetId, address),
    getNamedRange: (name: string) => getNamedRange(getWorkbook(), name),
    getRangeByName: (name: string) => getRangeByName(getWorkbook(), name),
    getTable: (tableId: string) => getTable(getWorkbook(), tableId),
    getTableByName: (name: string) => getTableByName(getWorkbook(), name),
    getSheets: () => getSheets(getWorkbook()),
    getNamedRanges: (sheetId?: string) => getNamedRanges(getWorkbook(), sheetId),
    getDrawings: (sheetId: string) => getDrawings(getWorkbook(), sheetId),
    getImages: (sheetId: string) => getImages(getWorkbook(), sheetId),
    getShapes: (sheetId: string) => getShapes(getWorkbook(), sheetId),
    getTextBoxes: (sheetId: string) => getTextBoxes(getWorkbook(), sheetId),
    getTables: (sheetId?: string) => getTables(getWorkbook(), sheetId),
    sheet: (sheetId: string) => createSpreadsheetSheetReader(getWorkbook, sheetId),
  });
}
