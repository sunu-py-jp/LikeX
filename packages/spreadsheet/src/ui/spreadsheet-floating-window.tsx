"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEventHandler, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export type SpreadsheetFloatingWindowFrame = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const resizeEdges: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
const themeVariables = ["primary", "on-primary", "primary-hover", "background", "foreground", "panel", "border", "muted", "accent", "selection", "hover", "error"];

function viewportSize(doc: Document): Size {
  return { width: doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0,
    height: doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0 };
}

function limits(size: Size) {
  const insetX = size.width >= 32 ? 8 : 0, insetY = size.height >= 32 ? 8 : 0;
  const width = Math.max(1, size.width - insetX * 2), height = Math.max(1, size.height - insetY * 2);
  return { insetX, insetY, width, height, minWidth: Math.min(340, width), minHeight: Math.min(220, height) };
}

/** Keep the complete window reachable within the browser viewport. */
export function fitSpreadsheetFloatingWindow(frame: SpreadsheetFloatingWindowFrame, size: Size): SpreadsheetFloatingWindowFrame {
  const limit = limits(size);
  const width = clamp(frame.width, limit.minWidth, limit.width), height = clamp(frame.height, limit.minHeight, limit.height);
  return { x: clamp(frame.x, limit.insetX, size.width - limit.insetX - width), y: clamp(frame.y, limit.insetY, size.height - limit.insetY - height), width, height };
}

