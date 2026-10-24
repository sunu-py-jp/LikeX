import { cellAddress, parseCellAddress } from "./address";
import { createWorkbookCalculator } from "./formula";
import { getCellFormat } from "./format-ranges";
import { effectiveCellFormat, formatCellValue } from "./formatting/display";
import { withFormatRangeContext } from "./formatting/range-context";
import { rangesIntersect } from "./merges";
import { SPREADSHEET_LIMITS, type SpreadsheetAutoFilter, type SpreadsheetCalculatedValue,
  type SpreadsheetFilterColumn, type SpreadsheetMergedRange, type SpreadsheetSheet } from "./types";

type Dimensions = Pick<SpreadsheetSheet, "rowCount" | "columnCount">;
const invalid = (message: string): never => { throw new Error(message); };
function record(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key)))
    return invalid(`${label}の形式が正しくありません`);
  return input as Record<string, unknown>;
}
function filterRange(input: unknown, sheet: Dimensions): SpreadsheetMergedRange {
  const range = record(input, ["top", "left", "bottom", "right"], "フィルター範囲");
  const { top, left, bottom, right } = range as unknown as SpreadsheetMergedRange;
  if (![top, left, bottom, right].every(Number.isInteger) || top < 0 || left < 0 || bottom < top || right < left ||
    bottom >= sheet.rowCount || right >= sheet.columnCount) return invalid("フィルター範囲がシートの範囲外です");
  return Object.freeze({ top, left, bottom, right });
}

/** Worksheet and table AutoFilters cannot overlap in XLSX. Keep the same invariant for every model mutation. */
export function assertSpreadsheetFilterTableSeparation(filter: SpreadsheetAutoFilter | undefined,
  tables: SpreadsheetSheet["tables"]): void {
  if (filter && tables?.some(table => rangesIntersect(filter.range, table.range)))
    invalid("フィルター範囲をテーブルと重ねることはできません。別の範囲を選択するかテーブルの定義を解除してください");
}

/** Validate and detach persisted filter settings without allocating a dense cell matrix. */
export function normalizeSpreadsheetAutoFilter(input: SpreadsheetAutoFilter | undefined,
  sheet: Dimensions & Pick<SpreadsheetSheet, "tables">): SpreadsheetAutoFilter | undefined {
  if (input === undefined) return undefined;
  const source = record(input, ["range", "columns"], "フィルター"), range = filterRange(source.range, sheet);
  assertSpreadsheetFilterTableSeparation({ range }, sheet.tables);
  if (source.columns === undefined) return Object.freeze({ range });
  if (!Array.isArray(source.columns) || source.columns.length > range.right - range.left + 1)
    return invalid("フィルター列の一覧が正しくありません");
  const seen = new Set<number>();
  const columns = source.columns.map(item => {
    const source = record(item, ["column", "values"], "フィルター列"), column = source.column as number;
    if (!Number.isInteger(column) || column < range.left || column > range.right || seen.has(column))
      return invalid("フィルター列が範囲外または重複しています");
    seen.add(column);
    if (!Array.isArray(source.values) || source.values.length > SPREADSHEET_LIMITS.rows ||
      source.values.some(value => typeof value !== "string" || value.length > SPREADSHEET_LIMITS.cellLength))
      return invalid("フィルターの値は上限内の文字列配列で指定してください");
    return Object.freeze({ column, values: Object.freeze([...new Set(source.values as string[])].sort()) });
  }).sort((a, b) => a.column - b.column);
  return Object.freeze({ range, ...(columns.length ? { columns: Object.freeze(columns) } : {}) });
}

/** A multi-row selection stays exact. A header-only selection extends through blanks to the last value/formula below it.
 * Formatting-only cells never extend the range, and columns are never inferred. */
