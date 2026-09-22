"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import { calculateWorkbook, cellAddress } from "../model";
import { notifyHost, type MaybePromise } from "../core";
import type { SpreadsheetCommand, SpreadsheetCommandResult, SpreadsheetCommandSuccess } from "../api/types";
import type { SpreadsheetDiscardOptions } from "../api/lifecycle";
import type { SpreadsheetProps } from "../props";
import { resolveSpreadsheetFeatures } from "../api/resolve-features";
import type { Position, Workbook } from "./types";
import { useCellEdit } from "./use-cell-edit";
import { usePendingObjectEdits } from "./use-pending-object-edits";
import { useSpreadsheetExport } from "./use-spreadsheet-export";
import { useSpreadsheetImport } from "./use-spreadsheet-import";
import type { SpreadsheetExcelExportOptions, SpreadsheetNativeExportOptions } from "../export/types";
import { useSpreadsheetSelection } from "./use-spreadsheet-selection";
import { useSpreadsheetCommands, type SpreadsheetGuiCommandOptions } from "./use-spreadsheet-commands";
import { useWorkbookDraft } from "./use-workbook-draft";
import { findHistoryTarget, type SpreadsheetHistoryTarget } from "./history-target";
import { useSpreadsheetZoom } from "./use-spreadsheet-zoom";

export { MAX_SELECTION_CELLS, MAX_SELECTION_RANGES, selectedAddresses, selectionBounds, selectionRanges, rangeBounds,
  isCellSelected, isRangeSelected, isMultiRangeSelection, selectionCellCount } from "./selection";
export type { Workbook, Sheet, Position, CellFormat } from "./types";
export { DEFAULT_ROW_HEIGHT as ROW_HEIGHT, DEFAULT_COLUMN_WIDTH as COLUMN_WIDTH } from "../model/sheet-dimensions";

