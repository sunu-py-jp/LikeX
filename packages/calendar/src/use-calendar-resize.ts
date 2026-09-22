import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { getDragScrollDelta } from "./core";
import { addCalendarDays, createCalendarResizeCommand, getCalendarLocalDateTime, type Calendar, type CalendarCommand, type CalendarEvent } from "./model";

type Edge = "start" | "end";
type Preview = { id: string; date: string; from: number; to: number; label: string };
type Options = { calendar: Calendar; rangeKey: string; editable: boolean; viewportRef: RefObject<HTMLDivElement | null>; onResize(command: CalendarCommand): void; onError(error: unknown): void };
const minutes = (time: string) => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
export const calendarMinuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
/** Pointer movement is transient; only pointer-up commits one ordinary event.update. */
export function useCalendarResize(options: Options) {
  const latest = useRef(options), active = useRef<{ calendar: Calendar; rangeKey: string; stop(): void } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  useLayoutEffect(() => { latest.current = options; if (active.current && (!options.editable || options.calendar !== active.current.calendar || options.rangeKey !== active.current.rangeKey)) active.current.stop(); }, [options]);
  useEffect(() => () => active.current?.stop(), []);
  function start(event: PointerEvent<HTMLElement>, item: CalendarEvent, date: string, edge: Edge) {
    const current = latest.current, viewport = current.viewportRef.current;
    if (event.button !== 0 || !current.editable || item.allDay || !viewport) return;
    event.preventDefault(); event.stopPropagation(); active.current?.stop();
    const owner = viewport.ownerDocument, win = owner.defaultView;
    if (!win) return;
    const startTime = getCalendarLocalDateTime(item.start, current.calendar.timeZone), endTime = getCalendarLocalDateTime(item.end, current.calendar.timeZone);
    const from = startTime.slice(0, 10) < date ? 0 : minutes(startTime), to = endTime.slice(0, 10) > date ? 1440 : minutes(endTime);
    const base = edge === "start" ? from : to, startY = event.clientY, initialScroll = viewport.scrollTop;
    const minuteOnDay = (instant: number) => { const local = getCalendarLocalDateTime(instant, current.calendar.timeZone); return local.slice(0, 10) < date ? 0 : local.slice(0, 10) > date ? 1440 : minutes(local); };
    const latestStart = Math.max(base, minuteOnDay(Date.parse(item.end) - 15 * 60000));
    const earliestEnd = Math.min(base, minuteOnDay(Date.parse(item.start) + 15 * 60000));
    let pointer = { x: event.clientX, y: event.clientY }, chosen = base, moved = false, stopped = false, frame = 0, previousTime = 0;
    const target = event.currentTarget, pointerId = event.pointerId;
    target.setPointerCapture?.(pointerId);
    function update() {
      const distance = pointer.y - startY + viewport!.scrollTop - initialScroll;
      moved ||= Math.abs(distance) >= 4;
      if (!moved) return;
      const delta = Math.round(distance / 64 * 60 / 15) * 15;
      // A click, sub-step motion or return to the original position must retain
      // short events unchanged. Only the real opposite boundary limits resizing;
      // the clipped edge of a multi-day segment is not that boundary.
      chosen = delta === 0 ? base : edge === "start" ? Math.max(0, Math.min(latestStart, base + delta)) : Math.max(earliestEnd, Math.min(1440, base + delta));
      const nextFrom = edge === "start" ? chosen : from, nextTo = edge === "end" ? chosen : to;
      setPreview(previous => previous?.from === nextFrom && previous?.to === nextTo && previous.id === item.id ? previous : { id: item.id, date, from: nextFrom, to: nextTo, label: `${calendarMinuteLabel(nextFrom)} – ${calendarMinuteLabel(nextTo)}` });
    }
    function stop() {
      if (stopped) return; stopped = true; win!.cancelAnimationFrame(frame);
      owner.removeEventListener("pointermove", move); owner.removeEventListener("pointerup", finish); owner.removeEventListener("pointercancel", cancel); target.removeEventListener?.("lostpointercapture", lost); owner.removeEventListener("keydown", escape); win!.removeEventListener("blur", cancel);
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
      active.current = null; setPreview(null);
    }
    function cancel() { stop(); }
    function lost(event: globalThis.PointerEvent) { if (event.pointerId === pointerId) stop(); }
    function move(event: globalThis.PointerEvent) { if (event.pointerId !== pointerId) return; event.preventDefault(); pointer = { x: event.clientX, y: event.clientY }; update(); }
    function finish(event: globalThis.PointerEvent) {
      if (event.pointerId !== pointerId) return;
      pointer = { x: event.clientX, y: event.clientY }; update();
      const policy = latest.current, minute = chosen;
      stop();
      if (!moved || !policy.editable || policy.calendar !== current.calendar || policy.rangeKey !== current.rangeKey || minute === base) return;
      try { policy.onResize(createCalendarResizeCommand(current.calendar, item.id, edge, minute === 1440 ? addCalendarDays(date, 1) : date, calendarMinuteLabel(minute === 1440 ? 0 : minute))); } catch (error) { policy.onError(error); }
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); stop(); } }
    function tick(time: number) {
      if (stopped) return;
      const delta = getDragScrollDelta(pointer, viewport!.getBoundingClientRect(), previousTime ? time - previousTime : 16); previousTime = time;
      if (moved && delta.y) { viewport!.scrollTop += delta.y; update(); }
      frame = win!.requestAnimationFrame(tick);
    }
    active.current = { calendar: current.calendar, rangeKey: current.rangeKey, stop };
    owner.addEventListener("pointermove", move, { passive: false }); owner.addEventListener("pointerup", finish); owner.addEventListener("pointercancel", cancel); target.addEventListener?.("lostpointercapture", lost); owner.addEventListener("keydown", escape); win.addEventListener("blur", cancel);
    update(); frame = win.requestAnimationFrame(tick);
  }
  return { preview, start };
}
