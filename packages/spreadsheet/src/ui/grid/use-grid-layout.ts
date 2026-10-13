"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { SpreadsheetRenderingMode } from "../../props";
import type { SpreadsheetSheet } from "../../model/types";
import { columnGeometry, createRowOffsets, visibleGridRows, type ColumnWidthPreview, type GridViewport } from "./grid-geometry";
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
  const { top, height } = viewport;
  const priorityRows = useMemo(() => visibleGridRows({ rowCount, merges }, rowOffsets, { top, height }, focusedRow), [rowCount, merges, rowOffsets, top, height, focusedRow]);
  const virtualRows = useProgressiveGridRows(id, rowCount, columnCount, priorityRows, mode, scroller);
  const mergeSession = useMemo(() => ({ sheetId: id, rowCount, mode, cache: createGridMergeCache(merges, columnCount) }), [id, merges, rowCount, columnCount, mode]);
  const renderedMerges = useMemo(() => mergeSession.mode === "progressive" ? mergeSession.cache.include(virtualRows) : mergeSession.cache.visible(virtualRows), [mergeSession, virtualRows]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      const next = { top: element.scrollTop, height: element.clientHeight, left: element.scrollLeft, width: element.clientWidth };
      setViewport(previous => sameViewport(previous, next) ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [zoom]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const next = { top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight, left: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth };
    setViewport(previous => sameViewport(previous, next) ? previous : next);
  };
  return { scroller, ...columns, rowOffsets, viewport, virtualRows, renderedMerges, onScroll };
}

function sameViewport(a: GridViewport, b: GridViewport) {
  return a.top === b.top && a.height === b.height && a.left === b.left && a.width === b.width;
}
