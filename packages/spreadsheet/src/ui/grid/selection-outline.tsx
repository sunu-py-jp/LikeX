"use client";

import { useMemo } from "react";
import type { SpreadsheetSelection } from "../../props";
import { selectionOutlineEdges, selectionOutlinePath } from "./selection-outline-geometry";

/** One decoration for the selection union; virtual rows never cut its outline. */
export function SelectionOutline({ selection, columnOffsets, rowOffsets }: {
  selection: SpreadsheetSelection; columnOffsets: readonly number[]; rowOffsets: readonly number[];
}) {
  const edges = useMemo(() => selectionOutlineEdges(selection), [selection]);
  const path = selectionOutlinePath(edges, columnOffsets, rowOffsets);
  return <svg className="lxs-selection-outline" aria-hidden="true" focusable="false" width={columnOffsets.at(-1)} height={rowOffsets.at(-1)}>
    <path d={path} />
  </svg>;
}