export function resizeSpreadsheetFloatingWindow(frame: SpreadsheetFloatingWindowFrame, edge: ResizeEdge, dx: number, dy: number, size: Size): SpreadsheetFloatingWindowFrame {
  const start = fitSpreadsheetFloatingWindow(frame, size), limit = limits(size);
  let left = start.x, top = start.y, right = left + start.width, bottom = top + start.height;
  if (edge.includes("w")) left = clamp(left + dx, limit.insetX, right - limit.minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + limit.minWidth, size.width - limit.insetX);
  if (edge.includes("n")) top = clamp(top + dy, limit.insetY, bottom - limit.minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + limit.minHeight, size.height - limit.insetY);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A modeless window scoped to one spreadsheet. It neither covers nor traps focus in the sheet. */
export function SpreadsheetFloatingWindow({ title, children, onClose, onKeyDown, actions, initialFocusRef, frameRef, className = "" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  actions?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  frameRef?: RefObject<SpreadsheetFloatingWindowFrame | null>;
  className?: string;
}) {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    if (node) setRegion(node.closest<HTMLElement>("[data-likex-spreadsheet]"));
  }, []);
  const panel = useRef<HTMLDivElement>(null), latestFrame = useRef<SpreadsheetFloatingWindowFrame | null>(null);
  const [frame, setFrame] = useState<SpreadsheetFloatingWindowFrame | null>(null);
  const [theme, setTheme] = useState<{ colorMode: string; style: CSSProperties }>({ colorMode: "light", style: {} });
  const stopInteraction = useRef<(() => void) | null>(null);
  const id = useId();
  const updateFrame = useCallback((next: SpreadsheetFloatingWindowFrame) => {
    latestFrame.current = next;
    if (frameRef) frameRef.current = next;
    setFrame(previous => previous?.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next);
  }, [frameRef]);

  useLayoutEffect(() => {
    if (!region) return;
    const doc = region.ownerDocument, view = doc.defaultView;
    let previousSize: Size | null = null;
    const resize = () => {
      const size = viewportSize(doc);
      if (size.width <= 0 || size.height <= 0) return;
      if (previousSize?.width === size.width && previousSize.height === size.height) return;
      previousSize = size;
      stopInteraction.current?.();
      const bounds = region.getBoundingClientRect();
      updateFrame(fitSpreadsheetFloatingWindow(latestFrame.current ?? frameRef?.current ?? {
        x: bounds.left + (bounds.width - 560) / 2, y: bounds.top + Math.min(96, (bounds.height - 520) / 2), width: 560, height: 520,
      }, size));
    };
    resize();
    view?.addEventListener("resize", resize);
    return () => { view?.removeEventListener("resize", resize); stopInteraction.current?.(); };
  }, [region, updateFrame, frameRef]);

  useLayoutEffect(() => {
    if (!region) return;
    const view = region.ownerDocument.defaultView;
    if (!view) return;
    const syncTheme = () => {
      const computed = view.getComputedStyle(region), variables: Record<string, string> = {};
      // Preserve resolved instance colors and typography across the body portal boundary.
      for (const variable of themeVariables) variables[`--lxs-${variable}`] = computed.getPropertyValue(`--lxs-${variable}`).trim();
      const next = { colorMode: region.getAttribute("data-color-mode") ?? "light", style: {
        ...variables, font: computed.font, color: computed.color, colorScheme: computed.colorScheme,
        direction: computed.direction, letterSpacing: computed.letterSpacing,
      } as CSSProperties };
      setTheme(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    syncTheme();
    const observer = new view.MutationObserver(syncTheme);
    // A host can set theme variables on the spreadsheet itself or an ancestor.
    for (let element: HTMLElement | null = region; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeFilter: ["style", "class", "data-color-mode"] });
    }
    view.addEventListener("resize", syncTheme);
    return () => { observer.disconnect(); view.removeEventListener("resize", syncTheme); };
  }, [region]);

  const ready = frame !== null;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !ready) return;
    const doc = element.ownerDocument, previous = doc.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? element.querySelector<HTMLElement>(focusableSelector) ?? element).focus({ preventScroll: true });
    return () => {
      // Closing through an external handle must not steal focus from a cell or the host app.
      if (element.contains(doc.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [region, initialFocusRef, ready]);

  const beginInteraction = (event: ReactPointerEvent<HTMLElement>, edge?: ResizeEdge) => {
    if (event.button !== 0 || !region || !latestFrame.current) return;
    if (!edge && (event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    event.preventDefault(); event.stopPropagation();
    stopInteraction.current?.();
    const element = event.currentTarget, doc = region.ownerDocument, view = doc.defaultView;
    const pointerId = event.pointerId, x = event.clientX, y = event.clientY, start = latestFrame.current;
    let stopped = false;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault();
      const size = viewportSize(doc), dx = next.clientX - x, dy = next.clientY - y;
      updateFrame(edge ? resizeSpreadsheetFloatingWindow(start, edge, dx, dy, size) : fitSpreadsheetFloatingWindow({ ...start, x: start.x + dx, y: start.y + dy }, size));
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", end); doc.removeEventListener("pointercancel", end);
      element.removeEventListener("lostpointercapture", stop); view?.removeEventListener("blur", stop);
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      if (stopInteraction.current === stop) stopInteraction.current = null;
    };
    const end = (next: PointerEvent) => { if (next.pointerId === pointerId) stop(); };
    stopInteraction.current = stop;
    doc.addEventListener("pointermove", move, { passive: false }); doc.addEventListener("pointerup", end); doc.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", stop); view?.addEventListener("blur", stop);
    // The owner document listeners are also a fallback for hosts without pointer capture.
    try { element.setPointerCapture?.(pointerId); } catch { /* The pointer may already have been cancelled. */ }
  };

  return <><span hidden ref={anchor} />{region && createPortal(
    <div className="lxs-root lxs-floating-layer" data-color-mode={theme.colorMode} style={theme.style}>
    <div ref={panel} className={`lxs-floating-window lxs-form-dialog ${className}`} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} tabIndex={-1}
      style={frame ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height } : { visibility: "hidden" }}
      onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
        if (event.key === "Escape") { event.preventDefault(); stopInteraction.current?.(); onClose(); }
      }}>
      <div className="lxs-form-dialog-heading lxs-floating-window-heading" onPointerDown={event => beginInteraction(event)}>
        <h2 id={`${id}-title`}>{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <div className="lxs-floating-window-content">{children}</div>
      {actions && <div className="lxs-dialog-actions">{actions}</div>}
      {resizeEdges.map(edge => <div key={edge} className={`lxs-floating-window-resize lxs-floating-window-resize-${edge}`} aria-hidden="true" onPointerDown={event => beginInteraction(event, edge)} />)}
    </div></div>, region.ownerDocument.body,
  )}</>;
}
