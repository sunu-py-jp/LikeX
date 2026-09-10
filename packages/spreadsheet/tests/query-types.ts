import { getCell, getCellComment, getDrawing, getImage, getImageResource, getRange, getShape, getSheet, getTextBox,
  type SpreadsheetReadRangeInput, type SpreadsheetReadRange } from "../src/model/query";
import { createSpreadsheetReader, type SpreadsheetReadApi } from "../src/model/query-reader";
import { createWorkbook } from "../src/model/workbook";
import type { SpreadsheetWorkbookSnapshot } from "../src/commands/types";

const workbook: SpreadsheetWorkbookSnapshot = createWorkbook();
const reader: SpreadsheetReadApi = createSpreadsheetReader(() => workbook);
const rangeInput: SpreadsheetReadRangeInput = "A1:C5";
const range: SpreadsheetReadRange = getRange(workbook, "sheet-1", rangeInput);
getRange(workbook, "sheet-1", { top: 0, left: 0, bottom: 2, right: 2 });
reader.getRange("sheet-1", rangeInput);
const cell = getCell(workbook, "sheet-1", "A1");
if (cell) {
  const value: string = cell.value;
  void value;
  // @ts-expect-error query cell data cannot be modified
  cell.value = "changed";
  if (cell.validation?.type === "list") {
    // @ts-expect-error nested arrays cannot be changed
    cell.validation.values.push("changed");
  }
}
const drawing = getDrawing(workbook, "sheet-1", "drawing-1");
if (drawing?.type === "image") { const resourceId: string = drawing.resourceId; void resourceId; }
const image = getImage(workbook, "sheet-1", "image-1");
if (image) { const type: "image" = image.type; void type; }
const shape = getShape(workbook, "sheet-1", "shape-1");
if (shape) { const type: "shape" = shape.type; void type; }
const text = getTextBox(workbook, "sheet-1", "text-1");
if (text) { const type: "text" = text.type; void type; }
getImageResource(workbook, "resource-1");
getCellComment(workbook, "sheet-1", "A1");
const sheet = getSheet(workbook, "sheet-1");
// @ts-expect-error sheet cells are deeply readonly
sheet.cells.A1.value = "changed";
// @ts-expect-error ranges are deeply readonly
range[0].push(null);
// @ts-expect-error no cross-sheet range object syntax
getRange(workbook, "sheet-1", { sheetId: "other", top: 0, left: 0, bottom: 2, right: 2 });
// @ts-expect-error raw values remain strings, not implicitly calculated numbers
const value: number = getCell(workbook, "sheet-1", "A1")!.value;
void value;
