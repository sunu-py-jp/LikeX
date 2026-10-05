import { useState } from "react";
import Spreadsheet, { createWorkbook, type SpreadsheetCell, type SpreadsheetRibbonDisplayMode } from "@likex/spreadsheet";
import "../../../packages/spreadsheet/src/styles.css";
import "./demo/spreadsheet-ribbon-demo.css";

const modes: ReadonlyArray<{ value: SpreadsheetRibbonDisplayMode; label: string; description: string }> = [
  { value: "expanded", label: "常に表示", description: "タブと操作ボタンを常に表示します。" },
  { value: "tabs", label: "タブのみ表示", description: "タブを押すと操作ボタンを一時表示します。セルを選ぶと閉じます。" },
  { value: "autoHide", label: "自動非表示", description: "リボンを隠し、上部の再表示ボタンから一時的に開きます。" },
  { value: "hidden", label: "完全に非表示", description: "タブも再表示ボタンも隠します。この画面上部の設定から元に戻せます。" },
];

function initialMode(): SpreadsheetRibbonDisplayMode {
  const requested = new URLSearchParams(window.location.search).get("ribbon");
  return modes.find(mode => mode.value === requested)?.value ?? "expanded";
}

function createRibbonWorkbook() {
  const workbook = createWorkbook(), sheet = workbook.sheets[0];
  const cells: Record<string, SpreadsheetCell> = {
    B2: { value: "四半期の売上プラン", format: { bold: true, fontSize: 24, color: "#205844" } },
    B3: { value: "表示を切り替えて、作業スペースの広さを比較できます。", format: { color: "#65776d" } },
  };
  ["サービス", "4月", "5月", "6月", "四半期合計"].forEach((value, index) => {
    cells[`${String.fromCharCode(66 + index)}5`] = { value, format: { bold: true, color: "#ffffff", background: "#28644d" } };
  });
  const rows = [["導入支援", "640000", "720000", "810000"], ["定額プラン", "380000", "420000", "450000"], ["保守サポート", "160000", "160000", "180000"]];
  rows.forEach((values, index) => {
    const row = index + 6, background = index % 2 === 0 ? "#f0f6f2" : "#ffffff";
    values.forEach((value, column) => { cells[`${String.fromCharCode(66 + column)}${row}`] = { value, format: { background, ...(column ? { numberFormat: "currency" as const } : {}) } }; });
    cells[`F${row}`] = { value: `=SUM(C${row}:E${row})`, format: { background, bold: true, numberFormat: "currency" } };
  });
  cells.B10 = { value: "合計", format: { bold: true, background: "#e1eee6" } };
  for (const column of ["C", "D", "E", "F"]) cells[`${column}10`] = { value: `=SUM(${column}6:${column}8)`, format: { bold: true, background: "#e1eee6", numberFormat: "currency" } };
  return { ...workbook, sheets: [{ ...sheet, name: "売上プラン", cells, columnWidths: { 0: 32, 1: 190, 2: 150, 3: 150, 4: 150, 5: 175 }, rowHeights: { 0: 18, 1: 44, 2: 32, 3: 18, 4: 34, 5: 38, 6: 38, 7: 38, 8: 18, 9: 38 } }] };
}

export default function SpreadsheetRibbonDemo() {
  const [workbook] = useState(createRibbonWorkbook), [mode, setMode] = useState(initialMode);
  return <main className="ribbon-demo">
    <header className="ribbon-demo-header">
      <div><p className="ribbon-demo-eyebrow">Spreadsheet</p><h1>リボンの表示</h1></div>
      <nav aria-label="スプレッドシートのデモ"><a href="/spreadsheet">標準デモ</a><a href="/spreadsheet/ribbon?ribbon=hidden">完全非表示で開く</a></nav>
    </header>
    <section className="ribbon-demo-controls" aria-label="アプリ側の表示設定">
      <label>リボンの表示方法<select value={mode} onChange={event => {
        const selected = modes.find(item => item.value === event.target.value);
        if (selected) setMode(selected.value);
      }}>{modes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <p role="status">{modes.find(item => item.value === mode)?.description}</p>
      {mode !== "hidden" && <span className="ribbon-demo-shortcut">折りたたみ切替：Ctrl + F1</span>}
    </section>
    <div className="ribbon-demo-sheet">
      <Spreadsheet title="売上プラン" initialWorkbook={workbook} colorMode="light" onSave={value => value}
        ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode}
        style={{ height: "100%", width: "100%" }} aria-label="リボン表示のサンプルスプレッドシート" />
    </div>
  </main>;
}
