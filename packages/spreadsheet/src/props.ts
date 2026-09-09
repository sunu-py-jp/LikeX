import type { CSSProperties, Ref } from "react";
import type { SpreadsheetCellPosition, SpreadsheetWorkbook } from "./model/types";
import type { SpreadsheetHandle } from "./api/types";

export type SpreadsheetColorMode = "light" | "dark" | "system";

/** Omitted features are enabled. False hides their controls and disables their actions. */
export type SpreadsheetFeatures = Readonly<{
  formulas?: boolean;
  clipboard?: boolean;
  formatting?: boolean;
  /** Allows merging/unmerging. Existing merged cells still render when disabled. */
  mergeCells?: boolean;
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
  /** Origin used to extend the active range. See ranges for the complete geometry. */
  anchor: Readonly<SpreadsheetCellPosition>;
  /** Editable active cell; merged positions resolve to the top-left cell. */
  focus: Readonly<SpreadsheetCellPosition>;
  /** All selected ranges, including the active range last. Always supplied by onSelectionChange. */
  ranges?: readonly SpreadsheetSelectionRange[];
}>;

export type SpreadsheetSaveHandler = (
  workbook: SpreadsheetWorkbook,
) => void | SpreadsheetWorkbook | Promise<void | SpreadsheetWorkbook>;

export type SpreadsheetProps = {
  /** Typed operations on the mounted draft. Does not trigger persistence. */
  ref?: Ref<SpreadsheetHandle>;
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
