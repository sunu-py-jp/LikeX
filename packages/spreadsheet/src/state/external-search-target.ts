import { parseCellAddress } from "../model/address";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetSelectionRange } from "../props";

/** Validate destinations again at navigation time: a result can outlive its sheet. */
export function resolveExternalSearchTarget(workbook: SpreadsheetWorkbook, target: unknown): { sheetId: string; range: SpreadsheetSelectionRange } | null {
  if (!target || typeof target !== "object" || !("sheetId" in target) || !("range" in target) ||
    typeof target.sheetId !== "string" || typeof target.range !== "string") return null;
  const sheet = workbook.sheets.find(item => item.id === target.sheetId);
  if (!sheet) return null;
  const parts = target.range.split(":"), start = parseCellAddress(parts[0]), end = parseCellAddress(parts[1] ?? parts[0]);
  if (parts.length > 2 || !start || !end || [start, end].some(position => position.row >= sheet.rowCount || position.column >= sheet.columnCount)) return null;
  // The API reveals the active endpoint. Keep it at the beginning even for a range larger than the viewport.
  return { sheetId: sheet.id, range: {
    anchor: { row: Math.max(start.row, end.row), column: Math.max(start.column, end.column) },
    focus: { row: Math.min(start.row, end.row), column: Math.min(start.column, end.column) },
  } };
}
