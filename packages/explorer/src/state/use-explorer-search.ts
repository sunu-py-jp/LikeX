"use client";

import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerLocationInfo } from "../model/events";
import { useExplorerSearchParams } from "./use-explorer-search-params";
import { createTextSearchMatcher } from "../model/core-text-search";
import { prepareExplorerSearchEntries } from "../model/search-entries";
import { DEFAULT_EXPLORER_SEARCH_CONDITIONS, createExplorerSearchResultAccumulator, type ExplorerSearchConditions, type ExplorerSearchHandler, type ExplorerSearchHit, type ExplorerSearchOptions, type ExplorerSearchResult, type ExplorerSearchResponse, type ExplorerSearchStream } from "../model/search";

type SearchOptions = {
  enabled: boolean;
  query: string;
  conditions?: ExplorerSearchConditions;
  params?: Readonly<Record<string, unknown>>;
  paramsError?: string | null;
  entries: readonly ExplorerEntry[];
  /** Cache hydration does not advance this revision; user edits and folder loads do. */
  searchDataRevision?: number;
  getSearchDataRevision?: () => number;
  getEntries?: () => readonly ExplorerEntry[];
  hydrateSearchEntries?: (entries: readonly ExplorerEntry[], expectedRevision: number) => { entries: readonly ExplorerEntry[]; addedCount: number } | null;
  /** Suspend external work during save/refresh without falling back to local matching. */
  externalPaused?: boolean;
  location: ExplorerLocationInfo;
  tabId: string;
  windowId: string;
  onSearchRequest?: ExplorerSearchHandler;
  trigger: NonNullable<ExplorerSearchOptions["trigger"]>;
  debounceMs?: number;
  pageSize?: number;
  /** Increment for an explicit submit or retry, including an unchanged query. */
  revision: number;
  ownerDocument: Document | null;
};

const EMPTY_IDS: readonly string[] = Object.freeze([]);
const EMPTY_HITS: readonly ExplorerSearchHit[] = Object.freeze([]);

