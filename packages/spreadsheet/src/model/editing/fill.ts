import { cellAddress } from "../address";
import { rangeContains, rangesIntersect } from "../merges";
import { translateFormula } from "../formula";
import { SPREADSHEET_LIMITS, type SpreadsheetMergedRange, type SpreadsheetWorkbook } from "../types";
import { getWorkbookSheet, replaceWorkbookSheet } from "../workbook/snapshot";
import { validateCellValue } from "../workbook/validation";
import { isIsoCalendarDate } from "../data-validation";

function validateRange(range: SpreadsheetMergedRange, rows: number, columns: number): void {
  if (!range || ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) || range.top < 0 || range.left < 0 ||
    range.bottom < range.top || range.right < range.left || range.bottom >= rows || range.right >= columns) throw new Error("オートフィルの範囲が正しくありません");
}
function sequence(values: readonly string[], mode: "auto" | "copy" | "series"): ((index: number) => string) | null {
  if (mode === "copy") return null;
  if (values.every(isIsoCalendarDate)) {
    const days = values.map(value => Date.parse(`${value}T00:00:00Z`) / 86_400_000);
    const start = days[0], step = days.length > 1 ? days[1] - start : 1;
    if (days.every((day, i) => day === start + step * i)) return index => {
      const next = new Date((start + step * index) * 86_400_000).toISOString().slice(0, 10);
      if (!isIsoCalendarDate(next)) throw new Error("日付の連番が対応する範囲を超えています");
      return next;
    };
    return null;
  }
  // Explicit text preserves identifiers such as '00123, instead of treating the quote as a sequence prefix.
  if (values.some(value => value.startsWith("'"))) return null;
  if (values.some(value => /^[+-]?\d{16,}$/.test(value))) return null;
  const numeric = values.every(value => value.trim() !== "" && Number.isFinite(Number(value)));
  if (numeric && (values.length > 1 || mode === "series")) {
    const start = Number(values[0]), step = values.length > 1 ? Number(values[1]) - start : 1;
    const zeroWidth = values.every(value => /^0\d+$/.test(value) && value.length === values[0].length) ? values[0].length : 0;
    if (values.every((value, i) => Math.abs(Number(value) - (start + step * i)) < 1e-9)) return index => {
      const value = String(Number((start + step * index).toPrecision(14)));
      return value.startsWith("-") ? value : value.padStart(zeroWidth, "0");
    };
  }
  const parts = values.map(value => /^(.*?)(-?\d+)$/.exec(value));
  if (parts.every(Boolean) && parts[0]?.[1] && parts.every(part => part![1] === parts[0]![1])) {
    const start = Number(parts[0]![2]), step = values.length > 1 ? Number(parts[1]![2]) - start : 1;
    if (parts.every((part, i) => Number(part![2]) === start + step * i)) {
      const width = parts[0]![2].startsWith("0") ? parts[0]![2].length : 0;
      return index => { const number = start + step * index;
        return `${parts[0]![1]}${number < 0 ? String(number) : String(number).padStart(width, "0")}`; };
    }
  }
  return null;
}
/** Extends a single rectangle along one axis, preserving source cells and translating relative formulas. */
export function fillSpreadsheetCells(workbook: SpreadsheetWorkbook, sheetId: string, source: SpreadsheetMergedRange,
  target: SpreadsheetMergedRange, mode: "auto" | "copy" | "series" = "auto",
  policy: { formulas: boolean; formatting: boolean; dataValidation: boolean; checkboxes?: boolean } = { formulas: true, formatting: true, dataValidation: true }): SpreadsheetWorkbook {
  if (!["auto", "copy", "series"].includes(mode)) throw new Error("オートフィルの方式が正しくありません");
  const sheet = getWorkbookSheet(workbook, sheetId);
  validateRange(source, sheet.rowCount, sheet.columnCount); validateRange(target, sheet.rowCount, sheet.columnCount);
  if (!rangeContains(target, source)) throw new Error("オートフィル先はコピー元の範囲を含めてください");
  const vertical = target.left === source.left && target.right === source.right;
  const horizontal = target.top === source.top && target.bottom === source.bottom;
  if (!vertical && !horizontal) throw new Error("オートフィルは縦または横の一方向に伸ばしてください");
  if ((target.bottom - target.top + 1) * (target.right - target.left + 1) > SPREADSHEET_LIMITS.clipboardCells) throw new Error("オートフィルは10,000セルまでです");
  if (sheet.merges?.some(merge => rangesIntersect(merge, target))) throw new Error("結合セルを含む範囲はオートフィルできません");
  const cells = { ...sheet.cells }, height = source.bottom - source.top + 1, width = source.right - source.left + 1;
  const modulo = (n: number, length: number) => (n % length + length) % length;
  const generators = new Map<number, ((index: number) => string) | null>();
  for (let row = target.top; row <= target.bottom; row++) for (let column = target.left; column <= target.right; column++) {
    if (row >= source.top && row <= source.bottom && column >= source.left && column <= source.right) continue;
    const fromRow = source.top + modulo(row - source.top, height), fromColumn = source.left + modulo(column - source.left, width);
    const original = sheet.cells[cellAddress(fromRow, fromColumn)], address = cellAddress(row, column), previous = sheet.cells[address];
    let value = original?.value ?? "";
    if (value.startsWith("=")) {
      if (!policy.formulas) throw new Error("数式の入力は無効です");
      value = translateFormula(value, row - fromRow, column - fromColumn);
    } else {
      const lane = vertical ? fromColumn : fromRow;
      if (!generators.has(lane)) {
        const values = vertical ? Array.from({ length: height }, (_, i) => sheet.cells[cellAddress(source.top + i, fromColumn)]?.value ?? "") :
          Array.from({ length: width }, (_, i) => sheet.cells[cellAddress(fromRow, source.left + i)]?.value ?? "");
        const seriesMode = mode === "auto" && ["date", "datetime"].includes(original?.format?.numberFormat ?? "") ? "series" : mode;
        generators.set(lane, sequence(values, seriesMode));
      }
      value = generators.get(lane)?.(vertical ? row - source.top : column - source.left) ?? value;
    }
    validateCellValue(value);
    const format = policy.formatting ? original?.format : previous?.format;
    const ruleTransferEnabled = policy.dataValidation && !(policy.checkboxes === false && (original?.validation?.type === "checkbox" || previous?.validation?.type === "checkbox"));
    const validation = ruleTransferEnabled ? original?.validation : previous?.validation;
    if (!value && !format && !validation) delete cells[address];
    else cells[address] = Object.freeze({ value, ...(format ? { format } : {}), ...(validation ? { validation } : {}) });
  }
  return replaceWorkbookSheet(workbook, { ...sheet, cells: Object.freeze(cells) });
}
