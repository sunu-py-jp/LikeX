"use client";

import { useCallback, useMemo } from "react";
import { calculateWorkbook } from "../model";
import type { SpreadsheetProps } from "../props";
import { resolveSpreadsheetFeatures } from "./features";
import type { Workbook, WorkbookOperation } from "./types";
import { useCellEdit } from "./use-cell-edit";
import { usePendingObjectEdits } from "./use-pending-object-edits";
import { useSpreadsheetSelection } from "./use-spreadsheet-selection";
import { useSpreadsheetCommands } from "./use-spreadsheet-commands";
import { useWorkbookDraft } from "./use-workbook-draft";

export { MAX_SELECTION_CELLS, MAX_SELECTION_RANGES, selectedAddresses, selectionBounds, selectionRanges, rangeBounds,
  isCellSelected, isRangeSelected, isMultiRangeSelection, selectionCellCount } from "./selection";
export type { Workbook, Sheet, Position, CellFormat } from "./types";
export { DEFAULT_ROW_HEIGHT as ROW_HEIGHT, DEFAULT_COLUMN_WIDTH as COLUMN_WIDTH } from "../model/sheet-dimensions";

/** Coordinates independent draft, view selection, and edit sessions behind the stable controller API. */
export function useSpreadsheet(props: SpreadsheetProps) {
  const features = resolveSpreadsheetFeatures(props.features);
  const draft = useWorkbookDraft(props);
  const view = useSpreadsheetSelection(draft.workbook, features, draft.reportError, draft.propsRef);
  const { selectionRef, setSelection } = view;
  const applyDraft = draft.apply;
  const apply = useCallback((operation: WorkbookOperation): boolean => applyDraft(operation, { selectionRef, setSelection }),
    [applyDraft, selectionRef, setSelection]);
  const cellEdit = useCellEdit({ activeSheet: view.activeSheet, selection: view.selection, disabled: draft.disabled,
    features, apply, clearDrawingSelection: view.clearDrawingSelection, reportError: draft.reportError });
  const pending = usePendingObjectEdits();
  const commands = useSpreadsheetCommands(draft, { selectionRef, setSelection,
    editingRef: cellEdit.editingRef, pendingObjectEditRef: pending.pendingObjectEditRef });
  const calculated = useMemo(() => calculateWorkbook(draft.workbook), [draft.workbook]);

  const selectDrawing = (id: string | null) => {
    if (!cellEdit.commitEdit()) return false;
    view.selectDrawing(id);
    return true;
  };
  const switchSheet = (id: string) => {
    if (cellEdit.commitEdit()) view.switchSheet(id, draft.workbookRef.current);
  };
  const restoreHistoryView = (workbook: Workbook) => {
    cellEdit.cancelEdit();
    view.resetForWorkbook(workbook);
  };
  const save = () => draft.save({ commitEdit: cellEdit.commitEdit,
    hasPendingEdits: () => pending.pendingObjectEditRef.current, resetView: view.resetForWorkbook });

  return { workbook: draft.workbook, activeSheet: view.activeSheet, selection: view.selection,
    select: view.select, selectRange: view.selectRange, toggleSelection: view.toggleSelection, toggleSelectionRange: view.toggleSelectionRange,
    switchSheet, calculated, editing: cellEdit.editing, beginEdit: cellEdit.beginEdit, cancelEdit: cellEdit.cancelEdit, commitEdit: cellEdit.commitEdit,
    selectedDrawingId: view.selectedDrawingId, selectedDrawing: view.selectedDrawing, selectDrawing,
    commentOpen: view.commentOpen, setCommentOpen: view.setCommentOpen,
    pendingObjectEdit: pending.pendingObjectEdit, setPendingObjectEdit: pending.setPendingObjectEdit,
    gridFocusRequest: view.gridFocusRequest, requestGridFocus: view.requestGridFocus,
    features, readOnly: draft.readOnly, disabled: draft.disabled, dirty: draft.dirty, saving: draft.saving,
    error: draft.error, setError: draft.setError, reportError: draft.reportError, apply,
    writeValues: cellEdit.writeValues, clearCells: cellEdit.clearCells, save,
    ...commands,
    undo: () => draft.changeHistory("past", restoreHistoryView), redo: () => draft.changeHistory("future", restoreHistoryView),
    canUndo: draft.canUndo, canRedo: draft.canRedo };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
