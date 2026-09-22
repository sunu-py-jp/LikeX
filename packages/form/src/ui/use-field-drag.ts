"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { getDragInsertionIndex, getDragScrollDelta } from "../core";
import type { FormModel } from "../model";

type DragView = { portalHost: HTMLElement; fieldId: string; x: number; y: number; line: { x: number; y: number; width: number } | null };
type Options = { canvas: RefObject<HTMLElement | null>; model: FormModel; enabled: boolean; move: (fieldId: string, index: number) => void };

/** Pointer lifecycle stays in the view; a successful drop invokes one field.move. */
export function useFieldDrag(options: Options) {
  const latest = useRef(options), cleanup = useRef<(() => void) | null>(null);
  const [view, setView] = useState<DragView | null>(null);
  const suppressClick = useRef(false);
  useLayoutEffect(() => {
    if (latest.current.model !== options.model || !options.enabled) cleanup.current?.();
    latest.current = options;
  });
  useLayoutEffect(() => () => cleanup.current?.(), []);

  function start(event: ReactPointerEvent<HTMLButtonElement>, fieldId: string) {
    if (!latest.current.enabled || !event.isPrimary || event.button !== 0) return;
    const canvas = latest.current.canvas.current, handle = event.currentTarget, doc = handle.ownerDocument, win = doc.defaultView;
    if (!canvas || !win) return;
    const model = latest.current.model, source = model.fields.findIndex(field => field.id === fieldId);
    if (source < 0) return;
    cleanup.current?.(); suppressClick.current = false;
    const pointerId = event.pointerId, origin = { x: event.clientX, y: event.clientY };
    let point = origin, active = false, frame = 0, previousTime = 0, target: number | null = null;
    let viewport: HTMLElement = canvas;
    while (viewport.parentElement && !/(auto|scroll)/.test(win.getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
    const bounds = () => {
      const rect = viewport.getBoundingClientRect(), content = canvas.getBoundingClientRect();
      return { left: Math.max(0, rect.left, content.left), right: Math.min(win.innerWidth, rect.right, content.right), top: Math.max(0, rect.top), bottom: Math.min(win.innerHeight, rect.bottom) };
    };
    const dropBounds = () => {
      const visible = bounds(), content = canvas.getBoundingClientRect();
      return { ...visible, top: Math.max(visible.top, content.top), bottom: Math.min(visible.bottom, content.bottom) };
    };
    function update() {
      if (!active) return;
      const rect = dropBounds();
      const cards = Array.from(canvas!.querySelectorAll<HTMLElement>("[data-form-field-id]"));
      const remaining = cards.filter(card => card.dataset.formFieldId !== fieldId), items = remaining.map(card => card.getBoundingClientRect());
      target = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom ? getDragInsertionIndex(point.y, items.map(item => ({ start: item.top, end: item.bottom }))) : null;
      let line: DragView["line"] = null;
      if (target !== null && target !== source && cards.length) {
        const next = items[target], previous = items[target - 1], card = next ?? previous ?? cards[0].getBoundingClientRect();
        const y = next ? next.top - 7 : previous.bottom + 7;
        if (y >= rect.top && y <= rect.bottom) line = { x: Math.max(rect.left, card.left), y, width: Math.max(0, Math.min(rect.right, card.right) - Math.max(rect.left, card.left)) };
      }
      const next = { portalHost: doc.body, fieldId, x: Math.max(4, Math.min(point.x + 18, win!.innerWidth - 252)), y: Math.max(4, Math.min(point.y + 14, win!.innerHeight - 106)), line };
      setView(previous => previous?.x === next.x && previous.y === next.y && previous.line?.x === line?.x && previous.line?.y === line?.y && previous.line?.width === line?.width ? previous : next);
    }
    function tick(time: number) {
      if (latest.current.model !== model || !latest.current.enabled) { stop(); return; }
      if (active) {
        const delta = getDragScrollDelta(point, bounds(), previousTime ? time - previousTime : 16, { axes: "y" });
        // Direct scroll offset avoids starting a second smooth-scroll animation each frame.
        if (delta.y) viewport.scrollTop += delta.y;
        update();
      }
      previousTime = time; frame = win!.requestAnimationFrame(tick);
    }
    function move(pointer: PointerEvent) {
      if (pointer.pointerId !== pointerId) return;
      point = { x: pointer.clientX, y: pointer.clientY };
      if (!active && Math.hypot(point.x - origin.x, point.y - origin.y) >= 5) { active = true; suppressClick.current = true; }
      if (active) { pointer.preventDefault(); update(); }
    }
    function stop() {
      win!.cancelAnimationFrame(frame);
      doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", finish);
      doc.removeEventListener("pointercancel", cancel); doc.removeEventListener("keydown", key);
      win!.removeEventListener("blur", stop); handle.removeEventListener("lostpointercapture", stop);
      try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* Capture can already be gone after cancellation. */ }
      cleanup.current = null; setView(null);
    }
    function cancel(pointer: PointerEvent) { if (pointer.pointerId === pointerId) stop(); }
    function key(keyboard: KeyboardEvent) { if (keyboard.key === "Escape") { keyboard.preventDefault(); stop(); } }
    function finish(pointer: PointerEvent) {
      if (pointer.pointerId !== pointerId) return;
      point = { x: pointer.clientX, y: pointer.clientY }; update();
      const rect = dropBounds(), index = target;
      const allowed = active && index !== null && index !== source && latest.current.model === model && latest.current.enabled
        && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      stop();
      if (allowed) latest.current.move(fieldId, index!);
    }
    cleanup.current = stop;
    doc.addEventListener("pointermove", move, { passive: false }); doc.addEventListener("pointerup", finish);
    doc.addEventListener("pointercancel", cancel); doc.addEventListener("keydown", key);
    win.addEventListener("blur", stop); handle.addEventListener("lostpointercapture", stop);
    try { handle.setPointerCapture?.(pointerId); } catch { /* Document listeners still cover browsers without capture. */ }
    frame = win.requestAnimationFrame(tick);
  }
  return { view, start, suppressClick: () => { const suppressed = suppressClick.current; suppressClick.current = false; return suppressed; } };
}
