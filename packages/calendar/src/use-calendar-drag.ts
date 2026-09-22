import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { getDragScrollDelta } from "./core";
import type { Calendar, CalendarEvent } from "./model";

type Target = { date: string; time?: string };
type Options = { calendar: Calendar; rangeKey: string; editable: boolean; onMove(id: string, date: string, time?: string): void };
/** Dragging only transports a local event ID; imported browser drag payloads are never trusted. */
export function useCalendarDrag(options: Options) {
  const viewportRef = useRef<HTMLDivElement>(null), latest = useRef(options);
  const session = useRef<{ calendar: Calendar; rangeKey: string; stop(): void; drop(point: { x: number; y: number }): void } | null>(null);
  const [target, setTarget] = useState<Target | null>(null), [draggedId, setDraggedId] = useState<string | null>(null);
  const cancel = useCallback(() => session.current?.stop(), []);
  useLayoutEffect(() => { latest.current = options; const active = session.current; if (active && (!options.editable || options.calendar !== active.calendar || options.rangeKey !== active.rangeKey)) active.stop(); }, [options]);
  useEffect(() => cancel, [cancel]);
  function start(event: DragEvent<HTMLElement>, value: CalendarEvent) {
    const current = latest.current, viewport = viewportRef.current;
    if (!viewport || !current.editable) { event.preventDefault(); return; }
    event.stopPropagation(); cancel();
    const owner = viewport.ownerDocument, win = owner.defaultView;
    if (!win) { event.preventDefault(); return; }
    const preview = owner.createElement("div"), color = win.getComputedStyle(viewport);
    preview.textContent = value.title;
    const sourceBounds = event.currentTarget?.getBoundingClientRect?.() ?? viewport.getBoundingClientRect();
    Object.assign(preview.style, { position: "fixed", left: `${Math.max(0, Math.min(sourceBounds.left, win.innerWidth - 176))}px`, top: `${Math.max(0, Math.min(sourceBounds.top, win.innerHeight - 64))}px`, width: "176px", maxHeight: "64px", overflow: "hidden", padding: "9px 12px", borderRadius: "5px", borderLeft: `3px solid ${value.color || color.getPropertyValue("--lxc-primary") || "#2563eb"}`, background: color.getPropertyValue("--lxc-bg") || "white", color: color.color, font: "13px/1.5 sans-serif", boxShadow: "0 5px 18px #0003", opacity: ".78", pointerEvents: "none" });
    owner.body.append(preview); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-likex-calendar-event", value.id); try { event.dataTransfer.setDragImage?.(preview, 18, 14); } catch { /* Keep native preview if custom drag images are unavailable. */ }
    const previewTimer = win.setTimeout(() => preview.remove(), 0);
    let pointer = { x: event.clientX, y: event.clientY }, destination: Target | null = null, frame = 0, previousTime = 0, stopped = false;
    function select(next: Target | null) { if (JSON.stringify(next) !== JSON.stringify(destination)) { destination = next; setTarget(next); } }
    function locate() {
      const bounds = viewport!.getBoundingClientRect();
      if (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top || pointer.y > bounds.bottom) { select(null); return; }
      const node = owner.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-lxc-drop-date]");
      if (!node || !viewport!.contains(node)) { select(null); return; }
      const date = node.dataset.lxcDropDate!, suppliedTime = node.dataset.lxcDropTime;
      if (node.dataset.lxcTimeColumn !== undefined) {
        const offset = Math.floor((pointer.y - node.getBoundingClientRect().top) / 32), slot = Math.max(0, Math.min(47, offset));
        select({ date, time: `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}` });
      } else select(suppliedTime ? { date, time: suppliedTime } : { date });
    }
    function track(event: globalThis.DragEvent) { pointer = { x: event.clientX, y: event.clientY }; locate(); if (destination) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; } }
    function tick(time: number) { if (stopped) return; const delta = getDragScrollDelta(pointer, viewport!.getBoundingClientRect(), previousTime ? time - previousTime : 16); previousTime = time; viewport!.scrollLeft += delta.x; viewport!.scrollTop += delta.y; locate(); frame = win!.requestAnimationFrame(tick); }
    function stop() { if (stopped) return; stopped = true; win!.cancelAnimationFrame(frame); win!.clearTimeout(previewTimer); owner.removeEventListener("dragover", track); owner.removeEventListener("dragend", stop); owner.removeEventListener("drop", stop); owner.removeEventListener("keydown", escape); win!.removeEventListener("blur", stop); preview.remove(); session.current = null; setTarget(null); setDraggedId(null); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") stop(); }
    session.current = { calendar: current.calendar, rangeKey: current.rangeKey, stop, drop(point) {
      const policy = latest.current;
      if (!policy.editable || policy.calendar !== current.calendar || policy.rangeKey !== current.rangeKey) { stop(); return; }
      pointer = point; locate();
      const next = destination; stop();
      if (next) policy.onMove(value.id, next.date, next.time);
    } };
    owner.addEventListener("dragover", track); owner.addEventListener("dragend", stop); owner.addEventListener("drop", stop); owner.addEventListener("keydown", escape); win.addEventListener("blur", stop);
    setDraggedId(value.id); frame = win.requestAnimationFrame(tick);
  }
  function drop(event: DragEvent) { if (!session.current) return; event.preventDefault(); event.stopPropagation(); session.current.drop({ x: event.clientX, y: event.clientY }); }
  return { viewportRef, start, drop, target, draggedId };
}
