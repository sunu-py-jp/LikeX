import { createOfficeConnectorGeometry } from "../../ooxml";
import { spreadsheetDrawingOutline } from "../../model/lines";
import type { SpreadsheetDrawing } from "../../model/types";

/** Preserve native outlines and eight standard DrawingML connection sites. */
export function connectorTargetGeometry(drawing: SpreadsheetDrawing): string {
  // Both image tags use the same outline and ports. The old tag keeps legacy
  // contain semantics, while the new tag preserves stretch on a return import.
  const tag = drawing.type === "shape" ? drawing.shape : drawing.type === "image" && drawing.fit === "fill" ? "imageFill" : drawing.type;
  return createOfficeConnectorGeometry(tag, spreadsheetDrawingOutline(drawing),
    drawing.type === "shape" && drawing.shape === "roundedRectangle" ? { cornerRadiusRatio: drawing.cornerRadiusRatio } : undefined);
}
