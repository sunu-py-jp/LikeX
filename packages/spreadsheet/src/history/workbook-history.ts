import type { SpreadsheetWorkbook } from "../model/types";

export type SpreadsheetHistoryState = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}>;

export type WorkbookHistoryDirection = "past" | "future";
export const DEFAULT_SPREADSHEET_HISTORY_LIMIT = 50;

/** Shared bounded snapshot history. Callers validate and publish workbook changes. */
export function createWorkbookHistory(limit = DEFAULT_SPREADSHEET_HISTORY_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000)
    throw new Error("履歴の上限は0〜1,000の整数で指定してください");
  let past: SpreadsheetWorkbook[] = [], future: SpreadsheetWorkbook[] = [];
  const clear = () => { past = []; future = []; };
  const append = (entries: SpreadsheetWorkbook[], workbook: SpreadsheetWorkbook) =>
    limit === 0 ? [] : [...entries.slice(Math.max(0, entries.length - limit + 1)), workbook];
  const getState = (): SpreadsheetHistoryState => Object.freeze({
    canUndo: past.length > 0, canRedo: future.length > 0, undoCount: past.length, redoCount: future.length,
  });
  const peek = (direction: WorkbookHistoryDirection) => (direction === "past" ? past : future).at(-1);
  return Object.freeze({
    clear, getState, peek,
    /** Record only actual changes; a disabled edit invalidates obsolete Undo and Redo entries. */
    record(before: SpreadsheetWorkbook, enabled = true): void {
      if (!enabled || limit === 0) { clear(); return; }
      past = append(past, before);
      future = [];
    },
    step(direction: WorkbookHistoryDirection, current: SpreadsheetWorkbook): SpreadsheetWorkbook | undefined {
      const next = peek(direction);
      if (!next) return;
      if (direction === "past") { future = append(future, current); past = past.slice(0, -1); }
      else { past = append(past, current); future = future.slice(0, -1); }
      return next;
    },
  });
}
