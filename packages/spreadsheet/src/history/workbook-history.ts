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
export function createWorkbookHistory<Metadata = undefined>(limit = DEFAULT_SPREADSHEET_HISTORY_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000)
    throw new Error("履歴の上限は0〜1,000の整数で指定してください");
  type Entry = { workbook: SpreadsheetWorkbook; metadata?: Metadata };
  let past: Entry[] = [], future: Entry[] = [];
  const clear = () => { past = []; future = []; };
  const append = (entries: Entry[], entry: Entry) =>
    limit === 0 ? [] : [...entries.slice(Math.max(0, entries.length - limit + 1)), entry];
  const getState = (): SpreadsheetHistoryState => Object.freeze({
    canUndo: past.length > 0, canRedo: future.length > 0, undoCount: past.length, redoCount: future.length,
  });
  const peekEntry = (direction: WorkbookHistoryDirection) => (direction === "past" ? past : future).at(-1);
  const peek = (direction: WorkbookHistoryDirection) => peekEntry(direction)?.workbook;
  return Object.freeze({
    clear, getState, peek,
    /** Optional caller-owned operation context; never part of the persisted workbook. */
    peekMetadata: (direction: WorkbookHistoryDirection) => peekEntry(direction)?.metadata,
    /** Record only actual changes; a disabled edit invalidates obsolete Undo and Redo entries. */
    record(before: SpreadsheetWorkbook, enabled = true, metadata?: Metadata): void {
      if (!enabled || limit === 0) { clear(); return; }
      past = append(past, { workbook: before, metadata });
      future = [];
    },
    step(direction: WorkbookHistoryDirection, current: SpreadsheetWorkbook): SpreadsheetWorkbook | undefined {
      const entry = peekEntry(direction);
      if (!entry) return;
      const inverse = { workbook: current, metadata: entry.metadata };
      if (direction === "past") { future = append(future, inverse); past = past.slice(0, -1); }
      else { past = append(past, inverse); future = future.slice(0, -1); }
      return entry.workbook;
    },
  });
}
