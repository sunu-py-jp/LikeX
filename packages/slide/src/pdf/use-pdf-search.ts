"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createSearchPanelState, getInitialSearchMode, isSearchPanelQuery, type SearchPanelMode } from "../core";
import { searchPdf } from "./search-pdf";
import type { PdfSearchMatch } from "./text-types";
import type { PdfSession } from "./use-pdf-document";
import type { SlidePdfViewerProps } from "./viewer-types";

type SearchState = ReturnType<typeof createSearchPanelState> & { mode: SearchPanelMode };
export type PdfSearchHit = { page: PdfSearchMatch; from: number; to: number };
type SearchResult = {
  state: SearchState; session: PdfSession; matchCase: boolean;
  hits: PdfSearchHit[]; truncated: boolean; error: string; index: number;
};

/** Search borrows the viewer's document. Cancelling a query never destroys the PDF being displayed. */
export function usePdfSearch(props: SlidePdfViewerProps, session: PdfSession | undefined, goToPage: (pageNumber: number) => boolean) {
  const [state, setState] = useState<SearchState>(() => ({ ...createSearchPanelState(props), open: props.features?.search !== false && props.initialSearchOpen === true, mode: getInitialSearchMode(props) }));
  const [pageTab, setPageTabState] = useState(false);
  const [matchCase, setCase] = useState(false), [result, setResult] = useState<SearchResult | null>(null);
  if (result && result.session !== session) setResult(null);
  const current = useRef({ active: false, props, session, goToPage, state, matchCase, pageTab });
  const pending = useRef<AbortController | null>(null);
  const stop = useCallback(() => { pending.current?.abort(); pending.current = null; }, []);
  useLayoutEffect(() => { current.current = { active: true, props, session, goToPage, state, matchCase, pageTab }; });
  useLayoutEffect(() => () => { current.current.active = false; stop(); }, [stop]);
  const update = useCallback((next: SearchState) => {
    stop(); current.current.state = next; setState(next); setResult(null);
  }, [stop]);
  const openSearch = useCallback((query?: string) => {
    const value = current.current;
    if (!value.active || value.props.features?.search === false || query !== undefined && !isSearchPanelQuery(query)) return false;
    update({ ...value.state, open: true, query: query ?? value.state.query, focus: value.state.focus + 1, mode: query === undefined ? value.state.mode : "local" });
    current.current.pageTab = false; setPageTabState(false); return true;
  }, [update]);
  const closeSearch = useCallback(() => {
    if (!current.current.active) return;
    update({ ...current.current.state, open: false });
  }, [update]);
  const setQuery = useCallback((query: string) => {
    if (!current.current.active || current.current.props.features?.search === false || !isSearchPanelQuery(query)) return;
    update({ ...current.current.state, query });
  }, [update]);
  const setMatchCase = useCallback((value: boolean) => {
    if (!current.current.active || current.current.props.features?.search === false) return;
    stop(); current.current.matchCase = value; setCase(value); setResult(null);
  }, [stop]);
  const enabled = props.features?.search !== false;
  useLayoutEffect(() => { if (!enabled) closeSearch(); }, [enabled, closeSearch]);
  useEffect(() => {
    if (!enabled || !state.open || state.mode !== "local" || !state.query || !session?.getPageText) return;
    const controller = new AbortController(); pending.current = controller;
    const alive = () => !controller.signal.aborted && current.current.active && current.current.props.features?.search !== false &&
      current.current.session === session && current.current.state === state && current.current.matchCase === matchCase;
    // searchPdf owns this lightweight adapter only. The PDF and its PDF.js worker
    // remain owned by usePdfDocument; no second document is loaded for a query.
    void searchPdf(async () => ({ pageCount: session.pageCount,
      getPageText: (pageNumber, options) => session.getPageText!(pageNumber, options?.signal),
      destroy: async () => {},
    }), { keywords: [state.query], matchCase }, { signal: controller.signal }).then(found => {
      if (!alive()) return;
      const hits = found.matches.flatMap(page => page.matches.map(({ from, to }) => ({ page, from, to })));
      setResult({ state, session, matchCase, hits, truncated: found.truncated, error: "", index: hits.length ? 0 : -1 });
      if (hits.length && !current.current.pageTab) current.current.goToPage(hits[0].page.pageNumber);
    }, cause => {
      if (alive()) setResult({ state, session, matchCase, hits: [], truncated: false,
        error: cause instanceof Error ? cause.message : "PDFを検索できませんでした。", index: -1 });
    }).finally(() => { if (pending.current === controller) pending.current = null; });
    return () => { controller.abort(); if (pending.current === controller) pending.current = null; };
  }, [enabled, state, session, matchCase]);
  const setExternalMode = useCallback(() => {
    const value = current.current;
    if (!value.active || value.props.features?.search === false || !value.props.externalSearch) return false;
    update({ ...value.state, mode: "external", open: true, focus: value.state.focus + 1 }); current.current.pageTab = false; setPageTabState(false); return true;
  }, [update]);
  const setPageTab = useCallback((value: boolean) => {
    if (!current.current.active || current.current.props.features?.search === false) return;
    current.current.pageTab = value; setPageTabState(value);
  }, []);
  const visibleResult = enabled && state.open && result?.state === state && result.session === session && result.matchCase === matchCase ? result : null;
  const selectResult = useCallback((value: SearchResult, index: number) => {
    const active = current.current;
    if (!active.active || active.props.features?.search === false || !active.state.open || active.state !== value.state ||
      active.session !== value.session || active.matchCase !== value.matchCase || !value.hits.length) return;
    const next = (index + value.hits.length) % value.hits.length;
    if (active.props.pageNumber !== undefined && !active.props.onPageChange) return;
    active.goToPage(value.hits[next].page.pageNumber);
    setResult(previous => previous === value ? { ...value, index: next } : previous);
  }, []);
  return {
    ...state, pageTab, open: enabled && state.open, matchCase, result: visibleResult,
    openSearch, closeSearch, setQuery, setMatchCase, setExternalMode, setPageTab,
    navigate: (index: number) => { if (visibleResult) selectResult(visibleResult, index); },
  };
}
export type PdfSearch = ReturnType<typeof usePdfSearch>;
