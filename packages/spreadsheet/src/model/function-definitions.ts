/** Shared by the formula evaluator and the function picker. Examples are editable formulas. */
export const SUPPORTED_SPREADSHEET_FUNCTIONS = Object.freeze([
  { name: "SUM", label: "合計", syntax: "SUM(値1, [値2], …)", example: "=SUM(10,20,30)", description: "数値の合計を求めます。" },
  { name: "AVERAGE", label: "平均", syntax: "AVERAGE(値1, [値2], …)", example: "=AVERAGE(10,20,30)", description: "数値の平均を求めます。空のセルは含めません。" },
  { name: "MIN", label: "最小値", syntax: "MIN(値1, [値2], …)", example: "=MIN(10,20,30)", description: "数値の最小値を求めます。" },
  { name: "MAX", label: "最大値", syntax: "MAX(値1, [値2], …)", example: "=MAX(10,20,30)", description: "数値の最大値を求めます。" },
  { name: "COUNT", label: "数値の個数", syntax: "COUNT(値1, [値2], …)", example: "=COUNT(10,20,30)", description: "数値が入っているセルや引数の個数を数えます。" },
  { name: "COUNTA", label: "空でない値の個数", syntax: "COUNTA(値1, [値2], …)", example: "=COUNTA(10,20,30)", description: "文字や論理値、空文字を返す数式も含めて数えます。" },
  { name: "ROUND", label: "四捨五入", syntax: "ROUND(数値, 桁数)", example: "=ROUND(12.345,2)", description: "指定した桁数に四捨五入します。負の桁数では整数部を丸めます。" },
  { name: "ABS", label: "絶対値", syntax: "ABS(数値)", example: "=ABS(-10)", description: "数値の符号を除いた絶対値を求めます。" },
  { name: "IF", label: "条件分岐", syntax: "IF(条件, 真の場合, [偽の場合])", example: '=IF(10>=5,"達成","未達成")', description: "条件に合う場合と合わない場合で値を切り替えます。" },
  { name: "IFERROR", label: "エラー時の値", syntax: "IFERROR(値, エラー時の値)", example: "=IFERROR(1/0,0)", description: "通常の計算エラーを別の値に置き換えます。計算上限や循環参照は除きます。" },
  { name: "AND", label: "すべての条件", syntax: "AND(条件1, [条件2], …)", example: "=AND(10>=5,20>=10)", description: "すべての条件が真かどうかを調べます。" },
  { name: "OR", label: "いずれかの条件", syntax: "OR(条件1, [条件2], …)", example: "=OR(10>=5,20>=30)", description: "いずれかの条件が真かどうかを調べます。" },
  { name: "NOT", label: "条件の反転", syntax: "NOT(条件)", example: "=NOT(10>=5)", description: "条件の真と偽を反転します。" },
  { name: "LEN", label: "文字数", syntax: "LEN(文字列)", example: "=LEN(12345)", description: "空白を含む文字数を求めます。" },
  { name: "CONCAT", label: "文字列の結合", syntax: "CONCAT(文字列1, [文字列2], …)", example: '=CONCAT("Like","X")', description: "文字列やセル範囲の値を順番に結合します。" },
] as const);

export type SpreadsheetFunctionName = typeof SUPPORTED_SPREADSHEET_FUNCTIONS[number]["name"];
