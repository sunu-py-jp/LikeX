import type { CSSProperties } from "react";
import type { SpreadsheetCellPosition, SpreadsheetWorkbook } from "./model/types";

export type SpreadsheetColorMode = "light" | "dark" | "system";

/** Omitted features are enabled. False hides their controls and disables their actions. */
export type SpreadsheetFeatures = Readonly<{
  formulas?: boolean;
  clipboard?: boolean;
  formatting?: boolean;
  rowColumnOperations?: boolean;
  sheets?: boolean;
  resize?: boolean;
  undoRedo?: boolean;
  images?: boolean;
  shapes?: boolean;
  textBoxes?: boolean;
  comments?: boolean;
}>;

export type SpreadsheetSelectionRange = Readonly<{
  anchor: Readonly<SpreadsheetCellPosition>;
  focus: Readonly<SpreadsheetCellPosition>;
}>;

export type SpreadsheetSelection = Readonly<{
  sheetId: string;
  /** Anchor and focus of the active (last) range. */
  anchor: Readonly<SpreadsheetCellPosition>;
  focus: Readonly<SpreadsheetCellPosition>;
  /** All selected ranges, including the active range last. Always supplied by onSelectionChange. */
  ranges?: readonly SpreadsheetSelectionRange[];
}>;

export type SpreadsheetSaveHandler = (
  workbook: SpreadsheetWorkbook,
) => void | SpreadsheetWorkbook | Promise<void | SpreadsheetWorkbook>;

export type SpreadsheetProps = {
  /** Read once at mount. Change the React key to open another workbook. */
  initialWorkbook?: SpreadsheetWorkbook;
  /** Observes draft changes. This notification does not perform persistence. */
  onChange?: (workbook: SpreadsheetWorkbook) => void;
  /** Owns persistence. Omit this callback for read-only viewing. */
  onSave?: SpreadsheetSaveHandler;
  readOnly?: boolean;
  features?: SpreadsheetFeatures;
  onSelectionChange?: (selection: SpreadsheetSelection) => void;
  colorMode?: SpreadsheetColorMode;
  title?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};
