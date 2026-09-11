import { namedRangesEqual, normalizeNamedRangeRectangle, normalizeNamedRanges, type SpreadsheetNamedRangeInput } from "../named-ranges";
import type { SpreadsheetNamedRange, SpreadsheetWorkbook } from "../types";
import { finishWorkbook, getWorkbookSheet } from "./snapshot";

export function requireNamedRange(workbook: SpreadsheetWorkbook, sheetId: string, id: string): SpreadsheetNamedRange {
  getWorkbookSheet(workbook, sheetId);
  if (typeof id !== "string" || !id) throw new Error("名前付き範囲のIDを指定してください");
  const range = workbook.namedRanges?.find(item => item.id === id && item.sheetId === sheetId);
  if (!range) throw new Error("名前付き範囲が見つかりません");
  return range;
}

export function addNamedRangeWithId(workbook: SpreadsheetWorkbook, sheetId: string, name: string,
  range: SpreadsheetNamedRangeInput, id: string): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  const namedRanges = normalizeNamedRanges([...(workbook.namedRanges ?? []),
    { id, name, sheetId, range: normalizeNamedRangeRectangle(range, sheet) }], workbook.sheets);
  return finishWorkbook(workbook.sheets, workbook, workbook.resources, namedRanges);
}

export function updateNamedRange(workbook: SpreadsheetWorkbook, sheetId: string, id: string,
  patch: Readonly<{ name?: string; range?: SpreadsheetNamedRangeInput }>): SpreadsheetWorkbook {
  const current = requireNamedRange(workbook, sheetId, id), sheet = getWorkbookSheet(workbook, sheetId);
  const item = { ...current, ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.range !== undefined ? { range: normalizeNamedRangeRectangle(patch.range, sheet) } : {}) };
  const namedRanges = normalizeNamedRanges(workbook.namedRanges!.map(range => range.id === id ? item : range), workbook.sheets);
  if (namedRangesEqual(workbook.namedRanges, namedRanges)) return workbook;
  return finishWorkbook(workbook.sheets, workbook, workbook.resources, namedRanges);
}

/** Remove only the definition. Content clearing is an explicit command option. */
export function removeNamedRange(workbook: SpreadsheetWorkbook, sheetId: string, id: string): SpreadsheetWorkbook {
  requireNamedRange(workbook, sheetId, id);
  return finishWorkbook(workbook.sheets, workbook, workbook.resources, workbook.namedRanges!.filter(item => item.id !== id));
}
