import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "./sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawingAnchor, type SpreadsheetSheet } from "./types";

/** CSS pixels from the top-left of A1; row and column headers are excluded. */
export type SpreadsheetDrawingBounds = Readonly<{
  left: number; top: number; right: number; bottom: number; width: number; height: number;
}>;

export type SpreadsheetDrawingPlacementOptions = Readonly<{
  /** Empty space below and to the right of the drawing, in CSS pixels. Defaults to zero. */
  gap?: number;
}>;

export type SpreadsheetDrawingPlacement = Readonly<{
  /** The drawing itself, without the requested gap. */
  bounds: SpreadsheetDrawingBounds;
  /** First row whose top edge is at or below the drawing's bottom edge plus gap. Zero-based. */
  nextRow: number;
  /** First column whose left edge is at or beyond the drawing's right edge plus gap. Zero-based. */
  nextColumn: number;
}>;

type PositionedDrawing = Readonly<{
  id: string; anchor: Readonly<SpreadsheetDrawingAnchor>; width: number; height: number;
}>;
type GeometrySheet = Readonly<Pick<SpreadsheetSheet, "id" | "rowCount" | "columnCount" | "rowHeights" | "columnWidths"> & {
  drawings?: readonly PositionedDrawing[];
}>;
// Only geometry is read: deeply readonly command snapshots also satisfy this input.
type GeometryWorkbook = Readonly<{ sheets: readonly GeometrySheet[] }>;
type AxisGeometry = Readonly<{ offsets: readonly number[]; defaultSize: number }>;

const fail = (message: string): never => { throw new Error(message); };

function validateId(id: string): void {
  if (typeof id !== "string" || !id || id.length > 200 || /\0/.test(id)) fail("シートまたは描画オブジェクトの ID が正しくありません");
}

function boundedNumber(value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) return fail("描画オブジェクトの位置、サイズ、または余白が正しくありません");
  return value;
}

function axisGeometry(count: number, input: Readonly<Record<number, number>> | undefined, row: boolean): AxisGeometry {
  if (!Number.isInteger(count) || count < 1 || count > (row ? SPREADSHEET_LIMITS.rows : SPREADSHEET_LIMITS.columns))
    return fail("行数または列数が上限を超えています");
  const sizes = new Map<number, number>();
  if (input !== undefined) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail("行列のサイズが正しくありません");
    for (const [key, value] of Object.entries(input)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= count) return fail("行列のサイズが範囲外です");
      sizes.set(index, boundedNumber(value, row ? 16 : 24, 1000));
    }
  }
  const defaultSize = row ? DEFAULT_ROW_HEIGHT : DEFAULT_COLUMN_WIDTH, offsets = [0];
  for (let index = 0; index < count; index++) offsets.push(offsets[index] + (sizes.get(index) ?? defaultSize));
  return { offsets, defaultSize };
}

function drawingGeometry(workbook: GeometryWorkbook, sheetId: string, drawingId: string) {
  validateId(sheetId); validateId(drawingId);
  if (!workbook || !Array.isArray(workbook.sheets) || !workbook.sheets.length || workbook.sheets.length > SPREADSHEET_LIMITS.sheets)
    return fail("ブックのシート一覧が正しくありません");
  const sheets: readonly GeometrySheet[] = workbook.sheets.filter(sheet => sheet?.id === sheetId);
  if (sheets.length !== 1) return fail("シートが見つからないか、同じ ID のシートがあります");
  const sheet = sheets[0];
  if (sheet.drawings !== undefined && (!Array.isArray(sheet.drawings) || sheet.drawings.length > SPREADSHEET_LIMITS.drawings))
    return fail("描画オブジェクトの一覧が正しくありません");
  const drawings = sheet.drawings?.filter(drawing => drawing?.id === drawingId) ?? [];
  if (drawings.length !== 1) return fail("描画オブジェクトが見つからないか、同じ ID の描画オブジェクトがあります");
  const drawing = drawings[0], rows = axisGeometry(sheet.rowCount, sheet.rowHeights, true),
    columns = axisGeometry(sheet.columnCount, sheet.columnWidths, false), anchor = drawing.anchor;
  if (!anchor || !Number.isInteger(anchor.row) || anchor.row < 0 || anchor.row >= sheet.rowCount ||
    !Number.isInteger(anchor.column) || anchor.column < 0 || anchor.column >= sheet.columnCount)
    return fail("描画オブジェクトの位置がシートの範囲外です");
  const left = columns.offsets[anchor.column] + boundedNumber(anchor.offsetX, 0, 10_000),
    top = rows.offsets[anchor.row] + boundedNumber(anchor.offsetY, 0, 10_000),
    width = boundedNumber(drawing.width, Number.MIN_VALUE, 10_000), height = boundedNumber(drawing.height, Number.MIN_VALUE, 10_000);
  const bounds: SpreadsheetDrawingBounds = Object.freeze({ left, top, right: left + width, bottom: top + height, width, height });
  return { rows, columns, bounds, anchor };
}

// Fractional row sizes can sum to 56.300000000000004 for a 56.3 px edge.
// Cap the tolerance so a very large requested gap never swallows actual pixel space.
function startsAtOrAfter(start: number, edge: number): boolean {
  return start >= edge || edge - start <= Math.min(1e-7, Number.EPSILON * Math.max(Math.abs(start), Math.abs(edge)) * 4);
}

/** Locate a cell start, extending past existing dimensions with implicit default sizes. */
function nextIndex(axis: AxisGeometry, target: number): number {
  const { offsets, defaultSize } = axis, count = offsets.length - 1, end = offsets[count];
  if (!startsAtOrAfter(end, target)) {
    const extra = Math.ceil((target - end) / defaultSize);
    return count + (startsAtOrAfter(end + (extra - 1) * defaultSize, target) ? extra - 1 : extra);
  }
  let low = 0, high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (!startsAtOrAfter(offsets[middle], target)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Read the current bounds of an image, shape or text box without rendering or changing the workbook. */
export function getDrawingBounds(workbook: GeometryWorkbook, sheetId: string, drawingId: string): SpreadsheetDrawingBounds {
  return drawingGeometry(workbook, sheetId, drawingId).bounds;
}

/**
 * Find separate below/right placement candidates, not an empty cell or a diagonal target.
 * Candidates can exceed sheet dimensions and limits; this function does not insert rows or columns.
 * Re-run after resizing/inserting rows, columns or the drawing to obtain current coordinates.
 */
export function getDrawingPlacement(workbook: GeometryWorkbook, sheetId: string, drawingId: string,
  options: SpreadsheetDrawingPlacementOptions = {}): SpreadsheetDrawingPlacement {
  if (!options || typeof options !== "object" || Array.isArray(options)) return fail("描画位置のオプションが正しくありません");
  const gap = boundedNumber(options.gap === undefined ? 0 : options.gap, 0), { bounds, rows, columns, anchor } = drawingGeometry(workbook, sheetId, drawingId);
  const bottom = boundedNumber(bounds.bottom + gap, 0), right = boundedNumber(bounds.right + gap, 0);
  return Object.freeze({ bounds, nextRow: Math.max(anchor.row + 1, nextIndex(rows, bottom)),
    nextColumn: Math.max(anchor.column + 1, nextIndex(columns, right)) });
}
