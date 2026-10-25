import type { SpreadsheetCellPosition, SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetCellBorder } from "../model/formatting/types";
import type { SpreadsheetWriteConflictPolicy } from "../model/workbook/write-conflicts";

/** Text sources contain detail rows only; headers are supplied separately. */
export type SpreadsheetTableData =
  | Readonly<{ type: "rows"; values: readonly (readonly string[])[] }>
  | Readonly<{ type: "csv" | "tsv"; text: string }>;
/** Insert whole sheet axes at target before writing, using the complete output height/width. */
export type SpreadsheetGridInsertMode = "none" | "rows" | "columns" | "both";
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
  /** Defaults to none. Includes headers/numbering in the inserted size; one atomic command. */
  insert?: SpreadsheetGridInsertMode;
}>;
export type SpreadsheetGridHeaderStyle = Readonly<{ background?: string; color?: string }>;
/** A leaf uses one body row/column; groups span their descendant leaves. */
export type SpreadsheetGridHeader = string | Readonly<{
  label: string;
  style?: SpreadsheetGridHeaderStyle;
  children?: readonly SpreadsheetGridHeader[];
}>;
/** merged aligns roots at the outer edge; protruding aligns each root subtree next to the body. */
export type SpreadsheetGridHeaderLayout = "merged" | "protruding";
/** Group adjacent detail rows by exact source values; no grouping metadata is stored. */
export type SpreadsheetGridRowGrouping = Readonly<{
  /** Zero-based source data columns, excluding generated numbering and left headers. */
  byColumns: readonly number[];
  /** Defaults to first: write empty strings to repeated key cells. Does not merge cells. */
  keyDisplay?: "first" | "all";
  /** Between consecutive groups only. Defaults to a 1px solid #d1d5db line. */
  separator?: false | SpreadsheetCellBorder;
  /** Between the top headers and detail rows. Defaults to a 1px solid #d1d5db line. */
  headerSeparator?: false | SpreadsheetCellBorder;
  /** Inner vertical borders. Omission preserves the base border; false clears these edges. */
  verticalBorder?: false | SpreadsheetCellBorder;
  /** Outline around the grid. Omission preserves the base border; false clears these edges. */
  outerBorder?: false | SpreadsheetCellBorder;
}>;
/** Absolute sheet coordinates, including each visible header cell (which may be merged). */
export type SpreadsheetGridLayout = Readonly<{
  dataRange?: SpreadsheetMergedRange;
  headerRanges: readonly SpreadsheetMergedRange[];
  rowHeaderRanges: readonly SpreadsheetMergedRange[];
  cornerRange?: SpreadsheetMergedRange;
  merges: readonly SpreadsheetMergedRange[];
}>;
/** Write ordinary cells with optional hierarchical headers and grid borders; creates no table definition. */
export type SpreadsheetCellGridWriteOptions = Omit<SpreadsheetTableWriteOptions, "headers" | "headerStyle"> & Readonly<{
  /** Top headers in body-column order. Omit for a body without top headers. */
  headers?: readonly SpreadsheetGridHeader[];
  /** Left headers in body-row order. Cannot be combined with rowNumbers. */
  rowHeaders?: readonly SpreadsheetGridHeader[];
  headerStyle?: SpreadsheetGridHeaderStyle;
  /** Missing properties inherit headerStyle. Node styles affect that node only. */
  rowHeaderStyle?: SpreadsheetGridHeaderStyle;
  headerLayout?: SpreadsheetGridHeaderLayout;
  rowHeaderLayout?: SpreadsheetGridHeaderLayout;
  /** Available only with both header axes. Omitted, null or whitespace-only labels are blank,
   * remain unmerged, have no default borders and do not inherit headerStyle. Explicit overrides still apply. */
  corner?: Readonly<{
    label?: string | null;
    /** Defaults to false for blank labels and true otherwise. An unmerged label occupies only the top-left cell. */
    merge?: boolean;
    style?: SpreadsheetGridHeaderStyle;
    /** Overrides the grid border, inheriting unspecified grid/default border properties. */
    border?: SpreadsheetCellBorder;
  }>;
  /** Defaults to a 1px solid #d1d5db grid, or false when rowGrouping is present. */
  border?: false | SpreadsheetCellBorder;
  /** Group adjacent rows and style group boundaries. Headers and detail cells remain ordinary cells. */
  rowGrouping?: SpreadsheetGridRowGrouping;
}>;
export type SpreadsheetTableCommand =
  | Readonly<SpreadsheetTableWriteOptions & { type: "tables.insert"; name: string }>
  | Readonly<SpreadsheetCellGridWriteOptions & { type: "cells.writeGrid" }>
  | Readonly<{ type: "tables.delete"; sheetId: string; tableId: string; clear?: "none" | "values" | "all" }>;
