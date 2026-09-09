import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetSheet, SpreadsheetWorkbook } from "@likex/spreadsheet";

const line = { style: "solid", width: 1, color: "#c8d9cf" } as const;
const grid = { top: line, right: line, bottom: line, left: line };
const heading: SpreadsheetCellFormat = { bold: true, color: "#ffffff", background: "#217346", verticalAlign: "middle", borders: grid };
const numeric: SpreadsheetCellFormat = { numberFormat: "number", decimalPlaces: 0, useGrouping: true, borders: grid };

function formattingAndInput(): SpreadsheetSheet {
  const cells: Record<string, SpreadsheetCell> = {
    A1: { value: "書式・入力規則のサンプル", format: { fontSize: 22, bold: true, color: "#217346", verticalAlign: "middle" } },
    A2: { value: "ホームで書式を変更／データで入力規則を設定。完了欄をクリック、状態欄でプルダウンを試せます。", format: { wrap: true, color: "#526359", verticalAlign: "middle" } },
    A12: { value: "表示形式を比較", format: { bold: true, fontSize: 16, color: "#217346" } },
    A13: { value: "負数・赤い括弧", format: { bold: true } },
    B13: { value: "-1234567.89", format: { numberFormat: "number", useGrouping: true, decimalPlaces: 2, negativeFormat: "red-parentheses" } },
    D13: { value: "日時", format: { bold: true } },
    E13: { value: "2026-09-10T14:30:00", format: { numberFormat: "datetime" } },
    A14: { value: "フォントとサイズ", format: { bold: true } },
    B14: { value: "LikeX 2026", format: { fontFamily: "Georgia", fontSize: 20, italic: true } },
    D14: { value: "時刻", format: { bold: true } },
    E14: { value: "09:45:30", format: { numberFormat: "time" } },
    A16: { value: "上寄せ\n複数行の文章", format: { wrap: true, verticalAlign: "top", borders: grid } },
    B16: { value: "中央\n複数行の文章", format: { wrap: true, verticalAlign: "middle", align: "center", borders: grid } },
    C16: { value: "下寄せ\n複数行の文章", format: { wrap: true, verticalAlign: "bottom", align: "right", borders: grid } },
    E16: { value: "二重線・点線", format: { borders: { bottom: { style: "double", width: 3, color: "#217346" }, top: { style: "dotted", width: 1, color: "#217346" } } } },
    A19: { value: "入力規則：数量は0〜100の整数、状態は選択肢、メモは40文字以内。無効な値を入力すると元の値を保持します。", format: { wrap: true, color: "#526359" } },
  };
  ["取引日", "案件", "数量", "単価", "進捗", "状態", "完了", "メモ"].forEach((value, column) => {
    cells[`${String.fromCharCode(65 + column)}4`] = { value, format: heading };
  });
  const statuses = ["未着手", "進行中", "確認中", "完了"];
  const names = ["ウェブサイト制作", "売上レポート", "利用ガイド", "画面デザイン", "動作確認"];
  names.forEach((name, index) => {
    const row = index + 5;
    cells[`A${row}`] = { value: `2026-09-${String(10 + index).padStart(2, "0")}`, format: { numberFormat: "date", borders: grid }, validation: { type: "date", min: "2026-01-01", max: "2026-12-31" } };
    cells[`B${row}`] = { value: name, format: { borders: grid } };
    cells[`C${row}`] = { value: String((index + 1) * 3), format: numeric, validation: { type: "number", integer: true, min: 0, max: 100 } };
    cells[`D${row}`] = { value: String(12500 + index * 2500), format: { ...numeric, numberFormat: "currency" } };
    cells[`E${row}`] = { value: String(index / 4), format: { numberFormat: "percent", decimalPlaces: 0, borders: grid } };
    cells[`F${row}`] = { value: statuses[Math.min(index, 3)], format: { borders: grid }, validation: { type: "list", values: statuses } };
    cells[`G${row}`] = { value: index >= 3 ? "TRUE" : "FALSE", format: { borders: grid }, validation: { type: "checkbox" } };
    cells[`H${row}`] = { value: index === 0 ? "長めの文章も\n折り返して表示できます" : "ダブルクリックで編集", format: { wrap: true, verticalAlign: "middle", borders: grid }, validation: { type: "textLength", max: 40 } };
  });
  return { id: "formatting-and-input", name: "書式と入力", cells, rowCount: 80, columnCount: 16,
    columnWidths: { 0: 160, 1: 180, 2: 100, 3: 130, 4: 155, 5: 130, 6: 65, 7: 220 },
    rowHeights: { 0: 52, 1: 48, 3: 34, 4: 58, 5: 42, 6: 42, 7: 42, 8: 42, 13: 42, 15: 82, 18: 54 },
    merges: [{ top: 0, left: 0, bottom: 0, right: 7 }, { top: 1, left: 0, bottom: 1, right: 7 }, { top: 18, left: 0, bottom: 18, right: 7 }],
    conditionalFormats: [
      { id: "progress-bar", type: "dataBar", ranges: [{ top: 4, left: 4, bottom: 8, right: 4 }], color: "#63ba8b", min: 0, max: 1 },
      { id: "completed-label", type: "text", ranges: [{ top: 4, left: 5, bottom: 8, right: 5 }], operator: "contains", value: "完了", format: { background: "#e2f4e9", color: "#185d37", bold: true } },
    ] };
}

