import { useState } from "react";
import LikeDataView, { createDataView, parseDataView, serializeDataView, type DataViewModel } from "../../../packages/dataview/src";
import { getDemoComponentTheme } from "./demo/component-theme";
export function createDemoDataView() {
  return createDataView({ id: "demo-data", title: "取引先一覧", fields: [
    { id: "company", name: "会社名", type: "text" }, { id: "owner", name: "担当者", type: "text" }, { id: "status", name: "ステータス", type: "select", options: ["新規", "提案中", "契約中", "保留"] }, { id: "amount", name: "契約金額", type: "number" }, { id: "start", name: "開始日", type: "date" }, { id: "active", name: "確認済み", type: "boolean" }, { id: "notes", name: "メモ", type: "text" },
  ], rows: [
    { id: "row-1", values: { company: "青葉デザイン", owner: "佐藤", status: "契約中", amount: 480000, start: "2026-09-01", active: true, notes: "月次レビューを第1火曜日に実施" } },
    { id: "row-2", values: { company: "北山製作所", owner: "山田", status: "提案中", amount: 1200000, start: "2026-10-01", active: true, notes: "次回打ち合わせで導入範囲を確定" } },
    { id: "row-3", values: { company: "みなと出版", owner: "鈴木", status: "新規", amount: null, start: null, active: false, notes: "問い合わせフォームから連絡" } },
    { id: "row-4", values: { company: "光和テクノロジー", owner: "佐藤", status: "契約中", amount: 760000, start: "2026-08-15", active: true, notes: "利用部門の追加を検討中" } },
    { id: "row-5", values: { company: "ふたば商事", owner: "山田", status: "保留", amount: 350000, start: null, active: false, notes: "来期の予算確定後に再提案" } },
    { id: "row-6", values: { company: "白石物流", owner: "鈴木", status: "提案中", amount: 920000, start: "2026-11-01", active: true, notes: "倉庫担当者の確認待ち" } },
    { id: "row-7", values: { company: "丘の上ラボ", owner: "佐藤", status: "新規", amount: 250000, start: null, active: false, notes: "小規模な試行から開始予定" } },
    { id: "row-8", values: { company: "桜井工業", owner: "山田", status: "契約中", amount: 640000, start: "2026-07-01", active: true, notes: "操作研修を実施済み" } },
  ] });
}
export default function DataViewDemo() {
  const [data] = useState(createDemoDataView), [theme] = useState(() => getDemoComponentTheme("system"));
  return <LikeDataView initialData={data} {...theme} onSave={(value: DataViewModel) => parseDataView(serializeDataView(value))} style={{ height: "100dvh", width: "100%" }} />;
}
