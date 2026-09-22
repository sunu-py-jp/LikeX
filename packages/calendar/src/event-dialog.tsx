import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { addCalendarDays, calendarLocalTimeToISO, getCalendarLocalDateTime, type CalendarEvent } from "./model";

export type CalendarEventDraft = { event?: CalendarEvent; date: string; time?: string; calendarId: string; timeZone: string; anchor?: { x: number; y: number }; detailed?: boolean };
export function EventDialog({ draft, timeZone, editable, busy, onClose, onCommit, onDelete }: {
  draft: CalendarEventDraft; timeZone: string; editable: boolean; busy: boolean;
  onClose(): void; onCommit(event: Omit<CalendarEvent, "id">): Promise<boolean>; onDelete(id: string): Promise<boolean>;
}) {
  const original = draft.event;
  const [detailed, setDetailed] = useState(draft.detailed ?? false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [allDay, setAllDay] = useState(original?.allDay ?? !draft.time);
  const initialStart = original ? (original.allDay ? original.start : getCalendarLocalDateTime(original.start, timeZone).slice(0, 16)) : (draft.time ? `${draft.date}T${draft.time}` : draft.date);
  const initialEnd = original ? (original.allDay ? original.end : getCalendarLocalDateTime(original.end, timeZone).slice(0, 16)) : (draft.time ? new Date(Date.parse(`${initialStart}Z`) + 3600000).toISOString().slice(0, 16) : addCalendarDays(draft.date, 1));
  const [title, setTitle] = useState(original?.title ?? ""), [start, setStart] = useState(initialStart), [end, setEnd] = useState(initialEnd);
  const [description, setDescription] = useState(original?.description ?? ""), [location, setLocation] = useState(original?.location ?? ""), [color, setColor] = useState(original?.color ?? "#2563eb");
  const [error, setError] = useState(""); const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = dialog.current?.ownerDocument.activeElement;
    dialog.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useLayoutEffect(() => {
    const panel = dialog.current, root = panel?.closest<HTMLElement>("[data-likex-calendar]");
    if (!panel || !root || detailed) return;
    const bounds = root.getBoundingClientRect();
    const left = draft.anchor ? draft.anchor.x - bounds.left + 10 : (bounds.width - panel.offsetWidth) / 2;
    const top = draft.anchor ? draft.anchor.y - bounds.top + 10 : 60;
    setPosition({ left: Math.max(8, Math.min(left, bounds.width - panel.offsetWidth - 8)), top: Math.max(8, Math.min(top, bounds.height - panel.offsetHeight - 8)) });
  }, [draft, detailed]);
  useEffect(() => {
    const panel = dialog.current, owner = panel?.ownerDocument;
    if (!panel || !owner || detailed || busy) return;
    const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node)) onClose(); };
    owner.addEventListener("pointerdown", outside, true);
    return () => owner.removeEventListener("pointerdown", outside, true);
  }, [detailed, busy, onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const next = { title, allDay, start: allDay ? start : (!original?.allDay && start === initialStart ? original?.start ?? calendarLocalTimeToISO(start, timeZone) : calendarLocalTimeToISO(start, timeZone)), end: allDay ? end : (!original?.allDay && end === initialEnd ? original?.end ?? calendarLocalTimeToISO(end, timeZone) : calendarLocalTimeToISO(end, timeZone)), ...(description || original?.description !== undefined ? { description } : {}), ...(location || original?.location !== undefined ? { location } : {}), ...(color !== "#2563eb" || !original || original.color !== undefined ? { color } : {}) };
      if (await onCommit(next)) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <div className={detailed ? "lxc-dialog-backdrop" : "lxc-quick-layer"} onPointerDown={event => { if (detailed && !busy && event.target === event.currentTarget) onClose(); }}><div className={`lxc-dialog${detailed ? " lxc-dialog-details" : " lxc-quick-dialog"}`} style={detailed ? undefined : position} role="dialog" aria-modal={detailed} aria-label={original ? "予定の詳細" : "予定を作成"} ref={dialog} onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
    if (event.key === "Tab" && detailed) { const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'); if (!elements?.length) return; const first = elements[0], last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}><form onSubmit={event => void submit(event)}><div className="lxc-dialog-heading"><h2>{original ? "予定の詳細" : "新しい予定"}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="閉じる">×</button></div>
    <fieldset disabled={!editable || busy}><label>タイトル<input required maxLength={1000} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="lxc-checkbox"><input type="checkbox" checked={allDay} onChange={event => { setAllDay(event.target.checked); setStart(event.target.checked ? start.slice(0, 10) : `${start.slice(0, 10)}T09:00`); setEnd(event.target.checked ? (end.slice(0, 10) > start.slice(0, 10) ? end.slice(0, 10) : addCalendarDays(start.slice(0, 10), 1)) : `${end.slice(0, 10)}T10:00`); }} />終日</label>
      <div className="lxc-dialog-dates"><label>開始<input required type={allDay ? "date" : "datetime-local"} value={start} onChange={event => setStart(event.target.value)} /></label><label>{allDay ? "終了（この日は含まない）" : "終了"}<input required type={allDay ? "date" : "datetime-local"} value={end} onChange={event => setEnd(event.target.value)} /></label></div>
      {detailed && <><p className="lxc-hint">{timeZone}</p>
      <label>場所<input value={location} onChange={event => setLocation(event.target.value)} maxLength={10000} /></label><label>説明<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={10000} rows={3} /></label>
      <label className="lxc-color-input">色<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label></>}
    </fieldset>{error && <p role="alert" className="lxc-error">{error}</p>}
    <div className="lxc-dialog-actions">{!detailed && <button type="button" className="lxc-detail-link" onClick={() => setDetailed(true)}>詳細設定</button>}{detailed && original && editable && <button type="button" className="lxc-danger" disabled={busy} onClick={() => { void onDelete(original.id).then(done => { if (done) onClose(); }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); }}>削除</button>}<button type="button" onClick={onClose} disabled={busy}>閉じる</button>{editable && <button type="submit" className="lxc-primary" disabled={busy}>保存</button>}</div>
  </form></div></div>;
}
