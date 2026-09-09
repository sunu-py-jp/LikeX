import { SPREADSHEET_LIMITS, type SpreadsheetCellPosition } from "./types";

export function cellAddress(row: number, column: number): string {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 ||
    row >= SPREADSHEET_LIMITS.rows || column >= SPREADSHEET_LIMITS.columns)
    throw new Error("セルの位置が範囲外です");
  let letters = "";
  for (let value = column + 1; value; value = Math.floor((value - 1) / 26))
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  return `${letters}${row + 1}`;
}

export function parseCellAddress(address: string): SpreadsheetCellPosition | null {
  if (typeof address !== "string") return null;
  const match = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,4})$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  return row < SPREADSHEET_LIMITS.rows && column <= SPREADSHEET_LIMITS.columns ? { row, column: column - 1 } : null;
}
