import type { CSSProperties } from "react";
import { isNegativeRed } from "../../model/formatting";
import type { SpreadsheetCellBorder } from "../../model/formatting";
import type { SpreadsheetCellFormat, SpreadsheetCalculatedValue, SpreadsheetMergedRange } from "../../model/types";

function borderCss(border: SpreadsheetCellBorder | undefined): string | undefined {
  return !border || border.style === "none" ? undefined : `${border.width ?? 1}px ${border.style ?? "solid"} ${border.color ?? "#808080"}`;
}

export function cellFormatStyle(format: SpreadsheetCellFormat | undefined, value: SpreadsheetCalculatedValue | undefined): CSSProperties {
  const style: CSSProperties = { fontWeight: format?.bold ? 700 : undefined, fontStyle: format?.italic ? "italic" : undefined,
    textDecoration: format?.underline ? "underline" : undefined, fontFamily: format?.fontFamily, fontSize: format?.fontSize,
    textAlign: format?.align ?? (typeof value === "number" ? "right" : "left"),
    color: isNegativeRed(value, format) ? "#dc2626" : format?.color, backgroundColor: format?.background,
    whiteSpace: format?.wrap ? "pre-wrap" : "pre", overflowWrap: format?.wrap ? "anywhere" : undefined,
    justifyContent: format?.verticalAlign === "top" ? "flex-start" : format?.verticalAlign === "bottom" ? "flex-end" : "center" };
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const border = borderCss(format?.borders?.[edge]); if (!border) continue;
    const key = `border${edge[0].toUpperCase()}${edge.slice(1)}` as "borderTop";
    style[key] = border;
  }
  return style;
}

/** Shared model edges are stored on both cells for Office round trips. Paint
 * matching top/left edges once, using the neighbour's bottom/right border.
 * A merge is only suppressed when every segment is already painted; partially
 * matching or absent neighbours must not remove the rest of its long edge. */
export function collapseSharedCellBorders(style: CSSProperties, range: SpreadsheetMergedRange,
  neighbourFormat: (row: number, column: number) => SpreadsheetCellFormat | undefined): CSSProperties {
  let result = style;
  const matches = (row: number, column: number, edge: "bottom" | "right", own: string | number) =>
    borderCss(neighbourFormat(row, column)?.borders?.[edge])?.toLowerCase() === String(own).toLowerCase();
  if (style.borderTop && range.top > 0) {
    let covered = true;
    for (let column = range.left; column <= range.right && covered; column++) covered = matches(range.top - 1, column, "bottom", style.borderTop);
    if (covered) result = { ...result, borderTop: 0 };
  }
  if (style.borderLeft && range.left > 0) {
    let covered = true;
    for (let row = range.top; row <= range.bottom && covered; row++) covered = matches(row, range.left - 1, "right", style.borderLeft);
    if (covered) result = { ...result, borderLeft: 0 };
  }
  return result;
}
