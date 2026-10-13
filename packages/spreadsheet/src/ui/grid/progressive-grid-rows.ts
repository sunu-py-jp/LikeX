/** Keep background work bounded even for sheets with hundreds of columns. */
const BACKGROUND_CELL_BUDGET = 1024;
const BACKGROUND_ROW_BUDGET = 32;

export function gridBackgroundRowBudget(columnCount: number) {
  return Math.max(1, Math.min(BACKGROUND_ROW_BUDGET, Math.floor(BACKGROUND_CELL_BUDGET / Math.max(1, columnCount))));
}

/** Both inputs are sorted and contain unique row indexes. Preserve identity on no-op. */
export function mergeGridRows(previous: readonly number[], incoming: readonly number[]): readonly number[] {
  if (!incoming.length) return previous;
  const rows: number[] = [];
  let left = 0, right = 0;
  while (left < previous.length || right < incoming.length) {
    const a = previous[left] ?? Infinity, b = incoming[right] ?? Infinity;
    const row = Math.min(a, b);
    rows.push(row);
    if (a === row) left++;
    if (b === row) right++;
  }
  return rows.length === previous.length ? previous : rows;
}

export type GridRowProgress = {
  readonly rowCount: number;
  readonly columnCount: number;
  readonly loaded: Set<number>;
  rows: readonly number[];
  cursor: number;
};

export function createGridRowProgress(rowCount: number, columnCount: number): GridRowProgress {
  return { rowCount, columnCount, loaded: new Set(), rows: [], cursor: 0 };
}

/** Called only from effects/callbacks; React receives a new immutable row snapshot. */
export function retainGridRows(progress: GridRowProgress, priority: readonly number[]) {
  const added = priority.filter(row => row >= 0 && row < progress.rowCount && !progress.loaded.has(row));
  if (!added.length) return false;
  for (const row of added) progress.loaded.add(row);
  progress.rows = mergeGridRows(progress.rows, added);
  return true;
}

export function advanceGridRows(progress: GridRowProgress) {
  const added: number[] = [];
  const budget = gridBackgroundRowBudget(progress.columnCount);
  while (progress.cursor < progress.rowCount && added.length < budget) {
    const row = progress.cursor++;
    if (!progress.loaded.has(row)) added.push(row);
  }
  return retainGridRows(progress, added);
}

/** Use the scroller's browsing context, including when embedded in an iframe. */
export function scheduleGridBackgroundWork(host: Window, work: () => void) {
  let cancelled = false;
  const run = () => { if (!cancelled) work(); };
  if (typeof host.requestIdleCallback === "function" && typeof host.cancelIdleCallback === "function") {
    const id = host.requestIdleCallback(run, { timeout: 250 });
    return () => { cancelled = true; host.cancelIdleCallback(id); };
  }
  const id = host.setTimeout(run, 16);
  return () => { cancelled = true; host.clearTimeout(id); };
}
