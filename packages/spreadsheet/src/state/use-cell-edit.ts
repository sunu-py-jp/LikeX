"use client";

import { useRef, useState } from "react";
import { cellAddress, mergedCellPosition, setCellValue, setCellValues } from "../model";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetFeatureSettings } from "./features";
import { clampPosition, selectedAddresses } from "./selection";
import type { Position, ReportError, Sheet, WorkbookOperation } from "./types";

type CellEditOptions = {
  activeSheet: Sheet;
  selection: SpreadsheetSelection;
  disabled: boolean;
  features: SpreadsheetFeatureSettings;
  apply: (operation: WorkbookOperation) => boolean;
  clearDrawingSelection: () => void;
  reportError: ReportError;
};

/** Keeps typed text separate from the draft until a successful commit. */
export function useCellEdit({ activeSheet, selection, disabled, features, apply, clearDrawingSelection, reportError }: CellEditOptions) {
  const [editing, setEditing] = useState<{ position: Position; value: string } | null>(null);
  const editingRef = useRef(editing);
  const beginEdit = (position = selection.focus, value?: string) => {
    if (disabled) return;
    clearDrawingSelection();
    const anchor = mergedCellPosition(activeSheet, clampPosition(position, activeSheet));
    const next = { position: anchor, value: value ?? activeSheet.cells[cellAddress(anchor.row, anchor.column)]?.value ?? "" };
    editingRef.current = next;
    setEditing(next);
  };
  const cancelEdit = () => { editingRef.current = null; setEditing(null); };
  const commitEdit = () => {
    const current = editingRef.current;
    if (!current) return true;
    const accepted = apply(workbook => {
      if (!features.formulas && current.value.startsWith("=")) throw new Error("数式の入力は無効です");
      return setCellValue(workbook, activeSheet.id, cellAddress(current.position.row, current.position.column), current.value);
    });
    if (accepted) cancelEdit();
    return accepted;
  };
  const writeValues = (values: Record<string, string>) => apply(workbook => {
    if (!features.formulas && Object.values(values).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
    return setCellValues(workbook, activeSheet.id, values);
  });
  const clearCells = () => {
    try { writeValues(Object.fromEntries(selectedAddresses(selection).map(address => [address, ""]))); }
    catch (cause) { reportError(cause); }
  };

  return { editing, editingRef, beginEdit, cancelEdit, commitEdit, writeValues, clearCells };
}
