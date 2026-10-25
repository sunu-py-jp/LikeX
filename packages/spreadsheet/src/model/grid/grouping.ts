import type { SpreadsheetGridRowGrouping } from "../../api/table-commands";
import { cellAddress } from "../address";
import type { SpreadsheetCellBorder, SpreadsheetCellBorders } from "../formatting/types";
import type { SpreadsheetCellFormat, SpreadsheetMergedRange } from "../types";
import { normalizeCellFormat } from "../workbook/validation";

export const defaultGridBorder = Object.freeze({ style: "solid" as const, width: 1 as const, color: "#d1d5db" });
const plainObject = (input: unknown): input is Record<string, unknown> => Boolean(input) && typeof input === "object"
  && (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null);
const onlyKeys = (input: object, allowed: readonly string[]) => Reflect.ownKeys(input).every(key => typeof key === "string" && allowed.includes(key));

/** Borders are copied so a caller cannot change a prepared plan by mutating its options. */
export function gridBorder(input: unknown, fallback: false | SpreadsheetCellBorder = defaultGridBorder): false | SpreadsheetCellBorder {
  if (input === undefined) return fallback;
  if (input === false) return false;
  if (!plainObject(input) || !onlyKeys(input, ["style", "width", "color"])) throw new Error("表の罫線が正しくありません");
  const border = normalizeCellFormat({ borders: { top: input as SpreadsheetCellBorder } })!.borders!.top!;
  return Object.freeze({ ...defaultGridBorder, ...border });
}

export type GridRowGrouping = Readonly<{
  columns: ReadonlySet<number>;
  starts: readonly boolean[];
  firstOnly: boolean;
  separator: false | SpreadsheetCellBorder;
  headerSeparator: false | SpreadsheetCellBorder;
  verticalBorder?: false | SpreadsheetCellBorder;
  outerBorder?: false | SpreadsheetCellBorder;
}>;

export function gridRowGrouping(input: SpreadsheetGridRowGrouping | undefined, rows: readonly (readonly string[])[], width: number): GridRowGrouping | undefined {
  if (input === undefined) return undefined;
  if (!plainObject(input) || !onlyKeys(input, ["byColumns", "keyDisplay", "separator", "headerSeparator", "verticalBorder", "outerBorder"]))
    throw new Error("行グループの設定が正しくありません");
  const keys = input.byColumns;
  if (!Array.isArray(keys) || !keys.length || keys.length > width) throw new Error("行グループの判定列を指定してください");
  const columns = new Set<number>();
  for (const column of keys) {
    if (!Number.isSafeInteger(column) || column < 0 || column >= width || columns.has(column))
      throw new Error("行グループの判定列は明細の列番号を重複なく0始まりで指定してください");
    columns.add(column);
  }
  if (input.keyDisplay !== undefined && input.keyDisplay !== "first" && input.keyDisplay !== "all")
    throw new Error("行グループの判定列の表示はfirstまたはallで指定してください");
  const starts = rows.map((row, index) => index === 0 || keys.some(column => row[column] !== rows[index - 1][column]));
  return Object.freeze({ columns, starts: Object.freeze(starts), firstOnly: input.keyDisplay !== "all",
    separator: gridBorder(input.separator), headerSeparator: gridBorder(input.headerSeparator),
    ...(input.verticalBorder === undefined ? {} : { verticalBorder: gridBorder(input.verticalBorder) }),
    ...(input.outerBorder === undefined ? {} : { outerBorder: gridBorder(input.outerBorder) }) });
}

/** Decorate only written cells; absent protruding-header cells retain their existing contents and borders. */
export function applyGridGroupingBorders(formats: Record<string, SpreadsheetCellFormat>, range: SpreadsheetMergedRange,
  headerHeight: number, merges: readonly SpreadsheetMergedRange[], grouping: GridRowGrouping,
  protectedCorner?: SpreadsheetMergedRange, explicitCornerBorder = false) {
  type Edge = keyof SpreadsheetCellBorders;
  const mergedCells = new Map<string, SpreadsheetMergedRange>();
  for (const merge of merges) for (let row = merge.top; row <= merge.bottom; row++) for (let column = merge.left; column <= merge.right; column++)
    mergedCells.set(cellAddress(row, column), merge);
  const protectedCell = (row: number, column: number) => protectedCorner && row >= protectedCorner.top && row <= protectedCorner.bottom
    && column >= protectedCorner.left && column <= protectedCorner.right;
  const set = (row: number, column: number, edge: Edge, border: false | SpreadsheetCellBorder) => {
    const address = cellAddress(row, column), previous = formats[address];
    if (!previous || protectedCell(row, column)) return;
    const borders = { ...previous.borders };
    if (border === false) delete borders[edge]; else borders[edge] = border;
    formats[address] = normalizeCellFormat({ ...previous, borders })!;
  };
  const edge = (row: number, column: number, side: Edge, border: false | SpreadsheetCellBorder) => {
    const merge = mergedCells.get(cellAddress(row, column));
    if (merge) {
      const perimeter = side === "top" ? row === merge.top : side === "bottom" ? row === merge.bottom
        : side === "left" ? column === merge.left : column === merge.right;
      if (!perimeter) return;
      // The renderer uses the merged cell's anchor format; XLSX also needs the perimeter cells.
      set(merge.top, merge.left, side, border);
    }
    set(row, column, side, border);
  };
  const horizontal = (row: number, border: false | SpreadsheetCellBorder) => {
    for (let column = range.left; column <= range.right; column++) {
      if (row > range.top) edge(row - 1, column, "bottom", border);
      if (row <= range.bottom) edge(row, column, "top", border);
    }
  };
  for (let index = 1; index < grouping.starts.length; index++) if (grouping.starts[index]) {
    const row = range.top + headerHeight + index;
    if (grouping.separator !== false && grouping.separator.style !== "none") for (let column = range.left; column <= range.right; column++) {
      const merge = mergedCells.get(cellAddress(row, column));
      if (merge && merge.top < row)
        throw new Error("行グループの区切り線が左見出しの結合セルを横切ります。見出しの範囲を合わせるかseparatorをfalseにしてください");
    }
    horizontal(row, grouping.separator);
  }
  if (headerHeight && grouping.starts.length) horizontal(range.top + headerHeight, grouping.headerSeparator);
  if (grouping.verticalBorder !== undefined) for (let row = range.top; row <= range.bottom; row++)
    for (let column = range.left + 1; column <= range.right; column++) {
      edge(row, column - 1, "right", grouping.verticalBorder); edge(row, column, "left", grouping.verticalBorder);
    }
  if (grouping.outerBorder !== undefined) {
    horizontal(range.top, grouping.outerBorder); horizontal(range.bottom + 1, grouping.outerBorder);
    for (let row = range.top; row <= range.bottom; row++) {
      edge(row, range.left, "left", grouping.outerBorder); edge(row, range.right, "right", grouping.outerBorder);
    }
  }
  if (explicitCornerBorder && protectedCorner) {
    const borders = formats[cellAddress(protectedCorner.top, protectedCorner.left)].borders!;
    // A shared edge must agree on both sides: otherwise the renderer paints two lines
    // and XLSX readers may choose the adjacent header's line instead of the corner's.
    if (borders.right) for (let row = protectedCorner.top; row <= protectedCorner.bottom; row++)
      edge(row, protectedCorner.right + 1, "left", borders.right);
    if (borders.bottom) for (let column = protectedCorner.left; column <= protectedCorner.right; column++)
      edge(protectedCorner.bottom + 1, column, "top", borders.bottom);
  }
}
