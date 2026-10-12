import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../model/sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawingAnchor, type SpreadsheetSheet } from "../model/types";
import { xlsxBaseColumnWidthToPixels, xlsxColumnWidthToPixels } from "../xlsx-column-width";
import { child, children, localName, textContent, type XmlNode } from "./xml";

export const EMU_PER_PIXEL = 9525;
export type DrawingFrame = { x: number; y: number; width: number; height: number };
export function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
export function drawingGrid(sheet: Pick<SpreadsheetSheet, "rowHeights" | "columnWidths">, defaults = { row: DEFAULT_ROW_HEIGHT, column: DEFAULT_COLUMN_WIDTH }) {
  const columns = [0], rows = [0];
  for (let i = 0; i < SPREADSHEET_LIMITS.columns; i++) columns.push(columns[i] + (sheet.columnWidths?.[i] ?? defaults.column));
  for (let i = 0; i < SPREADSHEET_LIMITS.rows; i++) rows.push(rows[i] + (sheet.rowHeights?.[i] ?? defaults.row));
  return { columns, rows };
}
type DrawingGrid = ReturnType<typeof drawingGrid>;
/** Retain the source dimensions for rebasing absolute DrawingML transforms after size normalization. */
export function worksheetDrawingGrid(node: XmlNode): DrawingGrid {
  const format = child(node, "sheetFormatPr"), storedWidth = finiteNumber(format?.attributes.defaultColWidth), baseWidth = finiteNumber(format?.attributes.baseColWidth);
  const sourceRowSize = (height: number) => height > 0 ? height / 0.75 : 1;
  const row = sourceRowSize(finiteNumber(format?.attributes.defaultRowHeight) ?? 15);
  const column = Math.max(1, storedWidth !== undefined ? xlsxColumnWidthToPixels(storedWidth) : baseWidth !== undefined ? xlsxBaseColumnWidthToPixels(baseWidth) : 64);
  const rowHeights: Record<number, number> = {}, columnWidths: Record<number, number> = {};
  let inferredRow = 0;
  for (const item of children(child(node, "sheetData"), "row")) {
    const index = item.attributes.r === undefined ? inferredRow : Number(item.attributes.r) - 1;
    inferredRow = index + 1;
    const height = finiteNumber(item.attributes.ht);
    if (index >= 0 && index < SPREADSHEET_LIMITS.rows && height !== undefined) rowHeights[index] = sourceRowSize(height);
  }
  for (const item of children(child(node, "cols"), "col")) {
    const width = finiteNumber(item.attributes.width);
    if (width === undefined) continue;
    for (let index = Math.max(0, Number(item.attributes.min) - 1); index < Math.min(SPREADSHEET_LIMITS.columns, Number(item.attributes.max)); index++)
      columnWidths[index] = Math.max(1, xlsxColumnWidthToPixels(width));
  }
  return drawingGrid({ rowHeights, columnWidths }, { row, column });
}
function marker(node: XmlNode | undefined, grid: DrawingGrid): { x: number; y: number } | undefined {
  const column = finiteNumber(textContent(child(node, "col"))), row = finiteNumber(textContent(child(node, "row")));
  const dx = finiteNumber(textContent(child(node, "colOff"))) ?? 0, dy = finiteNumber(textContent(child(node, "rowOff"))) ?? 0;
  if (column === undefined || row === undefined || !Number.isInteger(column) || !Number.isInteger(row) ||
    column < 0 || row < 0 || column > SPREADSHEET_LIMITS.columns || row > SPREADSHEET_LIMITS.rows) return;
  return { x: grid.columns[column] + dx / EMU_PER_PIXEL, y: grid.rows[row] + dy / EMU_PER_PIXEL };
}
/** Cell anchors and xfrm describe the same drawing in different coordinate systems. */
export function drawingAnchorTransform(node: XmlNode, source: DrawingGrid, target: DrawingGrid) {
  const unchanged = { point: (point: { x: number; y: number }) => point, scaleX: 1, scaleY: 1 };
  if (localName(node.name) === "absoluteAnchor") return unchanged;
  const from = marker(child(node, "from"), source), to = marker(child(node, "from"), target);
  if (!from || !to || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) return unchanged;
  const sourceEnd = localName(node.name) === "twoCellAnchor" ? marker(child(node, "to"), source) : undefined;
  const targetEnd = sourceEnd ? marker(child(node, "to"), target) : undefined;
  const scale = (axis: "x" | "y") => {
    const span = sourceEnd && sourceEnd[axis] - from[axis];
    const factor = span && targetEnd ? (targetEnd[axis] - to[axis]) / span : 1;
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
  };
  const sx = scale("x"), sy = scale("y");
  return { point: (point: { x: number; y: number }) => ({ x: to.x + (point.x - from.x) * sx, y: to.y + (point.y - from.y) * sy }), scaleX: sx, scaleY: sy };
}
export function transformDrawingFrame(frame: DrawingFrame, transform: ReturnType<typeof drawingAnchorTransform>, rotation = 0): { frame: DrawingFrame; approximated: boolean } {
  const center = transform.point({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
  const quarterTurns = rotation / 90, sinSquared = Number.isInteger(quarterTurns) ? Math.abs(quarterTurns % 2) : Math.sin(rotation * Math.PI / 180) ** 2;
  const cosSquared = 1 - sinSquared;
  // Project world-axis scaling onto the drawing's local axes. Quarter turns remain exact;
  // other rotations would also require shear, which the editable rectangle model cannot store.
  const width = frame.width * (transform.scaleX * cosSquared + transform.scaleY * sinSquared);
  const height = frame.height * (transform.scaleX * sinSquared + transform.scaleY * cosSquared);
  return { frame: { x: center.x - width / 2, y: center.y - height / 2, width, height },
    approximated: Math.abs(transform.scaleX - transform.scaleY) > 1e-9 && sinSquared > 1e-9 && cosSquared > 1e-9 };
}
export function readDrawingFrame(node: XmlNode, grid: DrawingGrid): DrawingFrame | undefined {
  const kind = localName(node.name), position = child(node, "pos"), extent = child(node, "ext");
  const start = kind === "absoluteAnchor" ? { x: (finiteNumber(position?.attributes.x) ?? NaN) / EMU_PER_PIXEL,
    y: (finiteNumber(position?.attributes.y) ?? NaN) / EMU_PER_PIXEL } : marker(child(node, "from"), grid);
  if (!start) return;
  const end = kind === "twoCellAnchor" ? marker(child(node, "to"), grid) : undefined;
  const width = end ? end.x - start.x : (finiteNumber(extent?.attributes.cx) ?? NaN) / EMU_PER_PIXEL;
  const height = end ? end.y - start.y : (finiteNumber(extent?.attributes.cy) ?? NaN) / EMU_PER_PIXEL;
  if (![start.x, start.y, width, height].every(Number.isFinite) || start.x < 0 || start.y < 0 || width <= 0 || height <= 0 || width > 10_000 || height > 10_000) return;
  return { ...start, width, height };
}
/** Rotated two-cell anchors can describe an AABB; xfrm retains the unrotated frame. */
export function readTransformFrame(node: XmlNode | undefined): DrawingFrame | undefined {
  const offset = child(node, "off"), extent = child(node, "ext");
  const x = (finiteNumber(offset?.attributes.x) ?? NaN) / EMU_PER_PIXEL, y = (finiteNumber(offset?.attributes.y) ?? NaN) / EMU_PER_PIXEL;
  const width = (finiteNumber(extent?.attributes.cx) ?? NaN) / EMU_PER_PIXEL, height = (finiteNumber(extent?.attributes.cy) ?? NaN) / EMU_PER_PIXEL;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || width > 10_000 || height > 10_000) return;
  return { x, y, width, height };
}
function locate(value: number, offsets: readonly number[]): { index: number; offset: number } | undefined {
  if (value < 0 || value >= offsets.at(-1)!) return;
  let low = 0, high = offsets.length - 2;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (offsets[middle] <= value) low = middle; else high = middle - 1; }
  return { index: low, offset: value - offsets[low] };
}
export function anchorFromFrame(frame: DrawingFrame, grid: DrawingGrid): SpreadsheetDrawingAnchor | undefined {
  const column = locate(frame.x, grid.columns), row = locate(frame.y, grid.rows);
  if (!column || !row) return;
  return { row: row.index, column: column.index, offsetX: column.offset, offsetY: row.offset };
}
