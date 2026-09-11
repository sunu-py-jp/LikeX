import { createWorkbook, type SpreadsheetCell, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import { insertionDemoImage, insertionDemoSheet } from "./spreadsheet-insertions";
import { functionDemoSheet } from "./spreadsheet-functions";
import { mergeDemoSheet } from "./spreadsheet-merges";
import { withExportSamples } from "./spreadsheet-export-samples";
import { withEditingSamples } from "./spreadsheet-editing-samples";

/** A fictional, memory-only workbook for exercising the spreadsheet UI. */
export function createDemoWorkbook(): SpreadsheetWorkbook {
  const cells: Record<string, SpreadsheetCell> = {};
  const heading = { bold: true, background: "#217346", color: "#ffffff" } as const;
  const currency = { numberFormat: "currency" } as const;
  const percent = { numberFormat: "percent" } as const;
  const total = { bold: true, background: "#e2efda", color: "#1d442d" } as const;
  cells.A1 = { value: "2026年 下期 売上計画", format: { bold: true } };
  ["サービス", "数量", "単価", "売上", "原価", "粗利", "粗利率", "担当", "状況"].forEach((value, column) => {
    cells[`${String.fromCharCode(65 + column)}3`] = { value, format: heading };
  });
  const projects = [
    ["サイト制作", 4, 180000, 320000, "佐藤", "進行中"],
    ["アプリ開発", 2, 420000, 480000, "鈴木", "進行中"],
    ["デザイン", 8, 65000, 240000, "高橋", "確定"],
    ["保守・運用", 12, 32000, 144000, "田中", "確定"],
    ["調査・分析", 3, 95000, 114000, "伊藤", "見積中"],
    ["コンテンツ制作", 10, 28000, 120000, "渡辺", "確定"],
  ] as const;
  projects.forEach(([name, quantity, price, cost, owner, status], index) => {
    const row = index + 4;
    const values = [name, String(quantity), String(price), `=B${row}*C${row}`, String(cost),
      `=D${row}-E${row}`, `=IF(D${row}=0,0,F${row}/D${row})`, owner, status];
    values.forEach((value, column) => {
      cells[`${String.fromCharCode(65 + column)}${row}`] = {
        value,
        ...(column >= 2 && column <= 5 ? { format: currency } : column === 6 ? { format: percent } : {}),
      };
    });
  });
  cells.A11 = { value: "合計", format: total };
  for (const column of ["B", "D", "E", "F"]) cells[`${column}11`] = {
    value: `=SUM(${column}4:${column}9)`, format: { ...total, ...(column !== "B" ? currency : {}) },
  };
  cells.G11 = { value: "=IF(D11=0,0,F11/D11)", format: { ...total, ...percent } };
  cells.A14 = { value: "売上目標", format: { bold: true } };
  cells.B14 = { value: "3000000", format: currency };
  cells.D14 = { value: "達成率", format: { bold: true } };
  cells.E14 = { value: "=D11/B14", format: percent };
  cells.A16 = { value: "共通経費", format: { bold: true } };
  cells.B16 = { value: "='経費'!C8", format: currency };
  cells.D16 = { value: "営業利益", format: { bold: true } };
  cells.E16 = { value: "=F11-B16", format: currency };
  const workbook = withEditingSamples(withExportSamples({ schemaVersion: 1, resources: { images: { "demo-bars": insertionDemoImage } }, sheets: [
    { id: "sales-plan", name: "売上計画", rowCount: 500, columnCount: 26, cells,
      columnWidths: { 0: 186, 1: 88, 2: 116, 3: 124, 4: 120, 5: 124, 6: 98, 7: 90, 8: 106 } },
    { id: "expenses", name: "経費", rowCount: 100, columnCount: 26, columnWidths: { 0: 180, 1: 110, 2: 130 }, cells: {
      A1: { value: "月次経費", format: { bold: true } },
      A3: { value: "項目", format: heading }, B3: { value: "月数", format: heading }, C3: { value: "金額", format: heading },
      A4: { value: "クラウド利用料" }, B4: { value: "6" }, C4: { value: "=B4*18000", format: currency },
      A5: { value: "ソフトウェア" }, B5: { value: "6" }, C5: { value: "=B5*9000", format: currency },
      A6: { value: "通信費" }, B6: { value: "6" }, C6: { value: "=B6*4500", format: currency },
      A8: { value: "合計", format: total }, C8: { value: "=SUM(C4:C6)", format: { ...total, ...currency } },
    } },
    insertionDemoSheet,
    functionDemoSheet,
    mergeDemoSheet,
  ] }));
  const defaults = createWorkbook().sheets[0];
  return { ...workbook, sheets: workbook.sheets.map(sheet => ({ ...sheet,
    rowCount: Math.max(sheet.rowCount, defaults.rowCount),
    columnCount: Math.max(sheet.columnCount, defaults.columnCount),
  })) };
}
