import type { CalendarView, CalendarVisibleRange } from "./types";
const formatters = new Map<string, Intl.DateTimeFormat>();

export function validateCalendarDate(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < "0100") throw new Error("Expected a date in YYYY-MM-DD format (year 0100–9999)");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
  return value;
}
export function validateCalendarTimeZone(value: string): string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) throw new Error("Invalid calendar timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); } catch { throw new Error("Invalid calendar timezone"); }
  return value;
}
export function addCalendarDays(date: string, days: number): string {
  validateCalendarDate(date);
  if (!Number.isSafeInteger(days)) throw new Error("Day offset must be an integer");
  return validateCalendarDate(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10));
}
export function getCalendarLocalDate(instant: string | number | Date, timeZone: string): string {
  return getCalendarLocalDateTime(instant, timeZone).slice(0, 10);
}
export function getCalendarLocalDateTime(instant: string | number | Date, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid instant");
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: validateCalendarTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); if (formatters.size >= 32) formatters.clear(); formatters.set(timeZone, formatter); }
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")!.padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
/** Resolve a wall time in an IANA zone. DST gaps reject; repeated times choose the earlier instant. */
export function calendarLocalTimeToISO(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(local)) throw new Error("Invalid local date/time");
  validateCalendarDate(local.slice(0, 10)); validateCalendarTimeZone(timeZone);
  const full = local.length === 16 ? `${local}:00` : local, guess = Date.parse(`${full}Z`);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = guess + hours * 3600000;
    offsets.add(Date.parse(`${getCalendarLocalDateTime(sample, timeZone)}Z`) - sample);
  }
  const matches = [...offsets].map(offset => guess - offset).filter(instant => getCalendarLocalDateTime(instant, timeZone) === full).sort((a, b) => a - b);
  if (!matches.length) throw new Error("This local time does not exist in the selected timezone (DST transition)");
  return new Date(matches[0]).toISOString();
}
export function getCalendarVisibleRange(date: string, view: CalendarView, timeZone = "UTC", weekStartsOn: 0 | 1 = 1): CalendarVisibleRange {
  validateCalendarDate(date); validateCalendarTimeZone(timeZone);
  if (!["month", "week", "day"].includes(view)) throw new Error("Invalid calendar view");
  if (weekStartsOn !== 0 && weekStartsOn !== 1) throw new Error("weekStartsOn must be 0 or 1");
  let start = view === "month" ? `${date.slice(0, 7)}-01` : date;
  if (view !== "day") start = addCalendarDays(start, -((new Date(`${start}T00:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7));
  let end = addCalendarDays(start, view === "day" ? 1 : 7);
  if (view === "month") {
    const first = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); first.setUTCMonth(first.getUTCMonth() + 1);
    const next = first.toISOString().slice(0, 10);
    end = next;
    const days = (weekStartsOn - first.getUTCDay() + 7) % 7;
    if (days) end = addCalendarDays(next, days);
  }
  return Object.freeze({ start, end, view, timeZone });
}
export function shiftCalendarDate(date: string, view: CalendarView, direction: -1 | 1): string {
  validateCalendarDate(date);
  if (view !== "month") return addCalendarDays(date, direction * (view === "week" ? 7 : 1));
  const result = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); result.setUTCMonth(result.getUTCMonth() + direction);
  return validateCalendarDate(result.toISOString().slice(0, 10));
}
