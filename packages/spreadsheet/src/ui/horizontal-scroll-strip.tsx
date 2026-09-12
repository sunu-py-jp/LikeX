"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { horizontalScrollState, horizontalScrollTarget, type HorizontalScrollItem, type HorizontalScrollMetrics } from "./horizontal-scroll";

type Props = HTMLAttributes<HTMLDivElement> & {
  itemSelector: string; previousLabel: string; nextLabel: string; wrapperClassName?: string;
};
type ScrollRequest = { metrics: HorizontalScrollMetrics; items: HorizontalScrollItem[]; direction: "previous" | "next" };
const metricsFor = (node: HTMLDivElement): HorizontalScrollMetrics => ({ scrollLeft: node.scrollLeft || 0, scrollWidth: node.scrollWidth || 0, clientWidth: node.clientWidth || 0 });

/** Keeps the existing viewport's height and native scrolling, with arrows in
 * ordinary flex slots only while that direction has hidden content. */
export function HorizontalScrollStrip({ children, className, wrapperClassName, itemSelector, previousLabel, nextLabel, onScroll, id, ...props }: Props) {
  const generatedId = useId(), viewportId = id ?? generatedId;
  const viewport = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null);
  const previousSlot = useRef<HTMLDivElement>(null), nextSlot = useRef<HTMLDivElement>(null);
  const request = useRef<ScrollRequest | null>(null);
  const [state, setState] = useState({ overflow: false, previous: false, next: false });
  const update = useCallback(() => {
    const node = viewport.current; if (!node) return;
    const metrics = metricsFor(node);
    const slotWidth = (slot: HTMLDivElement | null) => slot && !slot.hidden ? slot.offsetWidth || 0 : 0;
    // Include occupied slots when deciding whether content would fit without
    // arrows, so a strip can return to zero reserved space after resizing.
    const next = horizontalScrollState(metrics, metrics.clientWidth + slotWidth(previousSlot.current) + slotWidth(nextSlot.current));
    setState(current => current.overflow === next.overflow && current.previous === next.previous && current.next === next.next ? current : next);
  }, []);
  const scrollToRequest = useCallback((width?: number) => {
    const node = viewport.current, pending = request.current;
    if (!node || !pending || !node.clientWidth) return;
    const left = horizontalScrollTarget({ ...pending.metrics, scrollWidth: node.scrollWidth }, pending.items, pending.direction, width ?? node.clientWidth);
    const behavior = node.ownerDocument?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (Math.abs(node.scrollLeft - left) <= 1) return;
    if (node.scrollTo) node.scrollTo({ left, behavior }); else node.scrollLeft = left;
  }, []);
  const move = (direction: "previous" | "next") => {
    const node = viewport.current; if (!node) return;
    const metrics = metricsFor(node), bounds = node.getBoundingClientRect?.();
    const scale = bounds?.width && node.offsetWidth ? bounds.width / node.offsetWidth : 1;
    const items = Array.from(node.querySelectorAll?.<HTMLElement>(itemSelector) ?? []).flatMap(item => {
      const rect = item.getBoundingClientRect?.();
      if (!bounds || !rect?.width) return [];
      const start = (rect.left - bounds.left) / scale - (node.clientLeft || 0) + metrics.scrollLeft;
      return [{ start, end: start + rect.width / scale }];
    });
    request.current = { metrics, items, direction };
    // The opposite arrow becomes available after the first movement. Account
    // for its slot now; a layout effect corrects terminal clamping afterwards.
    const missingSlot = direction === "next" ? !state.previous : !state.next;
    scrollToRequest(Math.max(1, metrics.clientWidth - (missingSlot ? 24 : 0)));
  };

  useLayoutEffect(() => { update(); scrollToRequest(); }, [state.previous, state.next, children, className, update, scrollToRequest]);
  useLayoutEffect(() => {
    const node = viewport.current, rail = wrapper.current;
    const view = node?.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
    if (!node || !rail || !view) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      if (view.requestAnimationFrame) frame = view.requestAnimationFrame(() => { frame = 0; update(); }); else update();
    };
    const resize = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
    const observeItems = () => {
      resize?.disconnect(); resize?.observe(node); resize?.observe(rail);
      node.querySelectorAll?.(itemSelector).forEach(item => resize?.observe(item));
    };
    const mutation = view.MutationObserver ? new view.MutationObserver(() => { observeItems(); schedule(); }) : null;
    mutation?.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
    for (let parent = rail.parentElement; parent; parent = parent.parentElement) mutation?.observe(parent, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    const cancelRequest = () => { request.current = null; };
    const finish = () => {
      const pending = request.current;
      if (pending && Math.abs(node.scrollLeft - horizontalScrollTarget({ ...pending.metrics, scrollWidth: node.scrollWidth }, pending.items, pending.direction, node.clientWidth)) <= 1) cancelRequest();
      schedule();
    };
    observeItems(); update();
    view.addEventListener?.("resize", schedule);
    node.ownerDocument.fonts?.addEventListener?.("loadingdone", schedule);
    for (const event of ["pointerdown", "wheel", "keydown", "focusin"]) node.addEventListener?.(event, cancelRequest);
    node.addEventListener?.("scrollend", finish);
    return () => {
      if (frame) view.cancelAnimationFrame?.(frame);
      resize?.disconnect(); mutation?.disconnect();
      view.removeEventListener?.("resize", schedule);
      node.ownerDocument.fonts?.removeEventListener?.("loadingdone", schedule);
      for (const event of ["pointerdown", "wheel", "keydown", "focusin"]) node.removeEventListener?.(event, cancelRequest);
      node.removeEventListener?.("scrollend", finish);
      request.current = null;
    };
  }, [itemSelector, update]);

  const arrow = (direction: "previous" | "next", label: string) => <button type="button" className="lxs-horizontal-scroll-arrow"
    aria-label={label} title={label} aria-controls={viewportId} data-lxs-scroll-direction={direction}
    hidden={!state[direction]} disabled={!state[direction]}
    onPointerDown={event => event.preventDefault()} onClick={() => move(direction)}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === "previous" ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} /></svg>
  </button>;
  return <div ref={wrapper} className={`lxs-horizontal-scroll-strip ${wrapperClassName ?? ""}`}>
    <div ref={previousSlot} className="lxs-horizontal-scroll-slot" hidden={!state.previous}>{arrow("previous", previousLabel)}</div>
    <div {...props} ref={viewport} id={viewportId} className={`lxs-horizontal-scroll-viewport ${className ?? ""}`} onScroll={event => { update(); onScroll?.(event); }}>{children}</div>
    <div ref={nextSlot} className="lxs-horizontal-scroll-slot" hidden={!state.next}>{arrow("next", nextLabel)}</div>
  </div>;
}