/** Coordinates independent draft, view selection, and edit sessions behind the stable controller API. */
export function useSpreadsheet(props: SpreadsheetProps) {
  const features = resolveSpreadsheetFeatures(props.features);
  const draft = useWorkbookDraft(props);
  const zoom = useSpreadsheetZoom(props, draft.emitEvent);
  const view = useSpreadsheetSelection(draft.workbook, features, draft.reportError, draft.propsRef,
    () => draft.workbookRef.current, () => !cellEdit.editingRef.current && !pending.pendingObjectEditRef.current);
  const { selectionRef, setSelection } = view;
  // The editor only calls this after initialization; command guards can then inspect its live ref.
  const executeGuiCommands = (items: readonly SpreadsheetCommand[], options?: SpreadsheetGuiCommandOptions): MaybePromise<SpreadsheetCommandResult> =>
    commands.executeCommands(items, options);
  const cellEdit = useCellEdit({ activeSheet: view.activeSheet, selection: view.selection, disabled: draft.disabled,
    executeCommands: executeGuiCommands, cancelEditRequest: draft.cancelEditRequest,
    clearDrawingSelection: view.clearDrawingSelection, reportError: draft.reportError });
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
    const finish = (accepted: boolean) => accepted && view.selectDrawing(id);
    return typeof result === "boolean" ? finish(result) : result.then(finish);
  };
  const switchSheet = (id: string) => {
    afterCommit(() => view.switchSheet(id));
  };
  const resetWorkbookView = (workbook: Workbook) => {
    cellEdit.cancelEdit();
    view.resetForWorkbook(workbook);
  };
  const restoreHistoryView = (workbook: Workbook, previous: Workbook, target?: SpreadsheetHistoryTarget) => {
    cellEdit.cancelEdit();
    view.resetForWorkbook(workbook, { preserveFocus: true,
      historyTarget: target ?? findHistoryTarget(previous, workbook, view.selectionRef.current.sheetId) });
  };
  const viewSession = { commitEdit: cellEdit.commitEdit,
    hasPendingEdits: () => !!cellEdit.editingRef.current || pending.pendingObjectEditRef.current, resetView: resetWorkbookView };
  const externalHistory = (direction: "past" | "future") => viewSession.hasPendingEdits() ? false :
    draft.changeHistory(direction, restoreHistoryView, { source: "api", isCurrent: () => !viewSession.hasPendingEdits() });
  const save = () => fileImport.isImporting() ? Promise.resolve(false) : draft.save(viewSession);
  const externalSave = () => fileImport.isImporting() || viewSession.hasPendingEdits() ? Promise.resolve(false) : draft.save(viewSession);
  const refresh = (options?: SpreadsheetDiscardOptions) => fileImport.isImporting() ? Promise.resolve(false) : draft.refresh(viewSession, options);
  const discard = (options?: SpreadsheetDiscardOptions) => !fileImport.isImporting() && draft.discard(viewSession, options);
  const endEdit = () => !fileImport.isImporting() && !viewSession.hasPendingEdits() && draft.endEdit();
  const fileExport = useSpreadsheetExport(draft, viewSession.hasPendingEdits);
  const fileImport = useSpreadsheetImport(draft, { selectionRef, setSelection, hasPendingEdits: viewSession.hasPendingEdits,
    capturePendingEdits: () => {
      const cell = cellEdit.editingRef.current, revision = pending.pendingEditRevisionRef.current;
      return () => cellEdit.editingRef.current === cell && pending.pendingEditRevisionRef.current === revision;
    },
    resetView: workbook => { pending.clearPendingObjectEdits(); resetWorkbookView(workbook); },
    isExporting: fileExport.isExporting });
  const exportExcel = (options?: SpreadsheetExcelExportOptions) => fileImport.isImporting()
    ? Promise.reject(new Error("取り込みの処理が完了してから出力してください")) : fileExport.exportExcel(options);
  const exportNative = (options?: SpreadsheetNativeExportOptions) => fileImport.isImporting()
    ? Promise.reject(new Error("取り込みの処理が完了してから出力してください")) : fileExport.exportNative(options);
  const changedCellInput = cellEdit.editing !== null && cellEdit.editing.value !==
    (draft.workbook.sheets.find(sheet => sheet.id === cellEdit.editing?.sheetId)?.cells[cellAddress(cellEdit.editing.position.row, cellEdit.editing.position.column)]?.value ?? "");
  const hasUnsavedChanges = draft.dirty || changedCellInput || pending.pendingObjectEdit;
  const pendingInput = changedCellInput || pending.pendingObjectEdit;
  const { dirty, emitEvent } = draft;
  useEffect(() => { notifyHost(props.onUnsavedChangesChange, hasUnsavedChanges); }, [props.onUnsavedChangesChange, hasUnsavedChanges]);
  useEffect(() => { emitEvent({ type: "unsaved-changes", dirty, pending: pendingInput, hasUnsavedChanges }); },
    [emitEvent, dirty, pendingInput, hasUnsavedChanges]);

  return { ...zoom, workbook: draft.workbook, activeSheet: view.activeSheet, selection: view.selection,
    selectionApi: view.selectionApi, selectionFocus: view.selectionFocus, selectionReveal: view.selectionReveal, gridRevealRequest: view.gridRevealRequest,
    select: view.select, selectRange: view.selectRange, selectAxisRange: view.selectAxisRange, toggleAxisRange: view.toggleAxisRange,
    toggleSelection: view.toggleSelection, toggleSelectionRange: view.toggleSelectionRange,
    switchSheet, selectCellInSheet: view.selectCellInSheet,
    selectRangeInSheet: (sheetId: string, anchor: Position, focus: Position, activeFocus?: Position, kind?: "row" | "column") =>
      view.selectRangeInSheet(sheetId, anchor, focus, draft.workbookRef.current, activeFocus, kind),
    calculated, editing: cellEdit.editing, beginEdit: cellEdit.beginEdit, cancelEdit: cellEdit.cancelEdit, commitEdit: cellEdit.commitEdit,
    selectedDrawingId: view.selectedDrawingId, selectedDrawing: view.selectedDrawing, selectDrawing,
    commentOpen: view.commentOpen, setCommentOpen: view.setCommentOpen,
    pendingObjectEdit: pending.pendingObjectEdit, setPendingObjectEdit: pending.setPendingObjectEdit,
    gridFocusRequest: view.gridFocusRequest, requestGridFocus: view.requestGridFocus,
    features, readOnly: draft.readOnly, disabled: draft.disabled, dirty: draft.dirty, saving: draft.saving,
    refreshing: draft.refreshing, requesting: draft.editState.mode === "requesting", editMode: draft.editState.mode,
    canRefresh: !!props.onRefresh && features.refresh, hasUnsavedChanges,
    ...fileExport, ...fileImport, exportExcel, exportNative, exportFileName: props.exportFileName ?? props.title ?? "spreadsheet",
    viewRevision: view.viewRevision,
    setContextMenuLock: draft.setContextMenuLock, contextMenuLocked: draft.contextMenuLocked,
    getRevision: () => draft.revisionRef.current, getStructureRevision: () => draft.structureRevisionRef.current,
    emitEvent: draft.emitEvent, getEditState: draft.getEditState, requestEdit: draft.requestEdit,
    cancelEditRequest: draft.cancelEditRequest, endEdit, refresh, discard, externalSave, afterCommit, afterCommand,
    error: draft.error, setError: draft.setError, reportError: draft.reportError,
    writeValues: cellEdit.writeValues, clearCells: cellEdit.clearCells, save,
    ...commands,
    undo: () => draft.changeHistory("past", restoreHistoryView), redo: () => draft.changeHistory("future", restoreHistoryView),
    externalUndo: () => externalHistory("past"), externalRedo: () => externalHistory("future"), getHistoryState: draft.getHistoryState,
    canUndo: draft.canUndo, canRedo: draft.canRedo };
}

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
