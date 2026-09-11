import { parseCellAddress } from "../../model/address";
import { effectiveCellFormat, formatCellValue } from "../../model/formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetCellFormat, SpreadsheetSheet } from "../../model/types";

export type TextMeasurer = (text: string, format?: SpreadsheetCellFormat) => number;
export const estimateTextWidth: TextMeasurer = (text, format) => Array.from(text).reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.58) * (format?.fontSize ?? 13), 0);
export function createTextMeasurer(ownerDocument?: Document): TextMeasurer {
  const context = ownerDocument?.createElement("canvas").getContext("2d");
  if (!context) return estimateTextWidth;
  return (text, format) => { context.font = `${format?.italic ? "italic " : ""}${format?.bold ? "bold " : ""}${format?.fontSize ?? 13}px ${format?.fontFamily ?? 'Arial, sans-serif'}`; return context.measureText(text).width; };
}
const clamp = (value: number, minimum: number) => Math.min(1000, Math.max(minimum, Math.ceil(value)));
export function autoFitColumnWidth(sheet: SpreadsheetSheet, column: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure = estimateTextWidth) {
  let width = 24;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || position.column !== column) continue;
    if (sheet.merges?.some(range => position.row >= range.top && position.row <= range.bottom && column >= range.left && column <= range.right && range.right > range.left)) continue;
    const format = effectiveCellFormat(cell);
    for (const line of formatCellValue(values[address] ?? cell.value, format).split("\n")) width = Math.max(width, measure(line, format) + 16 + (cell.validation?.type === "list" ? 24 : 0));
  }
  return clamp(width, 24);
}
export function autoFitRowHeight(sheet: SpreadsheetSheet, row: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure = estimateTextWidth) {
  let height = 28;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || position.row !== row) continue;
    const merge = sheet.merges?.find(range => row >= range.top && row <= range.bottom && position.column >= range.left && position.column <= range.right);
    if (merge && merge.bottom > merge.top) continue;
    const format = effectiveCellFormat(cell); let width = 0;
    for (let column = merge?.left ?? position.column; column <= (merge?.right ?? position.column); column++) width += sheet.columnWidths?.[column] ?? 100;
    width = Math.max(1, width - 16 - (cell.validation?.type === "list" ? 24 : 0));
    let lines = 0;
    for (const line of formatCellValue(values[address] ?? cell.value, format).split("\n")) {
      if (!format?.wrap || !line) { lines++; continue; }
      let current = 0; lines++;
      for (const character of Array.from(line)) { const w = measure(character, format); if (current && current + w > width) { lines++; current = 0; } current += w; }
    }
    height = Math.max(height, lines * (format?.fontSize ?? 13) * 1.4 + 6);
  }
  return clamp(height, 16);
}

/** Batch fitting groups sparse cells once instead of rescanning the whole sheet per selected row. */
export function autoFitDimensions(sheet: SpreadsheetSheet, axis: "row" | "column", indices: ReadonlySet<number>, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure = estimateTextWidth): ReadonlyMap<number, number> {
  const groups = new Map<number, Record<string, SpreadsheetSheet["cells"][string]>>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || !indices.has(position[axis])) continue;
    const index = position[axis]; let group = groups.get(index); if (!group) { group = {}; groups.set(index, group); } group[address] = cell;
  }
  const result = new Map<number, number>();
  for (const index of indices) { const subset = { ...sheet, cells: groups.get(index) ?? {} }; result.set(index, axis === "row" ? autoFitRowHeight(subset, index, values, measure) : autoFitColumnWidth(subset, index, values, measure)); }
  return result;
}
