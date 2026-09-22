"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Redo2, Save, Undo2, Upload } from "lucide-react";
import { openContextMenu, type ContextMenuAction } from "./browser";
import { createPrimaryColorPalette, type ModelEditorOptions } from "./core";
import { CALENDAR_MAX_JSON_BYTES, createCalendar, createCalendarRescheduleCommand, getCalendarLocalDate, getCalendarVisibleRange, parseCalendar, serializeCalendar, shiftCalendarDate, validateCalendarDate, type Calendar, type CalendarCommand, type CalendarView, type CalendarEvent } from "./model";
import { createCalendarController } from "./controller";
import type { CalendarFeature, CalendarProps } from "./props";
import { CalendarGrid } from "./calendar-grid";
import { EventDialog, type CalendarEventDraft } from "./event-dialog";

function options(props: CalendarProps): ModelEditorOptions<Calendar, CalendarFeature> {
  return { onSave: props.onSave, onBeforeSave: props.onBeforeSave, onEditRequest: props.onEditRequest ? (request, context) => props.onEditRequest!({ calendar: request.model }, context) : undefined, onChange: props.onChange, onDirtyChange: props.onDirtyChange, onEvent: props.onEvent, readOnly: props.readOnly, features: props.features };
}
export default function LikeCalendar({ ref: forwardedRef, ...props }: CalendarProps) {
  const [controller] = useState(() => createCalendarController(props.initialCalendar ?? createCalendar(), options(props)));
  useLayoutEffect(() => controller.configure(options(props)));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), calendar = snapshot.model;
  const [date, setDate] = useState(() => validateCalendarDate(props.initialDate ?? getCalendarLocalDate(Date.now(), calendar.timeZone)));
  const [view, setView] = useState<CalendarView>(props.initialView ?? "month");
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null), [systemDark, setSystemDark] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null), closeMenu = useRef<(() => void) | null>(null);
  useEffect(() => () => closeMenu.current?.(), []);
  useLayoutEffect(() => { closeMenu.current?.(); }, [calendar, snapshot.editable, snapshot.features.events, date, view]);
  useEffect(() => { const query = window.matchMedia("(prefers-color-scheme: dark)"); const update = () => setSystemDark(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  const mode = props.colorMode === "dark" || (props.colorMode === "system" && systemDark) ? "dark" : "light";
  const palette = createPrimaryColorPalette(props.primaryColor, mode);
  const range = useMemo(() => getCalendarVisibleRange(date, view, calendar.timeZone, props.weekStartsOn ?? 1), [date, view, calendar.timeZone, props.weekStartsOn]);
  const callback = props.onVisibleRangeChange;
  useEffect(() => { callback?.(range); }, [callback, range]);
  useEffect(() => { if (!snapshot.dirty || props.warnOnUnsavedChanges === false) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [snapshot.dirty, props.warnOnUnsavedChanges]);
  const execute = useCallback(async (commands: CalendarCommand | readonly CalendarCommand[]) => {
    const next = await controller.execute(commands); return next ? { calendar: next, changed: true } : null;
  }, [controller]);
  const importNative = useCallback(async (value: string | Blob) => {
    const next = await controller.prepare(async (_model, context) => {
      if (typeof value !== "string" && value.size > CALENDAR_MAX_JSON_BYTES) throw new Error("Calendar exceeds JSON size limit");
      const text = typeof value === "string" ? value : await value.text();
      if (context.signal.aborted) throw new Error("読み込みを中止しました。");
      return { type: "calendar.replace", calendar: parseCalendar(text) };
    }, { feature: "import" });
    return next !== null;
  }, [controller]);
  const exportNative = useCallback(async () => {
    if (!controller.getSnapshot().features.export) throw new Error("書き出しは無効です。");
    return new Blob([serializeCalendar(controller.getModel())], { type: "application/json" });
  }, [controller]);
  useImperativeHandle(forwardedRef, () => ({ getCalendar: controller.getModel, getSnapshot: controller.getSnapshot, getVisibleRange: () => range, setDate: next => setDate(validateCalendarDate(next)), setView: next => { getCalendarVisibleRange(date, next, calendar.timeZone); setView(next); }, execute, undo: controller.undo, redo: controller.redo, save: controller.save, discard: controller.discard, cancelPending: controller.cancelPending, importNative, exportNative }), [controller, range, date, calendar.timeZone, execute, importNative, exportNative]);
  const editable = snapshot.editable && snapshot.features.events;
  const report = (cause: unknown) => controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
  function move(id: string, nextDate: string, time?: string) { try { void execute(createCalendarRescheduleCommand(controller.getModel(), id, nextDate, time)); } catch (cause) { report(cause); } }
  async function commitDialog(command: CalendarCommand): Promise<boolean> {
    if (!draft) return false;
    const current = controller.getModel();
    if (current.id !== draft.calendarId || current.timeZone !== draft.timeZone || draft.event && JSON.stringify(current.events.find(event => event.id === draft.event!.id)) !== JSON.stringify(draft.event)) throw new Error("予定が変更されました。閉じてからもう一度開いてください。");
    const result = await execute(command);
    const notice = controller.getSnapshot().notice;
    if (notice?.kind === "error") throw new Error(notice.text);
    return result !== null;
  }
  function eventMenu(event: MouseEvent<HTMLElement>, item: CalendarEvent) {
    if (event.shiftKey) return;
    const before = controller.getModel();
    const guard = (action: () => unknown) => () => {
      if (controller.getModel() !== before) { report(new Error("予定が変更されました。もう一度メニューを開いてください。")); return; }
      return action();
    };
    const items: ContextMenuAction[] = [{ id: "details", label: "詳細を開く", onSelect: guard(() => setDraft({ event: item, date: item.start.slice(0, 10), calendarId: before.id, timeZone: before.timeZone, detailed: true })) }];
    if (!snapshot.readOnly && snapshot.features.events) items.push(
      { id: "duplicate", label: "複製", disabled: !editable, onSelect: guard(() => { const { id: _id, ...copy } = item; void _id; return execute({ type: "event.create", event: { ...copy, title: `${item.title} のコピー` } }); }) },
      { id: "delete", label: "削除", danger: true, separatorBefore: true, disabled: !editable, onSelect: guard(() => execute({ type: "event.delete", id: item.id })) },
    );
    event.preventDefault(); event.stopPropagation();
    closeMenu.current = openContextMenu({ anchor: event.currentTarget, x: event.clientX, y: event.clientY, items, onError: report });
  }
  function emptyMenu(event: MouseEvent<HTMLElement>, day: string, time?: string) {
    if (event.shiftKey) return;
    if (snapshot.readOnly || !snapshot.features.events) return;
    const anchor = { x: event.clientX, y: event.clientY };
    event.preventDefault(); event.stopPropagation();
    closeMenu.current = openContextMenu({ anchor: event.currentTarget, ...anchor, items: [{ id: "create", label: time ? "ここに予定を作成" : "終日の予定を作成", disabled: !editable, onSelect: () => { if (controller.getSnapshot().editable) { const current = controller.getModel(); setDraft({ date: day, time, calendarId: current.id, timeZone: current.timeZone, anchor }); } } }], onError: report });
  }
  async function download() { try { const blob = await exportNative(), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = props.exportFileName ?? `${calendar.title || "calendar"}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (cause) { report(cause); } }
  const style = { ...(palette ? { "--lxc-primary": palette.primary, "--lxc-on-primary": palette.onPrimary, "--lxc-accent": palette.accent, "--lxc-selection": palette.selection } : {}), ...props.style } as CSSProperties;
  const heading = new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", year: "numeric", month: "long", ...(view === "day" ? { day: "numeric" } : {}) }).format(new Date(`${date}T00:00:00Z`));
  return <section ref={root} data-likex-calendar className={`lxc-root ${props.className ?? ""}`} data-color-mode={mode} style={style} aria-label={props["aria-label"] ?? props.title ?? calendar.title} aria-busy={snapshot.busy !== null}>
    <header className="lxc-header"><div className="lxc-brand"><CalendarDays size={22} /><h1>{props.title ?? calendar.title}</h1><span className="lxc-state">{snapshot.readOnly ? "閲覧専用" : snapshot.dirty ? "未保存" : "保存済み"}</span></div><div className="lxc-header-actions">
      {snapshot.features.history && <><button type="button" title="元に戻す" aria-label="元に戻す" disabled={!snapshot.editable || !snapshot.canUndo} onClick={() => void controller.undo()}><Undo2 size={17} /></button><button type="button" title="やり直す" aria-label="やり直す" disabled={!snapshot.editable || !snapshot.canRedo} onClick={() => void controller.redo()}><Redo2 size={17} /></button></>}
      {snapshot.features.import && !snapshot.readOnly && <button type="button" title="JSONを読み込む" aria-label="JSONを読み込む" disabled={!snapshot.editable} onClick={() => input.current?.click()}><Upload size={17} /></button>}
      {snapshot.features.export && <button type="button" title="JSONを書き出す" aria-label="JSONを書き出す" onClick={() => void download()}><Download size={17} /></button>}
      {!snapshot.readOnly && <><button type="button" className="lxc-save" disabled={!snapshot.editable || !snapshot.dirty} onClick={() => void controller.save()}><Save size={16} />保存</button>{snapshot.dirty && <button type="button" disabled={!snapshot.editable} onClick={() => controller.discard()}>変更を破棄</button>}</>}
    </div></header>
    <div className="lxc-toolbar"><div className="lxc-navigation"><button type="button" onClick={() => setDate(getCalendarLocalDate(Date.now(), calendar.timeZone))}>今日</button><button type="button" aria-label="前へ" onClick={() => setDate(shiftCalendarDate(date, view, -1))}><ChevronLeft size={18} /></button><button type="button" aria-label="次へ" onClick={() => setDate(shiftCalendarDate(date, view, 1))}><ChevronRight size={18} /></button><h2>{heading}</h2></div>
      <div className="lxc-toolbar-end">{snapshot.features.metadata && <label className="lxc-timezone-label">タイムゾーン<select aria-label="タイムゾーン" value={calendar.timeZone} disabled={!snapshot.editable || !snapshot.features.metadata} onChange={event => void execute({ type: "calendar.update", timeZone: event.target.value })}>{[...new Set([calendar.timeZone, "Asia/Tokyo", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Singapore", "Australia/Sydney"])].map(zone => <option key={zone}>{zone}</option>)}</select></label>}
        <div className="lxc-view-switch" role="group" aria-label="表示期間">{(["month", "week", "day"] as const).map((item, index) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{["月", "週", "日"][index]}</button>)}</div>{snapshot.features.events && !snapshot.readOnly && <button type="button" className="lxc-primary" disabled={!editable} onClick={event => setDraft({ date, time: "09:00", calendarId: calendar.id, timeZone: calendar.timeZone, anchor: { x: event.clientX, y: event.clientY } })}><Plus size={16} />予定を作成</button>}
      </div></div>
    {snapshot.notice && <div className={`lxc-notice lxc-notice-${snapshot.notice.kind}`} role={snapshot.notice.kind === "error" ? "alert" : "status"}>{snapshot.notice.text}<button type="button" aria-label="通知を閉じる" onClick={() => controller.setNotice(null)}>×</button></div>}
    <CalendarGrid calendar={calendar} range={range} activeDate={date} today={getCalendarLocalDate(now, calendar.timeZone)} editable={editable} onCreate={(day, time, anchor) => setDraft({ date: day, time, calendarId: calendar.id, timeZone: calendar.timeZone, anchor })} onEventContextMenu={eventMenu} onEmptyContextMenu={emptyMenu} onResize={command => { void execute(command); }} onError={report} onMove={move} onOpen={(event, anchor) => { try { props.onEventClick?.(event); } catch { /* Host observers do not block the dialog. */ } setDraft({ event, date: event.start.slice(0, 10), calendarId: calendar.id, timeZone: calendar.timeZone, anchor }); }} />
    <footer className="lxc-footer"><span>{range.start} — {range.end}（終了日を含まない）</span><span>{calendar.events.length} 件の予定 · {calendar.timeZone}</span></footer>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setDraft(null); void importNative(file); } }} />
    {draft && <EventDialog key={`${draft.calendarId}:${draft.timeZone}:${draft.event?.id ?? "new"}:${draft.date}:${draft.time ?? ""}:${draft.anchor?.x}:${draft.anchor?.y}`} draft={draft} timeZone={draft.timeZone} editable={!snapshot.readOnly && snapshot.features.events} busy={snapshot.busy !== null} onClose={() => setDraft(current => current === draft ? null : current)} onCommit={event => commitDialog(draft.event ? { type: "event.update", id: draft.event.id, changes: event } : { type: "event.create", event })} onDelete={id => commitDialog({ type: "event.delete", id })} />}
  </section>;
}
