import { normalizeWorkbook } from "../../model/workbook/normalize";
import { calculateNormalizedRange } from "../../model/calculated-range";
import { cellAddress } from "../../model/address";
import { effectiveCellFormat, formatCellValue } from "../../model/formatting";
import { createConditionalFormatter } from "../../model/conditional-formatting";
import { sheetDrawingGeometry, getSpreadsheetLineRoute, isSpreadsheetLine, spreadsheetLineRouteMidpoint } from "../../model/lines";
import { rotatedDrawingBounds } from "../../model/drawing-transform";
import type { SpreadsheetWorkbookSnapshot } from "../../commands/types";
import type { SpreadsheetMergedRange, SpreadsheetWorkbook } from "../../model/types";
import { cellFormatStyle, collapseSharedCellBorders } from "../grid/cell-style";

const MAX_ROWS = 20, MAX_COLUMNS = 10, MAX_DRAWINGS = 100, MAX_TEXT = 2_000;

/** Complete validation once; rendering and root formula evaluations stay inside A1:J20. */
export function prepareSpreadsheetThumbnail(input: SpreadsheetWorkbookSnapshot) {
  if (input === undefined) throw new Error("表示するブックを指定してください");
  const workbook = normalizeWorkbook(input as SpreadsheetWorkbook), sheet = workbook.sheets[0];
  const rowCount = Math.min(MAX_ROWS, sheet.rowCount), columnCount = Math.min(MAX_COLUMNS, sheet.columnCount);
  const range = { top: 0, left: 0, bottom: rowCount - 1, right: columnCount - 1 };
  const values = calculateNormalizedRange(workbook, sheet.id, range);
  // Only this sheet's geometry is needed, including off-screen endpoints of visible connectors.
  const grid = sheetDrawingGeometry(sheet), width = grid.columns[columnCount], height = grid.rows[rowCount];
  const conditionalFormats = sheet.conditionalFormats?.filter(rule => rule.type === "comparison" || rule.type === "text" ||
    (rule.min !== undefined && rule.max !== undefined) || rule.ranges.every(area => area.bottom < rowCount && area.right < columnCount));
  const conditional = createConditionalFormatter({ ...sheet, conditionalFormats }, values);
  const merges = new Map<number, SpreadsheetMergedRange>();
  for (const merge of sheet.merges ?? []) for (let row = merge.top; row <= Math.min(merge.bottom, rowCount - 1); row++)
    for (let column = merge.left; column <= Math.min(merge.right, columnCount - 1); column++) merges.set(row * columnCount + column, merge);
  const appearance = (row: number, column: number) => {
    const merge = merges.get(row * columnCount + column);
    const address = cellAddress(merge?.top ?? row, merge?.left ?? column);
    return conditional(row, column, values[address], effectiveCellFormat(sheet.cells[address]));
  };
  const cells = [];
  for (let row = 0; row < rowCount; row++) for (let column = 0; column < columnCount; column++) {
    const merge = merges.get(row * columnCount + column);
    if (merge && (merge.top !== row || merge.left !== column)) continue;
    const address = cellAddress(row, column), value = values[address], { format, dataBar } = appearance(row, column);
    const bounds = merge ? { ...merge, right: Math.min(merge.right, columnCount - 1), bottom: Math.min(merge.bottom, rowCount - 1) }
      : { top: row, bottom: row, left: column, right: column };
    const text = sheet.cells[address]?.validation?.type === "checkbox" ? (value === true || String(value).toLowerCase() === "true" ? "☑" : "☐") : formatCellValue(value, format);
    cells.push({ address, text: text.slice(0, MAX_TEXT), dataBar, style: {
      left: grid.columns[column], top: grid.rows[row], width: grid.columns[bounds.right + 1] - grid.columns[column], height: grid.rows[bounds.bottom + 1] - grid.rows[row],
      ...collapseSharedCellBorders(cellFormatStyle(format, value), bounds, (r, c) => appearance(r, c).format),
    } });
  }
  const drawings = [];
  for (const drawing of sheet.drawings ?? []) {
    if (drawings.length >= MAX_DRAWINGS) break;
    if (isSpreadsheetLine(drawing)) {
      const route = getSpreadsheetLineRoute(sheet, drawing.id, grid);
      const xs = route.points.map(point => point.x), ys = route.points.map(point => point.y), padding = drawing.strokeWidth * 6;
      if (Math.max(...xs) + padding < 0 || Math.min(...xs) - padding > width || Math.max(...ys) + padding < 0 || Math.min(...ys) - padding > height) continue;
      drawings.push({ kind: "line" as const, drawing: { ...drawing, text: drawing.text?.slice(0, MAX_TEXT) },
        points: route.points.map(point => `${point.x},${point.y}`).join(" "), label: spreadsheetLineRouteMidpoint(route.points) });
    } else {
      const left = grid.columns[drawing.anchor.column] + drawing.anchor.offsetX, top = grid.rows[drawing.anchor.row] + drawing.anchor.offsetY;
      const bounds = rotatedDrawingBounds({ left, top, width: drawing.width, height: drawing.height }, drawing.rotation);
      if (bounds.right < 0 || bounds.left > width || bounds.bottom < 0 || bounds.top > height) continue;
      drawings.push({ kind: "box" as const, drawing: drawing.type === "image" ? drawing : { ...drawing, text: (drawing.text ?? "").slice(0, MAX_TEXT) }, left, top,
        src: drawing.type === "image" ? workbook.resources!.images![drawing.resourceId].dataUrl : undefined });
    }
  }
  return { sheetName: sheet.name, width, height, cells, drawings };
}
