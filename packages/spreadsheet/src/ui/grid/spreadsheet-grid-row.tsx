"use client";

import { memo, type RefObject } from "react";
import { cellAddress } from "../../model";
import { effectiveCellFormat } from "../../model/formatting";
import { getMergedRange } from "../../model/merges";
import { indexMerges, visitIndexedMerges, visitMergesForRow } from "../../model/merge-index";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { rangeBounds, selectionRanges } from "../../state/selection";
import { blurObjectEditor } from "../../state/blur-object-editor";
import { createConditionalFormatter } from "../../model/conditional-formatting";
import type { SpreadsheetMergedRange } from "../../model/types";
import type { useGridFocus } from "./use-grid-focus";
import type { useGridSelection } from "./use-grid-selection";
import type { useGridResize } from "./use-grid-resize";
import { displayCell } from "./cell-display";
import { CellDataControl } from "./cell-data-control";
import { cellFormatStyle, collapseSharedCellBorders } from "./cell-style";
import { fitCellBoxStyle } from "./cell-box-style";
import { CellText } from "./cell-text";
import { cellTextOverflow, rowTextOverflowLimits } from "./cell-text-layout";

type RowInteractions = {
  controller: SpreadsheetController; focus: ReturnType<typeof useGridFocus>;
  selection: ReturnType<typeof useGridSelection>; rowResize: ReturnType<typeof useGridResize>;
};
type RowProps = {
  row: number; controller: SpreadsheetController; widths: number[]; columnOffsets: number[]; rowOffsets: number[]; gridWidth: number;
  renderedMerges: Map<number, SpreadsheetMergedRange>; visibleRows: ReadonlySet<number>; borderRows: readonly number[];
  selectedBounds: ReturnType<typeof rangeBounds>[]; conditional: ReturnType<typeof createConditionalFormatter>;
  bindActiveInput: ReturnType<typeof useGridFocus>["bindActiveInput"];
  interactions: RefObject<RowInteractions>;
  hasDataControls: boolean;
};

/** Background work, cursor movement and toolbars do not recreate unchanged rows.
 * Handlers read committed interactions rather than retaining an old controller. */
