"use client";

import { useMemo, type CSSProperties, type RefObject } from "react";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { getSpreadsheetPrintLayout } from "../../model/print-settings";
import { printAreaAddress } from "../spreadsheet-print-toolbar";
import { ROW_HEADER_WIDTH, ROW_HEIGHT, type GridViewport } from "./grid-geometry";
import { visiblePrintSegments, type PrintAreaHandle } from "./print-area-geometry";
import { usePrintAreaDrag } from "./use-print-area-drag";

const edges: { handle: PrintAreaHandle; label: string; x: number; y: number; horizontal: boolean }[] = [
  { handle: "top", label: "印刷範囲の上辺を調整", x: 0, y: 0, horizontal: true },
  { handle: "right", label: "印刷範囲の右辺を調整", x: 1, y: 0, horizontal: false },
  { handle: "bottom", label: "印刷範囲の下辺を調整", x: 0, y: 1, horizontal: true },
  { handle: "left", label: "印刷範囲の左辺を調整", x: 0, y: 0, horizontal: false },
];

/** Decorations are independent of mounted cells; scrolling does not regenerate the whole sheet. */
export function SpreadsheetPrintArea({ controller: c, scroller, columnOffsets, rowOffsets, viewport }: {
  controller: SpreadsheetController; scroller: RefObject<HTMLDivElement | null>;
  columnOffsets: readonly number[]; rowOffsets: readonly number[]; viewport: GridViewport;
}) {
  const layout = useMemo(() => getSpreadsheetPrintLayout(c.activeSheet, { hiddenRows: c.filters.hiddenRows }), [c.activeSheet, c.filters.hiddenRows]);
  const gesture = usePrintAreaDrag(c, scroller, columnOffsets, rowOffsets);
  if (!layout) return null;
  const area = gesture.drag?.preview ?? layout.area, left = columnOffsets[area.left], top = rowOffsets[area.top];
  const right = columnOffsets[area.right + 1], bottom = rowOffsets[area.bottom + 1], width = right - left, height = bottom - top;
  const fullRight = columnOffsets.at(-1)!, fullBottom = rowOffsets.at(-1)!;
  const screenLeft = viewport.left ?? 0, screenRight = screenLeft + (viewport.width ?? 800), screenBottom = viewport.top + viewport.height;
  const rows = visiblePrintSegments(layout.rows, rowOffsets, viewport.top, screenBottom);
  const columns = visiblePrintSegments(layout.columns, columnOffsets, screenLeft, screenRight);
  const box = (x: number, y: number, w: number, h: number): CSSProperties => ({ left: x, top: y, width: Math.max(0, w), height: Math.max(0, h) });
  // Extremely narrow printable areas can create a page per cell. Bound decorative
  // labels independently of persisted settings, without allocating the full product.
  const pageStride = Math.max(1, Math.ceil(columns.length * rows.length / 512));
  const pages = [];
  for (let index = 0; index < columns.length * rows.length; index += pageStride) {
    const { segment: column, index: columnIndex } = columns[Math.floor(index / rows.length)];
    const { segment: row, index: rowIndex } = rows[index % rows.length];
    const page = columnIndex * layout.rows.length + rowIndex + 1;
    pages.push(<div key={page} className="lxs-print-page-number" aria-hidden="true"
      style={box(columnOffsets[column.start], rowOffsets[row.start], columnOffsets[column.end + 1] - columnOffsets[column.start], rowOffsets[row.end + 1] - rowOffsets[row.start])}>
      <span>{page} ページ</span></div>);
  }
  const breaks = (axis: "row" | "column") => {
    const visible = axis === "row" ? rows : columns, offsets = axis === "row" ? rowOffsets : columnOffsets;
    const manual = new Set(axis === "row" ? c.activeSheet.printSettings?.rowBreaks : c.activeSheet.printSettings?.columnBreaks);
    return visible.filter(({ index }) => index > 0).map(({ segment }) => {
      const index = segment.start, explicit = manual.has(index);
      const dragging = gesture.drag && "axis" in gesture.drag.target && gesture.drag.target.axis === axis && gesture.drag.target.index === index;
      const point = offsets[dragging ? gesture.drag!.breakIndex ?? index : index];
      const style = axis === "row" ? box(left, point, width, 0) : box(point, top, 0, height);
      const className = `lxs-print-page-break lxs-print-page-break-${axis}${explicit ? " lxs-print-page-break-manual" : ""}`;
      return <div key={`${axis}-${index}`} className={className} style={style} data-print-break={axis} data-print-break-index={index}>
        {explicit && gesture.editable && <button type="button" className="lxs-print-break-handle" aria-label={`${axis === "row" ? index + 1 + "行" : cellColumn(index) + "列"}の前の改ページを移動`}
          title="ドラッグまたは矢印キーで手動改ページを移動（Escで取消）" {...gesture.handlers({ axis, index })} />}
      </div>;
    });
  };
  return <div className="lxs-print-area-layer" role="group" aria-label={`印刷範囲 ${printAreaAddress(area)}、${layout.pageCount}ページ`}
    style={{ clipPath: `inset(${Math.max(ROW_HEIGHT, viewport.top + ROW_HEIGHT)}px 0 0 ${Math.max(ROW_HEADER_WIDTH, screenLeft + ROW_HEADER_WIDTH)}px)` }}>
    <div className="lxs-print-outside" style={box(ROW_HEADER_WIDTH, ROW_HEIGHT, fullRight - ROW_HEADER_WIDTH, top - ROW_HEIGHT)} />
    <div className="lxs-print-outside" style={box(ROW_HEADER_WIDTH, bottom, fullRight - ROW_HEADER_WIDTH, fullBottom - bottom)} />
    <div className="lxs-print-outside" style={box(ROW_HEADER_WIDTH, top, left - ROW_HEADER_WIDTH, height)} />
    <div className="lxs-print-outside" style={box(right, top, fullRight - right, height)} />
    {pages}{breaks("row")}{breaks("column")}
    <div className="lxs-print-area-frame" data-print-area={printAreaAddress(area)} style={box(left, top, width, height)} />
    {gesture.editable && edges.map(({ handle, label, x, y, horizontal }) => <button type="button" key={handle}
      className={`lxs-print-area-edge lxs-print-area-edge-${horizontal ? "horizontal" : "vertical"}`} data-print-edge={handle}
      aria-label={label} title={`${label}（境界線をドラッグ、または矢印キー。Shiftで10セル、Escで取消）`}
      style={{ left: left + width * x, top: top + height * y, width: horizontal ? width : 10, height: horizontal ? 10 : height }}
      {...gesture.handlers({ handle })} />)}
  </div>;
}

function cellColumn(index: number) { let label = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label; return label; }
