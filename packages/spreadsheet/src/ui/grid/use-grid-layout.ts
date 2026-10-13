"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { SpreadsheetRenderingMode } from "../../props";
import type { SpreadsheetSheet } from "../../model/types";
import { columnGeometry, createRowOffsets, visibleGridRows, visibleMergedCells, type ColumnWidthPreview, type GridViewport } from "./grid-geometry";
import { useProgressiveGridRows } from "./use-progressive-grid-rows";
import { createGridMergeCache } from "./grid-merge-cache";

/** Owns viewport observation and spatial lookup; selection/editing remain outside this hook. */
export function useGridLayout(sheet: SpreadsheetSheet, focusedRow: number, resizing: ColumnWidthPreview | null, rowResize?: { index: number; value: number } | null, zoom = 100, mode: SpreadsheetRenderingMode = "progressive") {
  const scroller = useRef<HTMLDivElement>(null);
  const { id, rowCount, columnCount, columnWidths, rowHeights, merges } = sheet;
  const [viewport, setViewport] = useState<GridViewport>({ top: 0, height: 480, left: 0, width: 800 });
  const columnResizeIndex = resizing?.column, columnResizeValue = resizing?.value;
  const columns = useMemo(() => columnGeometry({ columnCount, columnWidths }, columnResizeIndex !== undefined && columnResizeValue !== undefined ? { column: columnResizeIndex, value: columnResizeValue } : null),
    [columnCount, columnWidths, columnResizeIndex, columnResizeValue]);
  const rowResizeIndex = rowResize?.index, rowResizeValue = rowResize?.value;
  const rowOffsets = useMemo(() => createRowOffsets({ rowCount, rowHeights: rowResizeIndex !== undefined && rowResizeValue !== undefined ? { ...rowHeights, [rowResizeIndex]: rowResizeValue } : rowHeights }), [rowCount, rowHeights, rowResizeIndex, rowResizeValue]);
  const priorityRows = useMemo(() => visibleGridRows({ rowCount, merges }, rowOffsets, viewport, focusedRow), [rowCount, merges, rowOffsets, viewport, focusedRow]);
  const virtualRows = useProgressiveGridRows(id, rowCount, columnCount, priorityRows, mode, scroller);
  const mergeSession = useMemo(() => ({ sheetId: id, rowCount, mode, cache: createGridMergeCache(merges, columnCount) }), [id, merges, rowCount, columnCount, mode]);
  const renderedMerges = useMemo(() => mergeSession.mode === "progressive" ? mergeSession.cache.include(virtualRows) : visibleMergedCells({ merges, columnCount }, virtualRows), [mergeSession, merges, columnCount, virtualRows]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight, left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [zoom]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight, left: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth });
  return { scroller, ...columns, rowOffsets, viewport, virtualRows, renderedMerges, onScroll };
}
