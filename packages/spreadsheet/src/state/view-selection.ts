import type { SpreadsheetSelection, SpreadsheetSelectionRange } from "../props";
import type { SpreadsheetCellPosition, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetFeatureSettings } from "../api/resolve-features";
import { axisSelectionRange, initialSheetSelection, isCellSelected, MAX_SELECTION_RANGES, selectionForSheet } from "./selection";

export type ViewSelectionTarget =
  | { type: "sheet"; sheetId: string }
  | { type: "ranges"; sheetId: string; ranges: readonly SpreadsheetSelectionRange[]; focus?: SpreadsheetCellPosition; expand?: boolean }
  | { type: "row" | "column"; sheetId: string; start: number; end: number }
  | { type: "drawing"; sheetId: string; drawingId: string }
  | { type: "clear" }
  | { type: "drawing.clear" };

/** Validate the complete target before publishing any view state; GUI and ref use identical merge/axis rules. */
export function resolveViewSelection(workbook: SpreadsheetWorkbook, current: SpreadsheetSelection,
  target: ViewSelectionTarget, features: SpreadsheetFeatureSettings): { selection: SpreadsheetSelection; drawingId: string | null } {
  const fail = (): never => { throw new Error("選択するシート、セル範囲またはオブジェクトが正しくありません"); };
  const sheetId = target.type === "clear" || target.type === "drawing.clear" ? current.sheetId : target.sheetId;
  const sheet = workbook.sheets.find(item => item.id === sheetId);
  if (!sheet || (!features.sheets && sheetId !== current.sheetId)) return fail();
  const position = (value: SpreadsheetCellPosition) => {
    if (!value || !Number.isInteger(value.row) || !Number.isInteger(value.column) || value.row < 0 || value.column < 0 ||
      value.row >= sheet.rowCount || value.column >= sheet.columnCount) fail();
  };
  if (target.type === "drawing") {
    const drawing = sheet.drawings?.find(item => item.id === target.drawingId);
    if (!drawing || !(drawing.type === "image" ? features.images : drawing.type === "shape" ? features.shapes : features.textBoxes)) return fail();
    return { selection: sheet.id === current.sheetId ? current : initialSheetSelection(sheet), drawingId: drawing.id };
  }
  if (target.type === "sheet") return { selection: initialSheetSelection(sheet), drawingId: null };
  if (target.type === "drawing.clear") return { selection: current, drawingId: null };
  if (target.type === "clear") return { selection: selectionForSheet(sheet, [{ anchor: current.focus, focus: current.focus }]), drawingId: null };
  if (target.type === "row" || target.type === "column") {
    const count = target.type === "row" ? sheet.rowCount : sheet.columnCount;
    if (![target.start, target.end].every(index => Number.isInteger(index) && index >= 0 && index < count)) return fail();
    return { selection: selectionForSheet(sheet, [axisSelectionRange(sheet, target.type, target.start, target.end)]), drawingId: null };
  }
  if (target.type !== "ranges" || !Array.isArray(target.ranges) || !target.ranges.length) return fail();
  if (target.ranges.length > MAX_SELECTION_RANGES) throw new Error(`一度に選択できる範囲は ${MAX_SELECTION_RANGES} 個までです`);
  for (const range of target.ranges) {
    if (!range || (range.kind !== undefined && range.kind !== "row" && range.kind !== "column")) return fail();
    position(range.anchor); position(range.focus);
  }
  if (target.focus) position(target.focus);
  const selection = selectionForSheet(sheet, target.ranges, target.expand !== false, target.focus);
  if (!isCellSelected(selection, selection.focus)) return fail();
  return { selection, drawingId: null };
}
