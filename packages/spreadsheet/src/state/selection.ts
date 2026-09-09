import type { SpreadsheetSelection, SpreadsheetSelectionRange } from "../props";
import { cellAddress } from "../model/address";
import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition, type SpreadsheetSheet } from "../model/types";
import { expandRangeForMerges, mergedCellPosition } from "../model/merges";

export const MAX_SELECTION_CELLS = SPREADSHEET_LIMITS.clipboardCells;
export const MAX_SELECTION_RANGES = 128;

export function selectionRanges(selection: SpreadsheetSelection): readonly SpreadsheetSelectionRange[] {
  return selection.ranges?.length ? selection.ranges : [{ anchor: selection.anchor, focus: selection.focus }];
}

export function rangeBounds(range: SpreadsheetSelectionRange) {
  return { top: Math.min(range.anchor.row, range.focus.row), bottom: Math.max(range.anchor.row, range.focus.row),
    left: Math.min(range.anchor.column, range.focus.column), right: Math.max(range.anchor.column, range.focus.column) };
}

/** The active range only. Never combine disjoint ranges into a bounding rectangle. */
export function selectionBounds(selection: SpreadsheetSelection) {
  return rangeBounds(selectionRanges(selection).at(-1)!);
}

export function isMultiRangeSelection(selection: SpreadsheetSelection) {
  return selectionRanges(selection).length > 1;
}

export function isCellSelected(selection: SpreadsheetSelection, position: SpreadsheetCellPosition) {
  return selectionRanges(selection).some(range => {
    const bounds = rangeBounds(range);
    return position.row >= bounds.top && position.row <= bounds.bottom && position.column >= bounds.left && position.column <= bounds.right;
  });
}

/** Row bands and merged column intervals represent the exact union without enumerating cells. */
function selectionBands(selection: SpreadsheetSelection) {
  const rectangles = selectionRanges(selection).map(rangeBounds);
  const edges = [...new Set(rectangles.flatMap(rectangle => [rectangle.top, rectangle.bottom + 1]))].sort((a, b) => a - b);
  const bands: { top: number; bottom: number; columns: { left: number; right: number }[] }[] = [];
  for (let index = 0; index < edges.length - 1; index++) {
    const top = edges[index], bottom = edges[index + 1] - 1;
    const intervals = rectangles.filter(rectangle => rectangle.top <= top && rectangle.bottom >= top).sort((a, b) => a.left - b.left);
    const columns: { left: number; right: number }[] = [];
    for (const interval of intervals) {
      const previous = columns.at(-1);
      if (previous && interval.left <= previous.right + 1) previous.right = Math.max(previous.right, interval.right);
      else columns.push({ left: interval.left, right: interval.right });
    }
    if (columns.length) bands.push({ top, bottom, columns });
  }
  return bands;
}

export function selectionCellCount(selection: SpreadsheetSelection) {
  return selectionBands(selection).reduce((total, band) => total + (band.bottom - band.top + 1) *
    band.columns.reduce((width, interval) => width + interval.right - interval.left + 1, 0), 0);
}

export function selectedAddresses(selection: SpreadsheetSelection) {
  const bands = selectionBands(selection);
  const count = bands.reduce((total, band) => total + (band.bottom - band.top + 1) *
    band.columns.reduce((width, interval) => width + interval.right - interval.left + 1, 0), 0);
  if (count > MAX_SELECTION_CELLS) throw new Error(`一度に操作できる範囲は ${MAX_SELECTION_CELLS.toLocaleString()} セルまでです`);
  const addresses: string[] = [];
  for (const band of bands) for (let row = band.top; row <= band.bottom; row++) {
    for (const interval of band.columns) for (let column = interval.left; column <= interval.right; column++) addresses.push(cellAddress(row, column));
  }
  return addresses;
}

/** Copies positions so external callback payloads and event arguments cannot mutate internal state. */
export function createSelection(sheetId: string, ranges: readonly SpreadsheetSelectionRange[], focus?: SpreadsheetCellPosition): SpreadsheetSelection {
  if (!ranges.length) throw new Error("少なくとも1つのセルを選択してください");
  if (ranges.length > MAX_SELECTION_RANGES) throw new Error(`一度に選択できる範囲は ${MAX_SELECTION_RANGES} 個までです`);
  const copies = ranges.map(range => ({ anchor: { ...range.anchor }, focus: { ...range.focus } }));
  const active = copies[copies.length - 1];
  return { sheetId, anchor: { ...active.anchor }, focus: { ...(focus ?? active.focus) }, ranges: copies };
}

