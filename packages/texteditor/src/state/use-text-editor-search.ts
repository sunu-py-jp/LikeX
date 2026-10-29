"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createSearchPanelState, getInitialSearchMode, isSearchPanelQuery, normalizeExternalSearchResults } from "../core";
import type { OperationContext, SearchPanelMode } from "../core";
import { findTextEditorMatches } from "../model/search";
import type { TextEditorModel, TextEditorSearchOptions } from "../model/types";
import type { TextEditorSearchProps, TextEditorSearchRenderContext, TextEditorSearchResult } from "../search-types";

type SearchState = {
  open: boolean;
  mode: SearchPanelMode;
  query: Readonly<TextEditorSearchOptions>;
  results: readonly TextEditorSearchResult[];
  activeResultId: string | null;
  busy: boolean;
  error: string | null;
  focusVersion: number;
};
type Options = TextEditorSearchProps & {
  document: TextEditorModel;
  enabled: boolean;
  onNavigate(result: TextEditorSearchResult, context: OperationContext): boolean | Promise<boolean>;
  onClose?(): void;
};

/** Copy host results so retained input objects cannot alter an in-flight selection. */
export function normalizeTextEditorSearchResults(results: readonly TextEditorSearchResult[] | undefined, length: number): readonly TextEditorSearchResult[] {
  return Object.freeze(normalizeExternalSearchResults(results).filter(result => {
    const target = result.target;
    return target && Number.isSafeInteger(target.from) && Number.isSafeInteger(target.to) && target.from >= 0 && target.to >= target.from && target.to <= length;
  }).map(result => Object.freeze({ ...result, target: Object.freeze({ from: result.target.from, to: result.target.to }) })));
}
function normalizedQuery(query: TextEditorSearchOptions): Readonly<TextEditorSearchOptions> | null {
  if (!query || typeof query !== "object" || !isSearchPanelQuery(query.query)) return null;
  for (const key of ["caseSensitive", "wholeWord", "regex"] as const) if (query[key] !== undefined && typeof query[key] !== "boolean") return null;
  return Object.freeze({ query: query.query, caseSensitive: query.caseSensitive === true, wholeWord: query.wholeWord === true, regex: query.regex === true });
}
function sameQuery(left: TextEditorSearchOptions, right: TextEditorSearchOptions) {
  return left.query === right.query && !!left.caseSensitive === !!right.caseSensitive && !!left.wholeWord === !!right.wholeWord && !!left.regex === !!right.regex;
}
function searchContextData(current: Options, snapshot: SearchState, external: readonly TextEditorSearchResult[], active: boolean) {
  return {
    open: active && snapshot.open && current.enabled, mode: snapshot.mode, query: snapshot.query,
    title: snapshot.mode === "external" ? current.externalSearch?.title ?? "外部検索結果" : "検索",
    results: snapshot.mode === "external" ? external : snapshot.results, activeResultId: snapshot.activeResultId,
    busy: snapshot.busy, error: snapshot.error, externalAvailable: !!current.externalSearch, focusVersion: snapshot.focusVersion,
  };
}

