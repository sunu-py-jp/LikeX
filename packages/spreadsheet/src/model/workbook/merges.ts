import { cellAddress, parseCellAddress } from "../address";
import { mergedContentWouldBeDiscarded, normalizeMerges, rangeContains, rangesIntersect, validateMergedRange } from "../merges";
import type { SpreadsheetMergedRange, SpreadsheetWorkbook } from "../types";
import { freezeCell, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { fail } from "./validation";

/** Merge a rectangle. Discarding covered values/comments requires an explicit caller decision. */
export function mergeCells(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetMergedRange,
  options: { discardValues?: boolean } = {}): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  validateMergedRange(range, sheet);
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    (options.discardValues !== undefined && typeof options.discardValues !== "boolean"))
    return fail("結合時の値の破棄は true または false で指定してください");
  const existing = sheet.merges ?? [];
  for (const merge of existing) if (rangesIntersect(range, merge) && !rangeContains(range, merge))
    return fail("結合セルの一部分だけを結合できません。結合範囲全体を選択してください");
  if (existing.some(merge => rangeContains(range, merge) && rangeContains(merge, range))) return workbook;
  if (!options.discardValues && mergedContentWouldBeDiscarded(sheet, range))
    return fail("結合すると左上以外のセルの値とコメントが失われます");
  const cells = { ...sheet.cells }, comments = { ...sheet.comments }, anchor = cellAddress(range.top, range.left);
  const covered = (address: string) => {
    if (address === anchor) return false;
    const { row, column } = parseCellAddress(address)!;
    return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
  };
  for (const [address, cell] of Object.entries(cells)) if (covered(address) && cell.value) {
    if (cell.format) cells[address] = freezeCell("", cell.format);
    else delete cells[address];
  }
  for (const address of Object.keys(comments)) if (covered(address)) {
    delete comments[address];
  }
  const merges = normalizeMerges([...existing.filter(merge => !rangesIntersect(range, merge)), range], sheet);
  return replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells), merges,
    ...(sheet.comments ? { comments: Object.freeze(comments) } : {}) });
}

/** Unmerge every intersected range; deleted covered values are not reconstructed. */
export function unmergeCells(workbook: SpreadsheetWorkbook, sheetId: string, range: SpreadsheetMergedRange): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  validateMergedRange(range, sheet, true);
  const merges = sheet.merges?.filter(merge => !rangesIntersect(range, merge));
  if (!merges || merges.length === sheet.merges?.length) return workbook;
  return replaceWorkbookSheet(workbook, { ...sheet, merges: merges.length ? Object.freeze(merges) : undefined });
}
