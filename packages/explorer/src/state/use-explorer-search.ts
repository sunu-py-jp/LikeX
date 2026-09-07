"use client";

import { useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerLocationInfo } from "../model/events";
import { resolveExplorerSearchIds, type ExplorerSearchHandler, type ExplorerSearchOptions } from "../model/search";

type SearchOptions = {
  enabled: boolean;
  query: string;
  entries: readonly ExplorerEntry[];
  location: ExplorerLocationInfo;
  tabId: string;
  windowId: string;
  onSearchRequest?: ExplorerSearchHandler;
  trigger: NonNullable<ExplorerSearchOptions["trigger"]>;
  debounceMs?: number;
  /** Increment for an explicit submit or retry, including an unchanged query. */
  revision: number;
  ownerDocument: Document | null;
};

const EMPTY_IDS: readonly string[] = [];

/** Resolve external search independently of the local draft and per-tab input state. */
export function useExplorerSearch({ enabled, query, entries, location, tabId, windowId,
  onSearchRequest, trigger, debounceMs = 0, revision, ownerDocument }: SearchOptions) {
  const hasHandler = typeof onSearchRequest === "function";
  const normalizedQuery = query.trim();
  const delay = trigger === "input" && Number.isFinite(debounceMs) && debounceMs > 0
    ? Math.min(debounceMs, 2_147_483_647) : 0;
  const externalSearch = enabled && hasHandler && Boolean(normalizedQuery);
  const [resumeRevision, setResumeRevision] = useState(0);
  const { kind, id, name, path } = location;
  const key = useMemo(() => ({ enabled: externalSearch, query: normalizedQuery, entries,
    location: { kind, id, name, path } as ExplorerLocationInfo,
    tabId, windowId, delay, revision, ownerDocument, resumeRevision }),
  [externalSearch, normalizedQuery, entries, kind, id, name, path, tabId, windowId, delay, revision, ownerDocument, resumeRevision]);
  const handlerRef = useRef(onSearchRequest);
  const committedKey = useRef(key);
  useInsertionEffect(() => {
    handlerRef.current = onSearchRequest;
    committedKey.current = key;
  }, [onSearchRequest, key]);
  const previousRun = useRef({ tabId, windowId, revision });
  const [result, setResult] = useState<{
    key: typeof key;
    ids: readonly string[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const previous = previousRun.current;
    const submitted = previous.tabId === key.tabId && previous.windowId === key.windowId && previous.revision !== key.revision;
    previousRun.current = { tabId: key.tabId, windowId: key.windowId, revision: key.revision };
    if (!key.enabled) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => active && !controller.signal.aborted && committedKey.current === key;
    const run = async () => {
      if (!isCurrent()) return;
      const handler = handlerRef.current;
      if (!handler) return;
      try {
        const response = await handler({ query: key.query, entries: key.entries, location: key.location,
          tabId: key.tabId, windowId: key.windowId }, { signal: controller.signal });
        if (!isCurrent()) return;
        setResult({ key, ids: resolveExplorerSearchIds(response, key.entries), error: null });
      } catch (error) {
        if (!isCurrent()) return;
        setResult({ key, ids: EMPTY_IDS,
          error: error instanceof Error && error.message.trim() ? error.message : "検索できませんでした。もう一度お試しください。" });
      }
    };
    // A microtask avoids duplicate host requests during StrictMode's effect replay.
    if (key.delay && !submitted) timer = setTimeout(() => { void run(); }, key.delay);
    else void Promise.resolve().then(run);
    const owner = key.ownerDocument?.defaultView;
    const cancel = () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
    const resume = () => {
      // A page restored from the back/forward cache retains this mounted hook.
      if (active && controller.signal.aborted) setResumeRevision(value => value + 1);
    };
    owner?.addEventListener("pagehide", cancel);
    owner?.addEventListener("pageshow", resume);
    return () => {
      active = false;
      cancel();
      owner?.removeEventListener("pagehide", cancel);
      owner?.removeEventListener("pageshow", resume);
    };
  }, [key]);

  const current = result?.key === key ? result : null;
  return {
    resultIds: externalSearch ? current?.ids ?? EMPTY_IDS : null,
    searchPending: externalSearch && !current,
    searchError: externalSearch ? current?.error ?? null : null,
    externalSearch,
  };
}
