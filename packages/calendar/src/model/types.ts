/** Date-only strings use YYYY-MM-DD; timed instants require Z or an explicit offset. */
export type CalendarEvent = Readonly<{
  id: string;
  title: string;
  description?: string;
  location?: string;
  color?: string;
  allDay: boolean;
  start: string;
  /** Exclusive end, including for all-day events. */
  end: string;
}>;

export type Calendar = Readonly<{
  format: "likex.calendar";
  version: 1;
  id: string;
  title: string;
  /** IANA display timezone. Stored timed events always retain their instant. */
  timeZone: string;
  events: readonly CalendarEvent[];
}>;
export type CalendarInput = Partial<Omit<Calendar, "format" | "version" | "events">> & { events?: readonly CalendarEvent[] };
export type CalendarCommand =
  | Readonly<{ type: "event.create"; event: Omit<CalendarEvent, "id"> & { id?: string } }>
  | Readonly<{ type: "event.update"; id: string; changes: Partial<Omit<CalendarEvent, "id">> }>
  | Readonly<{ type: "event.delete"; id: string }>
  | Readonly<{ type: "calendar.update"; title?: string; timeZone?: string }>
  | Readonly<{ type: "calendar.replace"; calendar: Calendar }>;
export type CalendarCommandResult = Readonly<{ calendar: Calendar; changed: boolean }>;
export type CalendarView = "month" | "week" | "day";
export type CalendarVisibleRange = Readonly<{ start: string; end: string; view: CalendarView; timeZone: string }>;
