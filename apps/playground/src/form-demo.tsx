import "../../../packages/form/src/styles.css";
import { useState } from "react";
import { FormView, createForm } from "@likex/form";
const form = createForm({ id: "project-feedback", title: "プロジェクト振り返り", description: "今週の進捗と、次に取り組みたいことを教えてください。", fields: [
  { id: "name", type: "text", label: "お名前", required: true, placeholder: "山田 太郎", maxLength: 100 },
  { id: "team", type: "select", label: "チーム", required: true, options: [{ value: "design", label: "デザイン" }, { value: "engineering", label: "開発" }, { value: "sales", label: "営業" }] },
  { id: "progress", type: "number", label: "進捗（%）", min: 0, max: 100, defaultValue: 50 },
  { id: "feedback", type: "textarea", label: "共有したいこと", placeholder: "うまくいったことや困っていること", maxLength: 1000 },
  { id: "followup", type: "checkbox", label: "個別に相談したい", placeholder: "相談を希望する" },
  { id: "date", type: "date", label: "相談希望日", required: true, visibleWhen: { fieldId: "followup", operator: "equals", value: true } },
] });
export default function FormDemo() {
  const [mode, setMode] = useState<"design" | "fill">("design"), [current, setCurrent] = useState(form);
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}><div style={{ padding: "6px 14px", display: "flex", gap: 12, font: "13px system-ui", background: "#f7f7f8" }}><label>デモ画面 <select value={mode} onChange={event => setMode(event.target.value as "design" | "fill")}><option value="design">フォームを作る</option><option value="fill">フォームに回答</option></select></label><span>回答送信はデモ内で完結します</span></div><div style={{ flex: 1, minHeight: 0 }}><FormView key={mode} initialForm={current} mode={mode} onSave={setCurrent} onSubmit={async () => { await new Promise(resolve => setTimeout(resolve, 500)); }} /></div></div>;
}
