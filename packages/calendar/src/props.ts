import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, SaveHandler, ModelEditorEvent, ModelEditorSnapshot } from "./core";
import type { Calendar, CalendarCommand, CalendarCommandResult, CalendarEvent, CalendarView, CalendarVisibleRange } from "./model";
export type CalendarFeature = "events" | "metadata" | "import" | "export" | "history";
export type CalendarFeatures = Partial<Record<CalendarFeature, boolean>>;
export type CalendarEditorEvent = ModelEditorEvent<Calendar>;
export type CalendarHandle = {
  getCalendar(): Calendar;
  getSnapshot(): ModelEditorSnapshot<Calendar, CalendarFeature>;
  getVisibleRange(): CalendarVisibleRange;
  setDate(date: string): void;
  setView(view: CalendarView): void;
  execute(command: CalendarCommand | readonly CalendarCommand[]): Promise<CalendarCommandResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  cancelPending(): void;
  importNative(input: string | Blob): Promise<boolean>;
  exportNative(): Promise<Blob>;
};
export type CalendarProps = {
  ref?: Ref<CalendarHandle>;
  /** Initial only. Remount with a new React key to open another calendar. */
  initialCalendar?: Calendar;
  initialDate?: string;
  initialView?: CalendarView;
  weekStartsOn?: 0 | 1;
  /** Without onSave the component is read-only. */
  onSave?: SaveHandler<Calendar>;
  onBeforeSave?: (calendar: Calendar) => MaybePromise<boolean | void>;
  onEditRequest?: (request: { calendar: Calendar }, context: OperationContext) => MaybePromise<boolean>;
  onChange?: (calendar: Calendar) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onEvent?: (event: CalendarEditorEvent) => MaybePromise<void>;
  onVisibleRangeChange?: (range: CalendarVisibleRange) => void;
  onEventClick?: (event: CalendarEvent) => void;
  readOnly?: boolean;
  warnOnUnsavedChanges?: boolean;
  features?: CalendarFeatures;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  title?: string;
  exportFileName?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};
