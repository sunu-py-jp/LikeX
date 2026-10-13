"use client";

import { useMemo } from "react";
import { SpreadsheetGridRow, createBorderRowLookup } from "./grid/spreadsheet-grid-row";
import { cellAddress } from "../model";
import { effectiveCellFormat } from "../model/formatting";
import { getMergedRange } from "../model/merges";
import { useGridEditorSize } from "./grid/use-grid-editor-size";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { rangeBounds, selectionRanges } from "../state/selection";
import { SpreadsheetDrawings, SpreadsheetDrawingInspector } from "./spreadsheet-drawings";
import { ROW_HEIGHT, ROW_HEADER_WIDTH } from "./grid/grid-geometry";
import { useGridLayout } from "./grid/use-grid-layout";
import { useGridZoom } from "./grid/use-grid-zoom";
import { useGridFocus } from "./grid/use-grid-focus";
import { useGridSelection } from "./grid/use-grid-selection";
import { useColumnResize } from "./grid/use-column-resize";
import { useGridResize } from "./grid/use-grid-resize";
import { useGridAutofill } from "./grid/use-grid-autofill";
import { SelectionOutline } from "./grid/selection-outline";
import { createConditionalFormatter } from "../model/conditional-formatting";

export { displayCell } from "./grid/cell-display";
export { nextCellPosition } from "./grid/use-grid-focus";

/** Composes grid markup; viewport, focus and pointer state live in dedicated hooks. */
export function SpreadsheetGrid({ controller: c }: { controller: SpreadsheetController }) {
  const resize = useColumnResize(c);
  const { resizing } = resize;
  const rowResize = useGridResize(c, "row");
  const layout = useGridLayout(c.activeSheet, c.selection.focus.row, resizing, rowResize.resizing, c.zoom, c.renderingMode);
  const { scroller, widths, columnOffsets, rowOffsets, gridWidth, virtualRows, renderedMerges } = layout;
  const drawingGeometry = useMemo(() => ({ columnOffsets, rowOffsets }), [columnOffsets, rowOffsets]);
  const drawingViewport = useMemo(() => ({ left: layout.viewport.left ?? 0, top: layout.viewport.top,
    width: layout.viewport.width ?? 800, height: layout.viewport.height }), [layout.viewport]);
  useGridZoom(c, scroller);
  const autofill = useGridAutofill(c, scroller, { columnOffsets, rowOffsets });
  const conditional = useMemo(() => createConditionalFormatter(c.activeSheet, c.calculated[c.activeSheet.id]), [c.activeSheet, c.calculated]);
  const focus = useGridFocus(c, scroller, widths, rowOffsets);
  const { activeInputRef: activeInput } = focus;
  const activeMerge = getMergedRange(c.activeSheet, c.selection.focus);
  const activeHeight = rowOffsets[(activeMerge?.bottom ?? c.selection.focus.row) + 1] - rowOffsets[activeMerge?.top ?? c.selection.focus.row];
  const activeAddress = cellAddress(c.selection.focus.row, c.selection.focus.column);
  const activeValue = c.calculated[c.activeSheet.id]?.[activeAddress];
  const activeFormat = conditional(c.selection.focus.row, c.selection.focus.column, activeValue, effectiveCellFormat(c.activeSheet.cells[activeAddress])).format;
  useGridEditorSize(activeInput, JSON.stringify({ focus: c.selection.focus, sheet: c.activeSheet.id, value: activeValue, editing: c.editing?.value, format: activeFormat, width: columnOffsets[(activeMerge?.right ?? c.selection.focus.column) + 1] - columnOffsets[activeMerge?.left ?? c.selection.focus.column] }), activeHeight, !!c.editing);
  const selectionHandlers = useGridSelection(c, focus, { columnOffsets, rowOffsets });
  const { startSelection, extendSelection, selectHeaderWithKeyboard } = selectionHandlers;
  const borderRows = useMemo(() => createBorderRowLookup(c.activeSheet.merges), [c.activeSheet.merges]);
  const selectedBounds = useMemo(() => selectionRanges(c.selection).map(rangeBounds), [c.selection]);
  const visibleRows = useMemo(() => new Set(virtualRows), [virtualRows]);
  return <div className="lxs-grid-surface"><SpreadsheetDrawingInspector controller={c} /><div ref={scroller} tabIndex={-1} className="lxs-grid-scroll" style={{ zoom: (c.zoom ?? 100) / 100 }} onBlurCapture={focus.onBlurCapture} onScroll={layout.onScroll}>
    <div className="lxs-grid-canvas" style={{ width: gridWidth, height: rowOffsets.at(-1) }}><div role="grid" aria-label={c.activeSheet.name} aria-readonly={c.disabled || c.requesting} aria-rowcount={c.activeSheet.rowCount + 1} aria-colcount={c.activeSheet.columnCount + 1} aria-multiselectable="true" className="lxs-grid" style={{ width: gridWidth, height: rowOffsets.at(-1) }}>
      <div role="row" aria-rowindex={1} className="lxs-column-headers" style={{ width: gridWidth, height: ROW_HEIGHT }}>
        <div role="columnheader" className="lxs-corner" style={{ width: ROW_HEADER_WIDTH }} aria-label="行と列"><button type="button" className="lxs-header-button" aria-label="すべてのセルを選択" onClick={focus.selectAll}>◢</button></div>
        {widths.map((width, column) => <div role="columnheader" data-lxs-column-header={column} aria-colindex={column + 2} key={column} className={`lxs-column-header ${selectedBounds.some(bounds => column >= bounds.left && column <= bounds.right) ? "lxs-header-selected" : ""}`} style={{ width: resizing?.column === column ? resizing.value : width }}>
          <button type="button" className="lxs-header-button" onPointerDown={event => startSelection(event, { row: 0, column }, "column")} onPointerEnter={event => extendSelection(event, { row: 0, column })} onClick={event => selectHeaderWithKeyboard(event, { row: 0, column }, "column")}>{cellAddress(0, column).replace(/\d+$/, "")}</button>
          {c.features.resize && <span role="separator" aria-label={`${cellAddress(0, column).replace(/\d+$/, "")}列の幅`} aria-orientation="vertical" aria-valuemin={1} aria-valuemax={1000} aria-valuenow={width} tabIndex={c.disabled ? -1 : 0} className="lxs-column-resize"
            {...resize.handlers(column, width)} />}
        </div>)}
      </div>
      {virtualRows.map(row => <SpreadsheetGridRow key={row} row={row} controller={c} widths={widths} columnOffsets={columnOffsets}
        rowOffsets={rowOffsets} gridWidth={gridWidth} renderedMerges={renderedMerges} visibleRows={visibleRows} borderRows={borderRows(row)}
        selectedBounds={selectedBounds} conditional={conditional} focus={focus} selection={selectionHandlers} rowResize={rowResize} />)}
    </div>{!c.selectedDrawingId && <SelectionOutline selection={c.selection} columnOffsets={columnOffsets} rowOffsets={rowOffsets} />}<SpreadsheetDrawings controller={c} geometry={drawingGeometry} viewport={c.renderingMode === "viewport" ? drawingViewport : undefined} />{autofill.preview}{autofill.handle}</div>
  </div></div>;
}
