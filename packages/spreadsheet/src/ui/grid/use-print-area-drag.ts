"use client";

import { useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import type { SpreadsheetCommand } from "../../api/types";
import type { SpreadsheetMergedRange } from "../../model/types";
import { adjustPrintArea, printGridIndex, type PrintAreaHandle } from "./print-area-geometry";

type Target = { handle: PrintAreaHandle } | { axis: "row" | "column"; index: number };
type Session = { target: Target; area: SpreadsheetMergedRange; preview: SpreadsheetMergedRange; breakIndex?: number;
  origin: { row: number; column: number }; workbook: ReturnType<SpreadsheetController["getWorkbook"]>; sheetId: string; scale: number; pointerId: number };

export function usePrintAreaDrag(c: SpreadsheetController, scroller: RefObject<HTMLDivElement | null>, columnOffsets: readonly number[], rowOffsets: readonly number[]) {
  const [drag, setDrag] = useState<Session | null>(null), current = useRef<Session | null>(null), pending = useRef(0);
  const latest = useRef(c), mounted = useRef(true);
  useLayoutEffect(() => { latest.current = c; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = 0; }; }, []);
  const scale = (c.zoom ?? 100) / 100;
  const editable = !c.disabled && !c.requesting && !c.pendingObjectEdit && c.features.printArea;
  const sameTarget = (value: Session) => mounted.current && latest.current.printAreaView && latest.current.getWorkbook() === value.workbook &&
    latest.current.activeSheet.id === value.sheetId && value.scale === (latest.current.zoom ?? 100) / 100;
  const eligible = (value: Session) => !latest.current.disabled && !latest.current.requesting && !latest.current.pendingObjectEdit && latest.current.features.printArea && sameTarget(value);
  const update = (value: Session | null) => { current.current = value; setDrag(value); };
  const position = (x: number, y: number) => {
    const node = scroller.current, rect = node?.getBoundingClientRect();
    if (!node || !rect) return null;
    return { row: printGridIndex(rowOffsets, (y - rect.top) / scale + node.scrollTop),
      column: printGridIndex(columnOffsets, (x - rect.left) / scale + node.scrollLeft) };
  };
  const commands = (value: Session): SpreadsheetCommand[] => {
    if ("handle" in value.target) return [{ type: "print.setArea", sheetId: value.sheetId, range: value.preview }];
    const { axis, index } = value.target, settings = value.workbook.sheets.find(sheet => sheet.id === value.sheetId)?.printSettings;
    const previous = (axis === "row" ? settings?.rowBreaks : settings?.columnBreaks) ?? [];
    const next = [...new Set([...previous.filter(item => item !== index), value.breakIndex ?? index])];
    return [{ type: "print.setBreaks", sheetId: value.sheetId, ...(axis === "row" ? { rows: next } : { columns: next }) }];
  };
  const move = (value: Session, delta: { row: number; column: number }): Session => {
    if ("handle" in value.target) return { ...value, preview: adjustPrintArea(value.area, value.target.handle, delta, c.activeSheet.rowCount, c.activeSheet.columnCount) };
    const { axis, index } = value.target;
    const min = (axis === "row" ? value.area.top : value.area.left) + 1, max = axis === "row" ? value.area.bottom : value.area.right;
    return { ...value, breakIndex: Math.max(min, Math.min(max, index + (axis === "row" ? delta.row : delta.column))) };
  };
  const finish = (value: Session) => { if (eligible(value)) void latest.current.executeCommands(commands(value), { isCurrent: () => sameTarget(value) }); };
  const handlers = (target: Target): HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: event => {
      if (!editable || event.button !== 0 || !c.activeSheet.printSettings?.area) return;
      event.preventDefault(); event.stopPropagation();
      const token = ++pending.current, element = event.currentTarget, pointerId = event.pointerId, origin = position(event.clientX, event.clientY);
      const originalSheet = c.activeSheet.id, area = c.activeSheet.printSettings.area;
      if (!origin) return;
      c.afterCommit(() => {
        const controller = latest.current;
        if (!mounted.current || pending.current !== token || element.isConnected === false || originalSheet !== controller.activeSheet.id ||
          !controller.printAreaView || controller.disabled || controller.requesting || !controller.features.printArea || controller.pendingObjectEdit ||
          scale !== (controller.zoom ?? 100) / 100 || JSON.stringify(area) !== JSON.stringify(controller.activeSheet.printSettings?.area)) return;
        try { element.setPointerCapture(pointerId); } catch { return; }
        update({ target, area, preview: area, origin, workbook: controller.getWorkbook(), sheetId: originalSheet, scale, pointerId });
      });
    },
    onPointerMove: event => {
      const value = current.current; if (!value || value.pointerId !== event.pointerId) return;
      if (!eligible(value)) { update(null); return; }
      const node = scroller.current, rect = node?.getBoundingClientRect();
      if (node && rect) {
        const margin = 30 * scale;
        if (event.clientY > rect.bottom - margin) node.scrollTop += 24;
        else if (event.clientY < rect.top + margin) node.scrollTop = Math.max(0, node.scrollTop - 24);
        if (event.clientX > rect.right - margin) node.scrollLeft += 24;
        else if (event.clientX < rect.left + margin) node.scrollLeft = Math.max(0, node.scrollLeft - 24);
      }
      const point = position(event.clientX, event.clientY); if (!point) return;
      update(move(value, { row: point.row - value.origin.row, column: point.column - value.origin.column }));
    },
    onPointerUp: event => {
      pending.current++; const value = current.current; if (!value || value.pointerId !== event.pointerId) return;
      update(null); event.stopPropagation();
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Already cancelled by the browser. */ }
      finish(value);
    },
    onPointerCancel: () => { pending.current++; update(null); },
    onLostPointerCapture: () => { pending.current++; update(null); },
    onKeyDown: event => {
      if (event.key === "Escape") {
        pending.current++; update(null); if (latest.current.requesting) latest.current.cancelEditRequest();
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (!editable || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) || !c.activeSheet.printSettings?.area) return;
      event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1, area = c.activeSheet.printSettings.area;
      const value: Session = { target, area, preview: area, origin: { row: 0, column: 0 }, workbook: c.getWorkbook(), sheetId: c.activeSheet.id, scale, pointerId: -1 };
      c.afterCommit(() => finish(move(value, { row: event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0,
        column: event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0 })));
    },
  });
  // Rendering uses committed props/state. Event and delayed-permission guards use
  // the latest refs above, so stale asynchronous callbacks still cannot commit.
  const visibleDrag = drag && editable && c.printAreaView && c.workbook === drag.workbook &&
    c.activeSheet.id === drag.sheetId && drag.scale === scale ? drag : null;
  return { drag: visibleDrag, editable, handlers };
}
