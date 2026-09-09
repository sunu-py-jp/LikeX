import type { SpreadsheetDrawing, SpreadsheetDrawingPatch } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

/** Shared geometry/property editors dispatch through the drawing's explicit command family. */
export function updateDrawingFromUI(c: SpreadsheetController, sheetId: string, drawing: SpreadsheetDrawing, patch: SpreadsheetDrawingPatch): boolean {
  const target = { sheetId, drawingId: drawing.id, patch };
  if (drawing.type === "image") return c.executeCommand({ type: "images.update", ...target }).ok;
  if (drawing.type === "shape") return c.executeCommand({ type: "shapes.update", ...target }).ok;
  return c.executeCommand({ type: "textBoxes.update", ...target }).ok;
}