/** Resolve external search independently of the local draft and per-tab input state. */
export function useExplorerSearch({ enabled, query, conditions = DEFAULT_EXPLORER_SEARCH_CONDITIONS, params: inputParams, paramsError, entries, location, tabId, windowId,
  onSearchRequest, trigger, debounceMs = 0, pageSize, revision, ownerDocument, searchDataRevision, getSearchDataRevision, getEntries, hydrateSearchEntries, externalPaused = false }: SearchOptions) {
  const parameters = useExplorerSearchParams(inputParams), params = parameters.params;
  const parameterError = paramsError ?? parameters.error;
  const hasHandler = typeof onSearchRequest === "function";
  const normalizedQuery = query.trim();
  const delay = trigger === "input" && Number.isFinite(debounceMs) && debounceMs > 0
    ? Math.min(debounceMs, 2_147_483_647) : 0;
  const limit = pageSize === undefined ? undefined : Number.isInteger(pageSize) && pageSize > 0 ? Math.min(1000, pageSize) : 100;
  const { matchCase, wholeName, useRegex } = conditions;
  const localError = useMemo(() => {
    if (!enabled || hasHandler || !normalizedQuery) return null;
    try { createTextSearchMatcher({ text: normalizedQuery, matchCase, wholeText: wholeName, useRegex }); return null; }
    catch (error) { return error instanceof Error ? error.message : "検索条件が不正です。"; }
  }, [enabled, hasHandler, normalizedQuery, matchCase, wholeName, useRegex]);
  const validationError = enabled && normalizedQuery ? parameterError ?? localError : null;
  const externalSearch = enabled && hasHandler && Boolean(normalizedQuery);
  const [resumeRevision, setResumeRevision] = useState(0);
  const { kind, id, name, path } = location;
  const dataKey = searchDataRevision ?? entries;
  const key = useMemo(() => ({ enabled: externalSearch && !validationError && !externalPaused, query: normalizedQuery, dataKey, conditions: { matchCase, wholeName, useRegex }, params,
    location: { kind, id, name, path } as ExplorerLocationInfo,
    tabId, windowId, delay, limit, revision, ownerDocument, resumeRevision }),
  [externalSearch, validationError, externalPaused, normalizedQuery, matchCase, wholeName, useRegex, params, dataKey, kind, id, name, path, tabId, windowId, delay, limit, revision, ownerDocument, resumeRevision]);
  const handlerRef = useRef(onSearchRequest);
  const committedKey = useRef(key);
  const cacheRef = useRef({ entries, getEntries, getSearchDataRevision, hydrateSearchEntries });
  useInsertionEffect(() => {
    handlerRef.current = onSearchRequest;
    committedKey.current = key;
    cacheRef.current = { entries, getEntries, getSearchDataRevision, hydrateSearchEntries };
  }, [onSearchRequest, key, entries, getEntries, getSearchDataRevision, hydrateSearchEntries]);
  const previousRun = useRef({ tabId, windowId, revision });
  const demandRef = useRef<{ key: typeof key; load: () => boolean } | null>(null);
  const loadMoreSearchResults = useCallback(() => committedKey.current === key && demandRef.current?.key === key
    ? demandRef.current.load() : false, [key]);
  const [result, setResult] = useState<{
    key: typeof key;
    ids: readonly string[];
    hits: readonly ExplorerSearchHit[];
    pending: boolean;
    error: string | null;
    hasMore: boolean;
    loadingMore: boolean;
    loadMoreError: string | null;
  } | null>(null);

  useEffect(() => {
    const previous = previousRun.current;
    const submitted = previous.tabId === key.tabId && previous.windowId === key.windowId && previous.revision !== key.revision;
    previousRun.current = { tabId: key.tabId, windowId: key.windowId, revision: key.revision };
    if (!key.enabled) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let iterator: AsyncIterator<ExplorerSearchResponse> | undefined;
    let iteratorClosed = false, iteratorDone = false;
    const closeIterator = () => {
      if (!iterator || iteratorClosed || iteratorDone) return;
      iteratorClosed = true;
      // Do not await return: a non-cooperative next() may keep it pending too.
      try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Cleanup must not replace the search error. */ }
    };
    const isCurrent = () => active && !controller.signal.aborted && committedKey.current === key &&
      (typeof key.dataKey !== "number" || !cacheRef.current.getSearchDataRevision || cacheRef.current.getSearchDataRevision() === key.dataKey);
    const accumulator = createExplorerSearchResultAccumulator(cacheRef.current.getEntries?.() ?? cacheRef.current.entries);
    const cursors = new Set<string>();
    let entryCount = 0, entryTextLength = 0;
    let hits = EMPTY_HITS, ids = EMPTY_IDS;
    let nextCursor: string | null = null, initialComplete = false, inFlight = false, loadingMore = false;
    let loadMoreError: string | null = null;
    const publish = (pending: boolean, error: string | null = null) => {
      if (isCurrent()) setResult({ key, hits, ids, pending, error, hasMore: nextCursor !== null, loadingMore, loadMoreError });
    };
    const append = (response: ExplorerSearchResponse): boolean => {
      if (!isCurrent()) return false;
      let result: ExplorerSearchResult, preparedEntries: ReturnType<typeof prepareExplorerSearchEntries> | undefined;
      let followingCursor: string | null = null;
      if (Array.isArray(response)) result = response;
      else {
        if (!response || typeof response !== "object" || Object.getPrototypeOf(response) !== Object.prototype && Object.getPrototypeOf(response) !== null)
          throw new Error("検索結果はヒットの配列または { hits, entries } で返してください");
        const hitProperty = Object.getOwnPropertyDescriptor(response, "hits"), entryProperty = Object.getOwnPropertyDescriptor(response, "entries");
        const cursorProperty = Object.getOwnPropertyDescriptor(response, "nextCursor");
        if (cursorProperty) {
          if (key.limit === undefined) throw new Error("nextCursor を返す検索には search.pageSize を指定してください");
          if (!("value" in cursorProperty)) throw new Error("検索ページの nextCursor に getter は使用できません");
          const cursor: unknown = cursorProperty.value;
          if (cursor !== null && (typeof cursor !== "string" || !cursor.trim() || cursor.length > 4096))
            throw new Error("検索ページの nextCursor は null または空でない 4,096 文字以内の文字列で指定してください");
          if (cursor !== null && cursors.has(cursor)) throw new Error("検索ページの nextCursor が繰り返されています");
          followingCursor = cursor;
        }
        if (!hitProperty || !("value" in hitProperty) || (!cursorProperty && !entryProperty) || entryProperty && !("value" in entryProperty))
          throw new Error("検索バッチには getter を使わず hits と entries を指定してください");
        result = hitProperty.value as ExplorerSearchResult;
        if (entryProperty && (!cursorProperty || entryProperty.value !== undefined)) {
          preparedEntries = prepareExplorerSearchEntries(entryProperty.value as readonly ExplorerEntry[]);
          if (preparedEntries.entries.length > 100_000 - entryCount || preparedEntries.textLength > 5_000_000 - entryTextLength)
            throw new Error("1 回の検索の entries は累計 100,000 件・文字列合計 5,000,000 文字以内で返してください");
        }
      }
      const preparedHits = accumulator.prepare(result);
      if (!isCurrent()) return false;
      let currentEntries = cacheRef.current.getEntries?.() ?? cacheRef.current.entries;
      if (preparedEntries) {
        if (!cacheRef.current.hydrateSearchEntries || typeof key.dataKey !== "number")
          throw new Error("検索結果の項目情報を取り込むには、フォルダの段階的な読み込みを有効にしてください");
        const merged = cacheRef.current.hydrateSearchEntries(preparedEntries.entries, key.dataKey);
        if (!merged) return false;
        currentEntries = merged.entries;
        entryCount += preparedEntries.entries.length; entryTextLength += preparedEntries.textLength;
      }
      const next = preparedHits.commit(currentEntries);
      if (next !== hits) { hits = next; ids = Object.freeze(hits.map(hit => hit.entryId)); }
      nextCursor = followingCursor;
      if (followingCursor !== null) cursors.add(followingCursor);
      return true;
    };
    const run = async (more = false) => {
      if (!isCurrent() || inFlight) return;
      const handler = handlerRef.current;
      if (!handler) return;
      inFlight = true;
      iterator = undefined; iteratorClosed = false; iteratorDone = false;
      loadingMore = more;
      loadMoreError = null;
      publish(!more);
      try {
        const response = await handler({ query: key.query, conditions: key.conditions, ...(key.params === undefined ? {} : { params: key.params }),
          ...(key.limit === undefined ? {} : { cursor: more ? nextCursor : null, limit: key.limit }),
          entries: cacheRef.current.getEntries?.() ?? cacheRef.current.entries, location: key.location,
          tabId: key.tabId, windowId: key.windowId }, { signal: controller.signal });
        if (response && !Array.isArray(response) && typeof (response as ExplorerSearchStream)[Symbol.asyncIterator] === "function") {
          iterator = (response as ExplorerSearchStream)[Symbol.asyncIterator]();
          if (!iterator || typeof iterator.next !== "function") throw new Error("検索ストリームが正しくありません。");
          if (!isCurrent()) { closeIterator(); return; }
          if (key.limit !== undefined) throw new Error("search.pageSize を指定した検索では AsyncIterable ではなく検索ページを返してください");
          let batches = 0;
          while (isCurrent()) {
            const step = await iterator.next();
            if (!isCurrent()) return;
            if (!step || typeof step !== "object") throw new Error("検索ストリームが正しくありません。");
            if (step.done) { iteratorDone = true; publish(false); return; }
            if (!append(step.value)) return;
            publish(true);
            // Also let finite, immediately-yielding generators paint and let an
            // empty-batch stream receive cancellation instead of starving the UI.
            if (++batches % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        } else {
          if (!isCurrent()) return;
          if (!append(response as ExplorerSearchResponse)) return;
          initialComplete = true;
          loadingMore = false;
          publish(false);
        }
      } catch (error) {
        if (!isCurrent()) return;
        const message = error instanceof Error && error.message.trim() ? error.message : "検索できませんでした。もう一度お試しください。";
        loadingMore = false;
        if (more) { loadMoreError = message; publish(false); }
        else publish(false, message);
      } finally {
        inFlight = false;
        closeIterator();
      }
    };
    demandRef.current = { key, load: () => {
      if (!isCurrent() || key.limit === undefined || !initialComplete || inFlight || nextCursor === null) return false;
      void run(true);
      return true;
    } };
    // A microtask avoids duplicate host requests during StrictMode's effect replay.
    if (key.delay && !submitted) timer = setTimeout(() => { void run(); }, key.delay);
    else void Promise.resolve().then(() => run());
    const owner = key.ownerDocument?.defaultView;
    const cancel = () => {
      controller.abort();
      closeIterator();
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
      if (demandRef.current?.key === key) demandRef.current = null;
      cancel();
      owner?.removeEventListener("pagehide", cancel);
      owner?.removeEventListener("pageshow", resume);
    };
  }, [key]);

  const current = result?.key === key ? result : null;
  return {
    resultIds: validationError ? EMPTY_IDS : externalSearch ? current?.ids ?? EMPTY_IDS : null,
    resultHits: validationError ? EMPTY_HITS : externalSearch ? current?.hits ?? EMPTY_HITS : null,
    searchPending: externalSearch && !validationError && !externalPaused && (current?.pending ?? true),
    searchError: validationError ?? (externalSearch ? current?.error ?? null : null),
    searchHasMore: externalSearch && !validationError && !externalPaused && (current?.hasMore ?? false),
    searchLoadingMore: externalSearch && !validationError && !externalPaused && (current?.loadingMore ?? false),
    searchLoadMoreError: externalSearch ? current?.loadMoreError ?? null : null,
    loadMoreSearchResults,
    externalSearch,
  };
}
