export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLUMNS = 50;
export const MAX_TABLE_CELLS = 10_000;
export const MAX_TABLE_CELL_CHARACTERS = 2_000;

/** Parse only the bounded table that can be displayed, preserving quoted CSV fields. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cells = 0;
  let lineHasContent = false;
  function append(value: string) {
    if (row.length < MAX_TABLE_COLUMNS && cell.length < MAX_TABLE_CELL_CHARACTERS)
      cell += value;
  }
  function finishCell() {
    if (row.length < MAX_TABLE_COLUMNS && cells < MAX_TABLE_CELLS) { row.push(cell); cells++; }
    cell = "";
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      lineHasContent = true;
      if (quoted && text[index + 1] === '"') { append('"'); index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      lineHasContent = true;
      finishCell();
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      finishCell();
      rows.push(row);
      if (rows.length === MAX_TABLE_ROWS || cells === MAX_TABLE_CELLS) return rows;
      row = [];
      lineHasContent = false;
    } else { lineHasContent = true; append(character); }
  }
  if (lineHasContent) { finishCell(); rows.push(row); }
  return rows;
}
