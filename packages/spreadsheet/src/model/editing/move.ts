import { parseCellAddress } from "../address";
import { rangesIntersect } from "../merges";
import { moveCells } from "../workbook/move-cells";
import type { SpreadsheetMoveSource, SpreadsheetMoveTarget, SpreadsheetWorkbook } from "../types";

/** The same cut semantics for GUI and commands; metadata moves intact rather than being recopied. */
export function moveSpreadsheetCells(workbook: SpreadsheetWorkbook, source: SpreadsheetMoveSource, target: SpreadsheetMoveTarget,
  policy: Readonly<{ formulas: boolean; mergeCells: boolean }>): SpreadsheetWorkbook {
  const next = moveCells(workbook, source, target); // Validate geometry and references before traversing caller ranges.
  const from = workbook.sheets.find(sheet => sheet.id === source.sheetId)!, to = workbook.sheets.find(sheet => sheet.id === target.sheetId)!;
  if (!policy.formulas && Object.entries(from.cells).some(([address, cell]) => {
    const position = parseCellAddress(address)!;
    return position.row >= source.top && position.row <= source.bottom && position.column >= source.left &&
      position.column <= source.right && cell.value.startsWith("=");
  })) throw new Error("数式の入力は無効です");
  const destination = { top: target.row, left: target.column, bottom: target.row + source.bottom - source.top,
    right: target.column + source.right - source.left };
  if (!policy.mergeCells && ((from.merges ?? []).some(merge => rangesIntersect(source, merge)) ||
    (to.merges ?? []).some(merge => rangesIntersect(destination, merge)))) throw new Error("セルの結合の変更は無効です");
  return next;
}
