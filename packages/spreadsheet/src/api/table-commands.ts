import type { SpreadsheetCellPosition } from "../model/types";
import type { SpreadsheetCellBorder } from "../model/formatting/types";
import type { SpreadsheetWriteConflictPolicy } from "../model/workbook/write-conflicts";

/** Text sources contain detail rows only; headers are supplied separately. */
export type SpreadsheetTableData =
  | Readonly<{ type: "rows"; values: readonly (readonly string[])[] }>
  | Readonly<{ type: "csv" | "tsv"; text: string }>;
export type SpreadsheetTableWriteOptions = Readonly<{
  sheetId: string;
  target: Readonly<SpreadsheetCellPosition>;
  headers: readonly string[];
  data: SpreadsheetTableData;
  headerStyle?: Readonly<{ background?: string; color?: string }>;
  /** Insert a static leading integer column. Defaults: header No., start 1. */
  rowNumbers?: false | Readonly<{ header?: string; start?: number }>;
  /** Defaults to overwrite. Skipped cells keep both their value and formatting. */
  onConflict?: SpreadsheetWriteConflictPolicy;
}>;
/** Write ordinary cells with grid borders and optional header colors; creates no table definition. */
export type SpreadsheetCellGridWriteOptions = SpreadsheetTableWriteOptions & Readonly<{
  /** Defaults to a 1px solid #d1d5db grid. Unspecified border properties retain these defaults. */
  border?: SpreadsheetCellBorder;
}>;
export type SpreadsheetTableCommand =
  | Readonly<SpreadsheetTableWriteOptions & { type: "tables.insert"; name: string }>
  | Readonly<SpreadsheetCellGridWriteOptions & { type: "cells.writeGrid" }>
  | Readonly<{ type: "tables.delete"; sheetId: string; tableId: string; clear?: "none" | "values" | "all" }>;