function conditionalFormatting(): SpreadsheetSheet {
  const cells: Record<string, SpreadsheetCell> = {
    A1: { value: "条件付き書式", format: { fontSize: 22, bold: true, color: "#217346" } },
    A2: { value: "数値を変更すると色やバーが追従します。ホームの「条件付き書式」からルールを変更できます。", format: { wrap: true } },
  };
  ["担当", "スコア／比較", "データバー", "2色スケール", "3色スケール"].forEach((value, column) => {
    cells[`${String.fromCharCode(65 + column)}4`] = { value, format: heading };
  });
  [12, 28, 43, 50, 66, 81, 95].forEach((score, index) => {
    const row = index + 5;
    cells[`A${row}`] = { value: `チーム ${index + 1}`, format: { borders: grid } };
    for (const column of ["B", "C", "D", "E"]) cells[`${column}${row}`] = { value: String(score), format: numeric };
  });
  const range = (column: number) => [{ top: 4, left: column, bottom: 10, right: column }];
  return { id: "conditional-formatting", name: "条件付き書式", cells, rowCount: 60, columnCount: 12,
    columnWidths: { 0: 170, 1: 170, 2: 170, 3: 170, 4: 170 }, rowHeights: { 0: 44, 1: 44 },
    merges: [{ top: 0, left: 0, bottom: 0, right: 4 }, { top: 1, left: 0, bottom: 1, right: 4 }],
    conditionalFormats: [
      { id: "high-scores", type: "comparison", ranges: range(1), operator: "gte", value: 80, format: { background: "#ddf0e2", color: "#17652e", bold: true } },
      { id: "low-scores", type: "comparison", ranges: range(1), operator: "lt", value: 30, format: { background: "#fde3e3", color: "#a61b1b" } },
      { id: "score-bars", type: "dataBar", ranges: range(2), color: "#619dd9", min: 0, max: 100 },
      { id: "two-colors", type: "colorScale", ranges: range(3), colors: ["#f8efbc", "#67bca0"] },
      { id: "three-colors", type: "colorScale", ranges: range(4), colors: ["#f8b8ad", "#fff3bb", "#a7d9b6"] },
    ] };
}

function editingPractice(): SpreadsheetSheet {
  return { id: "editing-practice", name: "編集の練習", rowCount: 100, columnCount: 20,
    columnWidths: { 0: 220, 1: 160, 2: 160, 3: 180, 4: 180 }, rowHeights: { 0: 44, 1: 60 },
    merges: [{ top: 0, left: 0, bottom: 0, right: 4 }, { top: 1, left: 0, bottom: 1, right: 4 }],
    cells: {
      A1: { value: "検索・置換・貼り付け・オートフィル", format: { fontSize: 20, bold: true, color: "#217346" } },
      A2: { value: "B5:B6を選択して右下のハンドルを下へドラッグ。D5の数式もドラッグでコピーできます。Ctrl/Cmd+Fで検索、Ctrl/Cmd+Hで置換。", format: { wrap: true } },
      A4: { value: "検索・置換用", format: heading }, B4: { value: "連番", format: heading }, C4: { value: "固定値", format: heading }, D4: { value: "数式", format: heading }, E4: { value: "日付", format: heading },
      A5: { value: "サンプル 東京" }, A6: { value: "サンプル 大阪" }, A7: { value: "サンプル 福岡" },
      B5: { value: "1" }, B6: { value: "2" }, C5: { value: "100" }, D5: { value: "=B5*$C$5", format: numeric },
      E5: { value: "2026-09-10", format: { numberFormat: "date" } },
      A12: { value: "形式を選択して貼り付け", format: { bold: true, color: "#217346" } },
      A13: { value: "D5をコピー後、別セルで「値のみ」「数式のみ」「書式のみ」を選択して違いを確認できます。", format: { wrap: true } },
      A16: { value: "シートの複製", format: { bold: true, color: "#217346" } },
      A17: { value: "このタブを右クリックして「複製」。値・数式・書式・入力規則をまとめてコピーします。", format: { wrap: true } },
    } };
}

/** Extend the same memory-only demo with editable examples for the supported tools. */
export function withEditingSamples(workbook: SpreadsheetWorkbook): SpreadsheetWorkbook {
  return { ...workbook, sheets: [formattingAndInput(), conditionalFormatting(), editingPractice(), ...workbook.sheets] };
}
