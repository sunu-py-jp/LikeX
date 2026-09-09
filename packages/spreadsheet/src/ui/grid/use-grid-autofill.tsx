"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { chainResult } from "../../core";
import type { SpreadsheetMergedRange } from "../../model/types";
import { rangesIntersect } from "../../model/merges";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { isMultiRangeSelection, selectionBounds } from "../../state/selection";
import { ROW_HEADER_WIDTH, ROW_HEIGHT } from "./grid-geometry";

type Geometry = { columnOffsets: readonly number[]; rowOffsets: readonly number[] };
type Drag = { source: SpreadsheetMergedRange; target: SpreadsheetMergedRange; sheetId: string; pointerId: number;
  workbook: SpreadsheetController["workbook"]; selection: SpreadsheetController["selection"];
  x: number; y: number; mode: "auto" | "copy" | "series" };
function cellAt(offsets: readonly number[], coordinate: number): number {
  let low = 0, high = offsets.length - 2;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (offsets[middle] <= coordinate) low = middle; else high = middle - 1; }
  return low;
}
export function autoFillTarget(source: SpreadsheetMergedRange, row: number, column: number): SpreadsheetMergedRange {
  const vertical = Math.max(source.top - row, row - source.bottom, 0), horizontal = Math.max(source.left - column, column - source.right, 0);
  return vertical >= horizontal ? { ...source, top: Math.min(source.top, row), bottom: Math.max(source.bottom, row) } :
    { ...source, left: Math.min(source.left, column), right: Math.max(source.right, column) };
}

/** One drag captures its source, previews a single axis, and commits through the ordinary command gate. */
export function useGridAutofill(c: SpreadsheetController, scroller: RefObject<HTMLDivElement | null>, geometry: Geometry) {
  const latest = useRef({ c, geometry });
  useLayoutEffect(() => { latest.current = { c, geometry }; });
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<SpreadsheetMergedRange | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  useEffect(() => {
    const element = scroller.current, document = element?.ownerDocument, view = document?.defaultView;
    if (!element || !document || !view) return;
    let frame = 0;
    const cancel = () => { drag.current = null; setPreview(null); if (frame) view.cancelAnimationFrame(frame); frame = 0; };
    cancelRef.current = cancel;
    const update = () => {
      const active = drag.current;
      if (!active) return;
      const { c: current, geometry: sizes } = latest.current;
      if (current.disabled || current.requesting || !current.features.autoFill || current.activeSheet.id !== active.sheetId || current.getWorkbook() !== active.workbook) { cancel(); return; }
      const bounds = element.getBoundingClientRect();
      const row = cellAt(sizes.rowOffsets, active.y - bounds.top + element.scrollTop);
      const column = cellAt(sizes.columnOffsets, active.x - bounds.left + element.scrollLeft);
      const target = autoFillTarget(active.source, row, column);
      active.target = target; setPreview(target);
    };
    const scroll = () => {
      frame = 0;
      const active = drag.current;
      if (!active) return;
      const bounds = element.getBoundingClientRect(), edge = 28;
      const dy = active.y < bounds.top + ROW_HEIGHT + edge ? -16 : active.y > bounds.bottom - edge ? 16 : 0;
      const dx = active.x < bounds.left + ROW_HEADER_WIDTH + edge ? -16 : active.x > bounds.right - edge ? 16 : 0;
      if (dy || dx) { element.scrollTop += dy; element.scrollLeft += dx; update(); }
      if (drag.current) frame = view.requestAnimationFrame(scroll);
    };
    const move = (event: globalThis.PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) { cancel(); return; }
      event.preventDefault();
      active.x = event.clientX; active.y = event.clientY;
      active.mode = event.altKey ? "series" : event.ctrlKey || event.metaKey ? "copy" : "auto";
      update();
      if (!frame && drag.current) frame = view.requestAnimationFrame(scroll);
    };
    const finish = (event: globalThis.PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const current = latest.current.c;
      cancel();
      if (current.getWorkbook() !== active.workbook || current.activeSheet.id !== active.sheetId || current.disabled || !current.features.autoFill) return;
      void chainResult(current.executeCommand({ type: "cells.fill", sheetId: active.sheetId, source: active.source, target: active.target, mode: active.mode }), result => {
        if (result.ok && latest.current.c.activeSheet.id === active.sheetId) latest.current.c.selectRange({ row: active.target.top, column: active.target.left }, { row: active.target.bottom, column: active.target.right });
      });
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
    view.addEventListener("blur", cancel);
    return () => {
      cancel(); cancelRef.current = () => {};
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel); document.removeEventListener("keydown", escape, true); view.removeEventListener("blur", cancel);
    };
  }, [scroller]);
  useLayoutEffect(() => { cancelRef.current(); }, [c.workbook, c.selection, c.activeSheet.id, c.features.autoFill, c.disabled]);
  const source = selectionBounds(c.selection);
  const enabled = c.features.autoFill && !c.disabled && !c.requesting && !c.editing && !c.pendingObjectEdit && !c.selectedDrawingId &&
    !isMultiRangeSelection(c.selection) && !(c.activeSheet.merges?.some(merge => rangesIntersect(merge, source)));
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { source, target: source, sheetId: c.activeSheet.id, workbook: c.getWorkbook(), selection: c.selection,
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, mode: event.altKey ? "series" : event.ctrlKey || event.metaKey ? "copy" : "auto" };
    setPreview(source);
  };
  const { columnOffsets, rowOffsets } = geometry;
  return {
    handle: enabled ? <button type="button" className="lxs-fill-handle" aria-label="オートフィル" title="ドラッグしてオートフィル（Ctrl: コピー / Alt: 連番）"
      style={{ left: columnOffsets[source.right + 1] - 4, top: rowOffsets[source.bottom + 1] - 4 }} onPointerDown={start}
      onKeyDown={event => {
        if (!enabled || !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const target = { ...source };
        if (event.key === "ArrowDown") target.bottom = Math.min(c.activeSheet.rowCount - 1, source.bottom + 1);
        if (event.key === "ArrowUp") target.top = Math.max(0, source.top - 1);
        if (event.key === "ArrowRight") target.right = Math.min(c.activeSheet.columnCount - 1, source.right + 1);
        if (event.key === "ArrowLeft") target.left = Math.max(0, source.left - 1);
        c.afterCommand({ type: "cells.fill", sheetId: c.activeSheet.id, source, target, mode: event.altKey ? "series" : "auto" }, () =>
          c.selectRange({ row: target.top, column: target.left }, { row: target.bottom, column: target.right }));
      }} /> : null,
    preview: preview ? <div className="lxs-fill-preview" aria-hidden="true" style={{ left: columnOffsets[preview.left], top: rowOffsets[preview.top],
      width: columnOffsets[preview.right + 1] - columnOffsets[preview.left], height: rowOffsets[preview.bottom + 1] - rowOffsets[preview.top] }} /> : null,
  };
}
