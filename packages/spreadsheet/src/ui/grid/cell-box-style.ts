import type { CSSProperties } from "react";

/** A CSS border box cannot be smaller than its padding and borders. Keep tiny
 * imported columns/rows at their actual size instead of shifting later cells. */
export function fitCellBoxStyle(style: CSSProperties, width: number, height: number): CSSProperties {
  const border = (value: CSSProperties["borderTop"], fallback: number) => value === undefined ? fallback : Number.parseFloat(String(value)) || 0;
  const left = border(style.borderLeft, 0), right = border(style.borderRight, 1);
  const top = border(style.borderTop, 0), bottom = border(style.borderBottom, 1);
  const result = { ...style };
  let horizontalBorders = left + right;
  if (horizontalBorders > width) {
    const end = Math.min(right, Math.floor(width)), start = Math.min(left, Math.floor(width - end));
    result.borderRightWidth = end; result.borderLeftWidth = start;
    horizontalBorders = start + end;
  }
  if (top + bottom > height) {
    const end = Math.min(bottom, Math.floor(height)), start = Math.min(top, Math.floor(height - end));
    result.borderBottomWidth = end; result.borderTopWidth = start;
  }
  if (width < horizontalBorders + 4) result.paddingLeft = result.paddingRight = Math.max(0, (width - horizontalBorders) / 2);
  return result;
}
