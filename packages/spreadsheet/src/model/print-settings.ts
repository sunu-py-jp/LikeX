import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "./sheet-dimensions";
import type { QuerySnapshot } from "./query-snapshot";
import { normalizeSizes } from "./workbook/validation";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetPrintSettings, type SpreadsheetSheet, type SpreadsheetWorkbook } from "./types";

/** Dimensions in CSS pixels at 96 dpi. Page boundaries are an estimate, not a printer layout engine. */
export const SPREADSHEET_PRINT_DEFAULTS = Object.freeze({ paperSize: "A4" as const, orientation: "portrait" as const,
  scale: 100, margins: Object.freeze({ top: .75, bottom: .75, left: .75, right: .75 }) });
const paperSizes = { A4: [210 / 25.4, 297 / 25.4], A3: [297 / 25.4, 420 / 25.4], Letter: [8.5, 11] } as const;
const fail = (): never => { throw new Error("印刷範囲・用紙・余白・改ページの設定が正しくありません"); };
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) return fail();
  return input as Record<string, unknown>;
}

export function normalizeSpreadsheetPrintSettings(input: unknown, sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): SpreadsheetPrintSettings | undefined {
  if (input === undefined) return;
  if (!Number.isSafeInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > SPREADSHEET_LIMITS.rows ||
    !Number.isSafeInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > SPREADSHEET_LIMITS.columns) return fail();
  const value = record(input, ["area", "paperSize", "orientation", "scale", "margins", "rowBreaks", "columnBreaks"]);
  const result: { area?: SpreadsheetMergedRange; paperSize?: SpreadsheetPrintSettings["paperSize"]; orientation?: SpreadsheetPrintSettings["orientation"];
    scale?: number; margins?: SpreadsheetPrintSettings["margins"]; rowBreaks?: readonly number[]; columnBreaks?: readonly number[] } = {};
  if (value.area !== undefined) {
    const area = record(value.area, ["top", "left", "bottom", "right"]);
    if (![area.top, area.left, area.bottom, area.right].every(index => Number.isSafeInteger(index) && (index as number) >= 0) ||
      (area.top as number) > (area.bottom as number) || (area.left as number) > (area.right as number) ||
      (area.bottom as number) >= sheet.rowCount || (area.right as number) >= sheet.columnCount) return fail();
    result.area = Object.freeze({ top: area.top as number, left: area.left as number, bottom: area.bottom as number, right: area.right as number });
  }
  if (value.paperSize !== undefined) {
    if (typeof value.paperSize !== "string" || !Object.hasOwn(paperSizes, value.paperSize)) return fail();
    if (value.paperSize !== "A4") result.paperSize = value.paperSize as SpreadsheetPrintSettings["paperSize"];
  }
  if (value.orientation !== undefined) {
    if (value.orientation !== "portrait" && value.orientation !== "landscape") return fail();
    if (value.orientation !== "portrait") result.orientation = value.orientation;
  }
  if (value.scale !== undefined) {
    if (!Number.isSafeInteger(value.scale) || (value.scale as number) < 10 || (value.scale as number) > 400) return fail();
    if (value.scale !== 100) result.scale = value.scale as number;
  }
  if (value.margins !== undefined) {
    const margins = record(value.margins, ["top", "bottom", "left", "right"]);
    if (![margins.top, margins.bottom, margins.left, margins.right].every(size => typeof size === "number" && Number.isFinite(size) && size >= 0 && size <= 22)) return fail();
    result.margins = Object.freeze({ top: margins.top as number, bottom: margins.bottom as number, left: margins.left as number, right: margins.right as number });
  }
  const paper = paperSizes[result.paperSize ?? "A4"], landscape = result.orientation === "landscape", margins = result.margins ?? SPREADSHEET_PRINT_DEFAULTS.margins;
  if (margins.left + margins.right >= paper[landscape ? 1 : 0] || margins.top + margins.bottom >= paper[landscape ? 0 : 1]) return fail();
  if (result.margins && Object.values(result.margins).every(size => size === .75)) delete result.margins;
  for (const [key, limit] of [["rowBreaks", sheet.rowCount], ["columnBreaks", sheet.columnCount]] as const) {
    const values = value[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > limit) return fail();
    for (let position = 0; position < values.length; position++) {
      const index = values[position];
      if (!Object.hasOwn(values, position) || !Number.isSafeInteger(index) || index <= 0 || index >= limit) return fail();
    }
    const sorted = [...new Set(values as number[])].sort((a, b) => a - b);
    if (sorted.length) result[key] = Object.freeze(sorted);
  }
  return Object.keys(result).length ? Object.freeze(result) : undefined;
}

