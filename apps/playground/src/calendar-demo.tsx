import { useCallback, useState } from "react";
import LikeCalendar, { createCalendar, parseCalendar, serializeCalendar, type Calendar } from "@likex/calendar";
import "../../../packages/calendar/src/styles.css";
import { getDemoComponentTheme } from "./demo/component-theme";

export default function CalendarDemo() {
  const [theme] = useState(() => getDemoComponentTheme("system"));
  const [initialCalendar] = useState(() => createCalendar({ title: "プロジェクトカレンダー", timeZone: "Asia/Tokyo", events: [
    { id: "planning", title: "スプリント計画", allDay: false, start: "2026-09-21T10:00:00+09:00", end: "2026-09-21T11:30:00+09:00", location: "会議室 A", description: "今週の優先順位と担当を決めます。", color: "#2563eb" },
    { id: "design", title: "デザインレビュー", allDay: false, start: "2026-09-22T14:00:00+09:00", end: "2026-09-22T15:00:00+09:00", location: "オンライン", color: "#7c3aed" },
    { id: "customer", title: "お客様との打ち合わせ", allDay: false, start: "2026-09-22T14:30:00+09:00", end: "2026-09-22T16:00:00+09:00", color: "#0891b2" },
    { id: "holiday", title: "チーム休暇", allDay: true, start: "2026-09-23", end: "2026-09-24", color: "#059669" },
    { id: "release", title: "リリース準備", allDay: true, start: "2026-09-24", end: "2026-09-26", color: "#d97706" },
    { id: "retro", title: "ふりかえり", allDay: false, start: "2026-09-25T16:00:00+09:00", end: "2026-09-25T17:00:00+09:00", color: "#2563eb" },
  ] }));
  const save = useCallback((calendar: Calendar) => parseCalendar(serializeCalendar(calendar)), []);
  return <LikeCalendar initialCalendar={initialCalendar} initialDate="2026-09-22" onSave={save} {...theme} exportFileName="project-calendar.json" style={{ height: "100dvh", width: "100%" }} />;
}