export const SpreadsheetGridRow = memo(function SpreadsheetGridRow({ row, controller: c, widths, columnOffsets, rowOffsets, gridWidth,
  renderedMerges, visibleRows, selectedBounds, conditional, bindActiveInput, interactions }: RowProps) {
  const rowHeight = rowOffsets[row + 1] - rowOffsets[row];
  const currentResize = () => interactions.current.rowResize.handlers(row, rowHeight);
  const neighbourFormat = (row: number, column: number) => {
    const merge = getMergedRange(c.activeSheet, { row, column });
    const anchorRow = merge?.top ?? row, anchorColumn = merge?.left ?? column;
    if (!visibleRows.has(anchorRow)) return undefined;
    const address = cellAddress(anchorRow, anchorColumn);
    return conditional(anchorRow, anchorColumn, c.calculated[c.activeSheet.id]?.[address], effectiveCellFormat(c.activeSheet.cells[address])).format;
  };

  const textLimits = rowTextOverflowLimits(c.activeSheet, row, columnOffsets, renderedMerges,
    c.features.dataValidation && c.features.checkboxes, c.editing && c.selection.focus.row === row ? c.selection.focus.column : undefined);
  return <div key={row} role="row" aria-rowindex={row + 2} className="lxs-row" style={{ top: rowOffsets[row], height: rowOffsets[row + 1] - rowOffsets[row], width: gridWidth }}>
    <div role="rowheader" data-lxs-row-header={row} className={`lxs-row-header ${selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom) ? "lxs-header-selected" : ""}`}><button type="button" className="lxs-header-button" onPointerDown={event => interactions.current.selection.startSelection(event, { row, column: 0 }, "row")} onPointerEnter={event => interactions.current.selection.extendSelection(event, { row, column: 0 })} onClick={event => interactions.current.selection.selectHeaderWithKeyboard(event, { row, column: 0 }, "row")}>{row + 1}</button>
      {c.features.resize && <span role="separator" aria-label={`${row + 1}行の高さ`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={1000} aria-valuenow={rowHeight} tabIndex={c.disabled ? -1 : 0} className="lxs-row-resize"
        onDoubleClick={event => currentResize().onDoubleClick?.(event)} onKeyDown={event => currentResize().onKeyDown?.(event)}
        onPointerDown={event => currentResize().onPointerDown?.(event)} onPointerMove={event => currentResize().onPointerMove?.(event)}
        onPointerUp={event => currentResize().onPointerUp?.(event)} onPointerCancel={event => currentResize().onPointerCancel?.(event)}
        onLostPointerCapture={event => currentResize().onLostPointerCapture?.(event)} />}
    </div>
    {widths.map((width, column) => {
      const merge = renderedMerges.get(row * c.activeSheet.columnCount + column);
      if (merge && (merge.top !== row || merge.left !== column)) {
        return <div key={column} className="lxs-cell-placeholder" aria-hidden="true" style={{ width }} />;
      }
      const address = cellAddress(row, column);
      const cell = c.activeSheet.cells[address];
      const comment = c.features.comments ? c.activeSheet.comments?.[address] : undefined;
      const value = c.calculated[c.activeSheet.id]?.[address];
      const baseFormat = effectiveCellFormat(cell);
      const appearance = conditional(row, column, value, baseFormat), format = appearance.format;
      const text = displayCell(value, format);
      const error = baseFormat?.numberFormat !== "text" && typeof value === "string" && value.startsWith("#");
      const cellWidth = merge ? columnOffsets[merge.right + 1] - columnOffsets[merge.left] : width;
      const cellHeight = rowOffsets[(merge?.bottom ?? row) + 1] - rowOffsets[merge?.top ?? row];
      const checkbox = c.features.dataValidation && c.features.checkboxes && cell?.validation?.type === "checkbox";
      const selected = selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right);
      const focused = row === c.selection.focus.row && column === c.selection.focus.column;
      const editing = focused && !!c.editing;
      const overflow = cellTextOverflow(column, value, format, columnOffsets, textLimits, !!merge || !!checkbox || error || editing);
      const rendered = <div key={column} role="gridcell" data-lxs-row={row} data-lxs-column={column} data-editing={editing || undefined} aria-colindex={column + 2} aria-colspan={merge ? merge.right - merge.left + 1 : undefined} aria-rowspan={merge ? merge.bottom - merge.top + 1 : undefined} aria-selected={selected} aria-label={`${address}${text ? ` ${text}` : ""}${comment ? ", コメントあり" : ""}`} title={error ? value : undefined}
        className={`lxs-cell ${merge ? "lxs-cell-merged" : ""} ${overflow.before || overflow.after ? "lxs-cell-overflow" : ""} ${format?.background ? "lxs-cell-filled" : ""} ${format?.wrap ? "lxs-cell-wrap" : ""} ${checkbox ? "lxs-cell-has-checkbox" : ""} ${selected ? "lxs-cell-selected" : ""} ${focused ? "lxs-cell-active" : ""} ${error ? "lxs-cell-error" : ""}`}
        style={{ width: cellWidth, height: merge ? cellHeight : undefined,
          ...fitCellBoxStyle(collapseSharedCellBorders(cellFormatStyle(format, value), merge ?? { top: row, bottom: row, left: column, right: column }, neighbourFormat), cellWidth, cellHeight) }}
        onPointerDown={event => {
          const { controller: current, focus: currentFocus, selection: currentSelection } = interactions.current;
          if (event.button !== 0 || (focused && current.editing)) return;
          // A later click in the selected input uses native caret placement.
          const input = currentFocus.activeInputRef.current;
          const currentBounds = selectionRanges(current.selection).map(rangeBounds);
          const singleCell = currentBounds.length === 1 && currentBounds[0].top === (merge?.top ?? row) &&
            currentBounds[0].bottom === (merge?.bottom ?? row) && currentBounds[0].left === (merge?.left ?? column) &&
            currentBounds[0].right === (merge?.right ?? column);
          if (focused && singleCell && !current.disabled && !current.requesting && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
            input && event.target === input && input.ownerDocument.activeElement === input) {
            current.beginEdit({ row, column });
            return;
          }
          currentSelection.startSelection(event, { row, column }, "cell");
        }}
        onPointerEnter={event => interactions.current.selection.extendSelection(event, { row, column })}
        onDoubleClick={() => { const current = interactions.current.controller; if (!current.editing) current.beginEdit({ row, column }); }}>
        {appearance.dataBar && <span aria-hidden="true" className="lxs-cell-data-bar" style={{ left: `${appearance.dataBar.start}%`, width: `${appearance.dataBar.width}%`, backgroundColor: appearance.dataBar.color }} />}
        {!editing && <CellText text={text} overflow={overflow} align={format?.align} shrink={!!format?.shrinkToFit && !format.wrap}
          revision={JSON.stringify({ format, width: cellWidth })} hidden={focused} />}
        {focused && <textarea rows={1} ref={bindActiveInput} className="lxs-cell-input" data-passive={!editing || undefined} data-editing={editing || undefined} aria-label={`${address}の値`}  value={editing ? c.editing!.value : text} readOnly={c.disabled || c.requesting}
          onFocus={event => { if (!interactions.current.controller.editing) event.currentTarget.setSelectionRange(0, 0); }}
          onChange={event => interactions.current.controller.beginEdit({ row, column }, event.target.value)}
          onKeyDown={event => interactions.current.focus.keyDown(event)}
          onCompositionStart={() => interactions.current.focus.onCompositionStart()}
          onBeforeInput={event => interactions.current.focus.onBeforeInput(event)}
          onBlur={event => {
            // Opening view-only search must not commit unfinished cell input.
            if (!event.relatedTarget || !(event.relatedTarget as HTMLElement).closest("[data-lxs-formula], .lxs-search-dialog")) interactions.current.controller.commitEdit();
          }}
        />}
        <CellDataControl controller={c} getController={() => interactions.current.controller} cell={cell} address={address} position={{ row, column }} focused={focused} editing={editing} />
        {comment && <button type="button" className="lxs-comment-marker" aria-label={`${address} のコメントを表示`} title={comment.text.slice(0, 200)}
          onPointerDown={event => { blurObjectEditor(event.currentTarget); event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); const current = interactions.current.controller; current.afterCommit(() => { current.select({ row, column }); current.setCommentOpen(true); }); }}
          onDoubleClick={event => event.stopPropagation()} /> }
      </div>;
      return merge ? <div key={column} className="lxs-cell-placeholder" style={{ width }}>{rendered}</div> : rendered;
    })}
  </div>;
}, (previous, next) => previous.row === next.row && sameRowController(previous, next) &&
  previous.widths === next.widths && previous.columnOffsets === next.columnOffsets && previous.rowOffsets === next.rowOffsets &&
  previous.gridWidth === next.gridWidth && previous.renderedMerges === next.renderedMerges &&
  sameRowSelection(previous, next) && previous.conditional === next.conditional && previous.interactions === next.interactions && previous.bindActiveInput === next.bindActiveInput &&
  previous.borderRows === next.borderRows && next.borderRows.every(row => previous.visibleRows.has(row) === next.visibleRows.has(row)));

