import type { SpreadsheetSelection } from "../../props";
import { selectionBands } from "../../state/selection";

type Interval = { left: number; right: number };
export type SelectionOutlineEdge = Readonly<{ x1: number; y1: number; x2: number; y2: number }>;

/** Subtract sorted, disjoint inclusive intervals without enumerating their cells. */
function uncoveredIntervals(columns: readonly Interval[], covered: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let index = 0;
  for (const column of columns) {
    let left = column.left;
    while (index < covered.length && covered[index].right < left) index++;
    for (let blocker = index; blocker < covered.length && covered[blocker].left <= column.right; blocker++) {
      if (covered[blocker].left > left) result.push({ left, right: covered[blocker].left - 1 });
      left = Math.max(left, covered[blocker].right + 1);
      if (left > column.right) break;
    }
    if (left <= column.right) result.push({ left, right: column.right });
  }
  return result;
}

/** Exact outer edges of the selection union, including holes, in cell-edge coordinates. */
export function selectionOutlineEdges(selection: SpreadsheetSelection): SelectionOutlineEdge[] {
  const bands = selectionBands(selection), edges: SelectionOutlineEdge[] = [];
  const vertical = new Map<number, { top: number; bottom: number }[]>();
  for (let index = 0; index < bands.length; index++) {
    const band = bands[index], before = bands[index - 1], after = bands[index + 1];
    for (const column of uncoveredIntervals(band.columns, before?.bottom === band.top - 1 ? before.columns : [])) {
      edges.push({ x1: column.left, x2: column.right + 1, y1: band.top, y2: band.top });
    }
    for (const column of uncoveredIntervals(band.columns, after?.top === band.bottom + 1 ? after.columns : [])) {
      edges.push({ x1: column.left, x2: column.right + 1, y1: band.bottom + 1, y2: band.bottom + 1 });
    }
    for (const column of band.columns) for (const x of [column.left, column.right + 1]) {
      let segments = vertical.get(x);
      if (!segments) { segments = []; vertical.set(x, segments); }
      const previous = segments.at(-1);
      if (previous?.bottom === band.top) previous.bottom = band.bottom + 1;
      else segments.push({ top: band.top, bottom: band.bottom + 1 });
    }
  }
  for (const [x, segments] of vertical) for (const segment of segments) {
    edges.push({ x1: x, x2: x, y1: segment.top, y2: segment.bottom });
  }
  return edges;
}

export function selectionOutlinePath(edges: readonly SelectionOutlineEdge[], columnOffsets: readonly number[], rowOffsets: readonly number[]): string {
  return edges.map(edge => `M${columnOffsets[edge.x1]},${rowOffsets[edge.y1]}H${columnOffsets[edge.x2]}V${rowOffsets[edge.y2]}`).join(" ");
}
