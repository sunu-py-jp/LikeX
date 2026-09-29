import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { normalizeDrawingPastePayload } from "../model/editing/copy-drawing";
import type { SpreadsheetWorkbook } from "../model/types";
import { addDrawing, insertImage } from "../model/workbook/annotations";
import type { SpreadsheetCommand } from "./types";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import { commandKeys, commandRecord, requireCommandFeature } from "./validation";
import { anchorPoint, sheetDrawingGeometry, withLinePoints } from "../model/lines";

export function applyDrawingPasteCommand(workbook: SpreadsheetWorkbook, command: Extract<SpreadsheetCommand, { type: "drawings.paste" }>,
  features: SpreadsheetFeatureSettings, nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandBaseReceipt } {
  requireCommandFeature(features, "paste");
  const { drawing, resource, linePoints } = normalizeDrawingPastePayload(command.payload);
  requireCommandFeature(features, drawing.type === "image" ? "images" : drawing.type === "shape" ? "shapes" : "textBoxes");
  if (command.anchor !== undefined) commandKeys(commandRecord(command.anchor, "描画位置"), ["row", "column", "offsetX", "offsetY"], "描画位置");
  const anchor = command.anchor ? { row: command.anchor.row, column: command.anchor.column,
    offsetX: command.anchor.offsetX ?? 0, offsetY: command.anchor.offsetY ?? 0 }
    : { ...drawing.anchor, offsetX: Math.min(10_000, drawing.anchor.offsetX + 16), offsetY: Math.min(10_000, drawing.anchor.offsetY + 16) };
  const drawingId = nextId();
  if (drawing.type === "image") {
    const current = workbook.resources?.images?.[drawing.resourceId];
    const shared = current && current.dataUrl === resource!.dataUrl && current.name === resource!.name && current.mimeType === resource!.mimeType &&
      current.width === resource!.width && current.height === resource!.height;
    const resourceId = shared ? drawing.resourceId : nextId();
    const copy = { ...drawing, id: drawingId, resourceId, anchor };
    return { workbook: shared ? addDrawing(workbook, command.sheetId, copy)
      : insertImage(workbook, command.sheetId, resourceId, resource!, copy),
    receipt: { type: command.type, sheetId: command.sheetId, drawingId, resourceId } };
  }
  let copy = { ...drawing, id: drawingId, anchor };
  if (drawing.type === "shape" && drawing.line) {
    const sheet = workbook.sheets.find(item => item.id === command.sheetId)!;
    const grid = sheetDrawingGeometry(sheet), from = anchorPoint(drawing.anchor, grid), to = anchorPoint(anchor, grid);
    const shift = (endpoint: typeof drawing.line.start) => { const point = anchorPoint(endpoint.anchor, grid); return { x: point.x + to.x - from.x, y: point.y + to.y - from.y }; };
    copy = withLinePoints(sheet, { ...drawing, id: drawingId }, linePoints ? {
      start: { x: to.x + linePoints.start.x, y: to.y + linePoints.start.y }, end: { x: to.x + linePoints.end.x, y: to.y + linePoints.end.y },
    } : { start: shift(drawing.line.start), end: shift(drawing.line.end) });
  }
  return { workbook: addDrawing(workbook, command.sheetId, copy),
    receipt: { type: command.type, sheetId: command.sheetId, drawingId } };
}
