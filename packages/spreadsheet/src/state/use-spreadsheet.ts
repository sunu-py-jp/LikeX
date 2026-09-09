"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { calculateWorkbook, cellAddress } from "../model";
import { notifyHost, type MaybePromise } from "../core";
import type { SpreadsheetCommand, SpreadsheetCommandSuccess } from "../api/types";
import type { SpreadsheetDiscardOptions } from "../api/lifecycle";
import type { SpreadsheetProps } from "../props";
import { resolveSpreadsheetFeatures } from "./features";
import type { Workbook, WorkbookOperation } from "./types";
import { useCellEdit } from "./use-cell-edit";
import { usePendingObjectEdits } from "./use-pending-object-edits";
import { useSpreadsheetExport } from "./use-spreadsheet-export";
import { useSpreadsheetSelection } from "./use-spreadsheet-selection";
import { useSpreadsheetCommands } from "./use-spreadsheet-commands";
import { useWorkbookDraft, type DraftOperationOptions } from "./use-workbook-draft";

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
  const apply = useCallback((operation: WorkbookOperation, options?: DraftOperationOptions): MaybePromise<boolean> => applyDraft(operation, { selectionRef, setSelection }, options),
    [applyDraft, selectionRef, setSelection]);
  const cellEdit = useCellEdit({ activeSheet: view.activeSheet, selection: view.selection, disabled: draft.disabled,
    features, apply, cancelEditRequest: draft.cancelEditRequest, clearDrawingSelection: view.clearDrawingSelection, reportError: draft.reportError });
  const pending = usePendingObjectEdits();
  const commands = useSpreadsheetCommands(draft, { selectionRef, setSelection,
    editingRef: cellEdit.editingRef, pendingObjectEditRef: pending.pendingObjectEditRef });
  const calculated = useMemo(() => calculateWorkbook(draft.workbook), [draft.workbook]);
  const { resetViewRef } = draft;
  useLayoutEffect(() => { resetViewRef.current = view.resetForWorkbook; }, [resetViewRef, view.resetForWorkbook]);

  const afterCommit = (callback: () => void): void => {
    const result = cellEdit.commitEdit();
    if (typeof result === "boolean") { if (result) callback(); }
    else void result.then(accepted => { if (accepted) callback(); }, draft.reportError);
  };
  const afterCommand = (command: SpreadsheetCommand, onSuccess?: (result: SpreadsheetCommandSuccess) => void): void => {
    const result = commands.executeCommand(command);
    const finish = (value: Awaited<typeof result>) => { if (value.ok) onSuccess?.(value); };
    if (result instanceof Promise) void result.then(finish, draft.reportError);
    else finish(result);
  };

  const selectDrawing = (id: string | null): MaybePromise<boolean> => {
    const result = cellEdit.commitEdit();
    const finish = (accepted: boolean) => { if (accepted) view.selectDrawing(id); return accepted; };
    return typeof result === "boolean" ? finish(result) : result.then(finish);
  };
  const switchSheet = (id: string) => {
    afterCommit(() => view.switchSheet(id, draft.workbookRef.current));
  };
  const restoreHistoryView = (workbook: Workbook) => {
    cellEdit.cancelEdit();
    view.resetForWorkbook(workbook);
  };
  const viewSession = { commitEdit: cellEdit.commitEdit,
    hasPendingEdits: () => !!cellEdit.editingRef.current || pending.pendingObjectEditRef.current, resetView: restoreHistoryView };
  const save = () => draft.save(viewSession);
  const externalSave = () => viewSession.hasPendingEdits() ? Promise.resolve(false) : draft.save(viewSession);
  const refresh = (options?: SpreadsheetDiscardOptions) => draft.refresh(viewSession, options);
  const discard = (options?: SpreadsheetDiscardOptions) => draft.discard(viewSession, options);
  const endEdit = () => !viewSession.hasPendingEdits() && draft.endEdit();
  const excelExport = useSpreadsheetExport(draft, viewSession.hasPendingEdits);
  const changedCellInput = cellEdit.editing !== null && cellEdit.editing.value !==
    (draft.workbook.sheets.find(sheet => sheet.id === cellEdit.editing?.sheetId)?.cells[cellAddress(cellEdit.editing.position.row, cellEdit.editing.position.column)]?.value ?? "");
  const hasUnsavedChanges = draft.dirty || changedCellInput || pending.pendingObjectEdit;
  const pendingInput = changedCellInput || pending.pendingObjectEdit;
  const { dirty, emitEvent } = draft;
  useEffect(() => { notifyHost(props.onUnsavedChangesChange, hasUnsavedChanges); }, [props.onUnsavedChangesChange, hasUnsavedChanges]);
  useEffect(() => { emitEvent({ type: "unsaved-changes", dirty, pending: pendingInput, hasUnsavedChanges }); },
    [emitEvent, dirty, pendingInput, hasUnsavedChanges]);

  return { workbook: draft.workbook, activeSheet: view.activeSheet, selection: view.selection,
    select: view.select, selectRange: view.selectRange, toggleSelection: view.toggleSelection, toggleSelectionRange: view.toggleSelectionRange,
    switchSheet, selectCellInSheet: view.selectCellInSheet, calculated, editing: cellEdit.editing, beginEdit: cellEdit.beginEdit, cancelEdit: cellEdit.cancelEdit, commitEdit: cellEdit.commitEdit,
    selectedDrawingId: view.selectedDrawingId, selectedDrawing: view.selectedDrawing, selectDrawing,
    commentOpen: view.commentOpen, setCommentOpen: view.setCommentOpen,
    pendingObjectEdit: pending.pendingObjectEdit, setPendingObjectEdit: pending.setPendingObjectEdit,
    gridFocusRequest: view.gridFocusRequest, requestGridFocus: view.requestGridFocus,
    features, readOnly: draft.readOnly, disabled: draft.disabled, dirty: draft.dirty, saving: draft.saving,
    refreshing: draft.refreshing, requesting: draft.editState.mode === "requesting", editMode: draft.editState.mode,
    canRefresh: !!props.onRefresh && features.refresh, hasUnsavedChanges,
    ...excelExport, exportFileName: props.exportFileName ?? props.title ?? "spreadsheet",
    viewRevision: view.viewRevision,
    setContextMenuLock: draft.setContextMenuLock, contextMenuLocked: draft.contextMenuLocked,
    getRevision: () => draft.revisionRef.current, getStructureRevision: () => draft.structureRevisionRef.current,
    emitEvent: draft.emitEvent, getEditState: draft.getEditState, requestEdit: draft.requestEdit,
    cancelEditRequest: draft.cancelEditRequest, endEdit, refresh, discard, externalSave, afterCommit, afterCommand,
    error: draft.error, setError: draft.setError, reportError: draft.reportError, apply,
    writeValues: cellEdit.writeValues, clearCells: cellEdit.clearCells, save,
    ...commands,
    undo: () => draft.changeHistory("past", restoreHistoryView), redo: () => draft.changeHistory("future", restoreHistoryView),
    canUndo: draft.canUndo, canRedo: draft.canRedo };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
