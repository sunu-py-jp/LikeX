import { SPREADSHEET_SHAPES, type SpreadsheetCell, type SpreadsheetMergedRange, type SpreadsheetShapeDrawing, type SpreadsheetSheet } from "@likex/spreadsheet";

const cells: Record<string, SpreadsheetCell> = {
  A1: { value: "図形一覧", format: { bold: true, fontSize: 20 } },
  A2: { value: "ダブルクリックで文字を編集。四隅でサイズ変更・反転、上のハンドルで回転できます。" },
};
const merges: SpreadsheetMergedRange[] = [{ top: 1, left: 0, bottom: 1, right: 11 }];
const drawings: SpreadsheetShapeDrawing[] = SPREADSHEET_SHAPES.map(({ kind, label }, index) => {
  const row = 4 + Math.floor(index / 4) * 7, column = (index % 4) * 3;
  const letter = String.fromCharCode(65 + column);
  cells[`${letter}${row}`] = { value: label, format: { bold: true, color: "#24563a" } };
  cells[`${letter}${row + 6}`] = { value: kind, format: { color: "#64748b", fontSize: 11 } };
  for (const top of [row - 1, row + 5]) merges.push({ top, bottom: top, left: column, right: column + 2 });
  return { id: `shape-sample-${kind}`, type: "shape", shape: kind,
    anchor: { row, column, offsetX: 8, offsetY: 4 }, width: 170, height: 115,
    fill: "#e8f3ec", stroke: "#217346", strokeWidth: 2,
    text: kind === "line" || kind === "arrow" ? "" : "サンプル", fontSize: 14, color: "#24563a" };
});

/** The same public shape catalog drives insertion, rendering, validation and the sample workbook. */
export const shapeDemoSheet: SpreadsheetSheet = {
  id: "shape-catalog", name: "図形一覧", rowCount: 300, columnCount: 26, cells, drawings,
  columnWidths: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index, 70])),
  merges,
};
