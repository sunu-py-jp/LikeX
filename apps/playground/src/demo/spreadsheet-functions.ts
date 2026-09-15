import { SUPPORTED_SPREADSHEET_FUNCTIONS, type SpreadsheetCell, type SpreadsheetSheet } from "@likex/spreadsheet";

const heading = { bold: true, background: "#217346", color: "#ffffff" } as const;
const input = { background: "#eef7f0", color: "#24563a" } as const;
const baseExamples = [
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
// The public catalog owns the function list. Examples share editable input cells.
const formulas: Record<string, string> = Object.fromEntries(baseExamples.map(([name, , formula]) => [name, formula]));
Object.assign(formulas, {
  COUNTIF: '=COUNTIF(J5:J8,"果物")', SUMIF: '=SUMIF(J5:J8,"果物",K5:K8)',
  AVERAGEIF: '=AVERAGEIF(J5:J8,"果物",K5:K8)',
  COUNTIFS: '=COUNTIFS(J5:J8,"果物",K5:K8,">=150")',
  SUMIFS: '=SUMIFS(K5:K8,J5:J8,"果物",K5:K8,">=150")',
  AVERAGEIFS: '=AVERAGEIFS(K5:K8,J5:J8,"果物",K5:K8,">=150")',
  COUNTBLANK: '=COUNTBLANK(G4:G7)', PRODUCT: '=PRODUCT(G4:G5)',
  ROUNDUP: '=ROUNDUP(G8,2)', ROUNDDOWN: '=ROUNDDOWN(G8,2)', INT: '=INT(G8)', MOD: '=MOD(G5,3)',
  LEFT: '=LEFT(G7,2)', RIGHT: '=RIGHT(G7,2)', MID: '=MID(G7,2,2)',
  TRIM: '=TRIM("  LikeX   Spreadsheet  ")', UPPER: '=UPPER(G9)', LOWER: '=LOWER(G10)',
  SUBSTITUTE: '=SUBSTITUTE("2026/09/15","/","-")',
  FIND: '=FIND("X","LikeX")', SEARCH: '=SEARCH("like","LikeX")',
  TEXTJOIN: '=TEXTJOIN("・",TRUE,I5:I8)', VALUE: '=VALUE("123.45")',
  IFNA: '=IFNA(MATCH("なし",I5:I8,0),"見つかりません")',
  IFS: '=IFS(G4>=20,"大",G4>=10,"中",TRUE,"小")',
  ISBLANK: '=ISBLANK(G6)', ISNUMBER: '=ISNUMBER(G4)', ISTEXT: '=ISTEXT(G7)', ISERROR: '=ISERROR(1/0)',
  INDEX: '=INDEX(I5:K8,2,3)', MATCH: '=MATCH("にんじん",I5:I8,0)',
  VLOOKUP: '=VLOOKUP("みかん",I5:K8,3,FALSE)', HLOOKUP: '=HLOOKUP("バナナ",M4:O5,2,FALSE)',
  XLOOKUP: '=XLOOKUP("バナナ",I5:I8,K5:K8)',
  DATE: '=DATE(2026,9,15)', YEAR: '=YEAR(DATE(2026,9,15))',
  MONTH: '=MONTH(DATE(2026,9,15))', DAY: '=DAY(DATE(2026,9,15))',
  ROW: '=ROW()', COLUMN: '=COLUMN()', ROWS: '=ROWS(I5:K8)', COLUMNS: '=COLUMNS(I5:K8)',
});

const cells: Record<string, SpreadsheetCell> = {
  A1: { value: "関数サンプル", format: { bold: true } },
  B1: { value: "G列とI〜O列の入力を編集して試せます" },
  A3: { value: "関数", format: heading },
  B3: { value: "用途", format: heading },
  C3: { value: "式の例（文字列）", format: heading },
  D3: { value: "計算結果", format: heading },
  F3: { value: "入力", format: heading },
  G3: { value: "変更可", format: heading },
};
SUPPORTED_SPREADSHEET_FUNCTIONS.forEach(({ name, label, example }, index) => {
  const formula = formulas[name] ?? example;
  const row = index + 4;
  cells[`A${row}`] = { value: name, format: { bold: true } };
  cells[`B${row}`] = { value: label };
  // A leading apostrophe displays the example as text; column D evaluates it.
  cells[`C${row}`] = { value: `'${formula}` };
  cells[`D${row}`] = { value: formula, ...(name === 'DATE' ? { format: { numberFormat: 'date' } } : {}) };
});
[
  ["商品", "区分", "金額"],
  ["りんご", "果物", "100"], ["みかん", "果物", "200"],
  ["にんじん", "野菜", "80"], ["バナナ", "果物", "150"],
].forEach((values, index) => values.forEach((value, column) => {
  cells[`${String.fromCharCode(73 + column)}${index + 4}`] = { value, format: index === 0 ? heading : input };
}));
[["りんご", "みかん", "バナナ"], ["100", "200", "150"]].forEach((values, index) => values.forEach((value, column) => {
  cells[`${String.fromCharCode(77 + column)}${index + 4}`] = { value, format: input };
}));
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
  columnWidths: { 0: 128, 1: 180, 2: 420, 3: 150, 4: 24, 5: 116, 6: 110, 7: 24, 8: 110, 9: 90, 10: 90, 11: 24 },
};