/** Owns view-only search state. It never writes to the document or performs network I/O itself. */
export function useTextEditorSearch(options: Options) {
  const [state, setState] = useState<SearchState>(() => {
    const initial = createSearchPanelState(options);
    return { open: options.enabled && initial.open, mode: getInitialSearchMode(options), query: normalizedQuery({ query: initial.query })!, results: [], activeResultId: null, busy: false, error: null, focusVersion: initial.open ? 1 : 0 };
  });
  const stateRef = useRef(state), settings = useRef(options), alive = useRef(true);
  const request = useRef<AbortController | null>(null), requestVersion = useRef(0), navigationVersion = useRef(0), navigationAbort = useRef<AbortController | null>(null), externalOpened = useRef(false);
  const cancelNavigation = useCallback(() => { navigationVersion.current++; navigationAbort.current?.abort(); navigationAbort.current = null; }, []);
  useLayoutEffect(() => {
    if (settings.current.document !== options.document || !options.enabled) cancelNavigation();
    settings.current = options;
  });
  const externalResults = useMemo(() => normalizeTextEditorSearchResults(options.externalSearch?.results, options.document.text.length), [options.externalSearch, options.document.text.length]);
  const externalRef = useRef(externalResults);
  useLayoutEffect(() => { if (externalRef.current !== externalResults && stateRef.current.mode === "external") cancelNavigation(); externalRef.current = externalResults; });
  const commit = useCallback((next: Partial<SearchState> | ((current: SearchState) => SearchState)) => {
    if (!alive.current) return;
    stateRef.current = typeof next === "function" ? next(stateRef.current) : { ...stateRef.current, ...next };
    setState(stateRef.current);
  }, []);
  const cancelRequest = useCallback(() => { requestVersion.current++; request.current?.abort(); request.current = null; }, []);
  const cancelPending = useCallback(() => { cancelRequest(); cancelNavigation(); if (stateRef.current.busy) commit({ busy: false }); }, [cancelRequest, cancelNavigation, commit]);
  const currentResults = useCallback(() => stateRef.current.mode === "external" ? externalRef.current : stateRef.current.results, []);
  const selectResult = useCallback(async (id: string): Promise<boolean> => {
    const current = settings.current, before = stateRef.current;
    if (!alive.current || !current.enabled || !before.open || typeof id !== "string") return false;
    const result = currentResults().find(item => item.id === id);
    if (!result) return false;
    cancelNavigation();
    const version = navigationVersion.current, document = current.document, mode = before.mode, abort = new AbortController();
    navigationAbort.current = abort;
    try {
      const selected = await current.onNavigate(result, { signal: abort.signal, requestId: crypto.randomUUID() });
      if (!selected || !alive.current || !settings.current.enabled || settings.current.document !== document || version !== navigationVersion.current || !stateRef.current.open || stateRef.current.mode !== mode) return false;
      commit({ activeResultId: result.id });
      if (mode === "external") {
        try { void Promise.resolve(settings.current.externalSearch?.onResultSelect?.(result)).catch(() => {}); } catch { /* Selection observers do not reject navigation. */ }
      }
      return true;
    } catch (cause) {
      if (alive.current && version === navigationVersion.current) commit({ error: cause instanceof Error ? cause.message : "検索結果に移動できませんでした。" });
      return false;
    } finally { if (navigationAbort.current === abort) navigationAbort.current = null; }
  }, [cancelNavigation, commit, currentResults]);
  const openSearch = useCallback((query?: string): boolean => {
    if (!alive.current || !settings.current.enabled || query !== undefined && !isSearchPanelQuery(query)) return false;
    cancelPending();
    const before = stateRef.current, next = query === undefined ? before.query : normalizedQuery({ ...before.query, query })!;
    commit({ open: true, mode: "local", query: sameQuery(before.query, next) ? before.query : next, error: null, focusVersion: before.focusVersion + 1 });
    return true;
  }, [cancelPending, commit]);
  const openExternalSearch = useCallback((resultId?: string): boolean => {
    const current = settings.current;
    if (!alive.current || !current.enabled || !current.externalSearch || resultId !== undefined && typeof resultId !== "string") return false;
    const results = externalRef.current;
    if (resultId !== undefined && !results.some(item => item.id === resultId)) return false;
    const preferred = resultId ?? (!externalOpened.current ? current.externalSearch.initialResultId : stateRef.current.activeResultId);
    const selected = results.find(item => item.id === preferred) ?? results[0];
    externalOpened.current = true; cancelPending();
    commit({ open: true, mode: "external", activeResultId: selected?.id ?? null, busy: false, error: null, focusVersion: stateRef.current.focusVersion + 1 });
    if (selected) void selectResult(selected.id);
    return true;
  }, [cancelPending, commit, selectResult]);
  const closeSearch = useCallback((): boolean => {
    if (!alive.current) return false;
    const open = stateRef.current.open;
    cancelPending(); commit({ open: false });
    if (open) { try { void Promise.resolve(settings.current.onClose?.()).catch(() => {}); } catch { /* View observer only. */ } }
    return open;
  }, [cancelPending, commit]);
  const setQuery = useCallback((input: TextEditorSearchOptions): boolean => {
    const query = normalizedQuery(input);
    if (!alive.current || !settings.current.enabled || !query) return false;
    if (sameQuery(stateRef.current.query, query)) return true;
    cancelPending(); commit({ query, results: [], activeResultId: null, error: null });
    return true;
  }, [cancelPending, commit]);
  const syncSearch = useCallback((input: { query: TextEditorSearchOptions; open: boolean }): void => {
    const query = normalizedQuery(input.query), before = stateRef.current;
    if (!alive.current || !settings.current.enabled || before.mode !== "local" || !query || typeof input.open !== "boolean") return;
    if (sameQuery(before.query, query) && before.open === input.open) return;
    cancelPending(); commit({ query: sameQuery(before.query, query) ? before.query : query, open: input.open });
  }, [cancelPending, commit]);
  const move = useCallback(async (direction: 1 | -1): Promise<boolean> => {
    const results = currentResults();
    if (!results.length) return false;
    const active = results.findIndex(result => result.id === stateRef.current.activeResultId);
    const index = active < 0 ? direction > 0 ? 0 : results.length - 1 : (active + direction + results.length) % results.length;
    return selectResult(results[index].id);
  }, [currentResults, selectResult]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancelRequest(); cancelNavigation(); };
  }, [cancelRequest, cancelNavigation]);
  useEffect(() => {
    if (!options.enabled) { closeSearch(); return; }
    if (stateRef.current.mode === "external" && stateRef.current.open) openExternalSearch();
  }, [options.enabled, closeSearch, openExternalSearch]);
  useEffect(() => {
    if (stateRef.current.mode !== "external") return;
    if (!options.externalSearch) { closeSearch(); return; }
    if (stateRef.current.activeResultId && !externalResults.some(result => result.id === stateRef.current.activeResultId)) commit({ activeResultId: null });
  }, [externalResults, options.externalSearch, closeSearch, commit]);
  useEffect(() => {
    cancelRequest();
    const before = stateRef.current, current = settings.current;
    if (!current.enabled || !before.open || before.mode !== "local" || !current.onSearchRequest && !current.renderSearch) {
      if (before.busy) commit({ busy: false });
      return;
    }
    const document = current.document, query = before.query;
    if (!query.query) { commit({ results: [], activeResultId: null, busy: false, error: null }); return; }
    const version = requestVersion.current, abort = new AbortController(); request.current = abort;
    commit({ results: [], activeResultId: null, busy: true, error: null });
    const context = { signal: abort.signal, requestId: crypto.randomUUID() };
    const valid = () => alive.current && !abort.signal.aborted && requestVersion.current === version && settings.current.enabled && settings.current.document === document && settings.current.onSearchRequest === current.onSearchRequest && settings.current.searchParams === current.searchParams && settings.current.renderSearch === current.renderSearch && stateRef.current.open && stateRef.current.mode === "local" && stateRef.current.query === query;
    void Promise.resolve().then(() => {
      if (!valid()) return [];
      if (current.onSearchRequest) return current.onSearchRequest({ document, query, params: current.searchParams }, context);
      return findTextEditorMatches(document, query).map((target, index) => ({ id: `local:${index}:${target.from}:${target.to}`, target, snippet: document.text.slice(Math.max(0, target.from - 30), Math.min(document.text.length, target.to + 70)), locationLabel: `${target.from}–${target.to}` }));
    }).then(results => {
      if (!valid()) return;
      const normalized = normalizeTextEditorSearchResults(results, document.text.length);
      commit({ results: normalized, activeResultId: null, busy: false, error: null });
    }).catch(cause => {
      if (valid()) commit({ results: [], activeResultId: null, busy: false, error: cause instanceof Error ? cause.message : "検索に失敗しました。" });
    });
    return () => { abort.abort(); if (request.current === abort) request.current = null; };
  }, [state.open, state.mode, state.query, state.focusVersion, options.document, options.enabled, options.onSearchRequest, options.searchParams, options.renderSearch, cancelRequest, commit]);
  const controls = useMemo(() => ({
    setQuery, openSearch, openExternalSearch, selectResult, next: () => move(1), previous: () => move(-1), close: closeSearch,
  }), [setQuery, openSearch, openExternalSearch, selectResult, move, closeSearch]);
  const getContext = useCallback((): TextEditorSearchRenderContext => Object.freeze({ ...searchContextData(settings.current, stateRef.current, externalRef.current, alive.current), ...controls }), [controls]);
  const getState = useCallback(() => Object.freeze({ ...stateRef.current, open: alive.current && settings.current.enabled && stateRef.current.open, results: currentResults() }), [currentResults]);
  const context: TextEditorSearchRenderContext = { ...searchContextData(options, state, externalResults, true), ...controls };
  return { context, getContext, getState, openSearch, openExternalSearch, closeSearch, setQuery, selectResult, syncSearch, cancelPending };
}
