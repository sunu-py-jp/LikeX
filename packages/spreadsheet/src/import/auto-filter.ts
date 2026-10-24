import { SPREADSHEET_LIMITS, type SpreadsheetAutoFilter } from "../model/types";
import type { ImportContext } from "./types";
import { readRange } from "./worksheet-shared";
import { child, children, localName, spreadsheetText, type XmlNode } from "./xml";

/** Recover unsupported criteria per column; never turn a partial OR-list into a stricter filter. */
export function readWorksheetAutoFilter(node: XmlNode, sheetName: string, context: ImportContext): SpreadsheetAutoFilter | undefined {
  const roots = children(node, "autoFilter"), root = roots[0];
  if (!root) return;
  const warn = (message: string) => context.warn({ code: "omitted", sheetName, message });
  if (roots.length > 1) warn("重複するフィルター定義を省略し、最初の定義を読み込みました");
  const range = readRange(root.attributes.ref);
  if (!range) { warn("不正またはシート上限外のフィルター範囲を省略しました（セルの値は保持）"); return; }
  const columns: { column: number; values: readonly string[] }[] = [], seen = new Set<number>();
  for (const item of children(root, "filterColumn")) {
    const offset = Number(item.attributes.colId);
    if (item.attributes.colId === undefined || !Number.isInteger(offset) || offset < 0 || offset > range.right - range.left) {
      warn("範囲外または不正な列のフィルター条件を省略しました"); continue;
    }
    const column = range.left + offset;
    if (seen.has(column)) { warn("重複する列のフィルター条件を省略し、最初の条件を保持しました"); continue; }
    seen.add(column);
    if (["1", "true"].includes(item.attributes.hiddenButton) || ["0", "false"].includes(item.attributes.showButton))
      context.warn({ code: "adjusted", sheetName, message: "フィルターボタンの非表示指定を通常表示へ変更しました" });
    const filters = child(item, "filters");
    if (item.children.some(entry => localName(entry.name) !== "filters") || children(item, "filters").length > 1 ||
      filters?.children.some(entry => localName(entry.name) !== "filter")) {
      warn("未対応のフィルター条件（日付グループ・比較式・上位件数・色など）を列単位で省略しました"); continue;
    }
    if (!filters) continue; // A button-only column has no filtering condition.
    if (filters.attributes.blank !== undefined && !["0", "1", "true", "false"].includes(filters.attributes.blank)) {
      warn("空白の指定が不正な列のフィルター条件を省略しました"); continue;
    }
    const values: string[] = [];
    let invalid = false;
    for (const entry of children(filters, "filter")) {
      if (entry.attributes.val === undefined) { invalid = true; break; }
      const value = spreadsheetText(entry.attributes.val);
      if (value.length > SPREADSHEET_LIMITS.cellLength || values.length >= SPREADSHEET_LIMITS.rows) { invalid = true; break; }
      values.push(value);
    }
    if (invalid) { warn("不正または保持上限を超える値を含む列のフィルター条件を省略しました"); continue; }
    if (["1", "true"].includes(filters.attributes.blank)) values.push("");
    const unique = [...new Set(values)];
    if (unique.length > SPREADSHEET_LIMITS.rows) { warn("保持上限を超える値を含む列のフィルター条件を省略しました"); continue; }
    columns.push({ column, values: unique });
  }
  if (root.children.some(entry => localName(entry.name) !== "filterColumn")) warn("フィルターの並べ替え・拡張情報を省略しました");
  return { range, ...(columns.length ? { columns } : {}) };
}
