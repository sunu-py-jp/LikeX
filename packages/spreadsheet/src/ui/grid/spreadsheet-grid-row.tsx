"use client";

import { memo } from "react";
import { cellAddress } from "../../model";
import { effectiveCellFormat } from "../../model/formatting";
import { getMergedRange } from "../../model/merges";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { rangeBounds } from "../../state/selection";
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

type RowProps = {
  row: number; controller: SpreadsheetController; widths: number[]; columnOffsets: number[]; rowOffsets: number[]; gridWidth: number;
  renderedMerges: Map<number, SpreadsheetMergedRange>; visibleRows: ReadonlySet<number>; borderRows: readonly number[];
  selectedBounds: ReturnType<typeof rangeBounds>[]; conditional: ReturnType<typeof createConditionalFormatter>;
  focus: ReturnType<typeof useGridFocus>; selection: ReturnType<typeof useGridSelection>; rowResize: ReturnType<typeof useGridResize>;
};

/** Background batches do not recreate the cell trees of rows already mounted.
 * Event closures are reusable while their controller and geometry are unchanged. */
export const SpreadsheetGridRow = memo(function SpreadsheetGridRow({ row, controller: c, widths, columnOffsets, rowOffsets, gridWidth,
  renderedMerges, visibleRows, selectedBounds, conditional, focus, selection, rowResize }: RowProps) {
  const { activeInputRef: activeInput, keyDown } = focus;
  const { startSelection, extendSelection, selectHeaderWithKeyboard } = selection;
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
    <div role="rowheader" data-lxs-row-header={row} className={`lxs-row-header ${selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom) ? "lxs-header-selected" : ""}`}><button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row, column: 0 }, "row")} onPointerEnter={event => extendSelection(event, { row, column: 0 })} onClick={event => selectHeaderWithKeyboard(event, { row, column: 0 }, "row")}>{row + 1}</button>
      {c.features.resize && <span role="separator" aria-label={`${row + 1}行の高さ`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={1000} aria-valuenow={rowOffsets[row + 1] - rowOffsets[row]} tabIndex={c.disabled ? -1 : 0} className="lxs-row-resize" {...rowResize.handlers(row, rowOffsets[row + 1] - rowOffsets[row])} />}
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
          if (event.button !== 0 || (focused && c.editing)) return;
          // A later click in the selected input uses native caret placement.
          const input = activeInput.current;
          const singleCell = selectedBounds.length === 1 && selectedBounds[0].top === (merge?.top ?? row) &&
            selectedBounds[0].bottom === (merge?.bottom ?? row) && selectedBounds[0].left === (merge?.left ?? column) &&
            selectedBounds[0].right === (merge?.right ?? column);
          if (focused && singleCell && !c.disabled && !c.requesting && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
            input && event.target === input && input.ownerDocument.activeElement === input) {
            c.beginEdit({ row, column });
            return;
          }
          startSelection(event, { row, column }, "cell");
        }}
        onPointerEnter={event => extendSelection(event, { row, column })}
        onDoubleClick={() => { if (!c.editing) c.beginEdit({ row, column }); }}>
        {appearance.dataBar && <span aria-hidden="true" className="lxs-cell-data-bar" style={{ left: `${appearance.dataBar.start}%`, width: `${appearance.dataBar.width}%`, backgroundColor: appearance.dataBar.color }} />}
        {!editing && <CellText text={text} overflow={overflow} align={format?.align} shrink={!!format?.shrinkToFit && !format.wrap}
          revision={JSON.stringify({ format, width: cellWidth })} hidden={focused} />}
        {focused && <textarea rows={1} ref={focus.bindActiveInput} className="lxs-cell-input" data-passive={!editing || undefined} data-editing={editing || undefined} aria-label={`${address}の値`}  value={editing ? c.editing!.value : text} readOnly={c.disabled || c.requesting}
          onFocus={event => { if (!c.editing) event.currentTarget.setSelectionRange(0, 0); }}
          onChange={event => c.beginEdit({ row, column }, event.target.value)}
          onKeyDown={keyDown}
          onCompositionStart={focus.onCompositionStart}
          onBeforeInput={focus.onBeforeInput}
          onBlur={event => {
            // Opening view-only search must not commit unfinished cell input.
            if (!event.relatedTarget || !(event.relatedTarget as HTMLElement).closest("[data-lxs-formula], .lxs-search-dialog")) c.commitEdit();
          }}
        />}
        <CellDataControl controller={c} cell={cell} address={address} position={{ row, column }} focused={focused} editing={editing} />
        {comment && <button type="button" className="lxs-comment-marker" aria-label={`${address} のコメントを表示`} title={comment.text.slice(0, 200)}
          onPointerDown={event => { blurObjectEditor(event.currentTarget); event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); c.afterCommit(() => { c.select({ row, column }); c.setCommentOpen(true); }); }}
          onDoubleClick={event => event.stopPropagation()} /> }
      </div>;
      return merge ? <div key={column} className="lxs-cell-placeholder" style={{ width }}>{rendered}</div> : rendered;
    })}
  </div>;
}, (previous, next) => previous.row === next.row && previous.controller === next.controller &&
  previous.widths === next.widths && previous.columnOffsets === next.columnOffsets && previous.rowOffsets === next.rowOffsets &&
  previous.gridWidth === next.gridWidth && previous.renderedMerges === next.renderedMerges &&
  previous.selectedBounds === next.selectedBounds && previous.conditional === next.conditional &&
  previous.borderRows === next.borderRows && next.borderRows.every(row => previous.visibleRows.has(row) === next.visibleRows.has(row)));

/** All possible border owners for one row, including the sides of tall merges.
 * Cache per merge layout, so each background tick compares row membership only. */
export function createBorderRowLookup(merges: readonly SpreadsheetMergedRange[] = []) {
  const cache = new Map<number, readonly number[]>();
  return (row: number): readonly number[] => {
    const found = cache.get(row); if (found) return found;
    const result = new Set([row - 1, row]);
    let bottom = row;
    for (const merge of merges) if (merge.top === row) bottom = Math.max(bottom, merge.bottom);
    for (let index = row + 1; index <= bottom; index++) result.add(index);
    for (const merge of merges) if (merge.top <= bottom && merge.bottom >= row - 1) result.add(merge.top);
    const rows = [...result]; cache.set(row, rows); return rows;
  };
}
