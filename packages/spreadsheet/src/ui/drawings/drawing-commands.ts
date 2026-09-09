import { chainResult, type MaybePromise } from "../../core";
import type { SpreadsheetDrawing, SpreadsheetDrawingPatch } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { resizeImageDimensions } from "../../state/drawing-geometry";

/** Shared geometry/property editors dispatch through the drawing's explicit command family. */
export function updateDrawingFromUI(c: SpreadsheetController, sheetId: string, drawing: SpreadsheetDrawing, patch: SpreadsheetDrawingPatch): MaybePromise<boolean> {
  if (drawing.type === "image" && (patch.width !== undefined) !== (patch.height !== undefined))
    patch = { ...patch, ...resizeImageDimensions(drawing, patch) };
  const target = { sheetId, drawingId: drawing.id, patch };
  if (drawing.type === "image") return chainResult(c.executeCommand({ type: "images.update", ...target }), result => result.ok);
  if (drawing.type === "shape") return chainResult(c.executeCommand({ type: "shapes.update", ...target }), result => result.ok);
  return chainResult(c.executeCommand({ type: "textBoxes.update", ...target }), result => result.ok);
}
