import { cellAddress, parseCellAddress } from "../address";
import { isFormulaCell } from "../cell-value";
import { normalizeConditionalFormats } from "../conditional-formatting";
import { normalizeMerges, rangeContains, rangesIntersect, validateMergedContents } from "../merges";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetCellPosition, type SpreadsheetComment,
  type SpreadsheetMergedRange, type SpreadsheetWorkbook } from "../types";
import { resolveCellRange, type SpreadsheetCellRangeInput } from "./clear";
import { rectangleAffected, rewriteShiftedFormula, shiftCellPosition, shiftCellRectangle, type CellShift } from "./shift-cells-transform";
import { finishWorkbook, freezeCell, getWorkbookSheet } from "./snapshot";
import { shiftSheetTables } from "./table-structure";
import { fail, validateDimension } from "./validation";

/** Shift only the selected lanes; sparse data and metadata determine any necessary insertion growth. */
function changeCellRange(workbook: SpreadsheetWorkbook, sheetId: string, input: SpreadsheetCellRangeInput,
  direction: "down" | "right" | "up" | "left", remove: boolean): SpreadsheetWorkbook {
  const target = getWorkbookSheet(workbook, sheetId), range = resolveCellRange(target, input);
  const rows = direction === "down" || direction === "up";
  const shift: CellShift = { axis: rows ? "row" : "column", index: rows ? range.top : range.left,
    count: rows ? range.bottom - range.top + 1 : range.right - range.left + 1,
    firstLane: rows ? range.left : range.top, lastLane: rows ? range.right : range.bottom, remove };
  let rowCount = target.rowCount, columnCount = target.columnCount;
  const requirePosition = (position: SpreadsheetCellPosition) => {
    validateDimension(position.row + 1, SPREADSHEET_LIMITS.rows);
    validateDimension(position.column + 1, SPREADSHEET_LIMITS.columns);
    if (!remove) { rowCount = Math.max(rowCount, position.row + 1); columnCount = Math.max(columnCount, position.column + 1); }
  };
  const transformRange = (area: SpreadsheetMergedRange, label: string) => {
    const next = shiftCellRectangle(area, shift, label);
    if (next) requirePosition({ row: next.bottom, column: next.right });
    return next;
  };
  const namedRanges = workbook.namedRanges?.flatMap(item => {
    if (item.sheetId !== sheetId) return [item];
    const next = transformRange(item.range, "名前付き範囲");
    return next ? [next === item.range ? item : Object.freeze({ ...item, range: next })] : [];
  });
  const merges = target.merges?.flatMap(merge => {
    const first = rows ? merge.top : merge.left, last = rows ? merge.bottom : merge.right;
    if (remove ? rangesIntersect(range, merge) && !rangeContains(range, merge)
      : rectangleAffected(merge, shift) && shift.index > first && shift.index <= last)
      return fail("結合セルの一部分だけは挿入・削除できません。結合範囲全体を選択してください");
    const next = transformRange(merge, "結合範囲");
    return next && (next.top !== next.bottom || next.left !== next.right) ? [next] : [];
  });
  const conditionalFormats = target.conditionalFormats?.flatMap(rule => {
    const ranges = rule.ranges.flatMap(area => {
      const next = transformRange(area, "条件付き書式の範囲"); return next ? [next] : [];
    });
    return ranges.length ? [Object.freeze({ ...rule, ranges: Object.freeze(ranges) })] : [];
  });
  const tables = target.tables?.flatMap(table => {
    if (!rectangleAffected(table.range, shift)) return [table];
    const first = rows ? table.range.left : table.range.top, last = rows ? table.range.right : table.range.bottom;
    if (first < shift.firstLane || last > shift.lastLane)
      return fail("テーブルの一部分だけは移動できません。テーブル全体を含む行または列を選択してください");
    const next = shiftSheetTables([table], shift.axis, shift.index, shift.count, remove)?.[0];
    if (next) requirePosition({ row: next.range.bottom, column: next.range.right });
    return next ? [next] : [];
  });
  const comments: Record<string, SpreadsheetComment> = Object.create(null);
  for (const [address, comment] of Object.entries(target.comments ?? {})) {
    const next = shiftCellPosition(parseCellAddress(address)!, shift);
    if (next) { requirePosition(next); comments[cellAddress(next.row, next.column)] = comment; }
  }
  const drawings = target.drawings?.map(drawing => {
    const next = shiftCellPosition(drawing.anchor, shift) ?? { ...drawing.anchor, [shift.axis]: shift.index };
    requirePosition(next);
    return next === drawing.anchor ? drawing : Object.freeze({ ...drawing, anchor: Object.freeze({ ...drawing.anchor, ...next }) });
  });
  // Process every formula before constructing the target sheet: references can require extra blank capacity.
  const sheets = workbook.sheets.map(sheet => {
    let changed = sheet.id === sheetId;
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    for (const [address, cell] of Object.entries(sheet.cells)) {
      let nextAddress = address;
      if (sheet.id === sheetId) {
        const next = shiftCellPosition(parseCellAddress(address)!, shift);
        if (!next) continue;
        requirePosition(next); nextAddress = cellAddress(next.row, next.column);
      }
      const value = isFormulaCell(cell) ? rewriteShiftedFormula(cell.value, sheet.name, target, shift, requirePosition) : cell.value;
      if (value !== cell.value) changed = true;
      cells[nextAddress] = value === cell.value ? cell : freezeCell(value, cell.format, cell.validation);
    }
    return changed ? Object.freeze({ ...sheet, cells: Object.freeze(cells) }) : sheet;
  }).map(sheet => {
    if (sheet.id !== sheetId) return sheet;
    const dimensions = { rowCount, columnCount };
    const next = Object.freeze({ ...sheet, ...dimensions,
      ...(target.comments ? { comments: Object.freeze(comments) } : {}),
      ...(drawings ? { drawings: Object.freeze(drawings) } : {}),
      ...(target.merges ? { merges: normalizeMerges(merges, dimensions) } : {}),
      ...(target.conditionalFormats ? { conditionalFormats: normalizeConditionalFormats(conditionalFormats, dimensions) } : {}),
      ...(target.tables ? { tables: tables?.length ? Object.freeze(tables) : undefined } : {}) });
    validateMergedContents(next);
    return next;
  });
  return finishWorkbook(sheets, workbook, workbook.resources, namedRanges);
}

/** Insert blank cells, moving cells down within selected columns or right within selected rows. */
export function insertCellRange(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetCellRangeInput,
  shift: "down" | "right"): SpreadsheetWorkbook {
  if (shift !== "down" && shift !== "right") return fail("セルの挿入方向は down または right を指定してください");
  return changeCellRange(workbook, sheetId, range, shift, false);
}

/** Delete a rectangle, closing its gap upward or leftward without reducing the sheet dimensions. */
export function deleteCellRange(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetCellRangeInput,
  shift: "up" | "left"): SpreadsheetWorkbook {
  if (shift !== "up" && shift !== "left") return fail("セルの削除方向は up または left を指定してください");
  return changeCellRange(workbook, sheetId, range, shift, true);
}
