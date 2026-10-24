import { rangeContains, rangesIntersect } from "../merges";
import { shiftRangeInterval } from "../named-ranges";
import type { SpreadsheetAutoFilter, SpreadsheetMoveSource, SpreadsheetMoveTarget, SpreadsheetSheet } from "../types";

/** Retain criteria on their original columns. Removing the header or every column removes the filter. */
export function shiftSheetAutoFilter(filter: SpreadsheetAutoFilter | undefined, axis: "row" | "column",
  index: number, count: number, remove: boolean): SpreadsheetAutoFilter | undefined {
  if (!filter) return undefined;
  const first = axis === "row" ? filter.range.top : filter.range.left, last = axis === "row" ? filter.range.bottom : filter.range.right;
  const interval = shiftRangeInterval(first, last, index, count, remove);
  if (!interval || (axis === "row" && remove && index <= first && index + count > first)) return undefined;
  const range = Object.freeze(axis === "row" ? { ...filter.range, top: interval[0], bottom: interval[1] }
    : { ...filter.range, left: interval[0], right: interval[1] });
  const columns = axis === "row" ? filter.columns : filter.columns?.flatMap(item => {
    if (remove && item.column >= index && item.column < index + count) return [];
    return [item.column >= index ? Object.freeze({ ...item, column: item.column + (remove ? -count : count) }) : item];
  });
  return Object.freeze({ range, ...(columns?.length ? { columns: Object.freeze(columns) } : {}) });
}

/** A filter follows a complete cut/move; splitting or replacing another filter rejects atomically. */
export function moveSheetAutoFilters(sheets: readonly SpreadsheetSheet[], source: SpreadsheetMoveSource,
  target: SpreadsheetMoveTarget): ReadonlyMap<string, SpreadsheetAutoFilter | undefined> {
  const destination = { top: target.row, left: target.column, bottom: target.row + source.bottom - source.top,
    right: target.column + source.right - source.left };
  const sourceFilter = sheets.find(sheet => sheet.id === source.sheetId)?.autoFilter;
  const moved = sourceFilter && rangesIntersect(source, sourceFilter.range);
  if (moved && !rangeContains(source, sourceFilter.range))
    throw new Error("フィルター範囲の一部分だけは移動できません。範囲全体を選択するかフィルターを解除してください");
  const destinationFilter = sheets.find(sheet => sheet.id === target.sheetId)?.autoFilter;
  if (destinationFilter && !(moved && source.sheetId === target.sheetId) &&
    (moved || rangesIntersect(destination, destinationFilter.range)))
    throw new Error("移動先のフィルターを先に解除してください");
  const result = new Map<string, SpreadsheetAutoFilter | undefined>();
  if (!moved) return result;
  const rows = target.row - source.top, columns = target.column - source.left;
  result.set(source.sheetId, undefined);
  result.set(target.sheetId, Object.freeze({
    range: Object.freeze({ top: sourceFilter.range.top + rows, bottom: sourceFilter.range.bottom + rows,
      left: sourceFilter.range.left + columns, right: sourceFilter.range.right + columns }),
    ...(sourceFilter.columns ? { columns: Object.freeze(sourceFilter.columns.map(item => Object.freeze({ ...item, column: item.column + columns }))) } : {}),
  }));
  return result;
}
