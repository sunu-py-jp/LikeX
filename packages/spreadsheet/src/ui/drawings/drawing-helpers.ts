import type { SpreadsheetDrawing } from "../../model";
import { getShapeDefinition } from "../../model/shapes";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

/** Shapes use a fixed light fill by default; keep their labels readable in dark UI themes. */
export const DEFAULT_SHAPE_TEXT_COLOR = "#1f2937";
export function drawingTextColor(drawing: Exclude<SpreadsheetDrawing, { type: "image" }>): string {
  return drawing.color ?? (drawing.type === "shape" ? DEFAULT_SHAPE_TEXT_COLOR : "currentColor");
}

export function visibleDrawing(drawing: SpreadsheetDrawing, c: SpreadsheetController) {
  return drawing.type === "image" ? c.features.images : drawing.type === "shape" ? c.features.shapes : c.features.textBoxes;
}
export function drawingLabel(drawing: SpreadsheetDrawing) {
  return drawing.type === "image" ? drawing.alt || "画像" : drawing.type === "text" ? `テキストボックス${drawing.text ? `: ${drawing.text.slice(0, 40)}` : ""}`
    : getShapeDefinition(drawing.shape).label;
}
