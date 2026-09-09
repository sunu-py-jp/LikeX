"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { SpreadsheetSheet } from "../../model/types";
import { columnGeometry, createRowOffsets, visibleGridRows, visibleMergedCells, type ColumnWidthPreview, type GridViewport } from "./grid-geometry";

/** Owns viewport observation and spatial lookup; selection/editing remain outside this hook. */
export function useGridLayout(sheet: SpreadsheetSheet, focusedRow: number, resizing: ColumnWidthPreview | null, rowResize?: { index: number; value: number } | null) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<GridViewport>({ top: 0, height: 480 });
  const columns = columnGeometry(sheet, resizing);
  const rowResizeIndex = rowResize?.index, rowResizeValue = rowResize?.value;
  const rowOffsets = useMemo(() => createRowOffsets({ rowCount: sheet.rowCount, rowHeights: rowResizeIndex !== undefined && rowResizeValue !== undefined ? { ...sheet.rowHeights, [rowResizeIndex]: rowResizeValue } : sheet.rowHeights }), [sheet.rowCount, sheet.rowHeights, rowResizeIndex, rowResizeValue]);
  const virtualRows = visibleGridRows(sheet, rowOffsets, viewport, focusedRow);
  const renderedMerges = visibleMergedCells(sheet, virtualRows);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const onScroll = (event: UIEvent<HTMLDivElement>) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight });
  return { scroller, ...columns, rowOffsets, virtualRows, renderedMerges, onScroll };
}
