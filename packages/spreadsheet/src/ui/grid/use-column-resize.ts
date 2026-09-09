"use client";

import { useRef, useState, type HTMLAttributes } from "react";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";
import type { ColumnWidthPreview } from "./grid-geometry";

type ColumnResizeSession = ColumnWidthPreview & { start: number; width: number; workbook: Workbook; sheetId: string; pointerId: number };

export function useColumnResize(c: SpreadsheetController) {
  const [resizing, setResizing] = useState<ColumnResizeSession | null>(null);
  const sessionRef = useRef<ColumnResizeSession | null>(null);
  const updateSession = (session: ColumnResizeSession | null) => { sessionRef.current = session; setResizing(session); };
  const eligible = (session: ColumnResizeSession) => !c.disabled && c.features.resize && c.getWorkbook() === session.workbook && c.activeSheet.id === session.sheetId;
  const handlers = (column: number, width: number): HTMLAttributes<HTMLSpanElement> => ({
    onKeyDown: event => {
      if (c.disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      c.executeCommand({ type: "columns.resize", sheetId: c.activeSheet.id, column, width: Math.min(1000, Math.max(24, width + (event.key === "ArrowLeft" ? -8 : 8))) });
    },
    onPointerDown: event => {
      if (c.disabled) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      updateSession({ column, start: event.clientX, width, value: width, workbook: c.workbook, sheetId: c.activeSheet.id, pointerId: event.pointerId });
    },
    onPointerMove: event => {
      const session = sessionRef.current;
      if (!session || session.column !== column || session.pointerId !== event.pointerId) return;
      if (!eligible(session)) { updateSession(null); return; }
      updateSession({ ...session, value: Math.min(1000, Math.max(24, session.width + event.clientX - session.start)) });
    },
    onPointerUp: event => {
      const session = sessionRef.current;
      if (!session || session.column !== column || session.pointerId !== event.pointerId) return;
      updateSession(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (eligible(session)) c.executeCommand({ type: "columns.resize", sheetId: session.sheetId, column: session.column, width: session.value });
    },
    onPointerCancel: () => updateSession(null),
    onLostPointerCapture: () => updateSession(null),
  });
  const visiblePreview = resizing && resizing.workbook === c.workbook && resizing.sheetId === c.activeSheet.id && !c.disabled && c.features.resize ? resizing : null;
  return { resizing: visiblePreview, handlers };
}
