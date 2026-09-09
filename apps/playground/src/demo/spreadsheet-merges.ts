import type { SpreadsheetSheet } from "@likex/spreadsheet";

const heading = { bold: true, background: "#217346", color: "#ffffff", align: "center" } as const;
const amount = { numberFormat: "currency" } as const;

/** Includes horizontal, vertical, and rectangular merges without hidden content. */
export const mergeDemoSheet: SpreadsheetSheet = {
  id: "merge-samples", name: "結合サンプル", rowCount: 80, columnCount: 12,
  columnWidths: { 0: 118, 1: 100, 2: 100, 3: 100, 4: 105, 5: 105 },
  rowHeights: { 0: 32, 1: 32 },
  merges: [
    { top: 0, left: 0, bottom: 1, right: 5 },
    { top: 3, left: 1, bottom: 3, right: 3 },
    { top: 3, left: 4, bottom: 3, right: 5 },
    { top: 4, left: 0, bottom: 6, right: 0 },
    { top: 4, left: 1, bottom: 4, right: 3 },
    { top: 4, left: 4, bottom: 4, right: 5 },
    { top: 5, left: 1, bottom: 5, right: 3 },
    { top: 5, left: 4, bottom: 5, right: 5 },
    { top: 6, left: 1, bottom: 6, right: 3 },
    { top: 6, left: 4, bottom: 6, right: 5 },
    { top: 9, left: 0, bottom: 9, right: 5 },
    { top: 15, left: 0, bottom: 16, right: 5 },
  ],
  cells: {
    A1: { value: "セルの結合サンプル", format: { bold: true, align: "center", background: "#e8f3ec", color: "#1d442d" } },
    A4: { value: "区分", format: heading }, B4: { value: "項目", format: heading }, E4: { value: "金額", format: heading },
    A5: { value: "月次計画", format: { align: "center", background: "#f1f5f3", color: "#252a29" } },
    B5: { value: "売上" }, E5: { value: "=1200*10", format: amount },
    B6: { value: "原価" }, E6: { value: "4800", format: amount },
    B7: { value: "粗利", format: { bold: true } }, E7: { value: "=E5-E6", format: { ...amount, bold: true } },
    A10: { value: "A12:C13を選択して「セルを結合」を試せます。", format: { bold: true } },
    A12: { value: "左上に残す値" }, B12: { value: "確認対象の値" },
    A16: { value: "結合セルはクリックで全体を選択。矢印キーは結合の外へ移動します。", format: { background: "#f1f5f3", color: "#252a29" } },
  },
};
