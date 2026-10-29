import type { SpreadsheetDrawing, SpreadsheetSheet } from "../../model/types";
import { getSpreadsheetLineRoute, isSpreadsheetLine, spreadsheetLineRouteMidpoint } from "../../model/lines";
import { drawingRectangle, type DrawingGeometry } from "../../state/drawing-geometry";
import { shapeTextFrame } from "../../model/shapes";
import { rotateDrawingVector } from "../../model/drawing-transform";
import { getDrawingTextRotation } from "../../model/drawing-text";

/** Logical grid pixels, including the row/column header offsets. */
export type DrawingViewport = { left: number; top: number; width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type LineGrid = { columns: readonly number[]; rows: readonly number[] };

function rotatedBounds(drawing: SpreadsheetDrawing, geometry: DrawingGeometry): Bounds {
  const box = drawingRectangle(drawing, geometry);
  const text = drawing.type !== "image" && !!drawing.text;
  const frame = drawing.type === "shape" ? shapeTextFrame(drawing) : { left: 0, top: 0, width: box.width, height: box.height };
  // Unclipped text can reach the viewport from beyond its frame. Do not guess
  // font metrics here or mount hidden editors just to measure them.
  const halfWidth = text && drawing.textOverflow === "overflow" ? Infinity : frame.width / 2;
  const halfHeight = text && (drawing.textVerticalOverflow === "overflow" || drawing.textAutoFit === "resize") ? Infinity : frame.height / 2;
  const product = (extent: number, coefficient: number) => coefficient < 1e-10 ? 0 : extent * coefficient;
  const extent = (degrees: number, horizontal: number, vertical: number) => {
    const angle = degrees * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    return { width: product(horizontal, cos) + product(vertical, sin), height: product(horizontal, sin) + product(vertical, cos) };
  };
  const shape = extent(drawing.rotation ?? 0, box.width / 2, box.height / 2);
  const label = extent(text ? drawing.textUpright ? 0 : (drawing.rotation ?? 0) + (drawing.textRotation ?? 0) : drawing.rotation ?? 0, halfWidth, halfHeight);
  const offset = rotateDrawingVector({ x: frame.left + frame.width / 2 - box.width / 2, y: frame.top + frame.height / 2 - box.height / 2 }, drawing.rotation ?? 0);
  const stroke = drawing.type === "shape" ? drawing.strokeWidth : 0;
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  return { left: Math.min(x - shape.width, x + offset.x - label.width) - stroke,
    right: Math.max(x + shape.width, x + offset.x + label.width) + stroke,
    top: Math.min(y - shape.height, y + offset.y - label.height) - stroke,
    bottom: Math.max(y + shape.height, y + offset.y + label.height) + stroke };
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
    // SVG labels are unclipped, but not unbounded. Allow two em per UTF-16
    // unit (including wide glyphs and bold/italic overhang) and generous
    // ascent/descent around the baseline. These conservative, finite bounds
    // also work before fonts/DOM are available and are cached with the route.
    // Infinity here would mount every rotated label on every scroll position.
    const midpoint = spreadsheetLineRouteMidpoint(route.points);
    const x = midpoint.x + geometry.columnOffsets[0], y = midpoint.y + geometry.rowOffsets[0];
    const fontSize = drawing.fontSize ?? 16;
    const halfWidth = fontSize * (drawing.text.length + 1), halfHeight = fontSize * 2;
    const angle = getDrawingTextRotation(drawing) * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const width = halfWidth * cos + halfHeight * sin, height = halfWidth * sin + halfHeight * cos;
    bounds.left = Math.min(bounds.left, x - width); bounds.right = Math.max(bounds.right, x + width);
    bounds.top = Math.min(bounds.top, y - height); bounds.bottom = Math.max(bounds.bottom, y + height);
  }
  return bounds;
}

/** A conservative paint test; never changes stored objects or their z-order. */
export function drawingBoundsIntersectViewport(bounds: Bounds, viewport: DrawingViewport, overscan = 200): boolean {
  return bounds.right >= viewport.left - overscan && bounds.left <= viewport.left + viewport.width + overscan &&
    bounds.bottom >= viewport.top - overscan && bounds.top <= viewport.top + viewport.height + overscan;
}
