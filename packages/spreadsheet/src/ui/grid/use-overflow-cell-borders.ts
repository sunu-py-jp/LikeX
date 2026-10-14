"use client";

import { useLayoutEffect, useRef } from "react";
import type { SpreadsheetCalculatedValue, SpreadsheetSheet } from "../../model/types";

const leftEdge = 1, rightEdge = 2;
type CoveredEdges = Map<HTMLElement, number>;
type TextSizes = Map<Element, { width: number; height: number }>;

/** Only boundaries strictly inside the painted text are covered; outer edges survive. */
export function textCoveredColumnBoundaries(offsets: readonly number[], left: number, right: number): number[] {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return [];
  let low = 1, high = offsets.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (offsets[middle] <= left) low = middle + 1; else high = middle; }
  const boundaries: number[] = [];
  for (let index = low; index < offsets.length - 1 && offsets[index] < right; index++) boundaries.push(index);
  return boundaries;
}

/** Measure only overflowing text. Stored borders and border-box geometry remain intact. */
export function updateOverflowCellBorders(root: HTMLElement, columnOffsets: readonly number[], previous: CoveredEdges = new Map(), sizes?: TextSizes): CoveredEdges {
  const covered: CoveredEdges = new Map();
  const cells = new Map<number, HTMLElement>();
  root.querySelectorAll<HTMLElement>(".lxs-cell[data-lxs-column]").forEach(cell => cells.set(Number(cell.dataset.lxsColumn), cell));
  const add = (cell: HTMLElement | undefined, edge: number) => { if (cell) covered.set(cell, (covered.get(cell) ?? 0) | edge); };
  root.querySelectorAll<HTMLElement>(".lxs-cell-text-overflow .lxs-cell-text-content").forEach(text => {
    const cell = text.closest<HTMLElement>(".lxs-cell[data-lxs-column]"), viewport = text.closest<HTMLElement>(".lxs-cell-text-overflow");
    if (!cell || !viewport) return;
    const column = Number(cell.dataset.lxsColumn), width = columnOffsets[column + 1] - columnOffsets[column];
    const cellBox = cell.getBoundingClientRect(), textBox = text.getBoundingClientRect(), clipBox = viewport.getBoundingClientRect();
    const scale = cellBox.width / width;
    if (!Number.isFinite(scale) || scale <= 0) return;
    sizes?.set(text, { width: textBox.width / scale, height: textBox.height / scale });
    // Bounding rectangles include sheet zoom. Work in the shared logical grid so
    // scrolling, fractional imported widths and scaling do not move the mask.
    const origin = cellBox.left - columnOffsets[column] * scale;
    let lines: Iterable<DOMRect> = [textBox];
    // With white-space: pre, manual line breaks remain even when wrapping is off.
    // The widest line may be below the cell's vertical clip and must not hide rules.
    if (/[\r\n]/.test(text.textContent ?? "")) {
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(text);
      lines = range.getClientRects();
    }
    for (const line of lines) {
      if (line.bottom <= clipBox.top || line.top >= clipBox.bottom) continue;
      const left = (Math.max(line.left, clipBox.left) - origin) / scale;
      const right = (Math.min(line.right, clipBox.right) - origin) / scale;
      for (const boundary of textCoveredColumnBoundaries(columnOffsets, left, right)) {
        add(cells.get(boundary - 1), rightEdge);
        add(cells.get(boundary), leftEdge);
      }
    }
  });
  for (const cell of new Set([...previous.keys(), ...covered.keys()])) {
    const before = previous.get(cell) ?? 0, after = covered.get(cell) ?? 0;
    if ((before & leftEdge) !== (after & leftEdge)) cell.toggleAttribute("data-lxs-overflow-hide-left", !!(after & leftEdge));
    if ((before & rightEdge) !== (after & rightEdge)) cell.toggleAttribute("data-lxs-overflow-hide-right", !!(after & rightEdge));
  }
  return covered;
}

/** One observer per overflowing row; selection-only renders do not remeasure text. */
export function useOverflowCellBorders(sheet: SpreadsheetSheet, calculated: Readonly<Record<string, SpreadsheetCalculatedValue>> | undefined,
  columnOffsets: readonly number[], formatting: unknown, editingColumn: number | undefined, checkboxes: boolean) {
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rowRef.current;
    if (!root?.querySelectorAll) return;
    const text = root.querySelectorAll<HTMLElement>(".lxs-cell-text-overflow .lxs-cell-text-content");
    if (!text.length) return;
    let covered: CoveredEdges = new Map(), disposed = false;
    const sizes: TextSizes = new Map();
    const update = () => { if (!disposed) covered = updateOverflowCellBorders(root, columnOffsets, covered, sizes); };
    update();
    const Observer = root.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(entries => {
      // The initial observer delivery duplicates the synchronous layout pass.
      // Reuse its sizes so unchanged mount/font-ready notifications do no work.
      if (entries.some(entry => {
        const previous = sizes.get(entry.target);
        return !previous || Math.abs(previous.width - entry.contentRect.width) > .01 || Math.abs(previous.height - entry.contentRect.height) > .01;
      })) update();
    }) : undefined;
    text.forEach(node => observer?.observe(node));
    const fonts = root.ownerDocument.fonts;
    fonts?.addEventListener?.("loadingdone", update);
    if (fonts?.status === "loading" && !fonts.addEventListener) void fonts.ready?.then(update, () => {});
    return () => {
      disposed = true;
      observer?.disconnect(); fonts?.removeEventListener?.("loadingdone", update);
      for (const cell of covered.keys()) {
        cell.removeAttribute("data-lxs-overflow-hide-left"); cell.removeAttribute("data-lxs-overflow-hide-right");
      }
    };
  }, [sheet, calculated, columnOffsets, formatting, editingColumn, checkboxes]);
  return rowRef;
}
