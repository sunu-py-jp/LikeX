import type { SpreadsheetMergedRange } from "../../model/types";

type MergeIndex = {
  center: number;
  byStart: readonly SpreadsheetMergedRange[];
  byEnd: readonly SpreadsheetMergedRange[];
  before?: MergeIndex;
  after?: MergeIndex;
};

function indexMerges(merges: readonly SpreadsheetMergedRange[]): MergeIndex | undefined {
  if (!merges.length) return undefined;
  const sorted = [...merges].sort((a, b) => a.top - b.top);
  const center = sorted[Math.floor(sorted.length / 2)].top;
  const before: SpreadsheetMergedRange[] = [], after: SpreadsheetMergedRange[] = [], overlap: SpreadsheetMergedRange[] = [];
  for (const merge of sorted) {
    if (merge.bottom < center) before.push(merge);
    else if (merge.top > center) after.push(merge);
    else overlap.push(merge);
  }
  return { center, byStart: overlap, byEnd: [...overlap].sort((a, b) => b.bottom - a.bottom), before: indexMerges(before), after: indexMerges(after) };
}

function forRow(index: MergeIndex | undefined, row: number, visit: (merge: SpreadsheetMergedRange) => void) {
  if (!index) return;
  if (row < index.center) {
    for (const merge of index.byStart) { if (merge.top > row) break; visit(merge); }
    forRow(index.before, row, visit);
  } else {
    for (const merge of index.byEnd) { if (merge.bottom < row) break; visit(merge); }
    if (row > index.center) forRow(index.after, row, visit);
  }
}

/** Lazily index only mounted rows, never expand a whole-sheet merged range at once. */
export function createGridMergeCache(merges: readonly SpreadsheetMergedRange[] | undefined, columnCount: number) {
  const index = indexMerges(merges ?? []);
  const rows = new Set<number>();
  const cells = new Map<number, SpreadsheetMergedRange>();
  return {
    cells,
    include(renderedRows: readonly number[]) {
      for (const row of renderedRows) {
        if (rows.has(row)) continue;
        rows.add(row);
        forRow(index, row, merge => {
          for (let column = merge.left; column <= merge.right; column++) cells.set(row * columnCount + column, merge);
        });
      }
      return cells;
    },
  };
}
