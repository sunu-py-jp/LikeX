import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat, type SpreadsheetSheet } from "../model/types";
import type { ImportContext } from "./types";

type MutableRange = { range: { top: number; left: number; bottom: number | "end"; right: number | "end" }; format: SpreadsheetCellFormat };
type Run = { top: number; bottom: number; left: number; right: number; format: SpreadsheetCellFormat; key: string };
const canonical = (value: unknown): string => value && typeof value === "object"
  ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
  : JSON.stringify(value);

/** Collect matching horizontal runs and join adjacent rows without retaining blank cells. */
export function createImportFormatRanges(context: ImportContext, name: string) {
  const columnStyles = new Map<number, SpreadsheetCellFormat>();
  const rowStyles = new Map<number, SpreadsheetCellFormat>();
  const explicit = new Set<Run>(), starts = new Map<string, Run>(), ends = new Map<string, Run>();
  const formatKeys = new WeakMap<SpreadsheetCellFormat, string>();
  let maxRow = 0, maxColumn = 0, omitted = 0;
  const keyOf = (format: SpreadsheetCellFormat) => {
    let key = formatKeys.get(format); if (key === undefined) { key = canonical(format); formatKeys.set(format, key); } return key;
  };
  const rowKey = (row: number, run: Pick<Run, "left" | "right" | "key">) => `${row}:${run.left}:${run.right}:${run.key}`;
  const remove = (run: Run) => { explicit.delete(run); starts.delete(rowKey(run.top, run)); ends.delete(rowKey(run.bottom, run)); };
  const add = (run: Run) => {
    const before = ends.get(rowKey(run.top - 1, run)), after = starts.get(rowKey(run.bottom + 1, run));
    if (before) { remove(before); run.top = before.top; }
    if (after) { remove(after); run.bottom = after.bottom; }
    if (explicit.size >= SPREADSHEET_LIMITS.formatRanges) { omitted += (run.bottom - run.top + 1) * (run.right - run.left + 1); return; }
    explicit.add(run); starts.set(rowKey(run.top, run), run); ends.set(rowKey(run.bottom, run), run);
  };
  return {
    columnStyles, rowStyles,
    addRow(row: number, cells: ReadonlyMap<number, SpreadsheetCellFormat>) {
      const entries = [...cells].sort(([a], [b]) => a - b);
      let run: Run | undefined;
      for (const [column, format] of entries) {
        maxRow = Math.max(maxRow, row + 1); maxColumn = Math.max(maxColumn, column + 1);
        const key = keyOf(format);
        if (run && run.right + 1 === column && run.key === key) run.right = column;
        else { if (run) add(run); run = { top: row, bottom: row, left: column, right: column, format, key }; }
      }
      if (run) add(run);
    },
    async apply(sheet: SpreadsheetSheet): Promise<SpreadsheetSheet> {
      const rowCount = Math.max(sheet.rowCount, maxRow, ...[...rowStyles.keys()].map(row => row + 1));
      const columnCount = Math.max(sheet.columnCount, maxColumn, ...[...columnStyles.keys()].map(column => column + 1));
      const available = Math.max(0, SPREADSHEET_LIMITS.formatRanges - (context.formatRangeCount ?? 0));
      const result: MutableRange[] = [], previous = new Map<string, MutableRange>();
      const byTop = [...explicit].sort((a, b) => a.top - b.top), active = new Set<Run>();
      let cursor = 0;
      const emit = (row: number, left: number, right: number, format: SpreadsheetCellFormat, followsRight: boolean, followsBottom: boolean) => {
        const key = `${left}:${right}:${keyOf(format)}:${Number(followsRight)}:${Number(followsBottom)}`;
        const prior = previous.get(key);
        if (prior && prior.range.bottom === row - 1) prior.range.bottom = row;
        else if (result.length < available) {
          const range: MutableRange = { range: { top: row, left, bottom: row, right: followsRight ? "end" : right }, format };
          result.push(range); previous.set(key, range);
        } else omitted += right - left + 1;
        if (followsBottom && row === rowCount - 1) {
          const last = previous.get(key); if (last && last.range.bottom === row) last.range.bottom = "end";
        }
      };
      for (let row = 0; row < rowCount; row++) {
        if ((row & 127) === 127) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
        while (cursor < byTop.length && byTop[cursor].top === row) active.add(byTop[cursor++]);
        for (const run of active) if (run.bottom < row) active.delete(run);
        const rowFormat = rowStyles.get(row);
        const formats: (SpreadsheetCellFormat | undefined)[] = Array.from({ length: columnCount }, (_, column) => rowFormat ?? columnStyles.get(column));
        const bottom = formats.map((format, column) => !!format && !rowFormat && columnStyles.has(column));
        const right = formats.map(() => !!rowFormat);
        for (const run of active) for (let column = run.left; column <= run.right; column++) {
          const inherited = formats[column];
          // Redundant cell declarations must not turn an entire-row/column
          // default into a finite range when their resolved formatting agrees.
          if (!inherited || keyOf(inherited) !== run.key) { bottom[column] = false; right[column] = false; }
          formats[column] = run.format;
        }
        let start = 0;
        for (let column = 0; column <= columnCount; column++) {
          const format = formats[start], current = formats[column];
          if (column < columnCount && (format === current || format && current && keyOf(format) === keyOf(current)) &&
              bottom[start] === bottom[column] && right[start] === right[column]) continue;
          if (format) emit(row, start, column - 1, format, column === columnCount && right[start], bottom[start]);
          start = column;
        }
      }
      context.formatRangeCount = (context.formatRangeCount ?? 0) + result.length;
      if (omitted) context.warn({ code: "omitted", sheetName: name, count: omitted,
        message: "保持できる書式範囲の上限を超えた空セルの書式を省略しました（値・数式は保持）" });
      return { ...sheet, rowCount, columnCount, ...(result.length ? { formatRanges: result } : {}) };
    },
  };
}
