import { createContext } from "react";
import type { SpreadsheetSheetColorMode } from "../../props";

export type ResolvedSheetColorMode = "light" | "dark";

/** Context updates repaint memoized rows without changing the workbook/controller. */
export const SheetColorModeContext = createContext<ResolvedSheetColorMode>("light");

export function resolveSheetColorMode(mode: SpreadsheetSheetColorMode | undefined, darkUI: boolean): ResolvedSheetColorMode {
  return mode === "dark" || (mode === "inherit" && darkUI) ? "dark" : "light";
}
