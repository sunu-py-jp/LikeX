"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { SpreadsheetRenderingMode } from "../../props";
import { advanceGridRows, createGridRowProgress, mergeGridRows, retainGridRows, scheduleGridBackgroundWork, type GridRowProgress } from "./progressive-grid-rows";

/** The sheet's data is already loaded; only offscreen grid DOM is prepared here. */
export function useProgressiveGridRows(sheetId: string, rowCount: number, columnCount: number, priorityRows: readonly number[],
  mode: SpreadsheetRenderingMode, scroller: RefObject<HTMLDivElement | null>) {
  // Spreadsheet remounts its view when opening/replacing a workbook. Switching
  // sheets, dimensions or modes also starts a fresh cancellable session here.
  const session = useMemo(() => ({ ...createGridRowProgress(rowCount, columnCount), sheetId, mode }), [sheetId, rowCount, columnCount, mode]);
  const [snapshot, setSnapshot] = useState<{ session: GridRowProgress; rows: readonly number[] }>(() => ({ session, rows: mode === "progressive" ? priorityRows : [] }));
  const retained = snapshot.session === session ? snapshot.rows : undefined;
  const rows = useMemo(() => mode === "viewport" || !retained ? priorityRows : mergeGridRows(retained, priorityRows), [mode, retained, priorityRows]);
  // Adjust retained view state before children commit: a viewport change must
  // not briefly unmount the editor or discard rows already prepared. This
  // conditional update also releases the old session on mode/sheet changes.
  if (snapshot.session !== session || (mode === "progressive" && snapshot.rows !== rows)) {
    setSnapshot({ session, rows: mode === "progressive" ? rows : [] });
  }

  useEffect(() => {
    if (mode !== "progressive") return;
    retainGridRows(session, rows);
    if (session.loaded.size >= rowCount) return;
    const host = scroller.current?.ownerDocument.defaultView;
    // A real browsing context owns the task. Headless/SSR renderers do not
    // start global timers, and neither can work outlive an unmounted view.
    if (!host || typeof host.setTimeout !== "function") return;
    return scheduleGridBackgroundWork(host, () => {
      if (advanceGridRows(session)) setSnapshot({ session, rows: session.rows });
    });
  }, [session, mode, rowCount, scroller, rows]);

  return rows;
}
