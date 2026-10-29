import { useRef, useState } from "react";
import Spreadsheet, { createWorkbook, type SpreadsheetCell, type SpreadsheetHandle, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import { applySpreadsheetCommands } from "@likex/spreadsheet/model";
import "../../../packages/spreadsheet/src/styles.css";
import "./demo/spreadsheet-ribbon-demo.css";

function createPrintWorkbook(): SpreadsheetWorkbook {
  const initial = createWorkbook(), source = initial.sheets[0], cells: Record<string, SpreadsheetCell> = {
    B2: { value: "月次レポート", format: { bold: true, fontSize: 24, color: "#205844" } },
    B3: { value: "青い枠をドラッグして印刷範囲を調整できます。", format: { color: "#65776d" } },
  };
  ["項目", "担当", "予定", "実績", "差分", "備考"].forEach((value, index) => {
    cells[`${String.fromCharCode(66 + index)}5`] = { value, format: { bold: true, color: "#ffffff", background: "#28644d" } };
  });
  for (let row = 6; row <= 36; row++) {
    const values = [`案件 ${row - 5}`, row % 2 ? "高橋" : "田中", String(row * 120), String(row * 130), `=E${row}-D${row}`, "確認済み"];
    values.forEach((value, column) => { cells[`${String.fromCharCode(66 + column)}${row}`] = { value, format: { background: row % 2 ? "#ffffff" : "#f0f6f2" } }; });
  }
  const workbook = { ...initial, sheets: [{ ...source, name: "印刷範囲", rowCount: 80, columnCount: 16, cells,
    columnWidths: { 0: 32, 1: 160, 2: 95, 3: 95, 4: 95, 5: 95, 6: 115 },
    rowHeights: { 0: 20, 1: 38, 2: 30 } }] };
  const sheetId = source.id;
  const result = applySpreadsheetCommands(workbook, [
    { type: "print.setArea", sheetId, range: { top: 1, left: 1, bottom: 35, right: 6 } },
    { type: "print.setLayout", sheetId, orientation: "landscape" },
    { type: "print.setBreaks", sheetId, rows: [20] },
    { type: "shapes.insert", sheetId, shape: "roundedRectangle", anchor: { row: 2, column: 9 }, width: 220, height: 100,
      text: "図形30°・文字30°", rotation: 30, textRotation: 30, fill: "#e1eee6" },
    { type: "shapes.insert", sheetId, shape: "rectangle", anchor: { row: 10, column: 9 }, width: 220, height: 100,
      text: "図形30°・文字は正立", rotation: 30, textUpright: true, fill: "#e9eff8" },
  ]);
  if (!result.ok) throw new Error(result.message);
  return result.workbook;
}

export default function SpreadsheetPrintDemo() {
  const [workbook] = useState(createPrintWorkbook), [readOnly, setReadOnly] = useState(false);
  const ref = useRef<SpreadsheetHandle>(null);
  return <main className="ribbon-demo">
    <header className="ribbon-demo-header"><div><p className="ribbon-demo-eyebrow">Spreadsheet</p><h1>印刷範囲と文字の回転</h1></div>
      <nav aria-label="スプレッドシートのデモ"><a href="/spreadsheet">標準デモ</a></nav></header>
    <section className="ribbon-demo-controls" aria-label="表示の確認">
      <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />閲覧専用</label>
      <button type="button" onClick={() => ref.current?.setPrintAreaView(true)}>印刷範囲を表示</button>
      <button type="button" onClick={() => ref.current?.setPrintAreaView(false)}>通常表示</button>
      <p>「ページ レイアウト」で範囲・用紙・改ページを変更できます。右側の図形は文字の回転例です。</p>
    </section>
    <div className="ribbon-demo-sheet"><Spreadsheet ref={ref} title="月次レポート" initialWorkbook={workbook}
      initialPrintAreaView readOnly={readOnly} onSave={value => value} colorMode="light"
      style={{ height: "100%", width: "100%" }} /></div>
  </main>;
}
