import { rangeContains, rangesIntersect } from "../merges";
import { shiftRangeInterval } from "../named-ranges";
import type { SpreadsheetTable } from "../tables/types";
import type { SpreadsheetMoveSource, SpreadsheetMoveTarget, SpreadsheetSheet } from "../types";

/** Preserve table identity while the surrounding grid changes. Unsupported header/column splits reject. */
export function shiftSheetTables(tables: readonly SpreadsheetTable[] | undefined, axis: "row" | "column",
  index: number, count: number, remove: boolean): readonly SpreadsheetTable[] | undefined {
  if (!tables) return undefined;
  const result = tables.flatMap(table => {
    const first = axis === "row" ? table.range.top : table.range.left, last = axis === "row" ? table.range.bottom : table.range.right;
    const interval = shiftRangeInterval(first, last, index, count, remove);
    if (!interval) return [];
    if (axis === "column" && ((!remove && index > first && index <= last) || (remove && index <= last && index + count > first)))
      throw new Error("テーブル内の列を挿入・削除するには、先にテーブルの定義を削除してください");
    if (axis === "row" && remove && index <= first && index + count > first)
      throw new Error("テーブルのヘッダ行だけは削除できません。テーブル全体を選択してください");
    const range = Object.freeze(axis === "row" ? { ...table.range, top: interval[0], bottom: interval[1] }
      : { ...table.range, left: interval[0], right: interval[1] });
    return [Object.freeze({ ...table, range })];
  });
  return result.length ? Object.freeze(result) : undefined;
}

/** Move table metadata with all its cells, and reject splits or overwriting an existing table. */
export function moveSheetTables(sheets: readonly SpreadsheetSheet[], source: SpreadsheetMoveSource,
  target: SpreadsheetMoveTarget): ReadonlyMap<string, readonly SpreadsheetTable[] | undefined> {
  const destination = { top: target.row, left: target.column, bottom: target.row + source.bottom - source.top,
    right: target.column + source.right - source.left };
  const moved: SpreadsheetTable[] = [];
  for (const sheet of sheets) for (const table of sheet.tables ?? []) {
    const intersects = sheet.id === source.sheetId && rangesIntersect(source, table.range);
    if (intersects && !rangeContains(source, table.range))
      throw new Error("テーブルの一部分だけは移動できません。テーブル全体を選択してください");
    if (!intersects && sheet.id === target.sheetId && rangesIntersect(destination, table.range))
      throw new Error("移動先に既存のテーブルがあります");
    if (intersects) {
      const rows = target.row - source.top, columns = target.column - source.left;
      moved.push(Object.freeze({ ...table, range: Object.freeze({ top: table.range.top + rows, bottom: table.range.bottom + rows,
        left: table.range.left + columns, right: table.range.right + columns }) }));
    }
  }
  const result = new Map<string, readonly SpreadsheetTable[] | undefined>();
  for (const sheet of sheets) {
    if (sheet.id !== source.sheetId && sheet.id !== target.sheetId) continue;
    const retained = (sheet.tables ?? []).filter(table => !(sheet.id === source.sheetId && rangeContains(source, table.range)));
    const tables = sheet.id === target.sheetId ? [...retained, ...moved] : retained;
    result.set(sheet.id, tables.length ? Object.freeze(tables) : undefined);
  }
  return result;
}
