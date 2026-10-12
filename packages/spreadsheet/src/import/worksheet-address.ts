import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition } from "../model/types";

/** Validate the source grid before deciding whether empty Excel metadata can be omitted. */
export function readExcelCellAddress(value: string): SpreadsheetCellPosition | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(value);
  if (!match) return;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  if (row >= 1_048_576 || column > 16_384) return;
  return { row, column: column - 1 };
}

/** Diagnostic A1 label for a position already validated against Excel's larger source grid. */
export function excelCellAddress(position: SpreadsheetCellPosition): string {
  let letters = "";
  for (let value = position.column + 1; value; value = Math.floor((value - 1) / 26))
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return `${letters}${position.row + 1}`;
}

/** Only valid Excel rectangles qualify; malformed references still fail normal validation. */
export function isExcelRangeOutsideModel(value: string): boolean {
  const parts = value.split(":"), first = readExcelCellAddress(parts[0]), last = readExcelCellAddress(parts[1] ?? parts[0]);
  return parts.length <= 2 && !!first && !!last && first.row <= last.row && first.column <= last.column &&
    (last.row >= SPREADSHEET_LIMITS.rows || last.column >= SPREADSHEET_LIMITS.columns);
}