/** Merge geometry stays in ranges; the editable focus always points to a visible anchor cell. */
export function selectionForSheet(sheet: SpreadsheetSheet, ranges: readonly SpreadsheetSelectionRange[], expand = true,
  focus = ranges.at(-1)?.focus): SpreadsheetSelection {
  const expanded = expand ? ranges.map(range => {
    const bounds = expandRangeForMerges(sheet, rangeBounds(range));
    const down = range.anchor.row <= range.focus.row, right = range.anchor.column <= range.focus.column;
    return { anchor: { row: down ? bounds.top : bounds.bottom, column: right ? bounds.left : bounds.right },
      focus: { row: down ? bounds.bottom : bounds.top, column: right ? bounds.right : bounds.left } };
  }) : ranges;
  return createSelection(sheet.id, expanded, focus && mergedCellPosition(sheet, focus));
}

export function isRangeSelected(selection: SpreadsheetSelection, range: SpreadsheetSelectionRange): boolean {
  const target = rangeBounds(range);
  const intersections: SpreadsheetSelectionRange[] = [];
  for (const selected of selectionRanges(selection)) {
    const bounds = rangeBounds(selected);
    if (bounds.top <= target.top && bounds.bottom >= target.bottom && bounds.left <= target.left && bounds.right >= target.right) return true;
    const top = Math.max(target.top, bounds.top), bottom = Math.min(target.bottom, bounds.bottom);
    const left = Math.max(target.left, bounds.left), right = Math.min(target.right, bounds.right);
    if (top <= bottom && left <= right) intersections.push({ anchor: { row: top, column: left }, focus: { row: bottom, column: right } });
  }
  if (!intersections.length) return false;
  return selectionCellCount(createSelection(selection.sheetId, intersections)) === (target.bottom - target.top + 1) * (target.right - target.left + 1);
}

/** Subtraction splits each affected rectangle into at most four nonoverlapping rectangles. */
export function toggleRangeSelection(selection: SpreadsheetSelection, target: SpreadsheetSelectionRange): SpreadsheetSelection {
  if (!isRangeSelected(selection, target)) return createSelection(selection.sheetId, [...selectionRanges(selection), target]);
  const removed = rangeBounds(target);
  const ranges: SpreadsheetSelectionRange[] = [];
  for (const range of selectionRanges(selection)) {
    const { top, bottom, left, right } = rangeBounds(range);
    const intersectionTop = Math.max(top, removed.top), intersectionBottom = Math.min(bottom, removed.bottom);
    const intersectionLeft = Math.max(left, removed.left), intersectionRight = Math.min(right, removed.right);
    if (intersectionTop > intersectionBottom || intersectionLeft > intersectionRight) { ranges.push(range); continue; }
    const fragments: SpreadsheetSelectionRange[] = [];
    const add = (firstRow: number, lastRow: number, firstColumn: number, lastColumn: number) => {
      if (firstRow <= lastRow && firstColumn <= lastColumn) fragments.push({
        anchor: { row: firstRow, column: firstColumn }, focus: { row: lastRow, column: lastColumn },
      });
    };
    add(top, intersectionTop - 1, left, right);
    add(intersectionBottom + 1, bottom, left, right);
    add(intersectionTop, intersectionBottom, left, intersectionLeft - 1);
    add(intersectionTop, intersectionBottom, intersectionRight + 1, right);
    const focusIndex = fragments.findIndex(fragment => {
      const bounds = rangeBounds(fragment);
      return range.focus.row >= bounds.top && range.focus.row <= bounds.bottom && range.focus.column >= bounds.left && range.focus.column <= bounds.right;
    });
    if (focusIndex >= 0) {
      const [active] = fragments.splice(focusIndex, 1);
      const bounds = rangeBounds(active);
      // Focus is an original corner, so its opposite corner preserves the whole fragment in either drag direction.
      fragments.push({ anchor: { row: range.focus.row === bounds.top ? bounds.bottom : bounds.top,
        column: range.focus.column === bounds.left ? bounds.right : bounds.left }, focus: range.focus });
    }
    ranges.push(...fragments);
  }
  // A spreadsheet always retains an active cell, even when the final range is removed.
  if (ranges.length) return createSelection(selection.sheetId, ranges);
  return selectionCellCount(selection) === 1 ? selection : createSelection(selection.sheetId, [{ anchor: selection.focus, focus: selection.focus }]);
}

export function toggleSelectionCell(selection: SpreadsheetSelection, position: SpreadsheetCellPosition): SpreadsheetSelection {
  return toggleRangeSelection(selection, { anchor: position, focus: position });
}
