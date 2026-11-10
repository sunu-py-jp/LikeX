"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import type { SpreadsheetController, Position, Workbook } from "../../state/use-spreadsheet";
import { getDragScrollDelta } from "../../core";
import { gridBodyBounds, gridCellAtPointer, type GridPointerGeometry } from "./grid-pointer-geometry";
import { axisSelectionRange, isCellSelected, isRangeSelected } from "../../state/selection";
import { blurObjectEditor } from "../../state/blur-object-editor";
import type { GridFocusRefs } from "./use-grid-focus";

type SelectionDrag = {
  kind: "cell" | "row" | "column";
  pointerId: number;
  origin: Position;
  sheetId: string; workbook: Workbook; zoom: number;
  point?: { x: number; y: number };
  lastPosition?: Position;
  toggleOnClick?: { anchor: Position; focus: Position };
  touch?: boolean;
};

/** Owns pointer gesture lifetime and header activation, including additive selection. */
export function useGridSelection(c: SpreadsheetController, { scrollerRef, activeInputRef, focusIntentRef }: GridFocusRefs, geometry: GridPointerGeometry, touchRangeSelection = false) {
  const dragging = useRef<SelectionDrag | null>(null);
  const touchTap = useRef<{ pointerId: number; x: number; y: number; position: Position; kind: SelectionDrag["kind"]; sheetId: string; workbook: Workbook; target: HTMLElement; scrollLeft: number; scrollTop: number } | null>(null);
  const pendingPointer = useRef<{ id: number; down: boolean } | null>(null);
  const latest = useRef(c), latestGeometry = useRef(geometry), cancelRef = useRef<() => void>(() => {});
  const extendRef = useRef<(position: Position) => void>(() => {});
  useLayoutEffect(() => { latest.current = c; latestGeometry.current = geometry; });
  useEffect(() => {
    const element = scrollerRef.current, document = element?.ownerDocument, view = document?.defaultView;
    if (!element || !document) return;
    let frame = 0, previousTime = 0;
    const stopFrame = () => { if (frame) view?.cancelAnimationFrame?.(frame); frame = 0; previousTime = 0; };
    const finish = (event: globalThis.PointerEvent) => {
      const tap = touchTap.current;
      if (tap?.pointerId === event.pointerId) {
        touchTap.current = null;
        const current = latest.current;
        if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 8 && tap.target.isConnected !== false &&
          tap.scrollLeft === element.scrollLeft && tap.scrollTop === element.scrollTop &&
          current.activeSheet.id === tap.sheetId && current.getWorkbook() === tap.workbook && !current.requesting) {
          blurObjectEditor(tap.target);
          const request = { id: tap.pointerId, down: false };
          pendingPointer.current = request;
          current.afterCommit(() => {
            const ready = latest.current;
            if (pendingPointer.current !== request || ready.activeSheet.id !== tap.sheetId) return;
            focusIntentRef.current = false;
            if (tap.kind === "cell") ready.selectionApi.selectCell(tap.sheetId, tap.position);
            else if (tap.kind === "row") ready.selectionApi.selectRows(tap.sheetId, tap.position.row);
            else ready.selectionApi.selectColumns(tap.sheetId, tap.position.column);
          });
        }
      }
      if (pendingPointer.current?.id === event.pointerId) pendingPointer.current.down = false;
      const drag = dragging.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragging.current = null; stopFrame();
      if (drag.toggleOnClick) {
        if (drag.kind === "cell") latest.current.toggleSelection(drag.toggleOnClick.focus);
        else latest.current.toggleAxisRange(drag.kind, drag.toggleOnClick.anchor[drag.kind], drag.toggleOnClick.focus[drag.kind]);
        latest.current.requestGridFocus();
      }
    };
    const cancel = () => { dragging.current = null; pendingPointer.current = null; touchTap.current = null; stopFrame(); };
    cancelRef.current = cancel;
    const valid = () => {
      const active = dragging.current, current = latest.current;
      if (!active || current.activeSheet.id !== active.sheetId || current.getWorkbook() !== active.workbook || current.editing || current.requesting) { cancel(); return null; }
      return active;
    };
    const update = () => {
      const active = valid(); if (!active?.point || !element.getBoundingClientRect) return;
      extendRef.current(gridCellAtPointer(latestGeometry.current, active.point, element.getBoundingClientRect(), element, (latest.current.zoom ?? 100) / 100));
    };
    const scroll = (time: number) => {
      frame = 0; const active = valid(); if (!active?.point) return;
      const scale = (latest.current.zoom ?? 100) / 100;
      const axes = active.kind === "row" ? "y" : active.kind === "column" ? "x" : "both";
      const delta = getDragScrollDelta(active.point, gridBodyBounds(element.getBoundingClientRect(), scale), previousTime ? time - previousTime : 16, { axes, edge: 32 });
      previousTime = time;
      if (delta.x || delta.y) { element.scrollLeft += delta.x / scale; element.scrollTop += delta.y / scale; update(); }
      if (dragging.current && view?.requestAnimationFrame) frame = view.requestAnimationFrame(scroll);
    };
    const move = (event: globalThis.PointerEvent) => {
      const tap = touchTap.current;
      if (tap?.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) touchTap.current = null;
      const active = dragging.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) { cancel(); return; }
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || !element.getBoundingClientRect) return;
      event.preventDefault(); active.point = { x: event.clientX, y: event.clientY }; update();
      if (!frame && dragging.current && view?.requestAnimationFrame) { previousTime = 0; frame = view.requestAnimationFrame(scroll); }
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && dragging.current) { event.preventDefault(); cancel(); } };
    document.addEventListener("pointermove", move, { passive: false }); document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    document.defaultView?.addEventListener("blur", cancel);
    return () => {
      cancel(); cancelRef.current = () => {};
      document.removeEventListener("pointermove", move); document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      document.defaultView?.removeEventListener("blur", cancel);
    };
  }, [scrollerRef, focusIntentRef]);
  useEffect(() => { cancelRef.current(); }, [touchRangeSelection]);
  useLayoutEffect(() => {
    const active = dragging.current;
    if (active && (active.sheetId !== c.activeSheet.id || active.workbook !== c.getWorkbook() || active.zoom !== c.zoom || c.editing || c.requesting)) cancelRef.current();
  });

  const startSelection = (event: PointerEvent<HTMLElement>, position: Position, kind: SelectionDrag["kind"]) => {
    if (event.button !== 0) return;
    cancelRef.current();
    const touch = event.pointerType === "touch";
    if (touch && !touchRangeSelection) {
      // Let the browser pan in either direction. Only an unmoved release selects;
      // no hidden textarea focus, so navigation does not open the software keyboard.
      touchTap.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, position, kind,
        sheetId: c.activeSheet.id, workbook: c.getWorkbook(), target: event.currentTarget,
        scrollLeft: scrollerRef.current?.scrollLeft ?? 0, scrollTop: scrollerRef.current?.scrollTop ?? 0 };
      return;
    }
    blurObjectEditor(event.currentTarget);
    event.preventDefault();
    const pointer = { id: event.pointerId, down: true };
    pendingPointer.current = pointer;
    const { shiftKey, ctrlKey, metaKey, altKey } = event;
    c.afterCommit(() => {
    if (pendingPointer.current !== pointer || latest.current.activeSheet.id !== c.activeSheet.id) return;
    const additive = !touch && (ctrlKey || metaKey) && !altKey && !shiftKey;
    const origin = !touch && shiftKey ? c.selection.anchor : position;
    const range = kind === "cell" ? { anchor: position, focus: position } : axisSelectionRange(c.activeSheet, kind, origin[kind], position[kind]);
    const alreadySelected = kind === "cell" ? isCellSelected(c.selection, position) : isRangeSelected(c.selection, range);
    const toggleOnClick = additive && alreadySelected ? range : undefined;
    if (!toggleOnClick) {
      const accepted = touch ? kind === "cell" ? c.selectionApi.selectCell(c.activeSheet.id, position)
        : kind === "row" ? c.selectionApi.selectRows(c.activeSheet.id, position.row) : c.selectionApi.selectColumns(c.activeSheet.id, position.column)
        : kind === "cell" ? c.select(position, shiftKey, additive)
        : c.selectAxisRange(kind, origin[kind], position[kind], additive, shiftKey);
      if (!accepted) return;
    }
    dragging.current = pointer.down ? { kind, pointerId: pointer.id, origin, toggleOnClick, touch, sheetId: c.activeSheet.id, workbook: c.getWorkbook(), zoom: c.zoom, lastPosition: position } : null;
    if (!pointer.down && toggleOnClick) {
      if (kind === "cell") c.toggleSelection(toggleOnClick.focus);
      else c.toggleAxisRange(kind, toggleOnClick.anchor[kind], toggleOnClick.focus[kind]);
    }
    if (touch) { focusIntentRef.current = false; return; }
    focusIntentRef.current = true;
    c.requestGridFocus();
    scrollerRef.current?.focus({ preventScroll: true });
    if (position.row === c.selection.focus.row && position.column === c.selection.focus.column) {
      activeInputRef.current?.focus({ preventScroll: true }); activeInputRef.current?.setSelectionRange(0, 0); focusIntentRef.current = false;
    }
    });
  };
  const extend = (position: Position) => {
    const drag = dragging.current, current = latest.current;
    if (!drag || drag.lastPosition?.row === position.row && drag.lastPosition?.column === position.column) return;
    if (current.activeSheet.id !== drag.sheetId || current.getWorkbook() !== drag.workbook) { cancelRef.current(); return; }
    let accepted: boolean;
    if (drag.touch) {
      accepted = drag.kind === "cell" ? current.selectionApi.selectRange(drag.sheetId, { anchor: drag.origin, focus: position })
        : drag.kind === "row" ? current.selectionApi.selectRows(drag.sheetId, drag.origin.row, position.row)
          : current.selectionApi.selectColumns(drag.sheetId, drag.origin.column, position.column);
    } else if (drag.toggleOnClick) {
      if (drag.kind === "row" ? position.row === drag.origin.row : drag.kind === "column" ? position.column === drag.origin.column : position.row === drag.origin.row && position.column === drag.origin.column) return;
      if (drag.kind === "cell") accepted = current.selectRange(drag.origin, position, true);
      else accepted = current.selectAxisRange(drag.kind, drag.origin[drag.kind], position[drag.kind], true);
      if (accepted) drag.toggleOnClick = undefined;
    } else if (drag.kind === "cell") accepted = current.select(position, true);
    else accepted = current.selectAxisRange(drag.kind, drag.origin[drag.kind], position[drag.kind], false, true);
    // A rejected addition must never turn the next pointer event into an extension
    // of the previous active range, or a release into a pending deselection.
    if (!accepted) { cancelRef.current(); focusIntentRef.current = false; return; }
    drag.lastPosition = position;
    focusIntentRef.current = !drag.touch;
  };
  useLayoutEffect(() => { extendRef.current = extend; });
  const extendSelection = (event: PointerEvent<HTMLElement>, position: Position) => {
    const drag = dragging.current; if (!drag || drag.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) { cancelRef.current(); return; }
    extend(position);
  };
  const selectHeaderWithKeyboard = (event: { detail: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, position: Position, kind: "row" | "column") => {
    // Pointer selection is handled on pointerdown; detail=0 covers keyboard/AT activation.
    if (event.detail !== 0) return;
    pendingPointer.current = null;
    c.afterCommit(() => {
    focusIntentRef.current = true;
    const additive = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const origin = event.shiftKey ? c.selection.anchor : position;
    if (additive) c.toggleAxisRange(kind, origin[kind], position[kind]);
    else c.selectAxisRange(kind, origin[kind], position[kind], false, event.shiftKey);
    c.requestGridFocus();
    });
  };

  return { startSelection, extendSelection, selectHeaderWithKeyboard };
}
