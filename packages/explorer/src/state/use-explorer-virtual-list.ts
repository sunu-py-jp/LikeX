"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerViewMode } from "../model/config";
import type { ExplorerRevealRequest } from "./use-explorer-navigation";
import { EXPLORER_VIRTUAL_THRESHOLD, explorerListCell, explorerListLayout, explorerListRange, explorerListWindow, explorerListScrollTarget,
  type ExplorerListViewport } from "../model/virtual-list";

export function useExplorerVirtualList(entries: readonly ExplorerEntry[], view: ExplorerViewMode, compact: boolean,
  showLocation: boolean, showCardControls: boolean, resetKey: string, renamingEntryId: string | null,
  focusEntryRef: RefObject<((id: string) => void) | null>, revealRequest?: ExplorerRevealRequest | null) {
  const enabled = entries.length > EXPLORER_VIRTUAL_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [viewport, setViewport] = useState<ExplorerListViewport>({ width: 800, height: 600, top: 0, left: 0, lineHeight: 21 });
  const [pinned, setPinned] = useState<{ focus?: string; menu?: string; drag?: string }>({});
  const positions = useMemo(() => new Map(entries.map((entry, index) => [entry.id, index])), [entries]);
  const { width, height, lineHeight } = viewport;
  const layout = useMemo(() => explorerListLayout(entries.length, view, compact, showLocation, showCardControls,
    { width, height, lineHeight, top: 0, left: 0 }), [entries.length, view, compact, showLocation, showCardControls, width, height, lineHeight]);
  const indices = useMemo(() => enabled ? explorerListRange(layout, viewport,
    [...Object.values(pinned), renamingEntryId].flatMap(id => id && positions.has(id) ? [positions.get(id)!] : [])) : entries.map((_, index) => index),
  [enabled, layout, viewport, pinned, renamingEntryId, positions, entries]);
  const items = useMemo(() => indices.map(index => ({ entry: entries[index], index,
    style: enabled && view !== "details" ? { position: "absolute", ...explorerListCell(layout, index) } as CSSProperties : undefined })),
  [indices, entries, enabled, view, layout]);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !enabled) return;
    const line = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? "21") || 21;
    const next = { width: element.clientWidth || 800, height: element.clientHeight || 600,
      top: element.scrollTop, left: element.scrollLeft, lineHeight: line };
    setViewport(old => {
      if (old.width !== next.width || old.height !== next.height || old.lineHeight !== next.lineHeight) return next;
      const before = explorerListWindow(layout, old), after = explorerListWindow(layout, next);
      // Native scrolling moves the existing DOM. React updates only when the
      // mounted range changes, rather than rerendering on every pixel.
      return before.start === after.start && before.end === after.end ? old : next;
    });
  }, [enabled, layout]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = scrollRef.current;
    if (!element) return;
    const owner = element.ownerDocument.defaultView;
    const observer = owner?.ResizeObserver ? new owner.ResizeObserver(measure) : null;
    observer?.observe(element);
    owner?.addEventListener("resize", measure);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer?.disconnect(); owner?.removeEventListener("resize", measure); element.removeEventListener("scroll", measure); };
  }, [enabled, measure]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) { element.scrollTop = 0; element.scrollLeft = 0; measure(); }
    // Geometry changes retain the current scroll; only navigation/search/sort reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const pin = useCallback((kind: "focus" | "menu" | "drag", id: string | null) => {
    setPinned(old => old[kind] === (id ?? undefined) ? old : { ...old, [kind]: id ?? undefined });
  }, []);
  const reveal = useCallback((index: number, focus = false) => {
    const element = scrollRef.current;
    if (!element || !enabled || !entries[index]) return;
    if (focus) pendingFocus.current = entries[index].id;
    // Navigation can switch from a short list before the first ResizeObserver
    // update. Use current DOM geometry, not the previous folder's viewport.
    const liveViewport = { width: element.clientWidth || 800, height: element.clientHeight || 600,
      lineHeight: Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? "21") || 21,
      top: element.scrollTop, left: element.scrollLeft };
    const liveLayout = explorerListLayout(entries.length, view, compact, showLocation, showCardControls, liveViewport);
    const next = explorerListScrollTarget(liveLayout, liveViewport, index);
    element.scrollTop = next.top;
    element.scrollLeft = next.left;
    if (focus) pin("focus", entries[index].id);
    measure();
  }, [enabled, entries, view, compact, showLocation, showCardControls, measure, pin]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const focus = (id: string) => { const index = positions.get(id); if (index !== undefined) reveal(index, true); };
    focusEntryRef.current = focus;
    return () => { if (focusEntryRef.current === focus) focusEntryRef.current = null; };
  }, [enabled, focusEntryRef, positions, reveal]);
  const completedReveal = useRef<ExplorerRevealRequest | null>(null);
  useLayoutEffect(() => {
    if (!revealRequest || completedReveal.current === revealRequest) return;
    const index = positions.get(revealRequest.id);
    const element = scrollRef.current;
    if (index === undefined || !element) return;
    if (enabled) {
      const liveLineHeight = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? "21") || 21;
      if (viewport.width !== (element.clientWidth || 800) || viewport.height !== (element.clientHeight || 600) ||
        viewport.lineHeight !== liveLineHeight) {
        // Commit the new content dimensions before scrolling, or the browser
        // could clamp the offset against the previous, shorter layout.
        measure();
        return;
      }
      completedReveal.current = revealRequest;
      // The new listing and its scroll reset are committed before revealing.
      // Do not focus a row: a preview dialog may already own keyboard focus.
      reveal(index);
      return;
    }
    const target = Array.from(element.querySelectorAll<HTMLElement>("[data-explorer-entry-id]"))
      .find(row => row.dataset.explorerEntryId === revealRequest.id);
    if (!target) return;
    completedReveal.current = revealRequest;
    const bounds = element.getBoundingClientRect();
    const row = target.getBoundingClientRect();
    const header = view === "details" ? element.querySelector("thead")?.getBoundingClientRect().height ?? 0 : 0;
    const top = bounds.top + header;
    // Scroll only this Explorer, never the host page or another window.
    if (row.top < top) element.scrollTop -= top - row.top;
    else if (row.bottom > bounds.bottom) element.scrollTop += Math.min(row.bottom - bounds.bottom, row.top - top);
    if (row.left < bounds.left) element.scrollLeft -= bounds.left - row.left;
    else if (row.right > bounds.right) element.scrollLeft += Math.min(row.right - bounds.right, row.left - bounds.left);
  }, [revealRequest, enabled, positions, reveal, view, measure, viewport.width, viewport.height, viewport.lineHeight]);
  useLayoutEffect(() => {
    if (!renamingEntryId || !enabled) return;
    const index = positions.get(renamingEntryId);
    // Reveal a newly mounted editor before paint; this synchronizes scroll geometry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (index !== undefined) reveal(index);
    // Only entering rename should scroll; typing or manually scrolling must not fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renamingEntryId, enabled]);
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const element = scrollRef.current;
    const target = element && Array.from(element.querySelectorAll<HTMLElement>("[data-explorer-entry-id]")).find(row => row.dataset.explorerEntryId === id);
    if (target) { pendingFocus.current = null; target.focus({ preventScroll: true }); }
  }, [items]);

  return { enabled, scrollRef, items, layout, positions, pin, reveal,
    contentStyle: enabled && view !== "details" ? { display: "block", position: "relative", height: layout.height,
      ...(view === "list" ? { width: layout.width } : {}) } as CSSProperties : undefined };
}
