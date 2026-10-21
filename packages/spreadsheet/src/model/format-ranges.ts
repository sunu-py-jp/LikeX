import { cellAddress } from "./address";
import { formatsEqual, normalizeCellFormat } from "./formatting/normalize";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellFormat, type SpreadsheetFormatRange,
  type SpreadsheetFormatRangeBounds, type SpreadsheetMergedRange, type SpreadsheetSheet } from "./types";

const validatedRanges = new WeakSet<readonly SpreadsheetFormatRange[]>();
const validatedDimensions = new WeakMap<readonly SpreadsheetFormatRange[], Set<string>>();
type Dimensions = Pick<SpreadsheetSheet, "rowCount" | "columnCount">;
const invalid = (): never => { throw new Error("範囲書式の範囲が正しくありません"); };
export function resolveFormatRange(sheet: Dimensions, range: SpreadsheetFormatRangeBounds): SpreadsheetMergedRange {
  if (!range || typeof range !== "object" || Array.isArray(range) || Object.keys(range).some(key => !["top", "left", "bottom", "right"].includes(key))) return invalid();
  const bottom = range.bottom === "end" ? sheet.rowCount - 1 : range.bottom;
  const right = range.right === "end" ? sheet.columnCount - 1 : range.right;
  if (![range.top, range.left, bottom, right].every(Number.isInteger) || range.top < 0 || range.left < 0 ||
    bottom < range.top || right < range.left || bottom >= sheet.rowCount || right >= sheet.columnCount) return invalid();
  return { top: range.top, left: range.left, bottom, right };
}
const intersects = (a: SpreadsheetMergedRange, b: SpreadsheetMergedRange) => a.top <= b.bottom && a.bottom >= b.top && a.left <= b.right && a.right >= b.left;
export function subtractFormatRectangle(area: SpreadsheetMergedRange, cut: SpreadsheetMergedRange): SpreadsheetMergedRange[] {
  if (!intersects(area, cut)) return [area];
  const top = Math.max(area.top, cut.top), bottom = Math.min(area.bottom, cut.bottom);
  const left = Math.max(area.left, cut.left), right = Math.min(area.right, cut.right);
  return [
    ...(area.top < top ? [{ ...area, bottom: top - 1 }] : []),
    ...(area.bottom > bottom ? [{ ...area, top: bottom + 1 }] : []),
    ...(area.left < left ? [{ top, bottom, left: area.left, right: left - 1 }] : []),
    ...(area.right > right ? [{ top, bottom, left: right + 1, right: area.right }] : []),
  ];
}
export function preserveFormatRangeEnd(range: SpreadsheetMergedRange, original: SpreadsheetFormatRangeBounds, dimensions: Dimensions): SpreadsheetFormatRangeBounds {
  return { ...range, ...(original.bottom === "end" && range.bottom === dimensions.rowCount - 1 ? { bottom: "end" as const } : {}),
    ...(original.right === "end" && range.right === dimensions.columnCount - 1 ? { right: "end" as const } : {}) };
}

/** Validate using a row sweep. At most columnCount disjoint rectangles can be active. */
export function normalizeFormatRanges(input: readonly SpreadsheetFormatRange[] | undefined, sheet: Dimensions): readonly SpreadsheetFormatRange[] | undefined {
  if (input === undefined) return undefined;
  const dimensions = `${sheet.rowCount}:${sheet.columnCount}`;
  if (validatedDimensions.get(input)?.has(dimensions)) return input;
  if (!Array.isArray(input) || input.length > SPREADSHEET_LIMITS.formatRanges) throw new Error("範囲書式の数が上限を超えています");
  const result = input.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => key !== "range" && key !== "format")) return invalid();
    resolveFormatRange(sheet, item.range);
    const format = normalizeCellFormat(item.format);
    if (!format) throw new Error("範囲書式には書式を指定してください");
    return Object.freeze({ range: Object.freeze({ ...item.range }), format });
  }).sort((a, b) => a.range.top - b.range.top || a.range.left - b.range.left);
  let active: SpreadsheetMergedRange[] = [];
  for (const item of result) {
    const area = resolveFormatRange(sheet, item.range);
    active = active.filter(previous => previous.bottom >= area.top);
    if (active.some(previous => previous.left <= area.right && previous.right >= area.left)) throw new Error("範囲書式が重複しています");
    active.push(area);
  }
  if (!result.length) return undefined;
  const frozen = Object.freeze(result); validatedRanges.add(frozen); validatedDimensions.set(frozen, new Set([dimensions])); return frozen;
}

