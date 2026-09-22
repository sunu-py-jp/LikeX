import type { Calendar, CalendarInput, CalendarCommand, CalendarCommandResult, CalendarEvent, CalendarVisibleRange } from "./types";
import { validateCalendarDate, validateCalendarTimeZone, getCalendarLocalDate, getCalendarLocalDateTime, addCalendarDays, calendarLocalTimeToISO } from "./dates";
export * from "./types";
export * from "./dates";

export const CALENDAR_MAX_JSON_BYTES = 5 * 1024 * 1024;
export const CALENDAR_MAX_EVENTS = 10000;
export const CALENDAR_MAX_COMMANDS = 1000;
const normalized = new WeakSet<object>();
function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], name: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
}
function string(value: unknown, name: string, max = 10000): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`${name} must be a string of at most ${max} characters`);
  return value;
}
function id(value: unknown): string { const result = string(value, "id", 200); if (!result.trim()) throw new Error("id cannot be empty"); return result; }
function newId(prefix: string): string { return `${prefix}-${globalThis.crypto.randomUUID()}`; }
function instant(value: unknown): string {
  const result = string(value, "event time", 40);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error("Timed events require an ISO date/time with Z or an explicit offset");
  validateCalendarDate(result.slice(0, 10));
  if (/[+-]14:(?!00)/.test(result)) throw new Error("Invalid timezone offset");
  return result;
}
function event(value: unknown): CalendarEvent {
  const source = record(value, "event"); keys(source, ["id", "title", "description", "location", "color", "allDay", "start", "end"], "event");
  if (typeof source.allDay !== "boolean") throw new Error("allDay must be a boolean");
  const start = source.allDay ? validateCalendarDate(string(source.start, "start")) : instant(source.start);
  const end = source.allDay ? validateCalendarDate(string(source.end, "end")) : instant(source.end);
  if (source.allDay ? end <= start : Date.parse(end) <= Date.parse(start)) throw new Error("Event end must be after start (end is exclusive)");
  const result: { id: string; title: string; allDay: boolean; start: string; end: string; description?: string; location?: string; color?: string } = { id: id(source.id), title: string(source.title, "title", 1000), allDay: source.allDay, start, end };
  if (!result.title.trim()) throw new Error("Event title cannot be empty");
  for (const key of ["description", "location"] as const) if (source[key] !== undefined) result[key] = string(source[key], key);
  if (source.color !== undefined) { const color = string(source.color, "color", 7); if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("Event color must be #RRGGBB"); result.color = color; }
  return Object.freeze(result);
}
export function createCalendar(input: CalendarInput = {}): Calendar {
  const source = record(input, "calendar input"); keys(source, ["id", "title", "timeZone", "events"], "calendar input");
  return normalizeCalendar({ format: "likex.calendar", version: 1, id: input.id ?? newId("calendar"), title: input.title ?? "Calendar", timeZone: input.timeZone ?? "UTC", events: input.events ?? [] });
}
export function normalizeCalendar(input: unknown): Calendar {
  if (input && typeof input === "object" && normalized.has(input)) return input as Calendar;
  const source = record(input, "calendar"); keys(source, ["format", "version", "id", "title", "timeZone", "events"], "calendar");
  if (source.format !== "likex.calendar" || source.version !== 1) throw new Error("Unsupported calendar format or version");
  if (!Array.isArray(source.events) || source.events.length > CALENDAR_MAX_EVENTS) throw new Error(`events must be an array with at most ${CALENDAR_MAX_EVENTS} items`);
  const events = source.events.map(event), ids = new Set<string>();
  for (const value of events) { if (ids.has(value.id)) throw new Error(`Duplicate event id: ${value.id}`); ids.add(value.id); }
  const result: Calendar = Object.freeze({ format: "likex.calendar", version: 1, id: id(source.id), title: string(source.title, "title", 1000), timeZone: validateCalendarTimeZone(string(source.timeZone, "timeZone", 100)), events: Object.freeze(events) });
  if (new TextEncoder().encode(JSON.stringify(result, null, 2) + "\n").byteLength > CALENDAR_MAX_JSON_BYTES) throw new Error("Calendar exceeds JSON size limit");
  normalized.add(result); return result;
}
export function parseCalendar(json: string): Calendar {
  if (typeof json !== "string" || json.length > CALENDAR_MAX_JSON_BYTES || new TextEncoder().encode(json).byteLength > CALENDAR_MAX_JSON_BYTES) throw new Error("Calendar exceeds JSON size limit");
  return normalizeCalendar(JSON.parse(json));
}
export function serializeCalendar(calendar: Calendar): string {
  const json = JSON.stringify(normalizeCalendar(calendar), null, 2) + "\n";
  if (new TextEncoder().encode(json).byteLength > CALENDAR_MAX_JSON_BYTES) throw new Error("Calendar exceeds JSON size limit");
  return json;
}
export function executeCalendarCommands(calendar: Calendar, commands: CalendarCommand | readonly CalendarCommand[]): CalendarCommandResult {
  const original = normalizeCalendar(calendar), batch = Array.isArray(commands) ? commands : [commands];
  if (batch.length > CALENDAR_MAX_COMMANDS) throw new Error("Too many calendar commands");
  let current = original;
  for (const input of batch) {
    const command = record(input, "command");
    switch (command.type) {
      case "calendar.replace": {
        keys(command, ["type", "calendar"], "command"); current = normalizeCalendar(command.calendar); break;
      }
      case "event.create": {
        keys(command, ["type", "event"], "command"); const data = record(command.event, "event");
        current = normalizeCalendar({ ...current, events: [...current.events, event({ ...data, id: data.id ?? newId("event") })] }); break;
      }
      case "event.update": {
        keys(command, ["type", "id", "changes"], "command"); const eventId = id(command.id), changes = record(command.changes, "changes");
        keys(changes, ["title", "description", "location", "color", "allDay", "start", "end"], "changes");
        if (!current.events.some(item => item.id === eventId)) throw new Error(`Unknown event: ${eventId}`);
        current = normalizeCalendar({ ...current, events: current.events.map(item => item.id === eventId ? event({ ...item, ...changes }) : item) }); break;
      }
      case "event.delete": {
        keys(command, ["type", "id"], "command"); const eventId = id(command.id);
        if (!current.events.some(item => item.id === eventId)) throw new Error(`Unknown event: ${eventId}`);
        current = normalizeCalendar({ ...current, events: current.events.filter(item => item.id !== eventId) }); break;
      }
      case "calendar.update": {
        keys(command, ["type", "title", "timeZone"], "command"); const changes = { ...command }; delete changes.type;
        current = normalizeCalendar({ ...current, ...changes }); break;
      }
      default: throw new Error(`Unknown calendar command: ${String(command.type)}`);
    }
  }
  const changed = serializeCalendar(original) !== serializeCalendar(current);
  return Object.freeze({ calendar: changed ? current : original, changed });
}
export function getCalendarEvent(calendar: Calendar, eventId: string): CalendarEvent | undefined { return normalizeCalendar(calendar).events.find(item => item.id === eventId); }
export function getCalendarEvents(calendar: Calendar, range?: Pick<CalendarVisibleRange, "start" | "end">): readonly CalendarEvent[] {
  const value = normalizeCalendar(calendar);
  if (!range) return value.events;
  validateCalendarDate(range.start); validateCalendarDate(range.end);
  if (range.end <= range.start) throw new Error("Range end must be after start");
  return Object.freeze(value.events.filter(item => {
    if (item.allDay) return item.start < range.end && item.end > range.start;
    const first = getCalendarLocalDate(item.start, value.timeZone), last = getCalendarLocalDate(Date.parse(item.end) - 1, value.timeZone);
    return first < range.end && last >= range.start;
  }));
}
/** Move an event to a local day/time, preserving its elapsed duration or count of all-day dates. */
export function createCalendarRescheduleCommand(calendar: Calendar, eventId: string, date: string, time?: string): CalendarCommand {
  const value = normalizeCalendar(calendar), target = getCalendarEvent(value, eventId); validateCalendarDate(date);
  if (!target) throw new Error(`Unknown event: ${eventId}`);
  if (target.allDay) {
    const duration = (Date.parse(target.end) - Date.parse(target.start)) / 86400000;
    return { type: "event.update", id: eventId, changes: { start: date, end: addCalendarDays(date, duration) } };
  }
  const start = calendarLocalTimeToISO(`${date}T${time ?? getCalendarLocalDateTime(target.start, value.timeZone).slice(11)}`, value.timeZone);
  const end = new Date(Date.parse(start) + Date.parse(target.end) - Date.parse(target.start)).toISOString();
  return { type: "event.update", id: eventId, changes: { start, end } };
}

/** Resize only one boundary in the calendar's display timezone; retain ID and the opposite boundary. */
export function createCalendarResizeCommand(calendar: Calendar, eventId: string, edge: "start" | "end", date: string, time: string): CalendarCommand {
  const value = normalizeCalendar(calendar), target = getCalendarEvent(value, eventId);
  if (!target) throw new Error(`Unknown event: ${eventId}`);
  if (target.allDay) throw new Error("Timed resizing is not available for all-day events");
  if (edge !== "start" && edge !== "end") throw new Error("Resize edge must be start or end");
  const instant = calendarLocalTimeToISO(`${validateCalendarDate(date)}T${time}`, value.timeZone);
  const start = edge === "start" ? instant : target.start, end = edge === "end" ? instant : target.end;
  if (Date.parse(end) <= Date.parse(start)) throw new Error("終了は開始より後にしてください。");
  return { type: "event.update", id: eventId, changes: { [edge]: instant } };
}
