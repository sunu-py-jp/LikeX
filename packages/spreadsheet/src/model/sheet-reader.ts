import { getCell, getCellComment, getDrawing, getDrawings, getImage, getImages, getNamedRanges, getRange,
  getShape, getShapes, getSheet, getTables, getTextBox, getTextBoxes, type SpreadsheetReadRangeInput } from "./query";
import { copyQuerySnapshot, type QuerySnapshot } from "./query-snapshot";
import type { SpreadsheetWorkbook } from "./types";

/** A sheet-scoped read facade. It has methods, while getInfo() always returns plain immutable sheet JSON. */
export type SpreadsheetSheetReadApi = Readonly<{
  getInfo(): ReturnType<typeof getSheet>;
  getCell(address: string): ReturnType<typeof getCell>;
  getRange(range: SpreadsheetReadRangeInput): ReturnType<typeof getRange>;
  getDrawing(drawingId: string): ReturnType<typeof getDrawing>;
  getImage(drawingId: string): ReturnType<typeof getImage>;
  getShape(drawingId: string): ReturnType<typeof getShape>;
  getTextBox(drawingId: string): ReturnType<typeof getTextBox>;
  getCellComment(address: string): ReturnType<typeof getCellComment>;
  getNamedRanges(): ReturnType<typeof getNamedRanges>;
  getDrawings(): ReturnType<typeof getDrawings>;
  getImages(): ReturnType<typeof getImages>;
  getShapes(): ReturnType<typeof getShapes>;
  getTextBoxes(): ReturnType<typeof getTextBoxes>;
  getTables(): ReturnType<typeof getTables>;
}>;

/** Internal live binding: reads resolve the workbook anew and fail if the sheet no longer exists. */
export function createSpreadsheetSheetReader(getWorkbook: () => QuerySnapshot<SpreadsheetWorkbook>, sheetId: string): SpreadsheetSheetReadApi {
  getSheet(getWorkbook(), sheetId);
  return Object.freeze({
    getInfo: () => getSheet(getWorkbook(), sheetId),
    getCell: (address: string) => getCell(getWorkbook(), sheetId, address),
    getRange: (range: SpreadsheetReadRangeInput) => getRange(getWorkbook(), sheetId, range),
    getDrawing: (drawingId: string) => getDrawing(getWorkbook(), sheetId, drawingId),
    getImage: (drawingId: string) => getImage(getWorkbook(), sheetId, drawingId),
    getShape: (drawingId: string) => getShape(getWorkbook(), sheetId, drawingId),
    getTextBox: (drawingId: string) => getTextBox(getWorkbook(), sheetId, drawingId),
    getCellComment: (address: string) => getCellComment(getWorkbook(), sheetId, address),
    getNamedRanges: () => getNamedRanges(getWorkbook(), sheetId),
    getDrawings: () => getDrawings(getWorkbook(), sheetId),
    getImages: () => getImages(getWorkbook(), sheetId),
    getShapes: () => getShapes(getWorkbook(), sheetId),
    getTextBoxes: () => getTextBoxes(getWorkbook(), sheetId),
    getTables: () => getTables(getWorkbook(), sheetId),
  });
}

/** Create a fixed, detached workbook snapshot facade for a single sheet without rendering anything. */
export function getSheetReader(workbook: QuerySnapshot<SpreadsheetWorkbook>, sheetId: string): SpreadsheetSheetReadApi {
  const snapshot = copyQuerySnapshot(workbook);
  return createSpreadsheetSheetReader(() => snapshot, sheetId);
}
