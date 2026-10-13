import { useState } from "react";
import Spreadsheet, { createWorkbook, type SpreadsheetCell, type SpreadsheetRenderingMode, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import "./demo/spreadsheet-ribbon-demo.css";

function createRenderingWorkbook(): SpreadsheetWorkbook {
  const book = createWorkbook(), source = book.sheets[0], cells: Record<string, SpreadsheetCell> = {};
  ["No.", "案件", "担当", "数量", "単価", "金額"].forEach((value, index) => {
    cells[`${String.fromCharCode(65 + index)}1`] = { value, format: { background: "#28644d", color: "#fff", bold: true } };
  });
  for (let row = 2; row <= 600; row++) {
    const values = [String(row - 1), `案件 ${String(row - 1).padStart(3, "0")}`, ["営業部", "企画部", "開発部"][row % 3], String(row % 12 + 1), "2500", `=D${row}*E${row}`];
    values.forEach((value, index) => { cells[`${String.fromCharCode(65 + index)}${row}`] = { value,
      format: { background: row % 2 ? "#f1f6f3" : "#fff", ...(index >= 4 ? { numberFormat: "currency" as const } : {}) } }; });
  }
  return { ...book, sheets: [{ ...source, name: "案件一覧", rowCount: 600, columnCount: 10, cells,
    columnWidths: { 0: 70, 1: 170, 2: 130, 3: 90, 4: 110, 5: 120 },
    drawings: [40, 300, 570].map(row => ({ id: `note-${row}`, type: "shape" as const, shape: "roundedRectangle" as const,
      anchor: { row, column: 6, offsetX: 0, offsetY: 0 }, width: 230, height: 85, fill: "#e8f3ec", stroke: "#217346", strokeWidth: 2,
      text: `${row + 1}行目の確認メモ`, cornerRadiusRatio: .15 })) },
    { ...source, id: "other", name: "別シート", rowCount: 50, columnCount: 10, cells: { A1: { value: "開いているシートが描画対象です。" } } }] };
}

export default function SpreadsheetRenderingDemo() {
  const [workbook] = useState(createRenderingWorkbook);
  const [mode, setMode] = useState<SpreadsheetRenderingMode>(() => new URLSearchParams(window.location.search).get("renderingMode") === "viewport" ? "viewport" : "progressive");
  return <main className="ribbon-demo">
    <header className="ribbon-demo-header"><div><p className="ribbon-demo-eyebrow">Spreadsheet</p><h1>シートの読み込み</h1></div>
      <nav aria-label="スプレッドシートのデモ"><a href="/spreadsheet">標準デモ</a></nav></header>
    <section className="ribbon-demo-controls" aria-label="アプリ側の表示設定">
      <label>表示モード<select value={mode} onChange={event => setMode(event.target.value as SpreadsheetRenderingMode)}>
        <option value="progressive">通常：シート全体を順次描画</option><option value="viewport">省エネ：表示範囲のみ</option>
      </select></label>
      <p role="status">{mode === "progressive" ? "最初の画面を表示した後、同じシートの残りの行も順次準備します。" : "表示範囲とその周辺だけを描画し、メモリ使用量を抑えます。"}</p>
    </section>
    <div className="ribbon-demo-sheet"><Spreadsheet title="案件一覧・600行" initialWorkbook={workbook} renderingMode={mode}
      colorMode="light" onSave={value => value} initialRibbonDisplayMode="tabs" style={{ height: "100%", width: "100%" }} /></div>
  </main>;
}
