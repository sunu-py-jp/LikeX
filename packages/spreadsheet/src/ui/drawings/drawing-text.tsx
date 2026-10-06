import type { SpreadsheetDrawing } from "../../model/types";
import { shapeTextFrame } from "../../model/shapes";
import { drawingTextColor } from "./drawing-helpers";

/** Shared non-interactive text content for the editor and compact previews. */
export function DrawingText({ drawing, placeholder = true }: { drawing: Exclude<SpreadsheetDrawing, { type: "image" }>; placeholder?: boolean }) {
  return <div className={drawing.type === "shape" ? "lxs-shape-text" : "lxs-text-box"}
    style={{ fontSize: drawing.fontSize ?? 16, color: drawingTextColor(drawing),
      background: drawing.type === "text" ? drawing.background : undefined, fontWeight: drawing.bold ? 700 : 400,
      ...(drawing.type === "shape" ? { ...shapeTextFrame(drawing), right: "auto", bottom: "auto" } : {}) }}>
    <span>{drawing.text || (placeholder && drawing.type === "text" ? "テキストを入力" : "")}</span>
  </div>;
}