export function resolveSpreadsheetFilterRange(sheet: SpreadsheetSheet, input: SpreadsheetMergedRange,
  inferRows?: boolean): SpreadsheetMergedRange {
  const range = filterRange(input, sheet);
  if (inferRows !== undefined && typeof inferRows !== "boolean") return invalid("inferRowsはtrueまたはfalseで指定してください");
  if (!(inferRows ?? range.top === range.bottom)) return range;
  let bottom = range.bottom;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (!cell.value) continue;
    const position = parseCellAddress(address);
    if (position && position.row > bottom && position.column >= range.left && position.column <= range.right)
      bottom = position.row;
  }
  return Object.freeze({ ...range, bottom });
}

/** Pass calculateWorkbook(workbook)[sheet.id] to resolve formulas referring to other sheets. */
function displayedValues(sheet: SpreadsheetSheet, calculated?: Readonly<Record<string, SpreadsheetCalculatedValue>>) {
  const context = withFormatRangeContext(sheet);
  const calculator = calculated ? undefined : createWorkbookCalculator({ sheets: [context] });
  return (row: number, column: number) => {
    const address = cellAddress(row, column), cell = context.cells[address];
    const value = calculated ? calculated[address] : calculator!.getCell(sheet.id, address);
    return formatCellValue(value, effectiveCellFormat(cell, getCellFormat(context, row, column)));
  };
}
const criteriaSets = (columns: readonly SpreadsheetFilterColumn[]) => columns.map(item => ({ column: item.column,
  values: new Set(item.values.map(value => value.toLowerCase())) }));

/** Distinct displayed values, in row order, after applying the other columns' criteria.
 * The active column's own criteria do not reduce its choices. Blanks are represented by "". */
export function getSpreadsheetFilterValues(sheet: SpreadsheetSheet, column: number,
  calculated?: Readonly<Record<string, SpreadsheetCalculatedValue>>): readonly string[] {
  const filter = normalizeSpreadsheetAutoFilter(sheet.autoFilter, sheet);
  if (!filter) return Object.freeze([]);
  if (!Number.isInteger(column) || column < filter.range.left || column > filter.range.right)
    return invalid("フィルター列が範囲外です");
  const read = displayedValues(sheet, calculated), criteria = criteriaSets((filter.columns ?? []).filter(item => item.column !== column));
  const values = new Map<string, string>();
  for (let row = filter.range.top + 1; row <= filter.range.bottom; row++) {
    if (criteria.every(item => item.values.has(read(row, item.column).toLowerCase()))) {
      const value = read(row, column), key = value.toLowerCase();
      if (!values.has(key)) values.set(key, value);
    }
  }
  return Object.freeze([...values.values()]);
}

/** Original zero-based row indices excluded by any column. Headers and rows outside the filter stay visible.
 * Filtering never deletes cells or changes row heights; callers use this projection only for visibility. */
export function getSpreadsheetFilteredRows(sheet: SpreadsheetSheet,
  calculated?: Readonly<Record<string, SpreadsheetCalculatedValue>>): ReadonlySet<number> {
  const filter = normalizeSpreadsheetAutoFilter(sheet.autoFilter, sheet), hidden = new Set<number>();
  if (!filter?.columns?.length) return hidden;
  const read = displayedValues(sheet, calculated), criteria = criteriaSets(filter.columns);
  for (let row = filter.range.top + 1; row <= filter.range.bottom; row++)
    if (criteria.some(item => !item.values.has(read(row, item.column).toLowerCase()))) hidden.add(row);
  return hidden;
}

export function spreadsheetAutoFiltersEqual(left: SpreadsheetAutoFilter | undefined, right: SpreadsheetAutoFilter | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if ((["top", "left", "bottom", "right"] as const).some(key => left.range[key] !== right.range[key])) return false;
  const a = left.columns ?? [], b = right.columns ?? [];
  return a.length === b.length && a.every(item => {
    const other = b.find(candidate => candidate.column === item.column);
    if (!other) return false;
    const values = new Set(item.values), otherValues = new Set(other.values);
    return values.size === otherValues.size && [...values].every(value => otherValues.has(value));
  });
}
