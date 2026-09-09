"use client";

import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { getMergedRange, mergedCellPosition } from "../../model/merges";
import type { SpreadsheetCellPosition, SpreadsheetSheet } from "../../model/types";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { selectionRanges } from "../../state/selection";
import { ROW_HEIGHT, ROW_HEADER_WIDTH } from "./grid-geometry";

export type GridFocusRefs = {
  scrollerRef: RefObject<HTMLDivElement | null>;
  activeInputRef: RefObject<HTMLInputElement | null>;
  focusIntentRef: RefObject<boolean>;
};

/** A merged cell occupies one keyboard stop, regardless of its row/column span. */
export function nextCellPosition(sheet: SpreadsheetSheet, position: Readonly<SpreadsheetCellPosition>, rows: number, columns: number): SpreadsheetCellPosition {
  const merge = getMergedRange(sheet, position);
  const anchor = mergedCellPosition(sheet, position);
  return { row: (rows > 0 ? merge?.bottom ?? anchor.row : merge?.top ?? anchor.row) + rows,
    column: (columns > 0 ? merge?.right ?? anchor.column : merge?.left ?? anchor.column) + columns };
}

/** Coordinates the active input, scrolling and cell keyboard navigation. */
export function useGridFocus(c: SpreadsheetController, scrollerRef: GridFocusRefs["scrollerRef"], widths: readonly number[], rowOffsets: readonly number[]) {
  const activeInput = useRef<HTMLInputElement>(null);
  const focusIntent = useRef(false);
  const lastFocusRequest = useRef(c.gridFocusRequest);
  useLayoutEffect(() => {
    if (!scrollerRef.current) return;
    const left = widths.slice(0, c.selection.focus.column).reduce((sum, width) => sum + width, ROW_HEADER_WIDTH);
    const right = left + widths[c.selection.focus.column];
    const top = rowOffsets[c.selection.focus.row];
    const bottom = rowOffsets[c.selection.focus.row + 1];
    const element = scrollerRef.current;
    if (top < element.scrollTop + ROW_HEIGHT) element.scrollTop = top - ROW_HEIGHT;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    if (left < element.scrollLeft + ROW_HEADER_WIDTH) element.scrollLeft = left - ROW_HEADER_WIDTH;
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
    if (focusIntent.current || lastFocusRequest.current !== c.gridFocusRequest || element.contains(element.ownerDocument.activeElement)) {
      activeInput.current?.focus({ preventScroll: true });
      activeInput.current?.select();
    }
    focusIntent.current = false;
    lastFocusRequest.current = c.gridFocusRequest;
    // Column sizes are independent of changing the selected position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.selection.sheetId, c.selection.focus.row, c.selection.focus.column, c.gridFocusRequest]);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); c.cancelEdit(); activeInput.current?.select(); return; }
    if (event.key === "F2") { event.preventDefault(); c.beginEdit(); return; }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      c.afterCommit(() => {
        focusIntent.current = true;
        const position = nextCellPosition(c.activeSheet, c.selection.focus, event.key === "Enter" ? (event.shiftKey ? -1 : 1) : 0,
          event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0);
        let { row, column } = position;
        if (column >= c.activeSheet.columnCount && row < c.activeSheet.rowCount - 1) { column = 0; row++; }
        if (column < 0 && row > 0) { column = c.activeSheet.columnCount - 1; row--; }
        const target = mergedCellPosition(c.activeSheet, { row, column });
        if (event.key === "Tab" && !event.shiftKey && target.row === c.selection.focus.row && target.column === c.selection.focus.column) {
          const merge = getMergedRange(c.activeSheet, target);
          if (merge && merge.bottom < c.activeSheet.rowCount - 1) { row = merge.bottom + 1; column = 0; }
        }
        c.select({ row, column });
      });
      return;
    }
    if (c.editing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "a") { event.preventDefault(); focusIntent.current = true; c.selectRange({ row: c.activeSheet.rowCount - 1, column: c.activeSheet.columnCount - 1 }, { row: 0, column: 0 }); return; }
      if (c.features.undoRedo && !c.readOnly && (key === "z" || key === "y")) { event.preventDefault(); focusIntent.current = true; if (key === "y" || event.shiftKey) c.redo(); else c.undo(); return; }
    }
    const directions: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault();
      const [r, col] = directions[event.key];
      focusIntent.current = true;
      const position = event.shiftKey ? selectionRanges(c.selection).at(-1)!.focus : c.selection.focus;
      c.select(nextCellPosition(c.activeSheet, position, r, col), event.shiftKey);
    } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); c.clearCells(); }
    else if (event.key === "Home") { event.preventDefault(); focusIntent.current = true; c.select({ row: event.ctrlKey || event.metaKey ? 0 : c.selection.focus.row, column: 0 }, event.shiftKey); }
    else if (event.key === "End") { event.preventDefault(); focusIntent.current = true; c.select({ row: c.selection.focus.row, column: c.activeSheet.columnCount - 1 }, event.shiftKey); }
  };

  const onBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusIntent.current = false;
  };
  const selectAll = () => {
    c.afterCommit(() => {
      focusIntent.current = true;
      c.selectRange({ row: c.activeSheet.rowCount - 1, column: c.activeSheet.columnCount - 1 }, { row: 0, column: 0 });
      c.requestGridFocus();
    });
  };
  return { scrollerRef, activeInputRef: activeInput, focusIntentRef: focusIntent, keyDown, onBlurCapture, selectAll };
}
