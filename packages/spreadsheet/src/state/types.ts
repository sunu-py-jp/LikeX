import type { RefObject } from "react";
import type { SpreadsheetCellFormat, SpreadsheetCellPosition, SpreadsheetSheet, SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetSelection } from "../props";

export type Workbook = SpreadsheetWorkbook;
export type Sheet = SpreadsheetSheet;
export type Position = SpreadsheetCellPosition;
export type CellFormat = SpreadsheetCellFormat;
export type WorkbookOperation = (current: Workbook) => Workbook;
export type ReportError = (cause: unknown) => void;
export type SelectionUpdate = SpreadsheetSelection | ((previous: SpreadsheetSelection) => SpreadsheetSelection);

/** Synchronous selection access lets a draft validate its complete commit before publishing it. */
export type DraftSelection = {
  selectionRef: RefObject<SpreadsheetSelection>;
  setSelection: (update: SelectionUpdate) => void;
};
