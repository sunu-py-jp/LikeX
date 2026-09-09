"use client";
import { useRef, useState, type HTMLAttributes } from "react";
import { calculateWorkbook } from "../../model";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";
import { autoFitColumnWidth, autoFitRowHeight, createTextMeasurer } from "./auto-fit";

type Session = { index: number; start: number; size: number; value: number; workbook: Workbook; sheetId: string; pointerId: number };
/** Both axes share cancellation, keyboard and optimistic preview behavior. */
export function useGridResize(c: SpreadsheetController, axis: "row" | "column") {
  const [resizing, setResizing] = useState<Session | null>(null), sessionRef = useRef<Session | null>(null);
  const pendingPointer = useRef(0);
  const update = (session: Session | null) => { sessionRef.current = session; setResizing(session); };
  const eligible = (session: Session) => !c.disabled && !c.requesting && c.features.resize && c.getWorkbook() === session.workbook && c.activeSheet.id === session.sheetId;
  const clamp = (size: number) => Math.min(1000, Math.max(axis === "row" ? 16 : 24, size));
  const resize = (sheetId: string, index: number, value: number) => c.executeCommand(axis === "row" ? { type: "rows.resize", sheetId, row: index, height: value } : { type: "columns.resize", sheetId, column: index, width: value });
  const handlers = (index: number, size: number): HTMLAttributes<HTMLSpanElement> => ({
    onDoubleClick: event => {
      event.preventDefault(); event.stopPropagation(); if (c.disabled || c.requesting || !c.features.resize) return;
      const ownerDocument = event.currentTarget.ownerDocument;
      c.afterCommit(() => {
        const workbook = c.getWorkbook(), sheet = workbook.sheets.find(sheet => sheet.id === c.activeSheet.id); if (!sheet) return;
        const values = (workbook === c.workbook ? c.calculated : calculateWorkbook(workbook))[sheet.id] ?? {}, measure = createTextMeasurer(ownerDocument);
        resize(sheet.id, index, axis === "row" ? autoFitRowHeight(sheet, index, values, measure) : autoFitColumnWidth(sheet, index, values, measure)); });
    },
    onKeyDown: event => {
      const negative = axis === "row" ? "ArrowUp" : "ArrowLeft", positive = axis === "row" ? "ArrowDown" : "ArrowRight";
      if (c.disabled || c.requesting || !c.features.resize || ![negative, positive].includes(event.key)) return;
      event.preventDefault(); const next = clamp(size + (event.key === negative ? -8 : 8)); c.afterCommit(() => resize(c.activeSheet.id, index, next));
    },
    onPointerDown: event => {
      if (c.disabled || c.requesting || !c.features.resize) return;
      event.preventDefault(); event.stopPropagation();
      const token = ++pendingPointer.current, target = event.currentTarget, pointerId = event.pointerId, start = axis === "row" ? event.clientY : event.clientX;
      c.afterCommit(() => {
        if (pendingPointer.current !== token || target.isConnected === false) return;
        try { target.setPointerCapture(pointerId); } catch { return; }
        update({ index, start, size, value: size, workbook: c.getWorkbook(), sheetId: c.activeSheet.id, pointerId });
      });
    },
    onPointerMove: event => { const session = sessionRef.current; if (!session || session.index !== index || session.pointerId !== event.pointerId) return; if (!eligible(session)) { update(null); return; } update({ ...session, value: clamp(session.size + (axis === "row" ? event.clientY : event.clientX) - session.start) }); },
    onPointerUp: event => { pendingPointer.current++; const session = sessionRef.current; if (!session || session.index !== index || session.pointerId !== event.pointerId) return; update(null); event.currentTarget.releasePointerCapture(event.pointerId); if (eligible(session)) resize(session.sheetId, index, session.value); },
    onPointerCancel: () => { pendingPointer.current++; update(null); }, onLostPointerCapture: () => { pendingPointer.current++; update(null); },
  });
  return { resizing: resizing && eligible(resizing) ? resizing : null, handlers };
}
