import { parseCellAddress } from "../address";
import { moveFormulaReference, rewriteFormulaReferences, tokenizeFormula, type FormulaReference } from "../formula";
import { shiftRangeInterval } from "../named-ranges";
import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition, type SpreadsheetMergedRange, type SpreadsheetSheet } from "../types";
import { fail } from "./validation";

export type CellShift = Readonly<{
  axis: "row" | "column"; index: number; count: number; firstLane: number; lastLane: number; remove: boolean;
}>;

export function shiftCellPosition(position: SpreadsheetCellPosition, shift: CellShift): SpreadsheetCellPosition | null {
  const lane = shift.axis === "row" ? position.column : position.row, value = position[shift.axis];
  if (lane < shift.firstLane || lane > shift.lastLane || value < shift.index) return position;
  if (shift.remove && value < shift.index + shift.count) return null;
  return { ...position, [shift.axis]: value + (shift.remove ? -shift.count : shift.count) };
}

export function rectangleAffected(range: SpreadsheetMergedRange, shift: CellShift): boolean {
  const firstLane = shift.axis === "row" ? range.left : range.top;
  const lastLane = shift.axis === "row" ? range.right : range.bottom;
  const last = shift.axis === "row" ? range.bottom : range.right;
  return firstLane <= shift.lastLane && lastLane >= shift.firstLane && last >= shift.index;
}

/** Each lane retains structural insert/delete interval semantics. Only a rectangular union is representable. */
export function shiftCellRectangle(range: SpreadsheetMergedRange, shift: CellShift, label: string): SpreadsheetMergedRange | null {
  if (!rectangleAffected(range, shift)) return range;
  const rows = shift.axis === "row", first = rows ? range.top : range.left, last = rows ? range.bottom : range.right;
  const firstLane = rows ? range.left : range.top, lastLane = rows ? range.right : range.bottom;
  const interval = shiftRangeInterval(first, last, shift.index, shift.count, shift.remove);
  const parts: SpreadsheetMergedRange[] = [];
  const add = (start: number, end: number, laneStart: number, laneEnd: number) => {
    parts.push(rows ? { top: start, bottom: end, left: laneStart, right: laneEnd }
      : { left: start, right: end, top: laneStart, bottom: laneEnd });
  };
  if (firstLane < shift.firstLane) add(first, last, firstLane, shift.firstLane - 1);
  if (interval) add(interval[0], interval[1], Math.max(firstLane, shift.firstLane), Math.min(lastLane, shift.lastLane));
  if (lastLane > shift.lastLane) add(first, last, shift.lastLane + 1, lastLane);
  if (!parts.length) return null;
  const result = {
    top: Math.min(...parts.map(part => part.top)), bottom: Math.max(...parts.map(part => part.bottom)),
    left: Math.min(...parts.map(part => part.left)), right: Math.max(...parts.map(part => part.right)),
  };
  const area = (part: SpreadsheetMergedRange) => (part.bottom - part.top + 1) * (part.right - part.left + 1);
  if (area(result) !== parts.reduce((sum, part) => sum + area(part), 0))
    return fail(`${label}が長方形でなくなるため、セルを挿入・削除できません。影響する範囲全体の行または列を選択してください`);
  return Object.freeze(result);
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
/** Structural edits follow the original referenced cells, including absolute references, across every sheet. */
export function rewriteShiftedFormula(formula: string, currentName: string, target: SpreadsheetSheet,
  shift: CellShift, requirePosition: (position: SpreadsheetCellPosition) => void): string {
  // The generic rewriter intentionally ignores unsupported syntax; a destructive shift cannot safely do that.
  try { tokenizeFormula(formula); } catch { return fail("数式の参照を安全に解析できないため、セルを挿入・削除できません"); }
  const matches = (reference: FormulaReference, inherited = currentName) => sameName(reference.sheet ?? inherited, target.name);
  const inSheet = (position: SpreadsheetCellPosition) => position.row < target.rowCount && position.column < target.columnCount;
  const result = rewriteFormulaReferences(formula, reference => {
    if (!matches(reference)) return undefined;
    const position = parseCellAddress(reference.address);
    if (!position) return "#REF!";
    const next = shiftCellPosition(position, shift);
    if (next === position) return undefined;
    if (!next) return "#REF!";
    if (inSheet(position)) requirePosition(next);
    return moveFormulaReference(reference, next.row, next.column);
  }, (first, last) => {
    const firstMatches = matches(first), lastMatches = matches(last, first.sheet ?? currentName);
    if (!firstMatches && !lastMatches) return undefined;
    if (firstMatches !== lastMatches) return fail("異なるシートにまたがる範囲参照はセルの挿入・削除で変更できません");
    const a = parseCellAddress(first.address), b = parseCellAddress(last.address);
    if (!a || !b) return "#REF!";
    const range = { top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row),
      left: Math.min(a.column, b.column), right: Math.max(a.column, b.column) };
    const next = shiftCellRectangle(range, shift, "数式の参照範囲");
    if (next === range) return undefined;
    if (!next) return "#REF!";
    if (inSheet(a) && inSheet(b)) requirePosition({ row: next.bottom, column: next.right });
    const start = moveFormulaReference(first, a.row <= b.row ? next.top : next.bottom, a.column <= b.column ? next.left : next.right);
    const end = moveFormulaReference(last, a.row <= b.row ? next.bottom : next.top, a.column <= b.column ? next.right : next.left);
    return start === "#REF!" || end === "#REF!" ? "#REF!" : `${start}:${end}`;
  });
  if (result.length > SPREADSHEET_LIMITS.formulaLength) return fail("セルの挿入・削除後の数式が長さの上限を超えています");
  return result;
}
