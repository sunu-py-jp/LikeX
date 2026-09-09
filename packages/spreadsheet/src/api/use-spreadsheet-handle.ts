"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from "react";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import type { SpreadsheetHandle } from "./types";

/** The public handle remains stable while delegating to the currently committed controller. */
export function useSpreadsheetHandle(ref: Ref<SpreadsheetHandle> | undefined, controller: SpreadsheetController) {
  const latest = useRef(controller);
  useLayoutEffect(() => { latest.current = controller; });
  const handle = useMemo<SpreadsheetHandle>(() => ({
    execute: command => latest.current.externalExecute(command),
    batch: commands => latest.current.externalBatch(commands),
    executeAsync: command => latest.current.externalExecuteAsync(command),
    batchAsync: commands => latest.current.externalBatchAsync(commands),
    getWorkbook: () => latest.current.getWorkbook(),
    getEditState: () => latest.current.getEditState(),
    requestEdit: intent => latest.current.requestEdit(intent),
    cancelEditRequest: () => latest.current.cancelEditRequest(),
    endEdit: () => latest.current.endEdit(),
    save: () => latest.current.externalSave(),
    exportExcel: options => latest.current.exportExcel(options),
    refresh: options => latest.current.refresh(options),
    discard: options => latest.current.discard(options),
  }), []);
  useImperativeHandle(ref, () => handle, [handle]);
}
