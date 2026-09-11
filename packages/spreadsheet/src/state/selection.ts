import type { SpreadsheetSelection, SpreadsheetSelectionRange } from "../props";
import { cellAddress } from "../model/address";
import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../model/types";
import { expandRangeForMerges, getMergedRange, mergedCellPosition, rangesIntersect } from "../model/merges";

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
export function selectionBands(selection: SpreadsheetSelection) {
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
  const copies = ranges.map(range => ({ anchor: { ...range.anchor }, focus: { ...range.focus }, ...(range.kind ? { kind: range.kind } : {}) }));
  const active = copies[copies.length - 1];
  return { sheetId, anchor: { ...active.anchor }, focus: { ...(focus ?? active.focus) }, ranges: copies };
}

/** Merge geometry stays in ranges; the editable focus always points to a visible anchor cell. */
export function selectionForSheet(sheet: SpreadsheetSheet, ranges: readonly SpreadsheetSelectionRange[], expand = true,
  focus = ranges.at(-1)?.focus): SpreadsheetSelection {
  const expanded = expand ? ranges.map(range => {
    if (range.kind) return range;
    const bounds = expandRangeForMerges(sheet, rangeBounds(range));
    const down = range.anchor.row <= range.focus.row, right = range.anchor.column <= range.focus.column;
    return { anchor: { row: down ? bounds.top : bounds.bottom, column: right ? bounds.left : bounds.right },
      focus: { row: down ? bounds.bottom : bounds.top, column: right ? bounds.right : bounds.left } };
  }) : ranges;
  return createSelection(sheet.id, expanded, focus && (expanded.some(range => range.kind)
    ? focusWithinSelection(sheet, expanded, focus) : mergedCellPosition(sheet, focus)));
}

/** Header geometry is independent of merge geometry; its cursor stays inside it. */
export function axisSelectionRange(sheet: SpreadsheetSheet, kind: "row" | "column", anchor: number, focus: number): SpreadsheetSelectionRange {
  return kind === "row" ? { kind, anchor: clampPosition({ row: anchor, column: sheet.columnCount - 1 }, sheet),
    focus: clampPosition({ row: focus, column: 0 }, sheet) }
    : { kind, anchor: clampPosition({ row: sheet.rowCount - 1, column: anchor }, sheet),
      focus: clampPosition({ row: 0, column: focus }, sheet) };
}

function focusWithinSelection(sheet: SpreadsheetSheet, ranges: readonly SpreadsheetSelectionRange[], preferred: SpreadsheetCellPosition): SpreadsheetCellPosition {
  const ordered = [ranges.at(-1)!, ...ranges.slice(0, -1)];
  for (const range of ordered) {
    const bounds = rangeBounds(range);
    const contains = (position: SpreadsheetCellPosition) => position.row >= bounds.top && position.row <= bounds.bottom &&
      position.column >= bounds.left && position.column <= bounds.right;
    if (contains(preferred)) {
      const anchor = mergedCellPosition(sheet, preferred);
      if (contains(anchor)) return anchor;
    }
    // Jump over covered merged rectangles instead of scanning entire columns.
    const find = (area: typeof bounds): SpreadsheetCellPosition | undefined => {
      for (let row = area.top; row <= area.bottom;) {
        let nextRow = area.bottom + 1;
        for (let column = area.left; column <= area.right;) {
          const merge = getMergedRange(sheet, { row, column });
          if (!merge) return { row, column };
          const anchor = { row: merge.top, column: merge.left };
          if (contains(anchor)) return anchor;
          nextRow = Math.min(nextRow, merge.bottom + 1);
          column = merge.right + 1;
        }
        row = Math.max(row + 1, nextRow);
      }
    };
    if (range.kind && contains(preferred)) {
      const line = range.kind === "column" ? { ...bounds, left: preferred.column, right: preferred.column }
        : { ...bounds, top: preferred.row, bottom: preferred.row };
      const alongAxis = find(line);
      if (alongAxis) return alongAxis;
    }
    const found = find(bounds);
    if (found) return found;
  }
  // A fully covered axis has no visible cell inside it. Never redirect its
  // logical cursor to an unselected merge anchor outside the requested range.
  const bounds = rangeBounds(ordered[0]);
  return { row: Math.max(bounds.top, Math.min(bounds.bottom, preferred.row)),
    column: Math.max(bounds.left, Math.min(bounds.right, preferred.column)) };
}

export function initialSheetSelection(sheet: SpreadsheetSheet): SpreadsheetSelection {
  return selectionForSheet(sheet, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]);
}

export function clampPosition(position: SpreadsheetCellPosition, sheet: SpreadsheetSheet): SpreadsheetCellPosition {
  const index = (value: number, limit: number) => Math.max(0, Math.min(limit - 1, Number.isFinite(value) ? Math.trunc(value) : 0));
  return { row: index(position.row, sheet.rowCount), column: index(position.column, sheet.columnCount) };
}

/** Preflight all selected ranges against the next workbook, preserving holes and complete merged cells. */
export function clampSelection(selection: SpreadsheetSelection, workbook: SpreadsheetWorkbook): SpreadsheetSelection {
  const sheet = workbook.sheets.find(item => item.id === selection.sheetId) ?? workbook.sheets[0];
  if (sheet.id !== selection.sheetId) return initialSheetSelection(sheet);
  const clamp = (position: SpreadsheetCellPosition) => clampPosition(position, sheet);
  const previous = selectionRanges(selection);
  let next = selectionForSheet(sheet, previous.map(range => ({ ...range, anchor: clamp(range.anchor), focus: clamp(range.focus) })), false);
  for (const merge of sheet.merges ?? []) {
    const range = { anchor: { row: merge.top, column: merge.left }, focus: { row: merge.bottom, column: merge.right } };
    if (selectionRanges(next).some(selected => !selected.kind && rangesIntersect(rangeBounds(selected), merge)) && !isRangeSelected(next, range)) {
      next = selectionForSheet(sheet, [...selectionRanges(next), range], false);
    }
  }
  const focus = previous.some(range => range.kind) ? focusWithinSelection(sheet, selectionRanges(next), clamp(selection.focus)) : mergedCellPosition(sheet, clamp(selection.focus));
  if (isCellSelected(next, focus)) next = createSelection(sheet.id, selectionRanges(next), focus);
  if (selection.ranges && selectionRanges(next).length === previous.length && next.focus.row === selection.focus.row && next.focus.column === selection.focus.column &&
    selectionRanges(next).every((range, index) => range.anchor.row === previous[index].anchor.row &&
      range.anchor.column === previous[index].anchor.column && range.focus.row === previous[index].focus.row && range.focus.column === previous[index].focus.column && range.kind === previous[index].kind)) return selection;
  return next;
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
        ...(range.kind ? { kind: range.kind } : {}),
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
        column: range.focus.column === bounds.left ? bounds.right : bounds.left }, focus: range.focus, ...(range.kind ? { kind: range.kind } : {}) });
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
