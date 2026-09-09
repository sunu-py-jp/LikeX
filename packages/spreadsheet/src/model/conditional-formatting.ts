import { parseCellAddress } from "./address";
import { normalizeCellFormat, validateFormatColor } from "./formatting";
import type { SpreadsheetCalculatedValue, SpreadsheetCellFormat, SpreadsheetMergedRange, SpreadsheetSheet } from "./types";

type RuleBase = { id: string; ranges: readonly SpreadsheetMergedRange[] };
export type SpreadsheetConditionalFormatRule = RuleBase & (
  | { type: "comparison"; operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "notBetween"; value: number; secondValue?: number; format: SpreadsheetCellFormat; stopIfTrue?: boolean }
  | { type: "text"; operator: "contains" | "notContains" | "startsWith" | "endsWith"; value: string; format: SpreadsheetCellFormat; stopIfTrue?: boolean }
  | { type: "dataBar"; color: string; min?: number; max?: number }
  | { type: "colorScale"; colors: readonly [string, string] | readonly [string, string, string]; min?: number; max?: number }
);
const fail = (): never => { throw new Error("条件付き書式のルールまたは範囲が正しくありません"); };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function normalizeConditionalFormats(input: readonly SpreadsheetConditionalFormatRule[] | undefined, sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): readonly SpreadsheetConditionalFormatRule[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 100) return fail();
  const ids = new Set<string>();
  const rules = Array.from(input, rule => {
    if (!rule || typeof rule !== "object" || typeof rule.id !== "string" || !rule.id || rule.id.length > 200 || ids.has(rule.id) || !Array.isArray(rule.ranges) || !rule.ranges.length || rule.ranges.length > 100) return fail();
    ids.add(rule.id);
    const ranges = Object.freeze(Array.from(rule.ranges, (range: SpreadsheetMergedRange) => {
      if (!range || ![range.top, range.left, range.bottom, range.right].every(Number.isInteger) || range.top < 0 || range.left < 0 || range.bottom < range.top || range.right < range.left || range.bottom >= sheet.rowCount || range.right >= sheet.columnCount) return fail();
      return Object.freeze({ top: range.top, left: range.left, bottom: range.bottom, right: range.right });
    }));
    const base = { id: rule.id, ranges };
    if (rule.type === "comparison" || rule.type === "text") {
      if (rule.stopIfTrue !== undefined && typeof rule.stopIfTrue !== "boolean") return fail();
      const format = normalizeCellFormat(rule.format); if (!format) return fail();
      const stop = rule.stopIfTrue === undefined ? {} : { stopIfTrue: rule.stopIfTrue };
      if (rule.type === "text") {
        if (!["contains", "notContains", "startsWith", "endsWith"].includes(rule.operator) || typeof rule.value !== "string" || !rule.value || rule.value.length > 255) return fail();
        return Object.freeze({ ...base, type: "text" as const, operator: rule.operator, value: rule.value, format, ...stop });
      }
      if (!["gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween"].includes(rule.operator) || !finite(rule.value) || (rule.secondValue !== undefined && !finite(rule.secondValue))) return fail();
      if (["between", "notBetween"].includes(rule.operator) && (rule.secondValue === undefined || rule.secondValue < rule.value)) return fail();
      return Object.freeze({ ...base, type: "comparison" as const, operator: rule.operator, value: rule.value, ...(rule.secondValue !== undefined ? { secondValue: rule.secondValue } : {}), format, ...stop });
    }
    if (rule.type !== "dataBar" && rule.type !== "colorScale") return fail();
    if ((rule.min !== undefined && !finite(rule.min)) || (rule.max !== undefined && !finite(rule.max)) || (rule.min !== undefined && rule.max !== undefined && rule.min >= rule.max)) return fail();
    const bounds = { ...(rule.min !== undefined ? { min: rule.min } : {}), ...(rule.max !== undefined ? { max: rule.max } : {}) };
    if (rule.type === "dataBar") return Object.freeze({ ...base, type: "dataBar" as const, color: validateFormatColor(rule.color), ...bounds });
    if (!Array.isArray(rule.colors) || (rule.colors.length !== 2 && rule.colors.length !== 3)) return fail();
    const colors = Object.freeze(Array.from(rule.colors, validateFormatColor)) as unknown as typeof rule.colors;
    return Object.freeze({ ...base, type: "colorScale" as const, colors, ...bounds });
  });
  return rules.length ? Object.freeze(rules) : undefined;
}
export function conditionalFormatsEqual(left: readonly SpreadsheetConditionalFormatRule[] | undefined, right: readonly SpreadsheetConditionalFormatRule[] | undefined) {
  return left === right || JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}
