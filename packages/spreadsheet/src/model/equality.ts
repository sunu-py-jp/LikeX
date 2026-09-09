import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetWorkbook } from "./types";
import { commentsEqual, drawingsEqual } from "./annotations";
import { mergesEqual } from "./merges";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "./sheet-dimensions";

const emptySizes: Readonly<Record<number, number>> = Object.freeze({});
function formatsEqual(left: SpreadsheetCellFormat | undefined, right: SpreadsheetCellFormat | undefined): boolean {
  if (left === right) return true;
  return !!left?.bold === !!right?.bold && !!left?.italic === !!right?.italic && !!left?.underline === !!right?.underline &&
    left?.align === right?.align && left?.color === right?.color && left?.background === right?.background &&
    (left?.numberFormat ?? "general") === (right?.numberFormat ?? "general");
}
function cellsEqual(left: SpreadsheetCell | undefined, right: SpreadsheetCell | undefined): boolean {
  return left === right || ((left?.value ?? "") === (right?.value ?? "") && formatsEqual(left?.format, right?.format));
}
function cellMapsEqual(left: Readonly<Record<string, SpreadsheetCell>>, right: Readonly<Record<string, SpreadsheetCell>>): boolean {
  if (left === right) return true;
  for (const address of Object.keys(left)) if (!cellsEqual(left[address], right[address])) return false;
  for (const address of Object.keys(right)) if (!Object.hasOwn(left, address) && !cellsEqual(undefined, right[address])) return false;
  return true;
}
function sizesEqual(left: Readonly<Record<number, number>> = emptySizes,
  right: Readonly<Record<number, number>> = emptySizes, defaultSize: number): boolean {
  if (left === right) return true;
  for (const key of Object.keys(left)) if (left[Number(key)] !== (right[Number(key)] ?? defaultSize)) return false;
  for (const key of Object.keys(right)) if (right[Number(key)] !== (left[Number(key)] ?? defaultSize)) return false;
  return true;
}
function resourcesEqual(left: SpreadsheetWorkbook["resources"], right: SpreadsheetWorkbook["resources"]): boolean {
  if (left === right || left?.images === right?.images) return true;
  const a = left?.images ?? {}, b = right?.images ?? {}, keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => {
    const first = a[key], second = b[key];
    return first === second || (!!second && first.name === second.name && first.mimeType === second.mimeType &&
      first.dataUrl === second.dataUrl && first.width === second.width && first.height === second.height);
  });
}
function annotationsEqual(left: SpreadsheetWorkbook["sheets"][number], right: SpreadsheetWorkbook["sheets"][number]): boolean {
  if (left.drawings !== right.drawings) {
    const a = left.drawings ?? [], b = right.drawings ?? [];
    if (a.length !== b.length || a.some((drawing, index) => !drawingsEqual(drawing, b[index]))) return false;
  }
  if (left.comments !== right.comments) {
    const a = left.comments ?? {}, b = right.comments ?? {}, keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length || keys.some(key => !commentsEqual(a[key], b[key]))) return false;
  }
  return true;
}

/** Compare normalized workbook content in O(populated cells), independent of record insertion order.
 * Sheet order matters. Explicit default sizes and false/general styles equal their omitted defaults. */
export function workbooksEqual(left: SpreadsheetWorkbook, right: SpreadsheetWorkbook): boolean {
  if (left === right) return true;
  if ((left.schemaVersion ?? 1) !== (right.schemaVersion ?? 1) || left.sheets.length !== right.sheets.length || !resourcesEqual(left.resources, right.resources)) return false;
  return left.sheets.every((sheet, index) => {
    const other = right.sheets[index];
    return sheet === other || (sheet.id === other.id && sheet.name === other.name && sheet.rowCount === other.rowCount &&
      sheet.columnCount === other.columnCount && cellMapsEqual(sheet.cells, other.cells) &&
      sizesEqual(sheet.columnWidths, other.columnWidths, DEFAULT_COLUMN_WIDTH) && sizesEqual(sheet.rowHeights, other.rowHeights, DEFAULT_ROW_HEIGHT) &&
      mergesEqual(sheet.merges, other.merges) && annotationsEqual(sheet, other));
  });
}