type IndexedRange = { area: SpreadsheetMergedRange; format: SpreadsheetCellFormat };
type RangeIndex = { center: number; across: IndexedRange[]; before?: RangeIndex; after?: RangeIndex };
const indices = new WeakMap<readonly SpreadsheetFormatRange[], Map<string, RangeIndex | undefined>>();
function buildIndex(ranges: IndexedRange[]): RangeIndex | undefined {
  if (!ranges.length) return undefined;
  const starts = ranges.map(item => item.area.top).sort((a, b) => a - b), center = starts[Math.floor(starts.length / 2)];
  const before: IndexedRange[] = [], after: IndexedRange[] = [], across: IndexedRange[] = [];
  for (const item of ranges) (item.area.bottom < center ? before : item.area.top > center ? after : across).push(item);
  across.sort((a, b) => a.area.left - b.area.left);
  return { center, across, before: buildIndex(before), after: buildIndex(after) };
}
export function getCellFormat(sheet: Pick<SpreadsheetSheet, "cells" | "formatRanges" | "rowCount" | "columnCount">, row: number, column: number): SpreadsheetCellFormat | undefined {
  const own = sheet.cells[cellAddress(row, column)]?.format;
  // An empty format is normalized to absence by the existing model contract.
  if (own && Object.keys(own).length) return own;
  if (!sheet.formatRanges?.length || row < 0 || column < 0 || row >= sheet.rowCount || column >= sheet.columnCount) return undefined;
  const cacheable = validatedRanges.has(sheet.formatRanges);
  let bySize = cacheable ? indices.get(sheet.formatRanges) : undefined;
  if (!bySize) { bySize = new Map(); if (cacheable) indices.set(sheet.formatRanges, bySize); }
  const size = `${sheet.rowCount}:${sheet.columnCount}`;
  if (!bySize.has(size)) bySize.set(size, buildIndex(sheet.formatRanges.map(item => ({ area: resolveFormatRange(sheet, item.range), format: item.format }))));
  let node = bySize.get(size);
  while (node) {
    let low = 0, high = node.across.length;
    while (low < high) { const mid = (low + high) >>> 1; if (node.across[mid].area.left <= column) low = mid + 1; else high = mid; }
    const item = node.across[low - 1];
    if (item && item.area.right >= column && item.area.top <= row && item.area.bottom >= row) return item.format;
    node = row < node.center ? node.before : row > node.center ? node.after : undefined;
  }
  return undefined;
}
export function getFormattedCell(sheet: Pick<SpreadsheetSheet, "cells" | "formatRanges" | "rowCount" | "columnCount">, row: number, column: number): SpreadsheetCell | undefined {
  const cell = sheet.cells[cellAddress(row, column)], format = getCellFormat(sheet, row, column);
  return format === cell?.format ? cell : { ...cell, value: cell?.value ?? "", format };
}

/** Compact neighbouring rectangles without expanding their cell area. Input must already be disjoint. */
export function compactFormatRanges(input: readonly SpreadsheetFormatRange[], sheet: Dimensions): readonly SpreadsheetFormatRange[] | undefined {
  let items = [...input];
  for (const horizontal of [true, false]) {
    const groups = new Map<string, SpreadsheetFormatRange[]>();
    for (const item of items) {
      const r = item.range, key = JSON.stringify([item.format, horizontal ? [r.top, r.bottom] : [r.left, r.right]]);
      const group = groups.get(key); if (group) group.push(item); else groups.set(key, [item]);
    }
    items = [];
    for (const group of groups.values()) {
      group.sort((a, b) => horizontal ? a.range.left - b.range.left : a.range.top - b.range.top);
      let last: SpreadsheetFormatRange | undefined;
      for (const item of group) {
        if (last && formatsEqual(last.format, item.format)) {
          const a = resolveFormatRange(sheet, last.range), b = resolveFormatRange(sheet, item.range);
          if (horizontal ? a.right + 1 === b.left && a.top === b.top && a.bottom === b.bottom : a.bottom + 1 === b.top && a.left === b.left && a.right === b.right) {
            const merged = { range: { ...last.range, ...(horizontal ? { right: item.range.right } : { bottom: item.range.bottom }) }, format: last.format };
            items[items.length - 1] = merged; last = merged; continue;
          }
        }
        items.push(item); last = item;
      }
    }
  }
  return normalizeFormatRanges(items, sheet);
}

/** Replace the base format of an area; explicit cell overrides are deliberately left untouched. */
export function setSheetFormatRange(sheet: SpreadsheetSheet, range: SpreadsheetFormatRangeBounds, format: SpreadsheetCellFormat | undefined): SpreadsheetSheet {
  const cut = resolveFormatRange(sheet, range), normalized = normalizeCellFormat(format);
  const items = (sheet.formatRanges ?? []).flatMap(item => subtractFormatRectangle(resolveFormatRange(sheet, item.range), cut)
    .map(part => ({ range: preserveFormatRangeEnd(part, item.range, sheet), format: item.format })));
  if (normalized) items.push({ range, format: normalized });
  return { ...sheet, formatRanges: compactFormatRanges(items, sheet) };
}
export function clearSheetFormatRanges(sheet: SpreadsheetSheet, range: SpreadsheetFormatRangeBounds): SpreadsheetSheet {
  return sheet.formatRanges?.length ? setSheetFormatRange(sheet, range, undefined) : sheet;
}
export function formatRangesEqual(a: readonly SpreadsheetFormatRange[] | undefined, b: readonly SpreadsheetFormatRange[] | undefined): boolean {
  return a === b || (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((item, index) => {
    const other = b![index]; return item.range.top === other.range.top && item.range.left === other.range.left &&
      item.range.bottom === other.range.bottom && item.range.right === other.range.right && formatsEqual(item.format, other.format);
  });
}
