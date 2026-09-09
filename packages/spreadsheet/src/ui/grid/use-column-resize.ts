"use client";

import { useState, type HTMLAttributes } from "react";
import { resizeColumn } from "../../model";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import type { ColumnWidthPreview } from "./grid-geometry";

type ColumnResizeSession = ColumnWidthPreview & { start: number; width: number };

export function useColumnResize(c: SpreadsheetController) {
  const [resizing, setResizing] = useState<ColumnResizeSession | null>(null);
  const handlers = (column: number, width: number): HTMLAttributes<HTMLSpanElement> => ({
    onKeyDown: event => {
      if (c.disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      c.apply(wb => resizeColumn(wb, c.activeSheet.id, column, Math.min(1000, Math.max(24, width + (event.key === "ArrowLeft" ? -8 : 8)))));
    },
    onPointerDown: event => {
      if (c.disabled) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      setResizing({ column, start: event.clientX, width, value: width });
    },
    onPointerMove: event => {
      if (resizing?.column === column) setResizing({ ...resizing, value: Math.min(1000, Math.max(24, resizing.width + event.clientX - resizing.start)) });
    },
    onPointerUp: event => {
      if (!resizing) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      c.apply(wb => resizeColumn(wb, c.activeSheet.id, column, resizing.value)); setResizing(null);
    },
    onPointerCancel: () => setResizing(null),
  });
  return { resizing, handlers };
}
