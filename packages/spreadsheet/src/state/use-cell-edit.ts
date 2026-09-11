"use client";

import { useRef, useState } from "react";
import type { MaybePromise } from "../core";
import { cellAddress, mergedCellPosition } from "../model";
import type { SpreadsheetSelection } from "../props";
import type { SpreadsheetCommand, SpreadsheetCommandResult } from "../api/types";
import { clampPosition, rangeBounds, selectionRanges } from "./selection";
import type { Position, ReportError, Sheet } from "./types";
import type { SpreadsheetGuiCommandOptions } from "./use-spreadsheet-commands";

type CellEditOptions = {
  activeSheet: Sheet;
  selection: SpreadsheetSelection;
  disabled: boolean;
  executeCommands: (commands: readonly SpreadsheetCommand[], options?: SpreadsheetGuiCommandOptions) => MaybePromise<SpreadsheetCommandResult>;
  cancelEditRequest: () => void;
  clearDrawingSelection: () => void;
  reportError: ReportError;
};

/** Keeps typed text separate from the draft until a successful commit. */
export function useCellEdit({ activeSheet, selection, disabled, executeCommands, cancelEditRequest, clearDrawingSelection, reportError }: CellEditOptions) {
  const [editing, setEditing] = useState<{ position: Position; value: string; sheetId: string } | null>(null);
  const editingRef = useRef(editing);
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
    const result = executeCommands([{ type: "cells.set", sheetId: current.sheetId,
      values: { [cellAddress(current.position.row, current.position.column)]: current.value } }],
    { allowSaveStarting: true, allowPendingCellEdit: true, isCurrent: () => editingRef.current === current });
    const finish = (accepted: SpreadsheetCommandResult) => {
      if (!accepted.ok || editingRef.current !== current) return false;
      cancelEdit();
      return true;
    };
    return result instanceof Promise ? result.then(finish) : finish(result);
  };
  const writeValues = (values: Record<string, string>): MaybePromise<boolean> => {
    const result = executeCommands([{ type: "cells.set", sheetId: activeSheet.id, values }]);
    return result instanceof Promise ? result.then(value => value.ok) : result.ok;
  };
  const clearCells = () => {
    try { executeCommands(selectionRanges(selection).map(range => ({ type: "cells.clear" as const, sheetId: activeSheet.id, range: rangeBounds(range) }))); }
    catch (cause) { reportError(cause); }
  };

  return { editing, editingRef, beginEdit, cancelEdit, commitEdit, writeValues, clearCells };
}
