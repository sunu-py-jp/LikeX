export type SpreadsheetCellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  background?: string;
  numberFormat?: "general" | "number" | "currency" | "percent";
};

export type SpreadsheetCell = { value: string; format?: SpreadsheetCellFormat };
export type SpreadsheetSheet = {
  id: string;
  name: string;
  cells: Readonly<Record<string, SpreadsheetCell>>;
  rowCount: number;
  columnCount: number;
  columnWidths?: Readonly<Record<number, number>>;
  rowHeights?: Readonly<Record<number, number>>;
};
export type SpreadsheetWorkbook = { sheets: readonly SpreadsheetSheet[] };
/** Zero-based row and column coordinates. */
export type SpreadsheetCellPosition = { row: number; column: number };
export type SpreadsheetCalculatedValue = string | number | boolean;
export type SpreadsheetMoveSource = { sheetId: string; top: number; left: number; bottom: number; right: number };
export type SpreadsheetMoveTarget = { sheetId: string; row: number; column: number };

export const SPREADSHEET_LIMITS = Object.freeze({ rows: 10_000, columns: 1_000, cells: 100_000,
  sheets: 100, cellLength: 100_000, formulaLength: 4_096, formulaTokens: 2_048,
  rangeCells: 10_000, evaluationSteps: 200_000, referenceDepth: 128,
  clipboardCharacters: 10 * 1024 * 1024, clipboardCells: 10_000 });
