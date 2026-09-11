import type { SpreadsheetContextMenuContext } from "../../api/context-menu";
import type { SpreadsheetCommand } from "../../api/types";
import type { SpreadsheetSelection } from "../../props";
import type { SpreadsheetController } from "../use-spreadsheet";
import { isCellSelected, isMultiRangeSelection, rangeBounds, selectionForSheet, selectionRanges } from "../selection";

export type CellMenuAction = "copy" | "cut" | "paste" | "paste-values" | "paste-formats" |
  "insert-rows" | "insert-columns" | "delete-rows" | "delete-columns" | "clear" | "delete-cells" |
  "format" | "comment" | "delete-comment" | "resize" | "autofit";
export type CellMenuItem = Readonly<{ id: CellMenuAction; label: string; group: number; disabled: boolean; destructive?: boolean }>;
export type GridMenuTarget = Exclude<SpreadsheetContextMenuContext["target"], {kind: "sheet"}>;

/** Built-ins target the clicked cell/header; host callbacks retain their independent original selection. */
export function selectionForContextTarget(context: SpreadsheetContextMenuContext): SpreadsheetSelection {
  const target = context.target, sheet = context.workbook.sheets.find(item => item.id === target.sheetId)!;
  if (target.kind === "sheet") return context.selection;
  const bounds = selectionRanges(context.selection).map(rangeBounds);
  if (context.selection.sheetId === sheet.id) {
    if (target.kind === "cell" && isCellSelected(context.selection, target)) return context.selection;
    if (target.kind === "row" && bounds.every(b => b.left === 0 && b.right === sheet.columnCount - 1) &&
      bounds.some(b => target.row >= b.top && target.row <= b.bottom)) return context.selection;
    if (target.kind === "column" && bounds.every(b => b.top === 0 && b.bottom === sheet.rowCount - 1) &&
      bounds.some(b => target.column >= b.left && target.column <= b.right)) return context.selection;
  }
  const anchor = target.kind === "column" ? {row: 0, column: target.column} :
    target.kind === "row" ? {row: target.row, column: 0} : {row: target.row, column: target.column};
  const focus = target.kind === "row" ? {row: target.row, column: sheet.columnCount - 1} :
    target.kind === "column" ? {row: sheet.rowCount - 1, column: target.column} : anchor;
  return selectionForSheet(sheet, [{anchor, focus}], true, anchor);
}

export function selectionAxisIndices(selection: SpreadsheetSelection, axis: "row" | "column"): number[] {
  const indices = new Set<number>();
  for (const range of selectionRanges(selection)) {
    const bounds = rangeBounds(range);
    for (let index = axis === "row" ? bounds.top : bounds.left; index <= (axis === "row" ? bounds.bottom : bounds.right); index++) indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}

/** Descending adjacent groups keep disjoint deletions/inserts atomic without shifting later targets. */
export function contextStructureCommands(sheetId: string, selection: SpreadsheetSelection, axis: "row" | "column", insert: boolean): SpreadsheetCommand[] {
  const groups: {index: number; count: number}[] = [];
  for (const index of selectionAxisIndices(selection, axis)) {
    const last = groups.at(-1);
    if (last && last.index + last.count === index) last.count++;
    else groups.push({index, count: 1});
  }
  return groups.reverse().map(group => ({type: `${axis === "row" ? "rows" : "columns"}.${insert ? "insert" : "delete"}`, sheetId, ...group}));
}

export function cellMenuItems(c: SpreadsheetController, target: GridMenuTarget, selection: SpreadsheetSelection): CellMenuItem[] {
  const f = c.features, items: CellMenuItem[] = [];
  const busy = c.disabled || c.requesting || c.pendingObjectEdit || !!c.editing;
  const add = (id: CellMenuAction, label: string, group: number, disabled = busy, destructive = false) => items.push({id,label,group,disabled,destructive});
  const multiple = isMultiRangeSelection(selection);
  if (f.cut && !c.readOnly) add("cut", "切り取り", 0, busy || multiple);
  if (f.copy) add("copy", "コピー", 0, c.saving || c.refreshing || c.requesting || c.pendingObjectEdit || multiple);
  if (f.paste && !c.readOnly) {
    add("paste", "貼り付け", 0, busy || multiple);
    if (f.pasteSpecial) { add("paste-values", "値のみ貼り付け", 0, busy || multiple); if (f.formatting) add("paste-formats", "書式のみ貼り付け", 0, busy || multiple); }
  }
  if (!c.readOnly) {
    if (target.kind !== "column" && f.insertRows) add("insert-rows", "上に行を挿入", 1);
    if (target.kind !== "row" && f.insertColumns) add("insert-columns", "左に列を挿入", 1);
    add("clear", "値をクリア", 2);
    if (f.formatting) add("format", "セルの書式設定…", 2);
    if (target.kind !== "cell" && f.resize) {
      add("resize", target.kind === "row" ? "行の高さ…" : "列の幅…", 2);
      add("autofit", target.kind === "row" ? "行の高さを自動調整" : "列の幅を自動調整", 2);
    }
    if (target.kind === "cell" && f.comments) {
      const comment = c.getWorkbook().sheets.find(sheet => sheet.id === target.sheetId)?.comments?.[target.address];
      add("comment", comment ? "コメントを編集" : "コメントを挿入", 3);
      if (comment) add("delete-comment", "コメントを削除", 3);
    }
    if (target.kind === "row" && f.deleteRows) add("delete-rows", "行を削除", 4, busy, true);
    if (target.kind === "column" && f.deleteColumns) add("delete-columns", "列を削除", 4, busy, true);
    if (target.kind === "cell" && f.formatting) add("delete-cells", "すべてクリア（書式も削除）", 4, busy, true);
  }
  return items;
}
