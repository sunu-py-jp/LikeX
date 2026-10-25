import type { SpreadsheetMergedRange } from "../model/types";
import type { SpreadsheetWriteConflictPolicy } from "../model/workbook/write-conflicts";

/** Same-sheet rectangle, or a workbook-unique range name on sheetId. */
export type SpreadsheetLookupRange = string | Readonly<SpreadsheetMergedRange> | Readonly<{ namedRange: string }>;
/** All positions are zero-based relative to the lookup range; headers are not skipped implicitly. */
export type SpreadsheetLookupSelector =
  | Readonly<{ axis?: "rows"; column: number; value: string; row?: never }>
  | Readonly<{ axis: "columns"; row: number; value: string; column?: never }>
  | Readonly<{ axis: "both"; row: Readonly<{ column: number; value: string }>; column: Readonly<{ row: number; value: string }>; value?: never }>;

type LookupWriteOptions = Readonly<{
  type: "cells.setByLookup";
  sheetId: string;
  range: SpreadsheetLookupRange;
  /** Defaults to values: formatted display strings. formulas compares saved input strings. */
  lookIn?: "values" | "formulas";
  /** Exact full-string matching; defaults to case-insensitive. No trimming or regular expressions. */
  matchCase?: boolean;
  /** Defaults to error. first selects the topmost/leftmost match; all selects every match. */
  onMultiple?: "error" | "first" | "all";
  /** Defaults to error. skip returns an unchanged workbook when either searched axis has no match. */
  onNotFound?: "error" | "skip";
  onConflict?: SpreadsheetWriteConflictPolicy;
}>;
/** Resolve all targets before writing ordinary cell values as one atomic command. */
export type SpreadsheetLookupCommand = LookupWriteOptions & (
  | Readonly<{ lookup: Extract<SpreadsheetLookupSelector, { axis?: "rows" }>;
      updates: readonly Readonly<{ column: number; value: string }>[]; value?: never }>
  | Readonly<{ lookup: Extract<SpreadsheetLookupSelector, { axis: "columns" }>;
      updates: readonly Readonly<{ row: number; value: string }>[]; value?: never }>
  | Readonly<{ lookup: Extract<SpreadsheetLookupSelector, { axis: "both" }>; value: string; updates?: never }>
);
/** Absolute sheet positions selected before writing; the unsearched axis is an empty array.
 * addresses includes resolved targets skipped by onConflict, reported separately in write. */
export type SpreadsheetLookupWriteReport = Readonly<{
  range: SpreadsheetMergedRange;
  matchedRows: readonly number[];
  matchedColumns: readonly number[];
  addresses: readonly string[];
}>;