const contains = (ranges: readonly SpreadsheetMergedRange[], row: number, column: number) => ranges.some(r => row >= r.top && row <= r.bottom && column >= r.left && column <= r.right);
function matches(rule: Extract<SpreadsheetConditionalFormatRule, { type: "comparison" | "text" }>, value: SpreadsheetCalculatedValue | undefined) {
  if (value === undefined || value === "") return false;
  if (rule.type === "text") {
    const text = String(value).toLocaleLowerCase("en-US"), needle = rule.value.toLocaleLowerCase("en-US");
    return rule.operator === "contains" ? text.includes(needle) : rule.operator === "notContains" ? !text.includes(needle) : rule.operator === "startsWith" ? text.startsWith(needle) : text.endsWith(needle);
  }
  if (typeof value !== "number") return false;
  const a = rule.value, b = rule.secondValue ?? a;
  return rule.operator === "gt" ? value > a : rule.operator === "gte" ? value >= a : rule.operator === "lt" ? value < a : rule.operator === "lte" ? value <= a : rule.operator === "eq" ? value === a : rule.operator === "neq" ? value !== a : rule.operator === "between" ? value >= a && value <= b : value < a || value > b;
}
export type ConditionalCellAppearance = { format?: SpreadsheetCellFormat; dataBar?: { color: string; start: number; width: number } };
/** Compile extrema once per sheet calculation; rendering does not rescan ranges per cell. */
export function createConditionalFormatter(sheet: SpreadsheetSheet, values: Readonly<Record<string, SpreadsheetCalculatedValue>> = {}) {
  const rules = sheet.conditionalFormats ?? [];
  if (!rules.length) return (_row: number, _column: number, _value: SpreadsheetCalculatedValue | undefined, format?: SpreadsheetCellFormat): ConditionalCellAppearance => ({ format });
  const numeric = Object.entries(values).flatMap(([address, value]) => { const p = parseCellAddress(address); return typeof value === "number" && Number.isFinite(value) && p ? [{ ...p, value }] : []; });
  const bounds = new Map<string, { min: number; max: number }>();
  for (const rule of rules) if (rule.type === "dataBar" || rule.type === "colorScale") {
    let min = Infinity, max = -Infinity;
    for (const cell of numeric) if (contains(rule.ranges, cell.row, cell.column)) { min = Math.min(min, cell.value); max = Math.max(max, cell.value); }
    bounds.set(rule.id, { min: rule.min ?? (min === Infinity ? 0 : rule.type === "dataBar" ? Math.min(0, min) : min), max: rule.max ?? (max === -Infinity ? 0 : rule.type === "dataBar" ? Math.max(0, max) : max) });
  }
  return (row: number, column: number, value: SpreadsheetCalculatedValue | undefined, base?: SpreadsheetCellFormat): ConditionalCellAppearance => {
    const overlays: SpreadsheetCellFormat[] = []; let dataBar: ConditionalCellAppearance["dataBar"];
    for (const rule of rules) {
      if (!contains(rule.ranges, row, column)) continue;
      if (rule.type === "comparison" || rule.type === "text") {
        if (matches(rule, value)) { overlays.push(rule.format); if (rule.stopIfTrue) break; }
      } else if (typeof value === "number" && Number.isFinite(value)) {
        const { min, max } = bounds.get(rule.id)!;
        const fraction = (v: number) => max === min ? 0.5 : Math.min(1, Math.max(0, (v - min) / (max - min)));
        if (rule.type === "dataBar" && !dataBar) {
          const zero = fraction(0), end = fraction(value);
          dataBar = { color: rule.color, start: Math.min(zero, end) * 100, width: Math.abs(end - zero) * 100 };
        } else if (rule.type === "colorScale") {
          const ratio = fraction(value), position = ratio * (rule.colors.length - 1), index = Math.min(rule.colors.length - 2, Math.floor(position));
          const percent = (position - index) * 100;
          overlays.push({ background: `color-mix(in srgb, ${rule.colors[index]} ${100 - percent}%, ${rule.colors[index + 1]} ${percent}%)` });
        }
      }
    }
    return { format: overlays.length ? Object.assign({}, base, ...overlays.reverse()) : base, ...(dataBar ? { dataBar } : {}) };
  };
}
/** Structural edits follow the same inclusive-range semantics as merges. Removed ranges disappear. */
export function shiftConditionalFormats(rules: readonly SpreadsheetConditionalFormatRule[] | undefined, axis: "row" | "column", index: number, count: number, remove: boolean) {
  if (!rules) return undefined;
  const startKey = axis === "row" ? "top" : "left", endKey = axis === "row" ? "bottom" : "right";
  return Object.freeze(rules.flatMap(rule => {
    const ranges = rule.ranges.flatMap(range => {
      let start = range[startKey], end = range[endKey];
      if (!remove) { if (index <= start) start += count; if (index <= end) end += count; }
      else {
        const last = index + count - 1;
        if (start >= index && end <= last) return [];
        start = start > last ? start - count : start >= index ? index : start;
        end = end > last ? end - count : end >= index ? index - 1 : end;
      }
      return [Object.freeze({ ...range, [startKey]: start, [endKey]: end })];
    });
    return ranges.length ? [Object.freeze({ ...rule, ranges: Object.freeze(ranges) })] : [];
  }));
}
