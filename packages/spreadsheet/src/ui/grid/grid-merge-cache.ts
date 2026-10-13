import type { SpreadsheetMergedRange } from "../../model/types";

import { indexMerges, visitMergesForRow } from "../../model/merge-index";

/** Lazily index only mounted rows, never expand a whole-sheet merged range at once. */
export function createGridMergeCache(merges: readonly SpreadsheetMergedRange[] | undefined, columnCount: number) {
  const index = indexMerges(merges ?? []);
  const rows = new Set<number>();
  const cells = new Map<number, SpreadsheetMergedRange>();
  const addRow = (target: Map<number, SpreadsheetMergedRange>, row: number) => visitMergesForRow(index, row, merge => {
    for (let column = merge.left; column <= merge.right; column++) target.set(row * columnCount + column, merge);
  });
  return {
    cells,
    /** Viewport-only mode indexes visible cells without retaining visited rows. */
    visible(renderedRows: readonly number[]) {
      const visible = new Map<number, SpreadsheetMergedRange>();
      for (const row of renderedRows) addRow(visible, row);
      return visible;
    },
    include(renderedRows: readonly number[]) {
      for (const row of renderedRows) {
        if (rows.has(row)) continue;
        rows.add(row);
        addRow(cells, row);
      }
      return cells;
    },
  };
}
