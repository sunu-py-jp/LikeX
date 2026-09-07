"use client";

import { isComposingKeyEvent } from "../model/keyboard";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  clampSidebarWidth,
  sidebarLimits,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_DESKTOP_BREAKPOINT,
} from "../model/sidebar-size";

type Drag = {
  node: HTMLDivElement;
  pointerId: number;
  startX: number;
  startWidth: number;
};

function releaseDrag(dragRef: RefObject<Drag | null>) {
  const drag = dragRef.current;
  dragRef.current = null;
  if (!drag) return;
  delete drag.node.dataset.resizing;
  if (drag.node.hasPointerCapture(drag.pointerId))
    drag.node.releasePointerCapture(drag.pointerId);
}

export function useExplorerSidebarResize(
  enabled: boolean,
  containerRef: RefObject<HTMLElement | null>,
) {
  const [requestedWidth, setRequestedWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // A disabled feature resets its local preference as well as its visible width.
  if (!enabled && requestedWidth !== SIDEBAR_DEFAULT_WIDTH)
    setRequestedWidth(SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    const container = containerRef.current;
    const ownerWindow = container?.ownerDocument.defaultView;
    if (!container || !ownerWindow) return;
    const measure = () => {
      setContainerWidth(container.clientWidth);
      if (container.clientWidth < SIDEBAR_DESKTOP_BREAKPOINT)
        releaseDrag(dragRef);
    };
    const Observer = ownerWindow.ResizeObserver;
    const observer = Observer ? new Observer(measure) : null;
    observer?.observe(container);
    const frame = ownerWindow.requestAnimationFrame(measure);
    ownerWindow.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      ownerWindow.cancelAnimationFrame(frame);
      ownerWindow.removeEventListener("resize", measure);
      releaseDrag(dragRef);
    };
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) releaseDrag(dragRef);
    return () => releaseDrag(dragRef);
  }, [enabled]);

  const { min, max } = sidebarLimits(containerWidth);
  const width = clampSidebarWidth(
    enabled ? requestedWidth : SIDEBAR_DEFAULT_WIDTH,
    containerWidth,
  );
  const currentContainerWidth = () =>
    containerRef.current?.clientWidth ?? containerWidth;
  const canResize = () =>
    enabled && (currentContainerWidth() ?? 0) >= SIDEBAR_DESKTOP_BREAKPOINT;

  function setWidth(value: number) {
    if (canResize())
      setRequestedWidth(clampSidebarWidth(value, currentContainerWidth()));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canResize() || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    releaseDrag(dragRef);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.resizing = "true";
    dragRef.current = {
      node: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: clampSidebarWidth(requestedWidth, currentContainerWidth()),
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(drag.startWidth + event.clientX - drag.startX);
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    event.stopPropagation();
    releaseDrag(dragRef);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || isComposingKeyEvent(event) || event.altKey || event.ctrlKey || event.metaKey || !canResize()) return;
    const limits = sidebarLimits(currentContainerWidth());
    const step = event.shiftKey ? 50 : 10;
    const next = event.key === "ArrowLeft" ? width - step
      : event.key === "ArrowRight" ? width + step
      : event.key === "Home" ? limits.min
      : event.key === "End" ? limits.max
      : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(next);
  }

  return {
    enabled, width, min, max, onPointerDown, onPointerMove, onKeyDown,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onDoubleClick: () => setWidth(SIDEBAR_DEFAULT_WIDTH),
  };
}

export function ExplorerSidebarResizer({
  resize,
  controlsId,
}: {
  resize: ReturnType<typeof useExplorerSidebarResize>;
  controlsId: string;
}) {
  if (!resize.enabled) return null;
  return (
    <div
      role="separator"
      aria-label="サイドバーの幅"
      aria-orientation="vertical"
      aria-controls={controlsId}
      aria-valuemin={resize.min}
      aria-valuemax={resize.max}
      aria-valuenow={resize.width}
      aria-valuetext={`${resize.width}ピクセル`}
      title="ドラッグまたは左右キーで幅を変更、ダブルクリックで元に戻す"
      tabIndex={0}
      className="lxe:group lxe:relative lxe:z-10 lxe:hidden lxe:w-1.5 lxe:shrink-0 lxe:cursor-col-resize lxe:touch-none lxe:items-center lxe:justify-center lxe:bg-[var(--explorer-panel)] lxe:outline-none lxe:select-none lxe:hover:bg-[var(--explorer-selection)] lxe:focus-visible:bg-[var(--explorer-selection)] lxe:data-[resizing=true]:bg-[var(--explorer-selection)] lxe:@[720px]/explorer:flex"
      onPointerDown={resize.onPointerDown}
      onPointerMove={resize.onPointerMove}
      onPointerUp={resize.onPointerUp}
      onPointerCancel={resize.onPointerCancel}
      onLostPointerCapture={resize.onLostPointerCapture}
      onKeyDown={resize.onKeyDown}
      onDoubleClick={resize.onDoubleClick}
    >
      <span className="lxe:pointer-events-none lxe:h-8 lxe:w-0.5 lxe:rounded-full lxe:bg-[var(--explorer-border)] lxe:group-hover:bg-[var(--explorer-accent)] lxe:group-focus-visible:bg-[var(--explorer-accent)] lxe:group-data-[resizing=true]:bg-[var(--explorer-accent)]" />
    </div>
  );
}
