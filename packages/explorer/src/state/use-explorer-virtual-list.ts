"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerViewMode } from "../model/config";
import { EXPLORER_VIRTUAL_THRESHOLD, explorerListCell, explorerListLayout, explorerListRange, explorerListWindow, explorerListScrollTarget,
  type ExplorerListViewport } from "../model/virtual-list";

export function useExplorerVirtualList(entries: readonly ExplorerEntry[], view: ExplorerViewMode, compact: boolean,
  showLocation: boolean, showCardControls: boolean, resetKey: string, renamingEntryId: string | null,
  focusEntryRef: RefObject<((id: string) => void) | null>) {
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
    const next = explorerListScrollTarget(layout, { ...viewport, top: element.scrollTop, left: element.scrollLeft }, index);
    element.scrollTop = next.top;
    element.scrollLeft = next.left;
    if (focus) pin("focus", entries[index].id);
    measure();
  }, [enabled, entries, layout, viewport, measure, pin]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const focus = (id: string) => { const index = positions.get(id); if (index !== undefined) reveal(index, true); };
    focusEntryRef.current = focus;
    return () => { if (focusEntryRef.current === focus) focusEntryRef.current = null; };
  }, [enabled, focusEntryRef, positions, reveal]);
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
