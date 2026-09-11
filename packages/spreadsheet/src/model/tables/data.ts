import type { SpreadsheetTableData } from "../../api/table-commands";
import { SPREADSHEET_LIMITS } from "../types";
import { validateCellValue } from "../workbook/validation";

/** Parse delimited detail rows, preserving quoted separators/newlines and doubled quotes. */
export function parseTableDelimitedText(text: string, delimiter: "," | "\t"): string[][] {
  if (typeof text !== "string" || text.length > SPREADSHEET_LIMITS.clipboardCharacters)
    throw new Error("表のテキストは10 Mi文字以内で指定してください");
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (!text) return [];
  const rows: string[][] = [], row: string[] = [];
  let value = "", quoted = false, closed = false, started = false, count = 0;
  const push = () => {
    if (++count > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度に書き込める表は10,000セルまでです");
    row.push(validateCellValue(value)); value = ""; started = false; closed = false;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else value += character;
    } else if (character === delimiter) push();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      push(); rows.push([...row]); row.length = 0;
    } else if (character === '"' && !started && !closed) { quoted = true; started = true; }
    else {
      if (closed || character === '"') throw new Error("表のテキストの引用符が正しくありません");
      value += character; started = true;
    }
    if (value.length > SPREADSHEET_LIMITS.cellLength) throw new Error("1セルは100,000文字以内で指定してください");
  }
  if (quoted) throw new Error("表のテキストの引用符が閉じられていません");
  if (started || closed || row.length || !/[\r\n]$/.test(text)) { push(); rows.push(row); }
  return rows;
}

export function tableDataRows(data: SpreadsheetTableData, width: number): readonly (readonly string[])[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("表の明細データを指定してください");
  let rows: readonly (readonly string[])[];
  if (data.type === "rows") rows = data.values;
  else if (data.type === "csv" || data.type === "tsv") rows = parseTableDelimitedText(data.text, data.type === "csv" ? "," : "\t");
  else throw new Error("表のデータ形式はrows、csv、tsvで指定してください");
  if (!Array.isArray(rows) || rows.length > SPREADSHEET_LIMITS.clipboardCells || rows.length * width > SPREADSHEET_LIMITS.clipboardCells)
    throw new Error("表の明細は10,000セル以内の二次元配列で指定してください");
  let characters = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width) throw new Error("明細の各行の列数をヘッダの数と一致させてください");
    for (const value of row) { validateCellValue(value); characters += value.length; }
  }
  if (characters > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("表の明細は10 Mi文字以内で指定してください");
  return rows;
}

/** Labels are text, including numeric-looking names and a leading equals sign. */
export function tableHeaderCellValue(label: string): string {
  return /^[=']/.test(label) || /^(true|false)$/i.test(label) || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(label.trim())
    ? `'${label}` : label;
}