/** Full rows/columns follow structural edits; deleting the whole area clears only that area. */
export function shiftSpreadsheetPrintSettings(settings: SpreadsheetPrintSettings | undefined, axis: "row" | "column", index: number,
  count: number, remove: boolean, dimensions: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): SpreadsheetPrintSettings | undefined {
  if (!settings) return;
  const result = { ...settings }, area = settings.area;
  if (area) {
    const first = axis === "row" ? area.top : area.left, last = axis === "row" ? area.bottom : area.right;
    let start: number, end: number;
    if (!remove) { start = first >= index ? first + count : first; end = last >= index ? last + count : last; }
    else if (first >= index && last < index + count) { delete result.area; start = end = -1; }
    else { start = first < index ? first : Math.max(first, index + count) - count; end = last >= index + count ? last - count : Math.min(last, index - 1); }
    if (start >= 0) result.area = axis === "row" ? { ...area, top: start, bottom: end } : { ...area, left: start, right: end };
  }
  const key = axis === "row" ? "rowBreaks" : "columnBreaks", limit = axis === "row" ? dimensions.rowCount : dimensions.columnCount;
  result[key] = settings[key]?.flatMap(value => {
    const next = !remove ? value >= index ? value + count : value : value < index ? value : value >= index + count ? value - count : index;
    return next > 0 && next < limit ? [next] : [];
  });
  return normalizeSpreadsheetPrintSettings(result, dimensions);
}

export type SpreadsheetPrintSegment = Readonly<{ start: number; end: number; offset: number; size: number }>;
export type SpreadsheetPrintLayout = Readonly<{ area: SpreadsheetMergedRange; rows: readonly SpreadsheetPrintSegment[];
  columns: readonly SpreadsheetPrintSegment[]; pageCount: number; paperWidth: number; paperHeight: number }>;

/** An immutable validated copy of saved settings, without expanding defaults. */
export function getSheetPrintSettings(workbook: QuerySnapshot<SpreadsheetWorkbook>, sheetId: string): SpreadsheetPrintSettings | null {
  const sheet = workbook.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error("指定されたシートが見つかりません");
  return normalizeSpreadsheetPrintSettings(sheet.printSettings, sheet) ?? null;
}

/** Inclusive segments. Number pages down each column first, then across. Does not allocate a page-per-cell matrix. */
export function getSpreadsheetPrintLayout(sheet: QuerySnapshot<SpreadsheetSheet>, options: { hiddenRows?: ReadonlySet<number> } = {}): SpreadsheetPrintLayout | null {
  const settings = normalizeSpreadsheetPrintSettings(sheet.printSettings, sheet), area = settings?.area;
  if (!area) return null;
  const rowHeights = normalizeSizes(sheet.rowHeights, sheet.rowCount, true), columnWidths = normalizeSizes(sheet.columnWidths, sheet.columnCount);
  const paper = paperSizes[settings.paperSize ?? "A4"], landscape = settings.orientation === "landscape";
  const paperWidth = paper[landscape ? 1 : 0] * 96, paperHeight = paper[landscape ? 0 : 1] * 96;
  const margins = settings.margins ?? SPREADSHEET_PRINT_DEFAULTS.margins, scale = (settings.scale ?? 100) / 100;
  const split = (first: number, last: number, budget: number, breaks: readonly number[] | undefined, sizeAt: (index: number) => number) => {
    const segments: SpreadsheetPrintSegment[] = [], manual = new Set(breaks);
    let offset = 0; for (let index = 0; index < first; index++) offset += sizeAt(index);
    let start = first, size = 0;
    for (let index = first; index <= last; index++) {
      const next = sizeAt(index);
      if (index > start && size > 0 && (manual.has(index) || next > 0 && size + next > budget + .000001)) {
        segments.push(Object.freeze({ start, end: index - 1, offset, size })); offset += size; start = index; size = 0;
      }
      size += next;
    }
    if (size > 0) segments.push(Object.freeze({ start, end: last, offset, size }));
    else if (segments.length) segments[segments.length - 1] = Object.freeze({ ...segments.at(-1)!, end: last });
    return Object.freeze(segments);
  };
  const rows = split(area.top, area.bottom, (paperHeight - (margins.top + margins.bottom) * 96) / scale, settings.rowBreaks,
    row => options.hiddenRows?.has(row) ? 0 : rowHeights?.[row] ?? DEFAULT_ROW_HEIGHT);
  const columns = split(area.left, area.right, (paperWidth - (margins.left + margins.right) * 96) / scale, settings.columnBreaks,
    column => columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH);
  return Object.freeze({ area, rows, columns, pageCount: rows.length * columns.length, paperWidth, paperHeight });
}
