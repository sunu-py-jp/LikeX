"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { getDragInsertionIndex, getDragScrollDelta } from "../../core";
import type { SpreadsheetController, Workbook } from "../../state/use-spreadsheet";

type DragSession = { sheetId: string; workbook: Workbook };
type DropPosition = { index: number; beforeId: string | null };

/** Native tab dragging only proposes an order; the regular command path owns changes. */
export function useSheetTabReorder(c: SpreadsheetController, renaming: boolean) {
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef(false), cleanup = useRef<() => void>(() => {});
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const enabled = c.features.reorderSheets && !c.disabled && !c.requesting && !c.editing && !c.pendingObjectEdit && !renaming;
  const latest = useRef({ c, enabled });
  useLayoutEffect(() => { latest.current = { c, enabled }; });
  const eligible = () => latest.current.enabled && session.current?.workbook === latest.current.c.getWorkbook();
  const clear = () => { cleanup.current(); cleanup.current = () => {}; session.current = null; setDrag(null); setDropPosition(null); };
  useLayoutEffect(() => { if (session.current && !eligible()) clear(); }, [c.workbook, enabled]);
  useEffect(() => () => cleanup.current(), []);
  const positionAt = (element: HTMLElement, clientX: number): DropPosition => {
    const tabs = [...element.querySelectorAll<HTMLElement>("[data-lxs-sheet-id]")]
      .filter(tab => tab.dataset.lxsSheetId !== session.current?.sheetId);
    const index = getDragInsertionIndex(clientX, tabs.map(tab => {
      const bounds = tab.getBoundingClientRect(); return { start: bounds.left, end: bounds.left + bounds.width };
    }));
    return { index, beforeId: tabs[index]?.dataset.lxsSheetId ?? null };
  };
  const track = (strip: HTMLDivElement, event: DragEvent<HTMLButtonElement>, name: string) => {
    const document = strip.ownerDocument, view = document?.defaultView;
    if (!document || !view) return;
    let frame = 0, previousTime = 0, point: { x: number; y: number } | null = null;
    let preview: HTMLElement | null = null, timer = 0;
    if (event.dataTransfer.setDragImage && document.createElement) {
      preview = document.createElement("div"); preview.className = "lxs-sheet-drag-preview"; preview.textContent = name;
      preview.setAttribute("aria-hidden", "true");
      preview.style.left = `${Math.max(0, event.clientX)}px`; preview.style.top = `${Math.max(0, event.clientY)}px`;
      (strip.closest("[data-likex-spreadsheet]") ?? document.body).appendChild(preview);
      event.dataTransfer.setDragImage(preview, 12, 12);
      // Native DND captures the image after dragstart returns; remove the backing DOM on the next task.
      timer = view.setTimeout(() => { preview?.remove(); preview = null; }, 0);
    }
    const scroll = (time: number) => {
      frame = 0;
      if (!eligible()) { clear(); return; }
      const bounds = strip.getBoundingClientRect(), elapsed = previousTime ? time - previousTime : 16;
      previousTime = time;
      if (point && point.y >= bounds.top - 48 && point.y <= bounds.bottom + 48) {
        const delta = getDragScrollDelta(point, bounds, elapsed, { axes: "x", edge: 32, maxSpeed: 640 });
        if (delta.x) {
          const scale = bounds.width && strip.offsetWidth ? bounds.width / strip.offsetWidth : 1;
          strip.scrollLeft += delta.x / scale;
          setDropPosition(positionAt(strip, point.x));
        }
      }
      if (session.current) frame = view.requestAnimationFrame(scroll);
    };
    const over = (native: globalThis.DragEvent) => {
      point = { x: native.clientX, y: native.clientY };
      if (!frame && view.requestAnimationFrame) { previousTime = 0; frame = view.requestAnimationFrame(scroll); }
    };
    const leave = (native: globalThis.DragEvent) => {
      if (!native.relatedTarget && (native.target === document || native.target === document.documentElement)) { point = null; setDropPosition(null); }
    };
    const key = (native: globalThis.KeyboardEvent) => { if (native.key === "Escape") clear(); };
    document.addEventListener("dragover", over, true); document.addEventListener("dragleave", leave);
    document.addEventListener("drop", clear); document.addEventListener("dragend", clear); document.addEventListener("keydown", key);
    view.addEventListener("blur", clear);
    cleanup.current = () => {
      if (frame) view.cancelAnimationFrame(frame); if (timer) view.clearTimeout(timer); preview?.remove();
      document.removeEventListener("dragover", over, true); document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", clear); document.removeEventListener("dragend", clear); document.removeEventListener("keydown", key);
      view.removeEventListener("blur", clear);
    };
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!eligible()) { setDropPosition(null); return; }
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    setDropPosition(positionAt(event.currentTarget, event.clientX));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!eligible()) { clear(); return; }
    event.preventDefault();
    const target = positionAt(event.currentTarget, event.clientX), sheetId = session.current!.sheetId;
    clear(); latest.current.c.afterCommand({ type: "sheets.move", sheetId, index: target.index });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, sheetId: string) => {
    if (!enabled || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
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
    onDragLeave: (event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPosition(null); },
    onPointerDown: () => { suppressClick.current = false; },
    ignoreClick: (detail?: number) => detail !== 0 && suppressClick.current,
    onKeyDown,
    onDragStart: (event: DragEvent<HTMLButtonElement>, sheetId: string) => {
      if (!enabled) { event.preventDefault(); return; }
      clear();
      const captured = { sheetId, workbook: c.getWorkbook() };
      session.current = captured; suppressClick.current = true;
      event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-likex-sheet", sheetId);
      const strip = event.currentTarget.closest?.<HTMLDivElement>(".lxs-sheet-tabs");
      if (strip) track(strip, event, captured.workbook.sheets.find(sheet => sheet.id === sheetId)?.name ?? "シート");
      setDrag(captured);
    },
    onDragEnd: clear,
  };
}
