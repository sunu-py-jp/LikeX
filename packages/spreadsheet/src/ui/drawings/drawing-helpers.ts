import type { SpreadsheetDrawing } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";

export function visibleDrawing(drawing: SpreadsheetDrawing, c: SpreadsheetController) {
  return drawing.type === "image" ? c.features.images : drawing.type === "shape" ? c.features.shapes : c.features.textBoxes;
}
export function drawingLabel(drawing: SpreadsheetDrawing) {
  return drawing.type === "image" ? drawing.alt || "画像" : drawing.type === "text" ? `テキストボックス${drawing.text ? `: ${drawing.text.slice(0, 40)}` : ""}`
    : ({ rectangle: "四角形", ellipse: "楕円", line: "直線", arrow: "矢印" } as const)[drawing.shape];
}
