import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetWorkbook } from "./types";

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

/** Compare normalized workbook content in O(populated cells), independent of record insertion order.
 * Sheet order matters. Explicit default sizes and false/general styles equal their omitted defaults. */
export function workbooksEqual(left: SpreadsheetWorkbook, right: SpreadsheetWorkbook): boolean {
  if (left === right) return true;
  if (left.sheets.length !== right.sheets.length) return false;
  return left.sheets.every((sheet, index) => {
    const other = right.sheets[index];
    return sheet === other || (sheet.id === other.id && sheet.name === other.name && sheet.rowCount === other.rowCount &&
      sheet.columnCount === other.columnCount && cellMapsEqual(sheet.cells, other.cells) &&
      sizesEqual(sheet.columnWidths, other.columnWidths, 100) && sizesEqual(sheet.rowHeights, other.rowHeights, 28));
  });
}
