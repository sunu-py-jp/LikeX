"use client";

import { memo } from "react";
import { ROW_HEIGHT, ROW_HEADER_WIDTH } from "./grid-geometry";

/** Keep cheap row labels available before virtualized cells finish rendering.
 * Interactive/accessible headers remain in the grid rows above this backdrop.
 * No cell data, selection or scroll state is read here, so scrolling and cursor
 * movement reuse the entire strip. Only row geometry changes rebuild it. */
export const GridRowLabels = memo(function GridRowLabels({ rowOffsets }: { rowOffsets: readonly number[] }) {
  return <div aria-hidden="true" className="lxs-row-labels" style={{ width: ROW_HEADER_WIDTH, height: rowOffsets[rowOffsets.length - 1] - ROW_HEIGHT }}>
    {rowOffsets.slice(0, -1).map((top, row) => <span key={row} className="lxs-row-label" style={{ top: top - ROW_HEIGHT, height: rowOffsets[row + 1] - top }}>{row + 1}</span>)}
  </div>;
});