function sameRowController(previous: RowProps, next: RowProps) {
  const a = previous.controller, b = next.controller;
  return a.activeSheet === b.activeSheet && a.calculated[a.activeSheet.id] === b.calculated[b.activeSheet.id] &&
    a.disabled === b.disabled && a.requesting === b.requesting && previous.hasDataControls === next.hasDataControls &&
    (!next.hasDataControls || !!a.selectedDrawingId === !!b.selectedDrawingId) &&
    a.features.comments === b.features.comments && a.features.dataValidation === b.features.dataValidation &&
    a.features.checkboxes === b.features.checkboxes && a.features.resize === b.features.resize &&
    (a.selection.focus.row !== previous.row && b.selection.focus.row !== next.row || a.editing === b.editing);
}

function sameRowSelection(previous: RowProps, next: RowProps) {
  const row = next.row, a = previous.controller.selection.focus, b = next.controller.selection.focus;
  if ((a.row === row ? a.column : -1) !== (b.row === row ? b.column : -1)) return false;
  if (previous.selectedBounds === next.selectedBounds) return true;
  // Selection changes elsewhere must not rerender this row. Compare only its
  // horizontal intervals; header selection follows from those same intervals.
  let nextIndex = 0;
  for (const range of previous.selectedBounds) {
    if (row < range.top || row > range.bottom) continue;
    while (nextIndex < next.selectedBounds.length && (row < next.selectedBounds[nextIndex].top || row > next.selectedBounds[nextIndex].bottom)) nextIndex++;
    const other = next.selectedBounds[nextIndex++];
    if (!other || range.left !== other.left || range.right !== other.right) return false;
  }
  while (nextIndex < next.selectedBounds.length) {
    const range = next.selectedBounds[nextIndex++];
    if (row >= range.top && row <= range.bottom) return false;
  }
  return true;
}

/** All possible border owners for one row, including the sides of tall merges.
 * Cache per merge layout, so each background tick compares row membership only. */
export function createBorderRowLookup(merges: readonly SpreadsheetMergedRange[] = []) {
  const cache = new Map<number, readonly number[]>();
  const index = indexMerges(merges);
  return (row: number): readonly number[] => {
    const found = cache.get(row); if (found) return found;
    const result = new Set([row - 1, row]);
    let bottom = row;
    visitMergesForRow(index, row, merge => { if (merge.top === row) bottom = Math.max(bottom, merge.bottom); });
    for (let index = row + 1; index <= bottom; index++) result.add(index);
    visitIndexedMerges(index, { top: row - 1, bottom, left: 0, right: Infinity }, merge => result.add(merge.top));
    const rows = [...result]; cache.set(row, rows); return rows;
  };
}
