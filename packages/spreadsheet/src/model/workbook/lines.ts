import type { SpreadsheetLinePoints, SpreadsheetShapeDrawing, SpreadsheetWorkbook } from "../types";
import { getSpreadsheetLinePoints, isSpreadsheetLine, withLinePoints } from "../lines";
import { updateDrawing } from "./annotations";
import { getWorkbookSheet } from "./snapshot";

/** Change the two endpoints atomically; omitted bindings detach those endpoints. */
export function updateLineEndpoints(workbook: SpreadsheetWorkbook, sheetId: string, drawingId: string, points: Partial<SpreadsheetLinePoints> & Pick<SpreadsheetShapeDrawing, "startArrow" | "endArrow">): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), drawing = sheet.drawings?.find(item => item.id === drawingId);
  if (!drawing || !isSpreadsheetLine(drawing)) throw new Error("指定された線が見つかりません");
  const previous = getSpreadsheetLinePoints(sheet, drawingId);
  const next = withLinePoints(sheet, drawing, { start: points.start === undefined ? previous.start : points.start, end: points.end === undefined ? previous.end : points.end });
  return updateDrawing(workbook, sheetId, drawingId, { line: next.line, anchor: next.anchor, width: next.width, height: next.height, rotation: 0, flipX: false, flipY: false,
    ...(points.startArrow !== undefined ? { startArrow: points.startArrow } : {}), ...(points.endArrow !== undefined ? { endArrow: points.endArrow } : {}) });
}
