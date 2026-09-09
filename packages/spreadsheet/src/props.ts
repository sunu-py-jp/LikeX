import type { CSSProperties, Ref } from "react";
import type { SpreadsheetCellPosition, SpreadsheetWorkbook } from "./model/types";
import type { SpreadsheetHandle } from "./api/types";
import type { ContextMenuExecutionMode } from "./core";
import type { SpreadsheetContextMenuProvider } from "./api/context-menu";
import type { SpreadsheetFeatures } from "./api/features";
import type { SpreadsheetBeforeSaveHandler, SpreadsheetEditHandler, SpreadsheetEventHandler, SpreadsheetRefreshHandler, SpreadsheetSaveHandler } from "./api/lifecycle";
export type { SpreadsheetFeatures } from "./api/features";
export type { SpreadsheetSaveHandler } from "./api/lifecycle";

export type SpreadsheetColorMode = "light" | "dark" | "system";

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

export type SpreadsheetProps = {
  /** Typed operations on the mounted draft. Does not trigger persistence. */
  ref?: Ref<SpreadsheetHandle>;
  /** Read once at mount. Change the React key to open another workbook. */
  initialWorkbook?: SpreadsheetWorkbook;
  /** Observes draft changes. This notification does not perform persistence. */
  onChange?: (workbook: SpreadsheetWorkbook) => void;
  /** Owns persistence. Omit this callback for read-only viewing. */
  onSave?: SpreadsheetSaveHandler;
  /** Async validation before persistence. False cancels; throw reports a validation error. */
  onBeforeSave?: SpreadsheetBeforeSaveHandler;
  /** Acquire a host-owned editing lease before the first actual change. */
  onEditRequest?: SpreadsheetEditHandler;
  /** Read an authoritative complete workbook on explicit refresh. */
  onRefresh?: SpreadsheetRefreshHandler;
  /** Observe operations; these notifications cannot veto or roll back an operation. */
  onEvent?: SpreadsheetEventHandler;
  /** Committed draft differs from the last accepted baseline. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Includes unfinished editor input, for host-owned SPA navigation guards. */
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  /** Warn before document unload while unsaved. Defaults to true. SPA navigation belongs to the host. */
  warnOnUnsavedChanges?: boolean;
  readOnly?: boolean;
  features?: SpreadsheetFeatures;
  /** Additional cell menu items. Return an empty array to hide them for a target. */
  getContextMenuItems?: SpreadsheetContextMenuProvider;
  /** Defaults to block. Handlers return proposed changes, which are applied after this policy. */
  contextMenuExecutionMode?: ContextMenuExecutionMode;
  onSelectionChange?: (selection: SpreadsheetSelection) => void;
  colorMode?: SpreadsheetColorMode;
  title?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};
