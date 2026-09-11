import { shiftConditionalFormats } from "../conditional-formatting";
import { cellAddress, parseCellAddress } from "../address";
import { moveFormulaReference, rewriteFormulaReferences, type FormulaReference } from "../formula";
import { normalizeMerges } from "../merges";
import { DEFAULT_COLUMN_WIDTH } from "../sheet-dimensions";
import { shiftNamedRanges } from "../named-ranges";
import { shiftSheetTables } from "./table-structure";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetComment, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { finishWorkbook, freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { fail, validateDimension } from "./validation";

export function resizeColumn(workbook: SpreadsheetWorkbook, sheetId: string, column: number, width: number): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (!Number.isInteger(column) || column < 0 || column >= sheet.columnCount || !Number.isFinite(width)) return fail("列の位置または幅が正しくありません");
  const value = Math.min(1000, Math.max(24, Math.round(width)));
  if ((sheet.columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH) === value) return workbook;
  return replaceWorkbookSheet(workbook, { ...sheet, columnWidths: Object.freeze({ ...sheet.columnWidths, [column]: value }) });
}

function coordinateAfter(value: number, index: number, count: number, remove: boolean): number | null {
  if (!remove) return value >= index ? value + count : value;
  return value < index ? value : value >= index + count ? value - count : null;
}
function intervalAfter(first: number, last: number, index: number, count: number, remove: boolean): [number, number] | null {
  if (!remove) return [coordinateAfter(first, index, count, false)!, coordinateAfter(last, index, count, false)!];
  const low = Math.min(first, last), high = Math.max(first, last), end = index + count;
  if (low >= index && high < end) return null;
  const start = low < index ? low : Math.max(low, end) - count;
  const finish = high >= end ? high - count : Math.min(high, index - 1);
  return first <= last ? [start, finish] : [finish, start];
}
function transformReferences(formula: string, currentName: string, targetName: string,
  axis: "row" | "column", index: number, count: number, remove: boolean) {
  const matches = (reference: FormulaReference, inherited = currentName) => (reference.sheet ?? inherited).toLocaleLowerCase("en-US") === targetName.toLocaleLowerCase("en-US");
  const single = (reference: FormulaReference) => {
    if (!matches(reference)) return undefined;
    const position = parseCellAddress(reference.address);
    if (!position) return "#REF!";
    const next = coordinateAfter(position[axis], index, count, remove);
    if (next === null) return "#REF!";
    return moveFormulaReference(reference, axis === "row" ? next : position.row, axis === "column" ? next : position.column);
  };
  return rewriteFormulaReferences(formula, single, (first, last) => {
    const firstMatches = matches(first), lastMatches = matches(last, first.sheet ?? currentName);
    if (!firstMatches && !lastMatches) return undefined;
    const a = parseCellAddress(first.address), b = parseCellAddress(last.address);
    if (!a || !b) return "#REF!";
    if (firstMatches !== lastMatches) return "#REF!";
    const next = intervalAfter(a[axis], b[axis], index, count, remove);
    if (!next) return "#REF!";
    return `${moveFormulaReference(first, axis === "row" ? next[0] : a.row, axis === "column" ? next[0] : a.column)}:${moveFormulaReference(last, axis === "row" ? next[1] : b.row, axis === "column" ? next[1] : b.column)}`;
  });
}
function shiftSizes(input: Readonly<Record<number, number>> | undefined, index: number, count: number, remove: boolean) {
  if (!input) return undefined;
  const result: Record<number, number> = {};
  for (const [key, size] of Object.entries(input)) {
    const next = coordinateAfter(Number(key), index, count, remove);
    if (next !== null) result[next] = size;
  }
  return Object.freeze(result);
}
function shiftMerges(sheet: SpreadsheetSheet, axis: "row" | "column", index: number, count: number, remove: boolean, total: number) {
  if (!sheet.merges?.length) return sheet.merges;
  const ranges: SpreadsheetMergedRange[] = [];
  for (const merge of sheet.merges) {
    const interval = intervalAfter(axis === "row" ? merge.top : merge.left,
      axis === "row" ? merge.bottom : merge.right, index, count, remove);
    if (!interval) continue;
    const next = axis === "row" ? { ...merge, top: interval[0], bottom: interval[1] }
      : { ...merge, left: interval[0], right: interval[1] };
    if (next.top !== next.bottom || next.left !== next.right) ranges.push(next);
  }
  return normalizeMerges(ranges, { rowCount: axis === "row" ? total : sheet.rowCount,
    columnCount: axis === "column" ? total : sheet.columnCount });
}
function shiftAnnotations(sheet: SpreadsheetSheet, axis: "row" | "column", index: number, count: number, remove: boolean, total: number) {
  const comments: Record<string, SpreadsheetComment> = Object.create(null);
  for (const [address, comment] of Object.entries(sheet.comments ?? {})) {
    const position = parseCellAddress(address)!, next = coordinateAfter(position[axis], index, count, remove);
    if (next !== null) comments[cellAddress(axis === "row" ? next : position.row, axis === "column" ? next : position.column)] = comment;
  }
  const drawings = sheet.drawings?.map(drawing => {
    const next = coordinateAfter(drawing.anchor[axis], index, count, remove) ?? Math.min(index, total - 1);
    if (next === drawing.anchor[axis]) return drawing;
    return Object.freeze({ ...drawing, anchor: Object.freeze({ ...drawing.anchor, [axis]: next }) });
  });
  return { ...(sheet.comments ? { comments: Object.freeze(comments) } : {}), ...(drawings ? { drawings: Object.freeze(drawings) } : {}) };
}

