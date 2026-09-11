import { cellAddress, parseCellAddress } from "./address";
import { rangeContains, rangesIntersect } from "./merges";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetMoveSource, type SpreadsheetMoveTarget,
  type SpreadsheetNamedRange, type SpreadsheetSheet } from "./types";

/** Inclusive zero-based rectangle or same-sheet A1 notation. */
export type SpreadsheetNamedRangeInput = SpreadsheetMergedRange | string;
export type SpreadsheetNamedRangeInfo = SpreadsheetNamedRange & Readonly<{ address: string }>;

/** Names remain compatible with XLSX defined names; cell references and reserved names are excluded. */
export function normalizeRangeName(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 ||
    !/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(value) || /^(?:R|C|R\d+C\d+)$/i.test(value) ||
    /^[A-Z]{1,3}[1-9]\d*$/i.test(value) || /^_xlnm\./i.test(value) || /^_LikeX_list_/i.test(value))
    throw new Error("範囲名は255文字以内の文字・数字・ピリオド・アンダースコアで指定し、数字やセル番地は使わないでください");
  return value;
}

export function namedRangeAddress(range: SpreadsheetMergedRange): string {
  const first = cellAddress(range.top, range.left), last = cellAddress(range.bottom, range.right);
  return first === last ? first : `${first}:${last}`;
}

export function normalizeNamedRangeRectangle(input: SpreadsheetNamedRangeInput,
  sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): SpreadsheetMergedRange {
  let value: SpreadsheetMergedRange;
  if (typeof input === "string") {
    const parts = input.split(":"), first = parseCellAddress(parts[0]), last = parseCellAddress(parts[1] ?? parts[0]);
    if (parts.length > 2 || !first || !last) throw new Error("範囲は同じシート内のA1表記で指定してください");
    value = { top: first.row, left: first.column, bottom: last.row, right: last.column };
  } else value = input;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![value.top, value.left, value.bottom, value.right].every(Number.isInteger) ||
    value.top < 0 || value.left < 0 || value.bottom < value.top || value.right < value.left ||
    value.bottom >= sheet.rowCount || value.right >= sheet.columnCount)
    throw new Error("範囲はシート内の長方形で指定してください");
  return Object.freeze({ top: value.top, left: value.left, bottom: value.bottom, right: value.right });
}

export function normalizeNamedRanges(input: readonly SpreadsheetNamedRange[] | undefined,
  sheets: readonly SpreadsheetSheet[]): readonly SpreadsheetNamedRange[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > SPREADSHEET_LIMITS.namedRanges) throw new Error("名前付き範囲の形式または件数が正しくありません");
  const ids = new Set<string>(), names = new Set<string>();
  const result: SpreadsheetNamedRange[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || item.id.length > 200 || /\0/.test(item.id) || ids.has(item.id))
      throw new Error("名前付き範囲のIDが空、重複、または不正です");
    const name = normalizeRangeName(item.name), key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) throw new Error("同じ名前の名前付き範囲があります");
    const sheet = sheets.find(sheet => sheet.id === item.sheetId);
    if (!sheet) throw new Error("名前付き範囲のシートが見つかりません");
    ids.add(item.id); names.add(key);
    result.push(Object.freeze({ id: item.id, name, sheetId: sheet.id, range: normalizeNamedRangeRectangle(item.range, sheet) }));
  }
  return result.length ? Object.freeze(result) : undefined;
}

/** Shared coordinate transform for named ranges, table rectangles and structural edits. */
export function shiftRangeInterval(first: number, last: number, index: number, count: number, remove: boolean): [number, number] | null {
  if (!remove) return [first >= index ? first + count : first, last >= index ? last + count : last];
  const end = index + count;
  if (first >= index && last < end) return null;
  return [first < index ? first : Math.max(first, end) - count, last >= end ? last - count : Math.min(last, index - 1)];
}

export function shiftNamedRanges(ranges: readonly SpreadsheetNamedRange[] | undefined, sheetId: string,
  axis: "row" | "column", index: number, count: number, remove: boolean): readonly SpreadsheetNamedRange[] | undefined {
  if (!ranges) return undefined;
  return Object.freeze(ranges.flatMap(item => {
    if (item.sheetId !== sheetId) return [item];
    const next = shiftRangeInterval(axis === "row" ? item.range.top : item.range.left,
      axis === "row" ? item.range.bottom : item.range.right, index, count, remove);
    if (!next) return [];
    const range = Object.freeze(axis === "row" ? { ...item.range, top: next[0], bottom: next[1] }
      : { ...item.range, left: next[0], right: next[1] });
    return [Object.freeze({ ...item, range })];
  }));
}

/** A named rectangle follows a full cut/move. Splitting one rectangle is deliberately rejected. */
export function moveNamedRanges(ranges: readonly SpreadsheetNamedRange[] | undefined, source: SpreadsheetMoveSource,
  target: SpreadsheetMoveTarget): readonly SpreadsheetNamedRange[] | undefined {
  if (!ranges) return undefined;
  return Object.freeze(ranges.map(item => {
    if (item.sheetId !== source.sheetId || !rangesIntersect(source, item.range)) return item;
    if (!rangeContains(source, item.range)) throw new Error("名前付き範囲の一部分だけは移動できません。範囲全体を選択してください");
    const row = target.row - source.top, column = target.column - source.left;
    return Object.freeze({ ...item, sheetId: target.sheetId, range: Object.freeze({ top: item.range.top + row,
      bottom: item.range.bottom + row, left: item.range.left + column, right: item.range.right + column }) });
  }));
}

export function namedRangesEqual(left: readonly SpreadsheetNamedRange[] | undefined, right: readonly SpreadsheetNamedRange[] | undefined): boolean {
  const a = left ?? [], b = right ?? [];
  if (a === b) return true;
  return a.length === b.length && a.every((item, index) => {
    const other = b[index];
    return item.id === other.id && item.name === other.name && item.sheetId === other.sheetId &&
      item.range.top === other.range.top && item.range.left === other.range.left && item.range.bottom === other.range.bottom && item.range.right === other.range.right;
  });
}
