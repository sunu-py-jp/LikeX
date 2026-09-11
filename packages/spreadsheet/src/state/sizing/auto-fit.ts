import { parseCellAddress } from "../../model/address";
import { effectiveCellFormat, formatCellValue } from "../../model/formatting";
import { createConditionalFormatter } from "../../model/conditional-formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetCellFormat, SpreadsheetSheet } from "../../model/types";
import { DEFAULT_CELL_MEASUREMENT, estimateTextWidth, type TextMeasurer } from "./text-measurer";
export { createTextMeasurer, estimateTextWidth, type TextMeasurer } from "./text-measurer";

const borderWidth = (format: SpreadsheetCellFormat | undefined, edge: "left" | "right" | "top" | "bottom", fallback: number) => {
  const border = format?.borders?.[edge];
  return border && border.style !== "none" ? border.width ?? 1 : fallback;
};
function horizontalInset(format: SpreadsheetCellFormat | undefined, measure: TextMeasurer, list: boolean) {
  const style = measure.cellStyle ?? DEFAULT_CELL_MEASUREMENT;
  // One spare logical pixel protects against fractional glyph/border rounding.
  return style.paddingX + borderWidth(format, "left", style.borderLeft) + borderWidth(format, "right", style.borderRight) + 1 + (list ? style.listWidth : 0);
}
const clamp = (value: number, minimum: number) => Math.min(1000, Math.max(minimum, Math.ceil(value)));
type ConditionalFormatter = ReturnType<typeof createConditionalFormatter>;
function fitColumn(sheet: SpreadsheetSheet, column: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure: TextMeasurer, conditional: ConditionalFormatter) {
  let width = 24;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || position.column !== column) continue;
    const merge = sheet.merges?.find(range => position.row >= range.top && position.row <= range.bottom && column >= range.left && column <= range.right);
    if (merge && (merge.right > merge.left || position.row !== merge.top)) continue;
    if (cell.validation?.type === "checkbox") {
      // The host may hide validation controls, revealing TRUE/FALSE text.
      // Reserve enough room for both presentations without coupling sizing to feature flags.
      width = Math.max(width, (measure.cellStyle ?? DEFAULT_CELL_MEASUREMENT).checkboxWidth + 8);
    }
    const value = values[address] ?? cell.value, format = conditional(position.row, column, value, effectiveCellFormat(cell)).format;
    const inset = horizontalInset(format, measure, cell.validation?.type === "list");
    for (const line of formatCellValue(value, format).split(/\r\n?|\n/)) width = Math.max(width, measure(line, format) + inset);
    if (width >= 1000) return 1000;
  }
  return clamp(width, 24);
}

function wrappedLineCount(text: string, width: number, format: SpreadsheetCellFormat | undefined, measure: TextMeasurer, limit: number) {
  if (!text || measure(text, format) <= width) return 1;
  // Keep ordinary words together, while allowing CJK and oversized words to
  // break as the grid's pre-wrap / overflow-wrap:anywhere text does.
  const parts = text.match(/\s+|[^\s\u2e80-\u9fff\uf900-\ufaff]+|[\u2e80-\u9fff\uf900-\ufaff]/gu) ?? [];
  let lines = 1, current = "";
  for (const part of parts) {
    if (measure(current + part, format) <= width) { current += part; continue; }
    if (current && !/^\s+$/.test(part) && measure(part, format) <= width) { lines++; current = part; }
    else for (const character of Array.from(part)) {
      if (current && measure(current + character, format) > width) { lines++; current = ""; }
      current += character;
      if (lines >= limit) return lines;
    }
    if (lines >= limit) return lines;
  }
  return lines;
}
function fitRow(sheet: SpreadsheetSheet, row: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure: TextMeasurer, conditional: ConditionalFormatter) {
  let height = 28;
  const style = measure.cellStyle ?? DEFAULT_CELL_MEASUREMENT;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || position.row !== row) continue;
    const merge = sheet.merges?.find(range => row >= range.top && row <= range.bottom && position.column >= range.left && position.column <= range.right);
    if (merge && (merge.bottom > merge.top || position.column !== merge.left)) continue;
    if (cell.validation?.type === "checkbox") height = Math.max(height, style.checkboxHeight + 8);
    const value = values[address] ?? cell.value, format = conditional(row, position.column, value, effectiveCellFormat(cell)).format;
    let width = 0;
    for (let column = merge?.left ?? position.column; column <= (merge?.right ?? position.column); column++) width += sheet.columnWidths?.[column] ?? 100;
    width = Math.max(1, width - horizontalInset(format, measure, cell.validation?.type === "list"));
    const lineHeight = (format?.fontSize ?? style.fontSize) * style.lineHeight;
    let lines = 0;
    for (const line of formatCellValue(value, format).split(/\r\n?|\n/)) {
      lines += format?.wrap ? wrappedLineCount(line, width, format, measure, Math.ceil(1000 / lineHeight)) : 1;
      if (lines * lineHeight >= 1000) return 1000;
    }
    height = Math.max(height, lines * lineHeight + style.paddingY + borderWidth(format, "top", style.borderTop) + borderWidth(format, "bottom", style.borderBottom) + 5);
  }
  return clamp(height, 16);
}

export function autoFitColumnWidth(sheet: SpreadsheetSheet, column: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure: TextMeasurer = estimateTextWidth) {
  return fitColumn(sheet, column, values, measure, createConditionalFormatter(sheet, values));
}
export function autoFitRowHeight(sheet: SpreadsheetSheet, row: number, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure: TextMeasurer = estimateTextWidth) {
  return fitRow(sheet, row, values, measure, createConditionalFormatter(sheet, values));
}

/** Batch fitting groups sparse cells once instead of rescanning the whole sheet per selected row. */
export function autoFitDimensions(sheet: SpreadsheetSheet, axis: "row" | "column", indices: ReadonlySet<number>, values: Readonly<Record<string, SpreadsheetCalculatedValue>>, measure: TextMeasurer = estimateTextWidth): ReadonlyMap<number, number> {
  const groups = new Map<number, Record<string, SpreadsheetSheet["cells"][string]>>();
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const position = parseCellAddress(address); if (!position || !indices.has(position[axis])) continue;
    const index = position[axis]; let group = groups.get(index); if (!group) { group = {}; groups.set(index, group); } group[address] = cell;
  }
  const result = new Map<number, number>();
  const conditional = createConditionalFormatter(sheet, values);
  for (const index of indices) { const subset = { ...sheet, cells: groups.get(index) ?? {} }; result.set(index, axis === "row" ? fitRow(subset, index, values, measure, conditional) : fitColumn(subset, index, values, measure, conditional)); }
  return result;
}
