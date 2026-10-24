import type { SpreadsheetCellGridWriteOptions, SpreadsheetGridHeader, SpreadsheetGridHeaderLayout, SpreadsheetGridHeaderStyle } from "../../api/table-commands";
import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat } from "../types";
import { normalizeCellFormat, validateCellValue } from "../workbook/validation";
import { tableHeaderCellValue } from "../tables/data";

export type GridHeaderNode = Readonly<{
  value: string;
  style?: SpreadsheetCellFormat;
  children: readonly GridHeaderNode[];
  depth: number;
  leaves: number;
}>;
export type GridHeaderAxis = Readonly<{ roots: readonly GridHeaderNode[]; depth: number; leaves: number }>;

export function gridHeaderStyle(input: SpreadsheetGridHeaderStyle | undefined): SpreadsheetCellFormat | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "background" && key !== "color"))
    throw new Error("見出しの書式はbackgroundとcolorで指定してください");
  return normalizeCellFormat(input);
}

export function gridHeaderLayout(input: SpreadsheetGridHeaderLayout | undefined): SpreadsheetGridHeaderLayout {
  if (input !== undefined && input !== "merged" && input !== "protruding")
    throw new Error("見出しの配置はmergedまたはprotrudingで指定してください");
  return input ?? "merged";
}

export function gridCorner(input: SpreadsheetCellGridWriteOptions["corner"]) {
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input)))
    throw new Error("左上見出しの設定が正しくありません");
  if (input && Object.keys(input).some(key => key !== "label" && key !== "merge" && key !== "style" && key !== "border"))
    throw new Error("左上見出しにはlabel、merge、style、borderを指定してください");
  const label = input?.label == null ? "" : validateCellValue(input.label);
  const value = label.trim() ? validateCellValue(tableHeaderCellValue(label)) : "";
  if (input?.merge !== undefined && typeof input.merge !== "boolean")
    throw new Error("左上見出しのmergeは真偽値で指定してください");
  const border = input?.border;
  if (border !== undefined) {
    if (!border || typeof border !== "object" || Array.isArray(border) || Object.keys(border).some(key => !["style", "width", "color"].includes(key)))
      throw new Error("左上見出しの罫線が正しくありません");
    normalizeCellFormat({ borders: { top: border } });
  }
  return Object.freeze({ value, merge: input?.merge ?? Boolean(value), style: gridHeaderStyle(input?.style), border });
}

/** Iterative traversal bounds cyclic/deep untrusted trees without using the JavaScript call stack. */
export function gridHeaderAxis(input: readonly SpreadsheetGridHeader[] | undefined): GridHeaderAxis | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || !input.length || input.length > SPREADSHEET_LIMITS.clipboardCells)
    throw new Error("見出しは1件以上の配列で指定してください");
  for (let index = 0; index < input.length; index++) if (!Object.hasOwn(input, index))
    throw new Error("見出しの配列に未指定の要素を含められません");
  type Pending = { source: SpreadsheetGridHeader; into: GridHeaderNode[]; children?: GridHeaderNode[]; value?: string; style?: SpreadsheetCellFormat };
  const roots: GridHeaderNode[] = [], path = new Set<object>();
  const stack: Pending[] = input.map(source => ({ source, into: roots })).reverse();
  let count = 0, scheduled = input.length, characters = 0;
  while (stack.length) {
    const task = stack.pop()!, { source } = task;
    if (task.children) {
      path.delete(source as object);
      task.into.push(Object.freeze({ value: task.value!, ...(task.style ? { style: task.style } : {}),
        children: Object.freeze(task.children), depth: 1 + task.children.reduce((max, child) => Math.max(max, child.depth), 0),
        leaves: task.children.reduce((sum, child) => sum + child.leaves, 0) }));
      continue;
    }
    if (++count > SPREADSHEET_LIMITS.clipboardCells) throw new Error("見出しは10,000件以内で指定してください");
    if (typeof source !== "string" && (!source || typeof source !== "object" || Array.isArray(source)))
      throw new Error("見出しは文字列またはlabelを持つオブジェクトで指定してください");
    if (typeof source !== "string" && Object.keys(source).some(key => key !== "label" && key !== "children" && key !== "style"))
      throw new Error("見出しにはlabel、children、styleを指定してください");
    if (typeof source !== "string" && path.has(source)) throw new Error("見出しの階層が循環しています");
    const label = validateCellValue(typeof source === "string" ? source : source.label);
    const value = validateCellValue(tableHeaderCellValue(label));
    characters += value.length;
    if (characters > SPREADSHEET_LIMITS.clipboardCharacters) throw new Error("見出しは10 Mi文字以内で指定してください");
    const style = typeof source === "string" ? undefined : gridHeaderStyle(source.style);
    const children = typeof source === "string" ? undefined : source.children;
    if (children !== undefined) {
      if (!Array.isArray(children) || !children.length || children.length > SPREADSHEET_LIMITS.clipboardCells)
        throw new Error("見出しのchildrenは1件以上の配列で指定してください");
      for (let index = 0; index < children.length; index++) if (!Object.hasOwn(children, index))
        throw new Error("見出しのchildrenに未指定の要素を含められません");
      scheduled += children.length;
      if (scheduled > SPREADSHEET_LIMITS.clipboardCells) throw new Error("見出しは10,000件以内で指定してください");
      path.add(source as object);
      const normalized: GridHeaderNode[] = [];
      stack.push({ source, into: task.into, children: normalized, value, style });
      for (let index = children.length - 1; index >= 0; index--) stack.push({ source: children[index], into: normalized });
    } else task.into.push(Object.freeze({ value, ...(style ? { style } : {}), children: Object.freeze([]), depth: 1, leaves: 1 }));
  }
  return Object.freeze({ roots: Object.freeze(roots), depth: roots.reduce((max, node) => Math.max(max, node.depth), 0),
    leaves: roots.reduce((sum, node) => sum + node.leaves, 0) });
}
