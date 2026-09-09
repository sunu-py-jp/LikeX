"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";

type DragSession = { sheetId: string; workbook: Workbook };
type DropPosition = { index: number; beforeId: string | null };

/** Native tab dragging only proposes an order; the regular command path owns changes. */
export function useSheetTabReorder(c: SpreadsheetController, renaming: boolean) {
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const enabled = c.features.reorderSheets && !c.disabled && !c.requesting && !c.editing && !c.pendingObjectEdit && !renaming;
  const eligible = () => enabled && session.current?.workbook === c.getWorkbook();
  const clear = () => { session.current = null; setDrag(null); setDropPosition(null); };
  const positionAt = (element: HTMLElement, clientX: number): DropPosition => {
    const tabs = [...element.querySelectorAll<HTMLElement>("[data-lxs-sheet-id]")]
      .filter(tab => tab.dataset.lxsSheetId !== session.current?.sheetId);
    const index = tabs.findIndex(tab => {
      const bounds = tab.getBoundingClientRect();
      return clientX < bounds.left + bounds.width / 2;
    });
    return index < 0 ? { index: tabs.length, beforeId: null } : { index, beforeId: tabs[index].dataset.lxsSheetId! };
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!eligible()) { setDropPosition(null); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropPosition(positionAt(event.currentTarget, event.clientX));
    // Keep the ends reachable when the tab strip overflows.
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left + 24) event.currentTarget.scrollLeft -= 16;
    else if (event.clientX > bounds.right - 24) event.currentTarget.scrollLeft += 16;
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!eligible()) { clear(); return; }
    event.preventDefault();
    const target = positionAt(event.currentTarget, event.clientX);
    const sheetId = session.current!.sheetId;
    clear();
    c.afterCommand({ type: "sheets.move", sheetId, index: target.index });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, sheetId: string) => {
    if (!enabled || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
      !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = c.workbook.sheets.findIndex(sheet => sheet.id === sheetId);
    const next = Math.max(0, Math.min(c.workbook.sheets.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
    c.afterCommand({ type: "sheets.move", sheetId, index: next });
  };
  return {
    enabled,
    draggingId: enabled && drag?.workbook === c.workbook ? drag.sheetId : null,
    dropPosition: enabled && drag?.workbook === c.workbook ? dropPosition : null,
    onDragOver, onDrop,
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPosition(null);
    },
    onPointerDown: () => { suppressClick.current = false; },
    ignoreClick: (detail?: number) => detail !== 0 && suppressClick.current,
    onKeyDown,
    onDragStart: (event: DragEvent<HTMLButtonElement>, sheetId: string) => {
      if (!enabled) { event.preventDefault(); return; }
      const captured = { sheetId, workbook: c.getWorkbook() };
      session.current = captured;
      suppressClick.current = true;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-likex-sheet", sheetId);
      setDrag(captured);
    },
    onDragEnd: clear,
  };
}
