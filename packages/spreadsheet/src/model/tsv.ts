import { SPREADSHEET_LIMITS } from "./types";

/** Parse clipboard TSV, including quoted tabs/newlines and doubled quotes. */
export function parseTsv(text: string): string[][] {
  if (typeof text !== "string" || text.length > SPREADSHEET_LIMITS.clipboardCharacters)
    throw new Error("貼り付けるテキストは10 Mi文字以内にしてください");
  const rows: string[][] = [], row: string[] = [];
  let value = "", quoted = false, start = true, cells = 0;
  const push = () => {
    if (++cells > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度に貼り付けられるのは10,000セルまでです");
    row.push(value); value = ""; start = true;
  };
  for (let index = 0; index < text.length; index++) {
    if (value.length > SPREADSHEET_LIMITS.cellLength) throw new Error("1セルは100,000文字以内にしてください");
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && start) { quoted = true; start = false; }
    else if (char === "\t") push();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      push(); rows.push([...row]); row.length = 0;
    } else { value += char; start = false; }
  }
  if (value.length > SPREADSHEET_LIMITS.cellLength) throw new Error("1セルは100,000文字以内にしてください");
  if (quoted) throw new Error("貼り付けるテキストの引用符が閉じられていません");
  if (value || row.length || !rows.length || !/[\r\n]$/.test(text)) { push(); rows.push(row); }
  return rows;
}

export function stringifyTsv(rows: readonly (readonly string[])[]): string {
  let cells = 0, characters = 0;
  if (rows.length > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度にコピーできるのは10,000セルまでです");
  return rows.map(row => {
    characters += 2;
    return row.map(value => {
      if (++cells > SPREADSHEET_LIMITS.clipboardCells) throw new Error("一度にコピーできるのは10,000セルまでです");
      if (typeof value !== "string" || value.length > SPREADSHEET_LIMITS.cellLength) throw new Error("1セルは100,000文字以内にしてください");
      const result = /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
      characters += result.length + 1;
      if (characters > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("コピーするテキストが大きすぎます");
      return result;
    }).join("\t");
  }).join("\r\n");
}
