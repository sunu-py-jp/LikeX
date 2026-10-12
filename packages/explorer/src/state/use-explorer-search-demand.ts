"use client";

import { useInsertionEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Read actual scroll geometry: a pinned virtual row may be far outside the viewport. */
export function useExplorerSearchDemand(scrollRef: RefObject<HTMLDivElement | null>, options: {
  enabled: boolean;
  horizontal: boolean;
  count: number;
  contextKey: string;
  loading: boolean;
  error: string | null;
  loadMore(): boolean;
}) {
  const current = useRef(options);
  useInsertionEffect(() => { current.current = options; });
  const { enabled, horizontal, count, contextKey } = options;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) return;
    const owner = element.ownerDocument.defaultView;
    const demand = () => {
      const latest = current.current;
      if (!latest.enabled || latest.contextKey !== contextKey || latest.loading || latest.error || owner?.closed) return;
      // Hidden panes must not eagerly consume a remote result set.
      if (!(element.clientHeight > 0 && element.clientWidth > 0)) return;
      const extent = horizontal ? element.scrollWidth : element.scrollHeight;
      const viewport = horizontal ? element.clientWidth : element.clientHeight;
      const offset = horizontal ? element.scrollLeft : element.scrollTop;
      if (Number.isFinite(extent) && Number.isFinite(offset) && extent - viewport - offset <= 160) latest.loadMore();
    };
    const observer = owner?.ResizeObserver ? new owner.ResizeObserver(demand) : null;
    observer?.observe(element);
    owner?.addEventListener("resize", demand);
    element.addEventListener("scroll", demand, { passive: true });
    demand();
    return () => {
      observer?.disconnect();
      owner?.removeEventListener("resize", demand);
      element.removeEventListener("scroll", demand);
    };
    // Append only checks again if visible content grew. Loading/error transitions
    // cannot drain empty/duplicate pages or automatically retry failed requests.
  }, [scrollRef, enabled, horizontal, count, contextKey]);
}
