import { parseCellAddress } from "../model/address";
import { commentsEqual, drawingsEqual } from "../model/annotations";
import { dataValidationsEqual } from "../model/data-validation";
import { formatsEqual } from "../model/formatting";
import { mergesEqual } from "../model/merges";
import type { SpreadsheetCell, SpreadsheetCellPosition, SpreadsheetImageResource, SpreadsheetSheet, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetSelection, SpreadsheetSelectionRange } from "../props";
import { clampPosition, MAX_SELECTION_RANGES, selectionForSheet, selectionRanges } from "./selection";

export type SpreadsheetHistoryTarget = Readonly<{
  sheetId: string;
  focus: Readonly<SpreadsheetCellPosition>;
  ranges?: readonly SpreadsheetSelectionRange[];
  drawingId?: string;
}>;

/** Retain the user's complete selection, including blanks, direction and header provenance. */
export function captureHistorySelection(selection: SpreadsheetSelection): SpreadsheetHistoryTarget {
  return Object.freeze({ sheetId: selection.sheetId, focus: Object.freeze({ ...selection.focus }),
    ranges: Object.freeze(selectionRanges(selection).map(range => Object.freeze({
      anchor: Object.freeze({ ...range.anchor }), focus: Object.freeze({ ...range.focus }),
      ...(range.kind ? { kind: range.kind } : {}),
    }))) });
}

function sameCell(left: SpreadsheetCell | undefined, right: SpreadsheetCell | undefined): boolean {
  return left === right || ((left?.value ?? "") === (right?.value ?? "") &&
    formatsEqual(left?.format, right?.format) && dataValidationsEqual(left?.validation, right?.validation));
}

function changedCells(before: SpreadsheetSheet, next: SpreadsheetSheet): SpreadsheetCellPosition[] {
  const addresses = new Set<string>();
  if (before.cells !== next.cells) {
    for (const address of Object.keys(before.cells)) addresses.add(address);
    for (const address of Object.keys(next.cells)) addresses.add(address);
  }
  if (before.comments !== next.comments) {
    for (const address of Object.keys(before.comments ?? {})) addresses.add(address);
    for (const address of Object.keys(next.comments ?? {})) addresses.add(address);
  }
  const positions: SpreadsheetCellPosition[] = [];
  for (const address of addresses) {
    if (sameCell(before.cells[address], next.cells[address]) && commentsEqual(before.comments?.[address], next.comments?.[address])) continue;
    const position = parseCellAddress(address);
    if (position && position.row < next.rowCount && position.column < next.columnCount) positions.push(position);
  }
  return positions.sort((left, right) => left.row - right.row || left.column - right.column);
}

/** Join adjacent runs without selecting holes; use one bounding range only past the UI limit. */
function changedRanges(positions: readonly SpreadsheetCellPosition[]): SpreadsheetSelectionRange[] {
  const rectangles: { top: number; left: number; bottom: number; right: number }[] = [];
  const lastRun = new Map<string, (typeof rectangles)[number]>();
  for (let index = 0; index < positions.length;) {
    const start = positions[index++];
    let right = start.column;
    while (index < positions.length && positions[index].row === start.row && positions[index].column === right + 1) right = positions[index++].column;
    const key = `${start.column}:${right}`, previous = lastRun.get(key);
    if (previous?.bottom === start.row - 1) previous.bottom = start.row;
    else {
      const rectangle = { top: start.row, bottom: start.row, left: start.column, right };
      rectangles.push(rectangle); lastRun.set(key, rectangle);
      if (rectangles.length > MAX_SELECTION_RANGES) {
        let left = positions[0].column, right = left;
        for (const position of positions) { left = Math.min(left, position.column); right = Math.max(right, position.column); }
        return [{ anchor: { row: positions[0].row, column: left }, focus: { row: positions.at(-1)!.row, column: right } }];
      }
    }
  }
  const ranges = rectangles.map(range => ({ anchor: { row: range.top, column: range.left }, focus: { row: range.bottom, column: range.right } }));
  // The last range is active. Keep the earliest changed cell as its cursor.
  if (ranges.length > 1) ranges.push(ranges.shift()!);
  return ranges;
}

function sameImage(left: SpreadsheetImageResource | undefined, right: SpreadsheetImageResource | undefined): boolean {
  return left === right || (!!left && !!right && left.name === right.name && left.mimeType === right.mimeType &&
    left.dataUrl === right.dataUrl && left.width === right.width && left.height === right.height);
}

function drawingTarget(before: SpreadsheetWorkbook, next: SpreadsheetWorkbook, oldSheet: SpreadsheetSheet, sheet: SpreadsheetSheet): SpreadsheetHistoryTarget | null {
  const previous = new Map((oldSheet.drawings ?? []).map(drawing => [drawing.id, drawing]));
  for (const drawing of sheet.drawings ?? []) {
    const oldDrawing = previous.get(drawing.id);
    if (!oldDrawing || !drawingsEqual(oldDrawing, drawing) || (drawing.type === "image" &&
      !sameImage(before.resources?.images?.[drawing.resourceId], next.resources?.images?.[drawing.resourceId])))
      return { sheetId: sheet.id, drawingId: drawing.id, focus: clampPosition(drawing.anchor, sheet) };
  }
  const present = new Set((sheet.drawings ?? []).map(drawing => drawing.id));
  const removed = oldSheet.drawings?.find(drawing => !present.has(drawing.id));
  if (!removed) return null;
  const position = clampPosition(removed.anchor, sheet);
  const selection = selectionForSheet(sheet, [{ anchor: position, focus: position }]);
  return { sheetId: sheet.id, focus: selection.focus, ranges: selection.ranges };
}

/** Fallback for external commands and drawing operations without a captured cell selection. */
export function findHistoryTarget(before: SpreadsheetWorkbook, next: SpreadsheetWorkbook, preferredSheetId: string): SpreadsheetHistoryTarget | null {
  if (before === next || before.sheets.length !== next.sheets.length) return null;
  // Structural edits can rewrite thousands of coordinates/formulas as a side
  // effect. Preserve the normal clamped selection instead of treating those as
  // independently edited cells, including sheets referenced from another sheet.
  if (before.sheets.some((sheet, index) => {
    const other = next.sheets[index];
    return sheet.id !== other.id || sheet.name !== other.name || sheet.rowCount !== other.rowCount ||
      sheet.columnCount !== other.columnCount || !mergesEqual(sheet.merges, other.merges);
  })) return null;
  const preferred = next.sheets.findIndex(sheet => sheet.id === preferredSheetId);
  const indices = next.sheets.map((_sheet, index) => index);
  if (preferred > 0) indices.unshift(...indices.splice(preferred, 1));
  for (const index of indices) {
    const oldSheet = before.sheets[index], sheet = next.sheets[index];
    const cells = changedCells(oldSheet, sheet);
    if (cells.length) {
      // Expand intact merged cells without introducing more than 128 ranges.
      const selection = selectionForSheet(sheet, changedRanges(cells), true, cells[0]);
      return { sheetId: sheet.id, focus: selection.focus, ranges: selection.ranges };
    }
    const drawing = drawingTarget(before, next, oldSheet, sheet);
    if (drawing) return drawing;
  }
  return null;
}
