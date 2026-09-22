"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import type { SpreadsheetHandle } from "./types";
import { createSpreadsheetReader } from "../model/query-reader";

/** The public handle remains stable while delegating to the currently committed controller. */
export function useSpreadsheetHandle(ref: Ref<SpreadsheetHandle> | undefined, controller: SpreadsheetController) {
  const latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; });
  const reader = useMemo(() => createSpreadsheetReader(controller.getWorkbook), [controller.getWorkbook]);
  const handle = useMemo<SpreadsheetHandle>(() => ({
    ...reader,
    getSelection: () => latest.current.selectionApi.getSelection(),
    getSelectedDrawing: () => latest.current.selectionApi.getSelectedDrawing(),
    selectSheet: (...args) => latest.current.selectionApi.selectSheet(...args),
    selectCell: (...args) => latest.current.selectionApi.selectCell(...args),
    selectRange: (...args) => latest.current.selectionApi.selectRange(...args),
    selectRanges: (...args) => latest.current.selectionApi.selectRanges(...args),
    selectRows: (...args) => latest.current.selectionApi.selectRows(...args),
    selectColumns: (...args) => latest.current.selectionApi.selectColumns(...args),
    selectDrawing: (...args) => latest.current.selectionApi.selectDrawing(...args),
    clearSelection: (...args) => latest.current.selectionApi.clearSelection(...args),
    revealSelection: () => latest.current.selectionApi.revealSelection(),
    execute: command => latest.current.externalExecute(command),
    batch: commands => latest.current.externalBatch(commands),
    executeAsync: command => latest.current.externalExecuteAsync(command),
    batchAsync: commands => latest.current.externalBatchAsync(commands),
    getWorkbook: () => latest.current.getWorkbook(),
    getZoom: () => latest.current.getZoom(),
    setZoom: percent => latest.current.setZoom(percent),
    undo: () => latest.current.externalUndo(),
    redo: () => latest.current.externalRedo(),
    getHistoryState: () => latest.current.getHistoryState(),
    getEditState: () => latest.current.getEditState(),
    requestEdit: intent => latest.current.requestEdit(intent),
    cancelEditRequest: () => latest.current.cancelEditRequest(),
    endEdit: () => latest.current.endEdit(),
    save: () => latest.current.externalSave(),
    exportExcel: options => latest.current.exportExcel(options),
    importExcel: (input, options) => latest.current.importExcel(input, options),
    exportNative: options => latest.current.exportNative(options),
    importNative: (input, options) => latest.current.importNative(input, options),
    refresh: options => latest.current.refresh(options),
    discard: options => latest.current.discard(options),
  }), [reader]);
  useImperativeHandle(ref, () => handle, [handle]);
}
