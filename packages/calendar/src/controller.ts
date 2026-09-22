import { createModelEditorController, type ModelEditorOptions } from "./core";
import { executeCalendarCommands, normalizeCalendar, serializeCalendar, type Calendar, type CalendarCommand } from "./model";
import type { CalendarFeature } from "./props";
export function createCalendarController(calendar: Calendar, options: ModelEditorOptions<Calendar, CalendarFeature> = {}) {
  return createModelEditorController<Calendar, CalendarCommand, CalendarFeature>({
    normalize: normalizeCalendar,
    serialize: serializeCalendar,
    execute: (current, commands) => executeCalendarCommands(current, commands).calendar,
    features: ["events", "metadata", "import", "export", "history"],
    getCommandFeatures: command => [command.type === "calendar.replace" ? "import" : command.type === "calendar.update" ? "metadata" : "events"],
  }, calendar, options);
}
