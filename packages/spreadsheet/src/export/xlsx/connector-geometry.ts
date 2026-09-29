import { createOfficeConnectorGeometry } from "../../ooxml";
import { spreadsheetDrawingOutline } from "../../model/lines";
import type { SpreadsheetDrawing } from "../../model/types";

/** Preserve native outlines and eight standard DrawingML connection sites. */
export function connectorTargetGeometry(drawing: SpreadsheetDrawing): string {
  return createOfficeConnectorGeometry(drawing.type === "shape" ? drawing.shape : drawing.type, spreadsheetDrawingOutline(drawing));
}
