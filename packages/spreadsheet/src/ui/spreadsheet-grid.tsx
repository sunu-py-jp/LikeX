"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cellAddress, resizeColumn } from "../model";
import { SpreadsheetDrawings, SpreadsheetDrawingInspector } from "./spreadsheet-drawings";
import { blurObjectEditor } from "../state/blur-object-editor";
import { COLUMN_WIDTH, ROW_HEIGHT, type SpreadsheetController, type CellFormat, type Position } from "../state/use-spreadsheet";
import { isCellSelected, isRangeSelected, rangeBounds, selectionRanges } from "../state/selection";

export function displayCell(value: string | number | boolean | undefined, format?: CellFormat) {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number" || !format?.numberFormat || format.numberFormat === "general") return String(value);
  if (format.numberFormat === "percent") return new Intl.NumberFormat("ja-JP", { style: "percent", maximumFractionDigits: 2 }).format(value);
  if (format.numberFormat === "currency") return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

type SelectionDrag = {
  kind: "cell" | "row" | "column";
  pointerId: number;
  origin: Position;
  toggleOnClick?: { anchor: Position; focus: Position };
};

export function SpreadsheetGrid({ controller: c }: { controller: SpreadsheetController }) {
  const scroller = useRef<HTMLDivElement>(null);
  const activeInput = useRef<HTMLInputElement>(null);
  const focusIntent = useRef(false);
  const lastFocusRequest = useRef(c.gridFocusRequest);
  const dragging = useRef<SelectionDrag | null>(null);
  const latest = useRef(c);
  useLayoutEffect(() => { latest.current = c; });
  const [viewport, setViewport] = useState({ top: 0, height: 480 });
  const [resizing, setResizing] = useState<{ column: number; start: number; width: number; value: number } | null>(null);
  const widths = Array.from({ length: c.activeSheet.columnCount }, (_, i) => resizing?.column === i ? resizing.value : c.activeSheet.columnWidths?.[i] ?? COLUMN_WIDTH);
  const columnOffsets = [48];
  for (const width of widths) columnOffsets.push(columnOffsets[columnOffsets.length - 1] + width);
  const gridWidth = widths.reduce((sum, width) => sum + width, 48);
  const selectedBounds = useMemo(() => selectionRanges(c.selection).map(rangeBounds), [c.selection]);
  const rowOffsets = useMemo(() => {
    const offsets = [ROW_HEIGHT];
    for (let row = 0; row < c.activeSheet.rowCount; row++) offsets.push(offsets[row] + (c.activeSheet.rowHeights?.[row] ?? ROW_HEIGHT));
    return offsets;
  }, [c.activeSheet.rowCount, c.activeSheet.rowHeights]);
  const rowAt = (position: number) => {
    let low = 0, high = rowOffsets.length - 1;
    while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (rowOffsets[middle] <= position) low = middle; else high = middle - 1; }
    return low;
  };
  const start = Math.max(0, rowAt(viewport.top) - 5);
  const end = Math.min(c.activeSheet.rowCount, rowAt(viewport.top + viewport.height) + 7);
  const virtualRows = Array.from({ length: end - start }, (_, i) => start + i);
  // Pin the active input while scrolling, preserving focus and IME composition.
  if (!virtualRows.includes(c.selection.focus.row)) virtualRows.push(c.selection.focus.row);
  virtualRows.sort((a, b) => a - b);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!scroller.current) return;
    const left = widths.slice(0, c.selection.focus.column).reduce((sum, width) => sum + width, 48);
    const right = left + widths[c.selection.focus.column];
    const top = rowOffsets[c.selection.focus.row];
    const bottom = rowOffsets[c.selection.focus.row + 1];
    const element = scroller.current;
    if (top < element.scrollTop + ROW_HEIGHT) element.scrollTop = top - ROW_HEIGHT;
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    if (left < element.scrollLeft + 48) element.scrollLeft = left - 48;
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
  useEffect(() => {
    const document = scroller.current?.ownerDocument;
    if (!document) return;
    const finish = (event: globalThis.PointerEvent) => {
      const drag = dragging.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragging.current = null;
      if (drag.toggleOnClick) {
        if (drag.kind === "cell") latest.current.toggleSelection(drag.toggleOnClick.focus);
        else latest.current.toggleSelectionRange(drag.toggleOnClick.anchor, drag.toggleOnClick.focus);
        latest.current.requestGridFocus();
      }
    };
    const cancel = () => { dragging.current = null; };
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    document.defaultView?.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      document.defaultView?.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => { dragging.current = null; }, [c.activeSheet.id]);

  const startSelection = (event: PointerEvent<HTMLElement>, position: Position, kind: SelectionDrag["kind"]) => {
    if (event.button !== 0) return;
    dragging.current = null;
    blurObjectEditor(event.currentTarget);
    if (!c.commitEdit()) return;
    event.preventDefault();
    const additive = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const origin = event.shiftKey ? c.selection.anchor : position;
    const range = kind === "row"
      ? { anchor: { row: origin.row, column: c.activeSheet.columnCount - 1 }, focus: { row: position.row, column: 0 } }
      : kind === "column"
        ? { anchor: { row: c.activeSheet.rowCount - 1, column: origin.column }, focus: { row: 0, column: position.column } }
        : { anchor: position, focus: position };
    const alreadySelected = kind === "cell" ? isCellSelected(c.selection, position) : isRangeSelected(c.selection, range);
    const toggleOnClick = additive && alreadySelected ? range : undefined;
    if (!toggleOnClick) {
      const accepted = kind === "cell" ? c.select(position, event.shiftKey, additive)
        : c.selectRange(range.anchor, range.focus, additive, event.shiftKey);
      if (!accepted) return;
    }
    dragging.current = { kind, pointerId: event.pointerId, origin, toggleOnClick };
    focusIntent.current = true;
    c.requestGridFocus();
    scroller.current?.focus({ preventScroll: true });
    if (position.row === c.selection.focus.row && position.column === c.selection.focus.column) {
      activeInput.current?.focus({ preventScroll: true }); activeInput.current?.select(); focusIntent.current = false;
    }
  };
  const extendSelection = (event: PointerEvent<HTMLElement>, position: Position) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Re-entry after releasing outside the document must not continue a stale drag.
    if (!(event.buttons & 1)) { dragging.current = null; return; }
    let accepted: boolean;
    if (drag.toggleOnClick) {
      if (drag.kind === "row" ? position.row === drag.origin.row : drag.kind === "column" ? position.column === drag.origin.column : position.row === drag.origin.row && position.column === drag.origin.column) return;
      if (drag.kind === "row") accepted = c.selectRange({ row: drag.origin.row, column: c.activeSheet.columnCount - 1 }, { row: position.row, column: 0 }, true);
      else if (drag.kind === "column") accepted = c.selectRange({ row: c.activeSheet.rowCount - 1, column: drag.origin.column }, { row: 0, column: position.column }, true);
      else accepted = c.selectRange(drag.origin, position, true);
      if (accepted) drag.toggleOnClick = undefined;
    } else if (drag.kind === "row") accepted = c.select({ row: position.row, column: 0 }, true);
    else if (drag.kind === "column") accepted = c.select({ row: 0, column: position.column }, true);
    else accepted = c.select(position, true);
    // A rejected addition must never turn the next pointer event into an extension
    // of the previous active range, or a release into a pending deselection.
    if (!accepted) { dragging.current = null; focusIntent.current = false; return; }
    focusIntent.current = true;
  };
  const selectHeaderWithKeyboard = (event: { detail: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, position: Position, kind: "row" | "column") => {
    // Pointer selection is handled on pointerdown; detail=0 covers keyboard/AT activation.
    if (event.detail !== 0 || !c.commitEdit()) return;
    focusIntent.current = true;
    const additive = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const origin = event.shiftKey ? c.selection.anchor : position;
    const anchor = kind === "row" ? { row: origin.row, column: c.activeSheet.columnCount - 1 } : { row: c.activeSheet.rowCount - 1, column: origin.column };
    const focus = kind === "row" ? { row: position.row, column: 0 } : { row: 0, column: position.column };
    if (additive) c.toggleSelectionRange(anchor, focus);
    else c.selectRange(anchor, focus, false, event.shiftKey);
    c.requestGridFocus();
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); c.cancelEdit(); activeInput.current?.select(); return; }
    if (event.key === "F2") { event.preventDefault(); c.beginEdit(); return; }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (c.commitEdit()) {
        focusIntent.current = true;
        let row = c.selection.focus.row + (event.key === "Enter" ? (event.shiftKey ? -1 : 1) : 0);
        let column = c.selection.focus.column + (event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0);
        if (column >= c.activeSheet.columnCount && row < c.activeSheet.rowCount - 1) { column = 0; row++; }
        if (column < 0 && row > 0) { column = c.activeSheet.columnCount - 1; row--; }
        c.select({ row, column });
      }
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
      c.select({ row: c.selection.focus.row + r, column: c.selection.focus.column + col }, event.shiftKey);
    } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); c.clearCells(); }
    else if (event.key === "Home") { event.preventDefault(); focusIntent.current = true; c.select({ row: event.ctrlKey || event.metaKey ? 0 : c.selection.focus.row, column: 0 }, event.shiftKey); }
    else if (event.key === "End") { event.preventDefault(); focusIntent.current = true; c.select({ row: c.selection.focus.row, column: c.activeSheet.columnCount - 1 }, event.shiftKey); }
  };

  return <div className="lxs-grid-surface"><SpreadsheetDrawingInspector controller={c} /><div ref={scroller} tabIndex={-1} className="lxs-grid-scroll" onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusIntent.current = false; }} onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    <div className="lxs-grid-canvas" style={{ width: gridWidth, height: rowOffsets.at(-1) }}><div role="grid" aria-label={c.activeSheet.name} aria-readonly={c.disabled} aria-rowcount={c.activeSheet.rowCount + 1} aria-colcount={c.activeSheet.columnCount + 1} aria-multiselectable="true" className="lxs-grid" style={{ width: gridWidth, height: rowOffsets.at(-1) }}>
      <div role="row" aria-rowindex={1} className="lxs-column-headers" style={{ width: gridWidth, height: ROW_HEIGHT }}>
        <div role="columnheader" className="lxs-corner" style={{ width: 48 }} aria-label="行と列"><button type="button" className="lxs-header-button" aria-label="すべてのセルを選択" onClick={() => { if (c.commitEdit()) { focusIntent.current = true; c.selectRange({ row: c.activeSheet.rowCount - 1, column: c.activeSheet.columnCount - 1 }, { row: 0, column: 0 }); c.requestGridFocus(); } }}>◢</button></div>
        {widths.map((width, column) => <div role="columnheader" aria-colindex={column + 2} key={column} className={`lxs-column-header ${selectedBounds.some(bounds => column >= bounds.left && column <= bounds.right) ? "lxs-header-selected" : ""}`} style={{ width: resizing?.column === column ? resizing.value : width }}>
          <button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row: 0, column }, "column")} onPointerEnter={event => extendSelection(event, { row: 0, column })} onClick={event => selectHeaderWithKeyboard(event, { row: 0, column }, "column")}>{cellAddress(0, column).replace(/\d+$/, "")}</button>
          {c.features.resize && <span role="separator" aria-label={`${cellAddress(0, column).replace(/\d+$/, "")}列の幅`} aria-orientation="vertical" aria-valuemin={24} aria-valuemax={1000} aria-valuenow={width} tabIndex={c.disabled ? -1 : 0} className="lxs-column-resize"
            onKeyDown={event => { if (c.disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); c.apply(wb => resizeColumn(wb, c.activeSheet.id, column, Math.min(1000, Math.max(24, width + (event.key === "ArrowLeft" ? -8 : 8))))); }}
            onPointerDown={event => { if (c.disabled) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing({ column, start: event.clientX, width, value: width }); }}
            onPointerMove={event => { if (resizing?.column === column) setResizing({ ...resizing, value: Math.min(1000, Math.max(24, resizing.width + event.clientX - resizing.start)) }); }}
            onPointerUp={event => { if (!resizing) return; event.currentTarget.releasePointerCapture(event.pointerId); c.apply(wb => resizeColumn(wb, c.activeSheet.id, column, resizing.value)); setResizing(null); }}
            onPointerCancel={() => setResizing(null)} />}
        </div>)}
      </div>
      {virtualRows.map(row => <div key={row} role="row" aria-rowindex={row + 2} className="lxs-row" style={{ top: rowOffsets[row], height: c.activeSheet.rowHeights?.[row] ?? ROW_HEIGHT, width: gridWidth }}>
        <div role="rowheader" className={`lxs-row-header ${selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom) ? "lxs-header-selected" : ""}`}><button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row, column: 0 }, "row")} onPointerEnter={event => extendSelection(event, { row, column: 0 })} onClick={event => selectHeaderWithKeyboard(event, { row, column: 0 }, "row")}>{row + 1}</button></div>
        {widths.map((width, column) => {
          const address = cellAddress(row, column);
          const cell = c.activeSheet.cells[address];
          const comment = c.features.comments ? c.activeSheet.comments?.[address] : undefined;
          const value = c.calculated[c.activeSheet.id]?.[address];
          const text = displayCell(value, cell?.format);
          const selected = selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right);
          const focused = row === c.selection.focus.row && column === c.selection.focus.column;
          const editing = focused && !!c.editing;
          return <div key={column} role="gridcell" aria-colindex={column + 2} aria-selected={selected} aria-label={`${address}${text ? ` ${text}` : ""}${comment ? ", コメントあり" : ""}`} title={typeof value === "string" && value.startsWith("#") ? value : undefined}
            className={`lxs-cell ${cell?.format?.background ? "lxs-cell-filled" : ""} ${selected ? "lxs-cell-selected" : ""} ${focused ? "lxs-cell-active" : ""} ${typeof value === "string" && value.startsWith("#") ? "lxs-cell-error" : ""}`}
            style={{ width: resizing?.column === column ? resizing.value : width, fontWeight: cell?.format?.bold ? 700 : undefined, fontStyle: cell?.format?.italic ? "italic" : undefined, textDecoration: cell?.format?.underline ? "underline" : undefined, textAlign: cell?.format?.align ?? (typeof value === "number" ? "right" : "left"), color: cell?.format?.color, backgroundColor: cell?.format?.background }}
            onPointerDown={event => {
              if (event.button !== 0 || (focused && c.editing)) return;
              startSelection(event, { row, column }, "cell");
            }}
            onPointerEnter={event => extendSelection(event, { row, column })}
            onDoubleClick={() => c.beginEdit({ row, column })}>
            {focused ? <input ref={activeInput} className="lxs-cell-input" aria-label={`${address}の値`} value={editing ? c.editing!.value : text} readOnly={c.disabled}
              onFocus={event => { if (!c.editing) event.currentTarget.select(); }}
              onChange={event => c.beginEdit({ row, column }, event.target.value)}
              onKeyDown={keyDown}
              onBlur={event => { if (!event.relatedTarget || !(event.relatedTarget as HTMLElement).closest("[data-lxs-formula]")) c.commitEdit(); }}
            /> : <span>{text}</span>}
            {comment && <button type="button" className="lxs-comment-marker" aria-label={`${address} のコメントを表示`} title={comment.text.slice(0, 200)}
              onPointerDown={event => { blurObjectEditor(event.currentTarget); event.preventDefault(); event.stopPropagation(); }}
              onClick={event => { event.stopPropagation(); if (c.commitEdit()) { c.select({ row, column }); c.setCommentOpen(true); } }}
              onDoubleClick={event => event.stopPropagation()} /> }
          </div>;
        })}
      </div>)}
    </div><SpreadsheetDrawings controller={c} geometry={{ columnOffsets, rowOffsets }} /></div>
  </div></div>;
}
