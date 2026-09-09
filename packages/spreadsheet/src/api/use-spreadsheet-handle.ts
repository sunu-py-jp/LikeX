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
    getWorkbook: () => latest.current.getWorkbook(),
  }), []);
  useImperativeHandle(ref, () => handle, [handle]);
}
