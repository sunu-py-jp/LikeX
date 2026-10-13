import type { SpreadsheetDrawing, SpreadsheetSheet } from "../../model/types";
import { getSpreadsheetLineRoute, isSpreadsheetLine, spreadsheetLineRouteMidpoint } from "../../model/lines";
import { drawingRectangle, type DrawingGeometry } from "../../state/drawing-geometry";

/** Logical grid pixels, including the row/column header offsets. */
export type DrawingViewport = { left: number; top: number; width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type LineGrid = { columns: readonly number[]; rows: readonly number[] };

function rotatedBounds(drawing: SpreadsheetDrawing, geometry: DrawingGeometry): Bounds {
  const box = drawingRectangle(drawing, geometry), angle = (drawing.rotation ?? 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const text = drawing.type !== "image" && !!drawing.text;
  // Unclipped text can reach the viewport from beyond its frame. Do not guess
  // font metrics here or mount hidden editors just to measure them.
  const halfWidth = text && drawing.textOverflow === "overflow" ? Infinity : box.width / 2;
  const halfHeight = text && (drawing.textVerticalOverflow === "overflow" || drawing.textAutoFit === "resize") ? Infinity : box.height / 2;
  const product = (extent: number, coefficient: number) => coefficient < 1e-10 ? 0 : extent * coefficient;
  const width = product(halfWidth, cos) + product(halfHeight, sin);
  const height = product(halfWidth, sin) + product(halfHeight, cos);
  const stroke = drawing.type === "shape" ? drawing.strokeWidth : 0;
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  return { left: x - width - stroke, right: x + width + stroke, top: y - height - stroke, bottom: y + height + stroke };
}

/** Route against the entire sheet: offscreen targets still position connectors.
 * Endpoint frames alone miss lines crossing the viewport and automatic elbows. */
export function drawingViewportBounds(drawing: SpreadsheetDrawing, sheet: SpreadsheetSheet, geometry: DrawingGeometry, grid: LineGrid): Bounds {
  if (!isSpreadsheetLine(drawing)) return rotatedBounds(drawing, geometry);
  const route = getSpreadsheetLineRoute(sheet, drawing.id, grid);
  const xs = route.points.map(point => point.x + geometry.columnOffsets[0]);
  const ys = route.points.map(point => point.y + geometry.rowOffsets[0]);
  const margin = Math.max(6, drawing.strokeWidth * 6);
  const bounds = { left: Math.min(...xs) - margin, right: Math.max(...xs) + margin,
    top: Math.min(...ys) - margin, bottom: Math.max(...ys) + margin };
  if (drawing.text) {
    // SVG line labels have no horizontal clip. Preserve labels that can extend
    // into view even when the line itself is just outside the viewport.
    const y = spreadsheetLineRouteMidpoint(route.points).y + geometry.rowOffsets[0];
    bounds.left = -Infinity; bounds.right = Infinity;
    bounds.top = Math.min(bounds.top, y - (drawing.fontSize ?? 16) * 2);
    bounds.bottom = Math.max(bounds.bottom, y + (drawing.fontSize ?? 16) * 2);
  }
  return bounds;
}

/** A conservative paint test; never changes stored objects or their z-order. */
export function drawingBoundsIntersectViewport(bounds: Bounds, viewport: DrawingViewport, overscan = 200): boolean {
  return bounds.right >= viewport.left - overscan && bounds.left <= viewport.left + viewport.width + overscan &&
    bounds.bottom >= viewport.top - overscan && bounds.top <= viewport.top + viewport.height + overscan;
}
