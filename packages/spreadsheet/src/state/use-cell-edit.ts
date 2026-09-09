"use client";

import { useInsertionEffect, useRef, useState } from "react";
import type { MaybePromise } from "../core";
import { cellAddress, mergedCellPosition, setCellValue, setCellValues } from "../model";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetFeatureSettings } from "./features";
import { clampPosition, selectedAddresses } from "./selection";
import type { Position, ReportError, Sheet, WorkbookOperation } from "./types";
import type { DraftOperationOptions } from "./use-workbook-draft";

type CellEditOptions = {
  activeSheet: Sheet;
  selection: SpreadsheetSelection;
  disabled: boolean;
  features: SpreadsheetFeatureSettings;
  apply: (operation: WorkbookOperation, options?: DraftOperationOptions) => MaybePromise<boolean>;
  cancelEditRequest: () => void;
  clearDrawingSelection: () => void;
  reportError: ReportError;
};

/** Keeps typed text separate from the draft until a successful commit. */
export function useCellEdit({ activeSheet, selection, disabled, features, apply, cancelEditRequest, clearDrawingSelection, reportError }: CellEditOptions) {
  const [editing, setEditing] = useState<{ position: Position; value: string; sheetId: string } | null>(null);
  const editingRef = useRef(editing);
  const currentFeatures = useRef(features);
  useInsertionEffect(() => { currentFeatures.current = features; }, [features]);
  const beginEdit = (position = selection.focus, value?: string) => {
    if (disabled) return;
    clearDrawingSelection();
    const anchor = mergedCellPosition(activeSheet, clampPosition(position, activeSheet));
    const next = { position: anchor, value: value ?? activeSheet.cells[cellAddress(anchor.row, anchor.column)]?.value ?? "", sheetId: activeSheet.id };
    if (editingRef.current) cancelEditRequest();
    editingRef.current = next;
    setEditing(next);
  };
  const cancelEdit = () => { editingRef.current = null; setEditing(null); cancelEditRequest(); };
  const commitEdit = (): MaybePromise<boolean> => {
    const current = editingRef.current;
    if (!current) return true;
    const result = apply(workbook => {
      if (!currentFeatures.current.formulas && current.value.startsWith("=")) throw new Error("数式の入力は無効です");
      return setCellValue(workbook, current.sheetId, cellAddress(current.position.row, current.position.column), current.value);
    }, { source: "ui", action: "cells.set", commands: ["cells.set"], sheetId: current.sheetId,
      isCurrent: () => editingRef.current === current });
    const finish = (accepted: boolean) => {
      if (!accepted || editingRef.current !== current) return false;
      cancelEdit();
      return true;
    };
    return typeof result === "boolean" ? finish(result) : result.then(finish);
  };
  const writeValues = (values: Record<string, string>) => apply(workbook => {
    if (!currentFeatures.current.formulas && Object.values(values).some(value => value.startsWith("="))) throw new Error("数式の入力は無効です");
    return setCellValues(workbook, activeSheet.id, values);
  }, { source: "ui", action: "cells.set", commands: ["cells.set"], sheetId: activeSheet.id });
  const clearCells = () => {
    try { writeValues(Object.fromEntries(selectedAddresses(selection).map(address => [address, ""]))); }
    catch (cause) { reportError(cause); }
  };

  return { editing, editingRef, beginEdit, cancelEdit, commitEdit, writeValues, clearCells };
}
