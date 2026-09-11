import { cellAddress } from "../address";
import { rangeContains, rangesIntersect } from "../merges";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../types";
import { setCellValues } from "./cells";
import { getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { normalizeNamedRangeRectangle } from "../named-ranges";
import { normalizeConditionalFormats } from "../conditional-formatting";

export type SpreadsheetClearMode = "values" | "all";
export type SpreadsheetCellRangeInput = string | SpreadsheetMergedRange;

export function resolveCellRange(sheet: SpreadsheetSheet, input: SpreadsheetCellRangeInput): SpreadsheetMergedRange {
  const range = normalizeNamedRangeRectangle(input, sheet);
  if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > SPREADSHEET_LIMITS.rangeCells)
    throw new Error("一度に変更できる範囲は10,000セルまでです");
  return Object.freeze({ ...range });
}

/** No shifting: values preserves formats/rules/comments; all removes cell records and enclosed structures. */
export function clearCellRange(workbook: SpreadsheetWorkbook, sheetId: string, input: SpreadsheetCellRangeInput,
  mode: SpreadsheetClearMode = "values"): SpreadsheetWorkbook {
  if (mode !== "values" && mode !== "all") throw new Error("クリアの方式が正しくありません");
  const sheet = getWorkbookSheet(workbook, sheetId), range = resolveCellRange(sheet, input);
  const merges = sheet.merges ?? [], tables = sheet.tables ?? [];
  if (merges.some(merge => rangesIntersect(range, merge) && !rangeContains(range, merge)))
    throw new Error("結合セル全体を含む範囲を指定してください");
  if (mode === "values") {
    const values: Record<string, string> = {};
    for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++)
      values[cellAddress(row, column)] = "";
    return setCellValues(workbook, sheetId, values);
  }
  if (tables.some(table => rangesIntersect(range, table.range) && !rangeContains(range, table.range)))
    throw new Error("テーブルの一部だけを削除できません。値のクリアかテーブル全体の削除を指定してください");
  const cells = { ...sheet.cells }, comments = { ...sheet.comments };
  for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
    const key = cellAddress(row, column); delete cells[key]; delete comments[key];
  }
  const retainedMerges = merges.filter(merge => !rangeContains(range, merge));
  const retainedTables = tables.filter(table => !rangeContains(range, table.range));
  const conditionalFormats = sheet.conditionalFormats?.flatMap(rule => {
    const ranges = rule.ranges.flatMap(area => {
      if (!rangesIntersect(area, range)) return [area];
      const top = Math.max(area.top, range.top), bottom = Math.min(area.bottom, range.bottom);
      const left = Math.max(area.left, range.left), right = Math.min(area.right, range.right);
      return [
        ...(area.top < top ? [{ ...area, bottom: top - 1 }] : []),
        ...(area.bottom > bottom ? [{ ...area, top: bottom + 1 }] : []),
        ...(area.left < left ? [{ top, bottom, left: area.left, right: left - 1 }] : []),
        ...(area.right > right ? [{ top, bottom, left: right + 1, right: area.right }] : []),
      ];
    });
    return ranges.length ? [{ ...rule, ranges }] : [];
  });
  return replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells),
    ...(sheet.comments ? { comments: Object.freeze(comments) } : {}),
    ...(sheet.merges ? { merges: Object.freeze(retainedMerges) } : {}),
    ...(sheet.tables ? { tables: Object.freeze(retainedTables) } : {}),
    ...(sheet.conditionalFormats ? { conditionalFormats: normalizeConditionalFormats(conditionalFormats, sheet) } : {}) });
}
