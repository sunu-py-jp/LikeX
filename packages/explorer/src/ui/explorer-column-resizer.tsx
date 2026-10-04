"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type MouseEvent } from "react";
import { isComposingKeyEvent } from "../model/keyboard";
import {
  EXPLORER_DETAILS_COLUMNS, EXPLORER_STANDARD_DETAILS_COLUMNS, DEFAULT_DETAILS_COLUMN_WIDTHS, COLUMN_MIN_WIDTHS, COLUMN_MAX_WIDTH,
  clampColumnWidth, normalizeColumnWidths, type ExplorerDetailsColumn, type ExplorerDetailsColumnWidths,
} from "../model/column-size";

type Drag = {
  node: HTMLDivElement;
  pointerId: number;
  column: ExplorerDetailsColumn;
  startX: number;
  widths: ExplorerDetailsColumnWidths;
};

export function useExplorerColumnResize(enabled: boolean, initialWidths?: Partial<ExplorerDetailsColumnWidths>,
  columns: readonly ExplorerDetailsColumn[] = EXPLORER_STANDARD_DETAILS_COLUMNS) {
  const [initial] = useState(() => ({ location: 240, updatedAt: 128, extension: 80, size: 96, ...normalizeColumnWidths(initialWidths) }));
  const [widths, setWidths] = useState<Partial<ExplorerDetailsColumnWidths>>(initial);
  const [tableElement, setElement] = useState<HTMLTableElement | null>(null);
  const [measuredNameWidth, setMeasuredNameWidth] = useState(DEFAULT_DETAILS_COLUMN_WIDTHS.name);
  const dragRef = useRef<Drag | null>(null);
  const setTableElement = useCallback((node: HTMLTableElement | null) => {
    setElement(node);
  }, []);
  const release = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    delete drag.node.dataset.resizing;
    if (drag.node.hasPointerCapture(drag.pointerId)) drag.node.releasePointerCapture(drag.pointerId);
  }, []);

  useEffect(() => {
    if (!enabled) release();
    return release;
  }, [enabled, columns, release]);

  useEffect(() => {
    const owner = tableElement?.ownerDocument.defaultView;
    if (!tableElement || !owner) return;
    const measure = () => {
      const width = tableElement.querySelector<HTMLElement>('th[data-explorer-column="name"]')?.getBoundingClientRect().width;
      if (width && Number.isFinite(width)) setMeasuredNameWidth(Math.round(width));
    };
    const Observer = owner.ResizeObserver;
    const observer = Observer ? new Observer(measure) : null;
    observer?.observe(tableElement);
    const frame = owner.requestAnimationFrame(measure);
    owner.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      owner.cancelAnimationFrame(frame);
      owner.removeEventListener("resize", measure);
      release();
    };
  }, [tableElement, release]);

  // Freeze the initial flexible name column when resizing begins. Other columns
  // then retain their actual widths instead of absorbing the dragged delta.
  function measuredWidths(): ExplorerDetailsColumnWidths {
    const result = { ...DEFAULT_DETAILS_COLUMN_WIDTHS, ...widths };
    for (const cell of tableElement?.querySelectorAll<HTMLElement>("th[data-explorer-column]") ?? []) {
      const column = cell.getAttribute("data-explorer-column") as ExplorerDetailsColumn;
      const width = cell.getBoundingClientRect().width;
      if (EXPLORER_DETAILS_COLUMNS.includes(column) && width > 0) result[column] = clampColumnWidth(column, width);
    }
    return result;
  }

  function getHandleProps(column: ExplorerDetailsColumn) {
    return {
      "aria-valuemin": COLUMN_MIN_WIDTHS[column],
      "aria-valuemax": COLUMN_MAX_WIDTH,
      "aria-valuenow": widths[column] ?? measuredNameWidth,
      "aria-valuetext": `${widths[column] ?? measuredNameWidth}ピクセル`,
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!enabled || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault(); event.stopPropagation();
        release();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.resizing = "true";
        const measured = measuredWidths();
        dragRef.current = { node: event.currentTarget, pointerId: event.pointerId, column, startX: event.clientX, widths: measured };
        setWidths(measured);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const drag = dragRef.current;
        if (!enabled || !drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        setWidths({ ...drag.widths, [drag.column]: clampColumnWidth(drag.column, drag.widths[drag.column] + event.clientX - drag.startX) });
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerId !== dragRef.current?.pointerId) return;
        event.stopPropagation(); release();
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerId !== dragRef.current?.pointerId) return;
        event.stopPropagation(); release();
      },
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerId === dragRef.current?.pointerId) release();
      },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (!enabled || event.defaultPrevented || isComposingKeyEvent(event) || event.altKey || event.ctrlKey || event.metaKey) return;
        const measured = measuredWidths();
        const step = event.shiftKey ? 50 : 10;
        const next = event.key === "ArrowLeft" ? measured[column] - step
          : event.key === "ArrowRight" ? measured[column] + step
          : event.key === "Home" ? COLUMN_MIN_WIDTHS[column]
          : event.key === "End" ? COLUMN_MAX_WIDTH : null;
        if (next === null) return;
        event.preventDefault(); event.stopPropagation();
        setWidths({ ...measured, [column]: clampColumnWidth(column, next) });
      },
      onClick(event: MouseEvent<HTMLDivElement>) { event.preventDefault(); event.stopPropagation(); },
      onDoubleClick(event: MouseEvent<HTMLDivElement>) {
        event.preventDefault(); event.stopPropagation();
        if (!enabled) return;
        release();
        setWidths({ ...measuredWidths(), [column]: initial[column] ?? DEFAULT_DETAILS_COLUMN_WIDTHS[column] });
      },
    };
  }

  const totalWidth = widths.name === undefined ? undefined
    : columns.reduce((total, column) => total + (widths[column] ?? DEFAULT_DETAILS_COLUMN_WIDTHS[column]), 0);
  return { enabled, widths, totalWidth, setTableElement, getHandleProps };
}

export function ExplorerColumnResizer({ resize, column, label }: {
  resize: Pick<ReturnType<typeof useExplorerColumnResize>, "enabled" | "getHandleProps">;
  column: ExplorerDetailsColumn;
  label: string;
}) {
  if (!resize.enabled) return null;
  return <div role="separator" aria-label={`${label}列の幅`} aria-orientation="vertical" tabIndex={0}
    title="ドラッグまたは左右キーで幅を変更、ダブルクリックで初期幅に戻す"
    className="lxe:absolute lxe:inset-y-0 lxe:right-0 lxe:z-10 lxe:w-2 lxe:cursor-col-resize lxe:touch-none lxe:select-none lxe:outline-none lxe:hover:bg-[var(--explorer-selection)] lxe:focus-visible:bg-[var(--explorer-selection)] lxe:data-[resizing=true]:bg-[var(--explorer-selection)]"
    {...resize.getHandleProps(column)} />;
}
