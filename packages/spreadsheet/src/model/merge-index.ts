import type { SpreadsheetCellPosition, SpreadsheetMergedRange } from "./types";

export type SpreadsheetMergeIndex = {
  center: number;
  byStart: readonly SpreadsheetMergedRange[];
  byEnd: readonly SpreadsheetMergedRange[];
  byColumn: readonly SpreadsheetMergedRange[];
  before?: SpreadsheetMergeIndex;
  after?: SpreadsheetMergeIndex;
};

/** Index rectangles without expanding their cells or rows. Each range belongs to one node. */
export function indexMerges(merges: readonly SpreadsheetMergedRange[]): SpreadsheetMergeIndex | undefined {
  if (!merges.length) return undefined;
  const sorted = [...merges].sort((a, b) => a.top - b.top);
  const center = sorted[Math.floor(sorted.length / 2)].top;
  const before: SpreadsheetMergedRange[] = [], after: SpreadsheetMergedRange[] = [], overlap: SpreadsheetMergedRange[] = [];
  for (const merge of sorted) {
    if (merge.bottom < center) before.push(merge);
    else if (merge.top > center) after.push(merge);
    else overlap.push(merge);
  }
  return { center, byStart: overlap, byEnd: [...overlap].sort((a, b) => b.bottom - a.bottom),
    byColumn: [...overlap].sort((a, b) => a.left - b.left), before: indexMerges(before), after: indexMerges(after) };
}

export function visitMergesForRow(index: SpreadsheetMergeIndex | undefined, row: number, visit: (merge: SpreadsheetMergedRange) => void): void {
  if (!index) return;
  if (row < index.center) {
    for (const merge of index.byStart) { if (merge.top > row) break; visit(merge); }
    visitMergesForRow(index.before, row, visit);
  } else {
    for (const merge of index.byEnd) { if (merge.bottom < row) break; visit(merge); }
    if (row > index.center) visitMergesForRow(index.after, row, visit);
  }
}

/** Visit only intersecting normalized merges, without scanning rows or unrelated rectangles. */
export function visitIndexedMerges(index: SpreadsheetMergeIndex | undefined, range: Readonly<SpreadsheetMergedRange>,
  visit: (merge: SpreadsheetMergedRange) => void): void {
  if (!index) return;
  // Every rectangle crossing this node contains its center row, so their column
  // intervals are disjoint. A binary search also avoids walking a wide row.
  let low = 0, high = index.byColumn.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.byColumn[middle].right < range.left) low = middle + 1;
    else high = middle;
  }
  for (let position = low; position < index.byColumn.length; position++) {
    const merge = index.byColumn[position];
    if (merge.left > range.right) break;
    if (merge.top <= range.bottom && merge.bottom >= range.top) visit(merge);
  }
  if (range.top < index.center) visitIndexedMerges(index.before, range, visit);
  if (range.bottom > index.center) visitIndexedMerges(index.after, range, visit);
}

/** Normalized merges do not overlap, so rectangles crossing a node have disjoint columns. */
export function findIndexedMerge(index: SpreadsheetMergeIndex | undefined, position: Readonly<SpreadsheetCellPosition>): SpreadsheetMergedRange | undefined {
  while (index) {
    let low = 0, high = index.byColumn.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (index.byColumn[middle].left <= position.column) low = middle + 1;
      else high = middle;
    }
    const range = index.byColumn[low - 1];
    if (range && position.column <= range.right && position.row >= range.top && position.row <= range.bottom) return range;
    index = position.row < index.center ? index.before : index.after;
  }
  return undefined;
}