function changeAxis(workbook: SpreadsheetWorkbook, sheetId: string, axis: "row" | "column", index: number, count: number, remove: boolean): SpreadsheetWorkbook {
  const target = getWorkbookSheet(workbook, sheetId), limit = axis === "row" ? target.rowCount : target.columnCount;
  if (!Number.isInteger(index) || index < 0 || index > limit || !Number.isInteger(count) || count < 1 || (remove && index + count > limit))
    return fail("挿入・削除する行列の範囲が正しくありません");
  const total = validateDimension(limit + (remove ? -count : count), axis === "row" ? SPREADSHEET_LIMITS.rows : SPREADSHEET_LIMITS.columns);
  return finishWorkbook(workbook.sheets.map(sheet => {
    let changed = sheet.id === sheetId;
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    for (const [address, cell] of Object.entries(sheet.cells)) {
      let nextAddress = address;
      if (sheet.id === sheetId) {
        const position = parseCellAddress(address)!;
        const next = coordinateAfter(position[axis], index, count, remove);
        if (next === null) continue;
        nextAddress = cellAddress(axis === "row" ? next : position.row, axis === "column" ? next : position.column);
      }
      const value = transformReferences(cell.value, sheet.name, target.name, axis, index, count, remove);
      if (value !== cell.value) changed = true;
      cells[nextAddress] = value === cell.value ? cell : freezeCell(value, cell.format, cell.validation);
    }
    if (!changed) return sheet;
    return Object.freeze({ ...sheet, cells: Object.freeze(cells),
      ...(sheet.id === sheetId && sheet.conditionalFormats ? { conditionalFormats: shiftConditionalFormats(sheet.conditionalFormats, axis, index, count, remove) } : {}),
      ...(sheet.id === sheetId && sheet.merges ? { merges: shiftMerges(sheet, axis, index, count, remove, total) } : {}),
      ...(sheet.id === sheetId && sheet.tables ? { tables: shiftSheetTables(sheet.tables, axis, index, count, remove) } : {}),
      ...(sheet.id === sheetId ? shiftAnnotations(sheet, axis, index, count, remove, total) : {}), ...(sheet.id === sheetId ? axis === "row"
      ? { rowCount: total, rowHeights: shiftSizes(sheet.rowHeights, index, count, remove) }
      : { columnCount: total, columnWidths: shiftSizes(sheet.columnWidths, index, count, remove) } : {}) });
  }), workbook, workbook.resources, shiftNamedRanges(workbook.namedRanges, sheetId, axis, index, count, remove));
}
export function insertRows(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "row", index, count, false); }
export function deleteRows(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "row", index, count, true); }
export function insertColumns(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "column", index, count, false); }
export function deleteColumns(workbook: SpreadsheetWorkbook, id: string, index: number, count = 1) { return changeAxis(workbook, id, "column", index, count, true); }
