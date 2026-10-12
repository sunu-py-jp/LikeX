import type { CSSProperties } from "react";
import type { SpreadsheetDrawing } from "../../model/types";
import { drawingTextColor } from "./drawing-helpers";

type TextDrawing = Exclude<SpreadsheetDrawing, { type: "image" }>;
export function drawingTextStyle(drawing: TextDrawing): CSSProperties {
  const insets = drawing.textInsets ?? { left: 8, top: 8, right: 8, bottom: 8 };
  const horizontal = drawing.textOverflow ?? "clip", vertical = drawing.textVerticalOverflow ?? "clip";
  const resizing = drawing.textAutoFit === "resize";
  return { fontSize: (drawing.fontSize ?? 16) * (drawing.textFontScale ?? 1), fontFamily: drawing.fontFamily,
    color: drawingTextColor(drawing), fontWeight: drawing.bold ? 700 : 400, fontStyle: drawing.italic ? "italic" : "normal",
    textDecoration: drawing.underline ? "underline" : "none", lineHeight: drawing.textLineHeight ?? 1.4,
    background: drawing.type === "text" ? drawing.background : undefined,
    padding: `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`,
    whiteSpace: drawing.textWrap === "none" ? "pre" : "pre-wrap", overflowWrap: drawing.textWrap === "none" ? "normal" : "anywhere",
    textAlign: drawing.textAlign ?? (drawing.type === "shape" ? "center" : "left"),
    justifyContent: ({ top: "flex-start", middle: "center", bottom: "flex-end" } as const)[drawing.textVerticalAlign ?? (drawing.type === "shape" ? "middle" : "top")],
    overflow: "visible", clipPath: horizontal === "overflow" && (vertical === "overflow" || resizing) ? "none"
      : `inset(${vertical === "overflow" || resizing ? "-100000px" : "0px"} ${horizontal === "overflow" ? "-100000px" : "0px"})` };
}
