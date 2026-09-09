import type { SpreadsheetCell, SpreadsheetSheet } from "@likex/spreadsheet";

const heading = { bold: true, background: "#217346", color: "#ffffff" } as const;
const input = { background: "#eef7f0", color: "#24563a" } as const;
const examples = [
  ["SUM", "数値の合計", "=SUM(G4:G6)"],
  ["AVERAGE", "数値の平均", "=AVERAGE(G4:G6)"],
  ["MIN", "最小値", "=MIN(G4:G6)"],
  ["MAX", "最大値", "=MAX(G4:G6)"],
  ["COUNT", "数値のセル数", "=COUNT(G4:G7)"],
  ["COUNTA", "空でないセル数", "=COUNTA(G4:G7)"],
  ["ROUND", "小数第2位まで四捨五入", "=ROUND(G8,2)"],
  ["ABS", "絶対値", "=ABS(G8)"],
  ["IF", "条件で表示を切り替え", '=IF(G4>=10,"達成","未達")'],
  ["IFERROR", "計算エラー時の表示", '=IFERROR(G4/G6,"計算できません")'],
  ["AND", "全ての条件を満たすか", "=AND(G4>0,G5>0)"],
  ["OR", "どれかの条件を満たすか", "=OR(G4>=20,G5>=20)"],
  ["NOT", "条件を反転", "=NOT(G4<0)"],
  ["LEN", "文字数", "=LEN(G7)"],
  ["CONCAT", "文字列を連結", "=CONCAT(G9:G10)"],
] as const;

const cells: Record<string, SpreadsheetCell> = {
  A1: { value: "関数サンプル", format: { bold: true } },
  B1: { value: "G列を編集して試せます" },
  A3: { value: "関数", format: heading },
  B3: { value: "用途", format: heading },
  C3: { value: "式の例（文字列）", format: heading },
  D3: { value: "計算結果", format: heading },
  F3: { value: "入力", format: heading },
  G3: { value: "変更可", format: heading },
};
examples.forEach(([name, purpose, formula], index) => {
  const row = index + 4;
  cells[`A${row}`] = { value: name, format: { bold: true } };
  cells[`B${row}`] = { value: purpose };
  // A leading apostrophe displays the example as text; column D evaluates it.
  cells[`C${row}`] = { value: `'${formula}` };
  cells[`D${row}`] = { value: formula };
});
[
  ["数値1", "10"], ["数値2", "20"], ["空白", ""], ["文字", "テキスト"],
  ["丸める数値", "-12.345"], ["文字列の前半", "Like"], ["文字列の後半", "X"],
].forEach(([label, value], index) => {
  const row = index + 4;
  cells[`F${row}`] = { value: label };
  cells[`G${row}`] = { value, format: input };
});

export const functionDemoSheet: SpreadsheetSheet = {
  id: "functions", name: "関数サンプル", rowCount: 100, columnCount: 26, cells,
  columnWidths: { 0: 100, 1: 180, 2: 294, 3: 124, 4: 24, 5: 116, 6: 100 },
};
