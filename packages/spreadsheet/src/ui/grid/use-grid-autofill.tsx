"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { chainResult, getDragScrollDelta } from "../../core";
import type { SpreadsheetMergedRange } from "../../model/types";
import { rangesIntersect } from "../../model/merges";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { isMultiRangeSelection, selectionBounds } from "../../state/selection";
import { gridBodyBounds, gridCellAtPointer, type GridPointerGeometry } from "./grid-pointer-geometry";

type Geometry = GridPointerGeometry;
type Drag = { source: SpreadsheetMergedRange; target: SpreadsheetMergedRange; sheetId: string; pointerId: number;
  workbook: SpreadsheetController["workbook"]; selection: SpreadsheetController["selection"]; zoom: number;
  x: number; y: number; mode: "auto" | "copy" | "series" };
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
    let frame = 0, previousTime = 0;
    const cancel = () => { drag.current = null; setPreview(null); if (frame) view.cancelAnimationFrame(frame); frame = 0; };
    cancelRef.current = cancel;
    const valid = () => {
      const active = drag.current, current = latest.current.c;
      if (!active) return null;
      if (current.disabled || current.requesting || current.editing || current.pendingObjectEdit || current.selectedDrawingId || !current.features.autoFill ||
        current.activeSheet.id !== active.sheetId || current.getWorkbook() !== active.workbook || current.selection !== active.selection || current.zoom !== active.zoom) { cancel(); return null; }
      return active;
    };
    const update = () => {
      const active = valid();
      if (!active) return;
      const { c: current, geometry: sizes } = latest.current;
      const bounds = element.getBoundingClientRect();
      const scale = (current.zoom ?? 100) / 100;
      const { row, column } = gridCellAtPointer(sizes, active, bounds, element, scale);
      const target = autoFillTarget(active.source, row, column);
      active.target = target; setPreview(target);
    };
    const scroll = (time: number) => {
      frame = 0;
      const active = valid();
      if (!active) return;
      const current = latest.current.c;
      const bounds = element.getBoundingClientRect(), scale = (current.zoom ?? 100) / 100;
      const delta = getDragScrollDelta(active, gridBodyBounds(bounds, scale), previousTime ? time - previousTime : 16, { edge: 32 });
      previousTime = time;
      if (delta.x || delta.y) { element.scrollTop += delta.y / scale; element.scrollLeft += delta.x / scale; update(); }
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
      if (!frame && drag.current) { previousTime = 0; frame = view.requestAnimationFrame(scroll); }
    };
    const finish = (event: globalThis.PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (!valid()) return;
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) { active.x = event.clientX; active.y = event.clientY; }
      active.mode = event.altKey ? "series" : event.ctrlKey || event.metaKey ? "copy" : "auto";
      update();
      const current = latest.current.c;
      cancel();
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
  useLayoutEffect(() => { cancelRef.current(); }, [c.workbook, c.selection, c.activeSheet.id, c.features.autoFill, c.disabled, c.requesting, c.zoom, c.editing, c.pendingObjectEdit, c.selectedDrawingId]);
  const source = selectionBounds(c.selection);
  const enabled = c.features.autoFill && !c.disabled && !c.requesting && !c.editing && !c.pendingObjectEdit && !c.selectedDrawingId &&
    !isMultiRangeSelection(c.selection) && !(c.activeSheet.merges?.some(merge => rangesIntersect(merge, source)));
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { source, target: source, sheetId: c.activeSheet.id, workbook: c.getWorkbook(), selection: c.selection, zoom: c.zoom,
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
