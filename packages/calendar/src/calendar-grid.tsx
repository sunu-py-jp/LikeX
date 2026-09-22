import { useLayoutEffect, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { useCalendarResize } from "./use-calendar-resize";
import { useCalendarDrag } from "./use-calendar-drag";
import { addCalendarDays, getCalendarLocalDate, getCalendarLocalDateTime, type Calendar, type CalendarEvent, type CalendarVisibleRange, type CalendarCommand } from "./model";

export type CalendarGridProps = {
  calendar: Calendar;
  range: CalendarVisibleRange;
  activeDate: string;
  today: string;
  editable: boolean;
  onOpen(event: CalendarEvent, anchor?: { x: number; y: number }): void;
  onCreate(date: string, time?: string, anchor?: { x: number; y: number }): void;
  onEventContextMenu?(event: MouseEvent<HTMLElement>, item: CalendarEvent): void;
  onEmptyContextMenu?(event: MouseEvent<HTMLElement>, date: string, time?: string): void;
  onResize?(command: CalendarCommand): void;
  onError?(error: unknown): void;
  onMove(id: string, date: string, time?: string): void;
};
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ja-JP", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
function daysBetween(start: string, end: string): string[] { const days: string[] = []; for (let day = start; day < end; day = addCalendarDays(day, 1)) days.push(day); return days; }
function EventButton({ event, props, time, style, onDragStart, draggedId, resize }: { event: CalendarEvent; props: CalendarGridProps; time?: string; style?: CSSProperties; onDragStart(event: DragEvent<HTMLElement>, value: CalendarEvent): void; draggedId: string | null; resize?: { start?: (event: PointerEvent<HTMLElement>) => void; end?: (event: PointerEvent<HTMLElement>) => void } }) {
  return <button type="button" className={`lxc-event${event.allDay ? " lxc-event-allday" : ""}`} data-dragging={draggedId === event.id || undefined} style={{ ...style, ...(event.color ? { borderLeftColor: event.color } : {}) }} title={`${event.title}${event.location ? ` · ${event.location}` : ""}`} draggable={props.editable}
    onContextMenu={action => props.onEventContextMenu?.(action, event)} onDragStart={drag => { if ((drag.target as HTMLElement).closest?.("[data-lxc-resize]")) drag.preventDefault(); else onDragStart(drag, event); }}
    onClick={action => { if (!(action.target as HTMLElement).closest?.("[data-lxc-resize]")) props.onOpen(event, { x: action.clientX, y: action.clientY }); }}>{time && <span className="lxc-event-time">{time}</span>}<span>{event.title}</span>{resize?.start && <span data-lxc-resize="start" className="lxc-event-resize lxc-event-resize-start" aria-hidden="true" onPointerDown={resize.start} onClick={event => event.stopPropagation()} />}{resize?.end && <span data-lxc-resize="end" className="lxc-event-resize lxc-event-resize-end" aria-hidden="true" onPointerDown={resize.end} onClick={event => event.stopPropagation()} />}</button>;
}
export function CalendarGrid(props: CalendarGridProps) {
  const { viewportRef, start, drop, target, draggedId } = useCalendarDrag({ calendar: props.calendar, rangeKey: `${props.range.view}:${props.range.start}:${props.range.end}`, editable: props.editable, onMove: props.onMove });
  const resizing = useCalendarResize({ calendar: props.calendar, rangeKey: `${props.range.view}:${props.range.start}:${props.range.end}`, editable: props.editable, viewportRef, onResize: command => props.onResize?.(command), onError: error => props.onError?.(error) });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (props.range.view === "month" || !viewport) return;
    // Keep the sticky date heading visible and place 07:00 immediately below it.
    const body = viewport.querySelector<HTMLElement>(".lxc-time-body"), header = viewport.querySelector<HTMLElement>(".lxc-time-header");
    const beforeBody = body ? body.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop : 0;
    viewport.scrollTop = Math.max(0, beforeBody + 7 * 64 - (header?.offsetHeight ?? 0));
  }, [props.range.view, viewportRef]);
  const days = daysBetween(props.range.start, props.range.end), { calendar } = props;
  const eventsByDay: CalendarEvent[][] = days.map(() => []);
  for (const event of calendar.events) {
    const start = event.allDay ? event.start : getCalendarLocalDate(event.start, calendar.timeZone), end = event.allDay ? event.end : addCalendarDays(getCalendarLocalDate(Date.parse(event.end) - 1, calendar.timeZone), 1);
    days.forEach((date, index) => { if (start <= date && date < end) eventsByDay[index].push(event); });
  }
  if (props.range.view === "month") return <div ref={viewportRef} onDrop={drop} className="lxc-month" role="grid" aria-label="月カレンダー">
    <div className="lxc-weekdays" role="row">{days.slice(0, 7).map(day => <div role="columnheader" key={day}>{dateLabel(day, { weekday: "short" })}</div>)}</div>
    <div className="lxc-month-days" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(108px, 1fr))` }}>{days.map((date, index) => <div role="gridcell" className={`lxc-month-day${date.slice(0, 7) !== props.activeDate.slice(0, 7) ? " lxc-outside" : ""}`} key={date} aria-label={date} tabIndex={props.editable ? 0 : undefined}
      onClick={event => { if (props.editable && !(event.target as HTMLElement).closest("button")) props.onCreate(date, undefined, { x: event.clientX, y: event.clientY }); }}
      onKeyDown={event => { if (props.editable && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); props.onCreate(date); } }}
      onContextMenu={event => props.onEmptyContextMenu?.(event, date)}
      data-lxc-drop-date={date} data-drop-active={target?.date === date && !target.time || undefined}>
      <div className="lxc-day-heading"><span className={date === props.today ? "lxc-today" : ""}>{Number(date.slice(-2))}</span>{props.editable && <button type="button" className="lxc-add-day" aria-label={`${date} に予定を追加`} onClick={event => props.onCreate(date, undefined, { x: event.clientX, y: event.clientY })}>+</button>}</div>
      <div className="lxc-day-events">{eventsByDay[index].map(event => <EventButton onDragStart={start} draggedId={draggedId} key={event.id} event={event} props={props} time={event.allDay ? undefined : getCalendarLocalDateTime(event.start, calendar.timeZone).slice(11, 16)} />)}</div>
    </div>)}</div>
  </div>;
  return <div ref={viewportRef} onDrop={drop} className="lxc-time-scroll"><div className="lxc-time-grid" style={{ "--lxc-day-count": days.length } as CSSProperties}>
    <div className="lxc-time-header"><span className="lxc-time-gutter">{calendar.timeZone}</span>{days.map(date => <div key={date} className={date === props.today ? "lxc-current-day" : ""}>{dateLabel(date, { weekday: "short", month: "numeric", day: "numeric" })}</div>)}</div>
    <div className="lxc-all-day-row"><span className="lxc-time-gutter">終日</span>{days.map((date, index) => <div key={date} className="lxc-all-day-cell" onContextMenu={event => props.onEmptyContextMenu?.(event, date)} onClick={event => { if (props.editable && event.target === event.currentTarget) props.onCreate(date, undefined, { x: event.clientX, y: event.clientY }); }} data-lxc-drop-date={date} data-drop-active={target?.date === date && !target.time || undefined}>
      {eventsByDay[index].filter(event => event.allDay).map(event => <EventButton onDragStart={start} draggedId={draggedId} key={event.id} event={event} props={props} />)}
      {props.editable && <button type="button" className="lxc-add-day" aria-label={`${date} に終日予定を追加`} onClick={event => props.onCreate(date, undefined, { x: event.clientX, y: event.clientY })}>+</button>}
    </div>)}</div>
    <div className="lxc-time-body"><div className="lxc-hour-labels">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: `${hour * 64}px` }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
      {days.map((date, index) => {
        const timed = eventsByDay[index].filter(event => !event.allDay).map(event => {
          const start = getCalendarLocalDateTime(event.start, calendar.timeZone), end = getCalendarLocalDateTime(event.end, calendar.timeZone);
          const minutes = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
          const from = start.slice(0, 10) < date ? 0 : minutes(start), to = end.slice(0, 10) > date ? 1440 : minutes(end);
          // Repeated local hours at DST fall-back may have an earlier wall-clock end.
          return { event, from, to: Math.max(from + 15, to), label: start.slice(11, 16), lane: 0, lanes: 1 };
        }).sort((a, b) => a.from - b.from || a.to - b.to);
        let group: typeof timed = [], groupEnd = -1;
        const finish = () => { for (const item of group) item.lanes = Math.max(...group.map(other => other.lane + 1)); group = []; };
        for (const item of timed) {
          if (item.from >= groupEnd) finish();
          const occupied = new Set(group.filter(other => other.to > item.from).map(other => other.lane));
          while (occupied.has(item.lane)) item.lane++;
          group.push(item); groupEnd = Math.max(group.length === 1 ? -1 : groupEnd, item.to);
        }
        finish();
        return <div key={date} className="lxc-time-column" aria-label={date} data-lxc-time-column="" data-lxc-drop-date={date}>
          {Array.from({ length: 48 }, (_, slot) => { const time = `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`; return <button type="button" className="lxc-time-slot" disabled={!props.editable} key={slot} aria-label={`${date} ${time} に予定を追加`} onContextMenu={event => props.onEmptyContextMenu?.(event, date, time)} onClick={event => props.onCreate(date, time, { x: event.clientX, y: event.clientY })} data-lxc-drop-date={date} data-lxc-drop-time={time} data-drop-active={target?.date === date && target.time === time || undefined} />; })}
          {timed.map(item => <EventButton onDragStart={start} draggedId={draggedId} key={item.event.id} event={item.event} props={props} time={item.label} resize={props.editable && props.onResize ? { start: getCalendarLocalDate(item.event.start, calendar.timeZone) === date ? event => resizing.start(event, item.event, date, "start") : undefined, end: getCalendarLocalDate(Date.parse(item.event.end) - 1, calendar.timeZone) === date ? event => resizing.start(event, item.event, date, "end") : undefined } : undefined} style={{ position: "absolute", top: `${item.from / 60 * 64}px`, height: `${Math.min(1440 - item.from, item.to - item.from) / 60 * 64}px`, left: `${item.lane / item.lanes * 100}%`, width: `calc(${100 / item.lanes}% - 3px)` }} />)}
          {resizing.preview?.date === date && <div className="lxc-resize-preview" role="status" style={{ top: `${resizing.preview.from / 60 * 64}px`, height: `${(resizing.preview.to - resizing.preview.from) / 60 * 64}px`, left: 0, right: 2 }}>{resizing.preview.label}</div>}
        </div>;
      })}
    </div>
  </div></div>;
}
