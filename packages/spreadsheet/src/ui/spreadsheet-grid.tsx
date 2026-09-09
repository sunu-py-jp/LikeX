"use client";

import { useMemo } from "react";
import { cellAddress } from "../model";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { rangeBounds, selectionRanges } from "../state/selection";
import { blurObjectEditor } from "../state/blur-object-editor";
import { SpreadsheetDrawings, SpreadsheetDrawingInspector } from "./spreadsheet-drawings";
import { displayCell } from "./grid/cell-display";
import { ROW_HEIGHT, ROW_HEADER_WIDTH } from "./grid/grid-geometry";
import { useGridLayout } from "./grid/use-grid-layout";
import { useGridFocus } from "./grid/use-grid-focus";
import { useGridSelection } from "./grid/use-grid-selection";
import { useColumnResize } from "./grid/use-column-resize";

export { displayCell } from "./grid/cell-display";
export { nextCellPosition } from "./grid/use-grid-focus";

/** Composes grid markup; viewport, focus and pointer state live in dedicated hooks. */
export function SpreadsheetGrid({ controller: c }: { controller: SpreadsheetController }) {
  const resize = useColumnResize(c);
  const { resizing } = resize;
  const layout = useGridLayout(c.activeSheet, c.selection.focus.row, resizing);
  const { scroller, widths, columnOffsets, rowOffsets, gridWidth, virtualRows, renderedMerges } = layout;
  const focus = useGridFocus(c, scroller, widths, rowOffsets);
  const { activeInputRef: activeInput, keyDown } = focus;
  const { startSelection, extendSelection, selectHeaderWithKeyboard } = useGridSelection(c, focus);
  const selectedBounds = useMemo(() => selectionRanges(c.selection).map(rangeBounds), [c.selection]);

  return <div className="lxs-grid-surface"><SpreadsheetDrawingInspector controller={c} /><div ref={scroller} tabIndex={-1} className="lxs-grid-scroll" onBlurCapture={focus.onBlurCapture} onScroll={layout.onScroll}>
    <div className="lxs-grid-canvas" style={{ width: gridWidth, height: rowOffsets.at(-1) }}><div role="grid" aria-label={c.activeSheet.name} aria-readonly={c.disabled} aria-rowcount={c.activeSheet.rowCount + 1} aria-colcount={c.activeSheet.columnCount + 1} aria-multiselectable="true" className="lxs-grid" style={{ width: gridWidth, height: rowOffsets.at(-1) }}>
      <div role="row" aria-rowindex={1} className="lxs-column-headers" style={{ width: gridWidth, height: ROW_HEIGHT }}>
        <div role="columnheader" className="lxs-corner" style={{ width: ROW_HEADER_WIDTH }} aria-label="行と列"><button type="button" className="lxs-header-button" aria-label="すべてのセルを選択" onClick={focus.selectAll}>◢</button></div>
        {widths.map((width, column) => <div role="columnheader" aria-colindex={column + 2} key={column} className={`lxs-column-header ${selectedBounds.some(bounds => column >= bounds.left && column <= bounds.right) ? "lxs-header-selected" : ""}`} style={{ width: resizing?.column === column ? resizing.value : width }}>
          <button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row: 0, column }, "column")} onPointerEnter={event => extendSelection(event, { row: 0, column })} onClick={event => selectHeaderWithKeyboard(event, { row: 0, column }, "column")}>{cellAddress(0, column).replace(/\d+$/, "")}</button>
          {c.features.resize && <span role="separator" aria-label={`${cellAddress(0, column).replace(/\d+$/, "")}列の幅`} aria-orientation="vertical" aria-valuemin={24} aria-valuemax={1000} aria-valuenow={width} tabIndex={c.disabled ? -1 : 0} className="lxs-column-resize"
            {...resize.handlers(column, width)} />}
        </div>)}
      </div>
      {virtualRows.map(row => <div key={row} role="row" aria-rowindex={row + 2} className="lxs-row" style={{ top: rowOffsets[row], height: c.activeSheet.rowHeights?.[row] ?? ROW_HEIGHT, width: gridWidth }}>
        <div role="rowheader" className={`lxs-row-header ${selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom) ? "lxs-header-selected" : ""}`}><button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row, column: 0 }, "row")} onPointerEnter={event => extendSelection(event, { row, column: 0 })} onClick={event => selectHeaderWithKeyboard(event, { row, column: 0 }, "row")}>{row + 1}</button></div>
        {widths.map((width, column) => {
          const merge = renderedMerges.get(row * c.activeSheet.columnCount + column);
          if (merge && (merge.top !== row || merge.left !== column)) {
            return <div key={column} className="lxs-cell-placeholder" aria-hidden="true" style={{ width }} />;
          }
          const address = cellAddress(row, column);
          const cell = c.activeSheet.cells[address];
          const comment = c.features.comments ? c.activeSheet.comments?.[address] : undefined;
          const value = c.calculated[c.activeSheet.id]?.[address];
          const text = displayCell(value, cell?.format);
          const selected = selectedBounds.some(bounds => row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right);
          const focused = row === c.selection.focus.row && column === c.selection.focus.column;
          const editing = focused && !!c.editing;
          const rendered = <div key={column} role="gridcell" aria-colindex={column + 2} aria-colspan={merge ? merge.right - merge.left + 1 : undefined} aria-rowspan={merge ? merge.bottom - merge.top + 1 : undefined} aria-selected={selected} aria-label={`${address}${text ? ` ${text}` : ""}${comment ? ", コメントあり" : ""}`} title={typeof value === "string" && value.startsWith("#") ? value : undefined}
            className={`lxs-cell ${merge ? "lxs-cell-merged" : ""} ${cell?.format?.background ? "lxs-cell-filled" : ""} ${selected ? "lxs-cell-selected" : ""} ${focused ? "lxs-cell-active" : ""} ${typeof value === "string" && value.startsWith("#") ? "lxs-cell-error" : ""}`}
            style={{ width: merge ? columnOffsets[merge.right + 1] - columnOffsets[merge.left] : width, height: merge ? rowOffsets[merge.bottom + 1] - rowOffsets[merge.top] : undefined, fontWeight: cell?.format?.bold ? 700 : undefined, fontStyle: cell?.format?.italic ? "italic" : undefined, textDecoration: cell?.format?.underline ? "underline" : undefined, textAlign: cell?.format?.align ?? (typeof value === "number" ? "right" : "left"), color: cell?.format?.color, backgroundColor: cell?.format?.background }}
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
          return merge ? <div key={column} className="lxs-cell-placeholder" style={{ width }}>{rendered}</div> : rendered;
        })}
      </div>)}
    </div><SpreadsheetDrawings controller={c} geometry={{ columnOffsets, rowOffsets }} /></div>
  </div></div>;
}
