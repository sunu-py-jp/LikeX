import { createWorkbook, getDrawingBounds, getDrawingPlacement, type SpreadsheetDrawingBounds,
  type SpreadsheetDrawingPlacement, type SpreadsheetDrawingPlacementOptions, type SpreadsheetWorkbookSnapshot } from "../src/model-entry";

const workbook: SpreadsheetWorkbookSnapshot = createWorkbook();
const options: SpreadsheetDrawingPlacementOptions = { gap: 12 };
const bounds: SpreadsheetDrawingBounds = getDrawingBounds(workbook, "sheet-1", "drawing-1");
const placement: SpreadsheetDrawingPlacement = getDrawingPlacement(workbook, "sheet-1", "drawing-1", options);
const row: number = placement.nextRow;
const column: number = placement.nextColumn;
void row; void column;
// @ts-expect-error geometry results are immutable
bounds.top = 0;
// @ts-expect-error nested placement geometry is immutable
placement.bounds.bottom = 0;
// @ts-expect-error candidates are immutable
placement.nextRow = 1;
// @ts-expect-error gap is a number of CSS pixels
getDrawingPlacement(workbook, "sheet-1", "drawing-1", { gap: "12px" });
// @ts-expect-error unsupported option names cannot silently change geometry
getDrawingPlacement(workbook, "sheet-1", "drawing-1", { padding: 12 });
