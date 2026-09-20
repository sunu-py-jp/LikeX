import { parseCellAddress } from "./address";
import { SPREADSHEET_FORMAT, SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetSheet, type SpreadsheetWorkbook } from "./types";

export const SPREADSHEET_FILE_VERSION = 1 as const;

/** One row in file order (index 0 is row 1). Columns use A, B, ..., Z, AA, ... keys. */
export type SpreadsheetFileRow = {
  height?: number;
  cells?: Readonly<Record<string, SpreadsheetCell>>;
};
/** File layout only. Runtime sheets continue to expose the existing flat A1-addressed cells. */
export type SpreadsheetFileSheet = Omit<SpreadsheetSheet, "cells" | "rowHeights"> & {
  /** Empty rows inside the data are {}; trailing empty rows are omitted, with rowCount retaining sheet size. */
  rows: readonly SpreadsheetFileRow[];
};
export type SpreadsheetFile = Omit<SpreadsheetWorkbook, "schemaVersion" | "format" | "sheets"> & {
  format: typeof SPREADSHEET_FORMAT;
  schemaVersion: typeof SPREADSHEET_FILE_VERSION;
  sheets: readonly SpreadsheetFileSheet[];
};

/** Convert an already-normalized runtime workbook without modifying its model or identities. */
export function workbookToFile(workbook: SpreadsheetWorkbook): SpreadsheetFile {
  return { format: SPREADSHEET_FORMAT, schemaVersion: SPREADSHEET_FILE_VERSION,
    sheets: workbook.sheets.map(sheet => {
      const { cells, rowHeights, ...rest } = sheet;
      const rows: { height?: number; cells?: Record<string, SpreadsheetCell> }[] = [];
      const rowAt = (row: number) => {
        while (rows.length <= row) rows.push({});
        return rows[row];
      };
      for (const [address, cell] of Object.entries(cells)) {
        const position = parseCellAddress(address)!;
        (rowAt(position.row).cells ??= Object.create(null))[address.replace(/\d+$/, "")] = cell;
      }
      for (const [index, height] of Object.entries(rowHeights ?? {})) rowAt(Number(index)).height = height;
      return { ...rest, rows };
    }),
    ...(workbook.resources ? { resources: workbook.resources } : {}),
    ...(workbook.namedRanges ? { namedRanges: workbook.namedRanges } : {}),
  };
}

const invalidFile = (): never => { throw new Error("SPONの行・列の構成が正しくありません"); };
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidFile();
  return input as Record<string, unknown>;
};

/** Decode row-oriented SPON v1 files; validation of every cell/format/resource remains in normalizeWorkbook. */
export function fileToWorkbook(input: unknown): SpreadsheetWorkbook {
  const file = object(input);
  if (file.format !== SPREADSHEET_FORMAT) throw new Error("スプレッドシートのファイル形式ではありません");
  if (file.schemaVersion !== SPREADSHEET_FILE_VERSION) throw new Error("未対応のブック形式です");
  if (!Array.isArray(file.sheets) || file.sheets.length < 1 || file.sheets.length > SPREADSHEET_LIMITS.sheets) return invalidFile();
  let cellCount = 0;
  const sheets = file.sheets.map(inputSheet => {
    const sheet = object(inputSheet);
    if (Object.hasOwn(sheet, "cells") || Object.hasOwn(sheet, "rowHeights")) return invalidFile();
    const cells: Record<string, SpreadsheetCell> = Object.create(null);
    const rowHeights: Record<number, number> = Object.create(null);
    const rowCount = sheet.rowCount, columnCount = sheet.columnCount;
    if (typeof rowCount !== "number" || !Number.isInteger(rowCount) || rowCount < 1 || rowCount > SPREADSHEET_LIMITS.rows ||
      typeof columnCount !== "number" || !Number.isInteger(columnCount) || columnCount < 1 || columnCount > SPREADSHEET_LIMITS.columns) return invalidFile();
    if (!Array.isArray(sheet.rows) || sheet.rows.length > rowCount) return invalidFile();
    for (const [index, inputRow] of sheet.rows.entries()) {
      const row = object(inputRow);
      if (Object.keys(row).some(key => key !== "height" && key !== "cells")) return invalidFile();
      if (Object.hasOwn(row, "height")) {
        if (typeof row.height !== "number" || !Number.isFinite(row.height) || row.height < 16 || row.height > 1000) return invalidFile();
        rowHeights[index] = row.height;
      }
      if (!Object.hasOwn(row, "cells")) continue;
      for (const [column, cell] of Object.entries(object(row.cells))) {
        if (++cellCount > SPREADSHEET_LIMITS.cells) throw new Error("保存できるセル数の上限を超えています");
        if (!/^[A-Z]{1,3}$/.test(column)) return invalidFile();
        const address = `${column}${index + 1}`, position = parseCellAddress(address);
        if (!position || position.column >= columnCount) return invalidFile();
        cells[address] = cell as SpreadsheetCell;
      }
    }
    const rest = { ...sheet };
    delete rest.rows;
    return { ...rest, cells, ...(Object.keys(rowHeights).length ? { rowHeights } : {}) } as SpreadsheetSheet;
  });
  return { ...file, schemaVersion: 1, sheets } as SpreadsheetWorkbook;
}

const rootOrder = ["format", "schemaVersion", "sheets", "resources", "namedRanges"];
const fieldOrder = ["id", "name", "type", "shape", "rowCount", "columnCount",
  "columnWidths", "rows", "height", "cells", "merges", "tables", "comments", "drawings", "conditionalFormats",
  "value", "format", "validation", "anchor", "row", "column", "offsetX", "offsetY", "width", "rotation", "flipX", "flipY",
  "resourceId", "alt", "text", "fontFamily", "fontSize", "bold", "italic", "underline", "align", "verticalAlign", "wrap",
  "numberFormat", "decimalPlaces", "useGrouping", "negativeFormat", "color", "background", "fill", "stroke", "strokeWidth", "borders",
  "top", "left", "bottom", "right", "style", "author", "sheetId", "range", "mimeType", "dataUrl"];
const fieldRank = new Map(fieldOrder.map((key, index) => [key, index]));
const columnNumber = (key: string) => [...key].reduce((column, character) => column * 26 + character.charCodeAt(0) - 64, 0);

/** Keep the file readable in sheet order, row order and left-to-right column order. */
export function compareWorkbookFileKeys(left: string, right: string, path: readonly (string | number)[]): number {
  if (!path.length) return rootOrder.indexOf(left) - rootOrder.indexOf(right);
  // Match schema locations rather than final names: image IDs are caller-owned
  // and may legitimately be named "comments", "cells" or "columnWidths".
  const inSheet = path[0] === "sheets" && typeof path[1] === "number";
  if (inSheet && path.length === 3 && path[2] === "columnWidths") return Number(left) - Number(right);
  if (inSheet && path.length === 5 && path[2] === "rows" && typeof path[3] === "number" && path[4] === "cells")
    return columnNumber(left) - columnNumber(right);
  if (inSheet && path.length === 3 && path[2] === "comments") {
    const a = parseCellAddress(left)!, b = parseCellAddress(right)!;
    return a.row - b.row || a.column - b.column;
  }
  if (path.length === 2 && path[0] === "resources" && path[1] === "images") return 0;
  return (fieldRank.get(left) ?? fieldOrder.length) - (fieldRank.get(right) ?? fieldOrder.length);
}
