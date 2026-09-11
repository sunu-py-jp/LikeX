import type { ReactNode } from "react";
import type { ContextMenuItem, ContextMenuProvider } from "../core";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetCommand, SpreadsheetWorkbookSnapshot } from "./types";
import type { SpreadsheetFeatures } from "./features";

/** The right-click target is independent of the preserved selection, including disjoint ranges. */
export type SpreadsheetContextMenuContext = Readonly<{
  target: Readonly<{ kind: "cell"; sheetId: string; row: number; column: number; address: string }> |
    Readonly<{ kind: "row"; sheetId: string; row: number }> |
    Readonly<{ kind: "column"; sheetId: string; column: number }> |
    Readonly<{ kind: "sheet"; sheetId: string; name: string; index: number }>;
  selection: SpreadsheetSelection;
  workbook: SpreadsheetWorkbookSnapshot;
  features: Readonly<Required<SpreadsheetFeatures>>;
  readOnly: boolean;
}>;
/** Returned commands are validated and committed together as one undo operation. */
export type SpreadsheetContextMenuChange = readonly SpreadsheetCommand[];
export type SpreadsheetContextMenuItem = ContextMenuItem<SpreadsheetContextMenuContext, SpreadsheetContextMenuChange, ReactNode>;
export type SpreadsheetContextMenuProvider = ContextMenuProvider<SpreadsheetContextMenuContext, SpreadsheetContextMenuChange, ReactNode>;
