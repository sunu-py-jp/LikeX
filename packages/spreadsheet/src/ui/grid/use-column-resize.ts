"use client";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { useGridResize } from "./use-grid-resize";
export function useColumnResize(c: SpreadsheetController) {
  const resize = useGridResize(c, "column");
  return { ...resize, resizing: resize.resizing ? { ...resize.resizing, column: resize.resizing.index } : null };
}
