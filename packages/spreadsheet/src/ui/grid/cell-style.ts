import type { CSSProperties } from "react";
import { isNegativeRed } from "../../model/formatting";
import type { SpreadsheetCellFormat, SpreadsheetCalculatedValue } from "../../model/types";
export function cellFormatStyle(format: SpreadsheetCellFormat | undefined, value: SpreadsheetCalculatedValue | undefined): CSSProperties {
  const style: CSSProperties = { fontWeight: format?.bold ? 700 : undefined, fontStyle: format?.italic ? "italic" : undefined,
    textDecoration: format?.underline ? "underline" : undefined, fontFamily: format?.fontFamily, fontSize: format?.fontSize,
    textAlign: format?.align ?? (typeof value === "number" ? "right" : "left"),
    color: isNegativeRed(value, format) ? "#dc2626" : format?.color, backgroundColor: format?.background,
    whiteSpace: format?.wrap ? "pre-wrap" : "pre", overflowWrap: format?.wrap ? "anywhere" : undefined,
    justifyContent: format?.verticalAlign === "top" ? "flex-start" : format?.verticalAlign === "bottom" ? "flex-end" : "center" };
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const border = format?.borders?.[edge]; if (!border || border.style === "none") continue;
    const key = `border${edge[0].toUpperCase()}${edge.slice(1)}` as "borderTop";
    style[key] = `${border.width ?? 1}px ${border.style ?? "solid"} ${border.color ?? "#808080"}`;
  }
  return style;
}
