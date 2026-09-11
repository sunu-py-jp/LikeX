import type { SpreadsheetCellPosition } from "../model/types";
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
export type SpreadsheetTableCommand =
  | Readonly<SpreadsheetTableWriteOptions & { type: "tables.insert"; name: string }>
  | Readonly<SpreadsheetTableWriteOptions & { type: "cells.writeTable" }>
  | Readonly<{ type: "tables.delete"; sheetId: string; tableId: string; clear?: "none" | "values" | "all" }>;
