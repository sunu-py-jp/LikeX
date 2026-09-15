import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../model/sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawingAnchor, type SpreadsheetSheet } from "../model/types";
import { child, localName, textContent, type XmlNode } from "./xml";

export const EMU_PER_PIXEL = 9525;
export type DrawingFrame = { x: number; y: number; width: number; height: number };
export function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
export function drawingGrid(sheet: SpreadsheetSheet, defaults = { row: DEFAULT_ROW_HEIGHT, column: DEFAULT_COLUMN_WIDTH }) {
  const columns = [0], rows = [0];
  for (let i = 0; i < SPREADSHEET_LIMITS.columns; i++) columns.push(columns[i] + (sheet.columnWidths?.[i] ?? defaults.column));
  for (let i = 0; i < SPREADSHEET_LIMITS.rows; i++) rows.push(rows[i] + (sheet.rowHeights?.[i] ?? defaults.row));
  return { columns, rows };
}
type DrawingGrid = ReturnType<typeof drawingGrid>;
function marker(node: XmlNode | undefined, grid: DrawingGrid): { x: number; y: number } | undefined {
  const column = finiteNumber(textContent(child(node, "col"))), row = finiteNumber(textContent(child(node, "row")));
  const dx = finiteNumber(textContent(child(node, "colOff"))) ?? 0, dy = finiteNumber(textContent(child(node, "rowOff"))) ?? 0;
  if (column === undefined || row === undefined || !Number.isInteger(column) || !Number.isInteger(row) ||
    column < 0 || row < 0 || column > SPREADSHEET_LIMITS.columns || row > SPREADSHEET_LIMITS.rows) return;
  return { x: grid.columns[column] + dx / EMU_PER_PIXEL, y: grid.rows[row] + dy / EMU_PER_PIXEL };
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
