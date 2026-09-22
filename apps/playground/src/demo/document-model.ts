import { createDocument, type DocumentBlock, type DocumentMark, type DocumentTableCellNode } from "@likex/document";
const text = (value: string, marks?: DocumentMark[]) => ({ type: "text" as const, text: value, ...(marks ? { marks } : {}) });
const paragraph = (value: string): DocumentBlock => ({ type: "paragraph", content: [text(value)] });
const heading = (value: string, level = 1): DocumentBlock => ({ type: "heading", attrs: { level }, content: [text(value)] });
const cell = (value: string, header = false): DocumentTableCellNode => ({ type: header ? "table_header" : "table_cell", content: [paragraph(value)] });

export function createDemoDocument() {
  return createDocument({ title: "新しい働き方 — プロジェクト提案書", content: { type: "doc", content: [
    { type: "paragraph", content: [text("PROJECT PROPOSAL  /  2026", [{ type: "text_style", attrs: { color: "#6e7c91", fontSize: 9 } }])] },
    heading("新しい働き方を、\nチームの当たり前に。"),
    { type: "paragraph", content: [text("ワークスペース改善プロジェクト", [{ type: "text_style", attrs: { fontSize: 14, color: "#57677e" } }])] },
    paragraph("企画推進チーム  ｜  2026年9月22日"),
    heading("1. この提案について", 2),
    { type: "paragraph", content: [text("必要な情報が、必要な人に届く。" , [{ type: "strong" }]), text("そのために、資料の整理から日々の情報共有までを見直します。チームの小さな工夫を仕組みに変え、仕事に集中できる環境をつくります。")] },
    heading("2. 今回取り組むこと", 2),
    { type: "bullet_list", content: ["資料を探す時間を減らし、最新の情報へすぐにアクセスする", "会議の決定事項と担当者を明確にし、次の行動につなげる", "現場からのフィードバックを集め、小さく改善を続ける"].map(value => ({ type: "list_item", content: [paragraph(value)] })) },
    heading("3. 進め方とスケジュール", 2),
    { type: "table", content: [
      { type: "table_row", content: [cell("フェーズ", true), cell("実施内容", true), cell("時期", true)] },
      { type: "table_row", content: [cell("ヒアリング"), cell("課題と利用シーンの整理"), cell("10月上旬")] },
      { type: "table_row", content: [cell("試験導入"), cell("小さなチームで運用を開始"), cell("10月下旬")] },
      { type: "table_row", content: [cell("振り返り"), cell("効果の確認と次の改善"), cell("11月中旬")] },
    ] },
    { type: "paragraph", content: [text("次のアクション：", [{ type: "strong" }]), text("各チームで、日々の作業で困っていることを3つ挙げてください。", [{ type: "text_style", attrs: { backgroundColor: "#fff2cc" } }])] },
  ] } });
}
