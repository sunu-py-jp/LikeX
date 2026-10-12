import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createSearchPanelState, getInitialSearchMode, isSearchPanelQuery, notifyHost } from "../core";
import { searchDocument, type DocumentSearchMatch, type DocumentSearchTextMatch } from "../model/search";
import type { DocumentProps } from "../props";
import { useDocumentExternalSearch } from "./use-document-external-search";
import type { DocumentModel } from "../model/types";

export type DocumentSearchLocation = DocumentSearchMatch & { match: DocumentSearchTextMatch };

/** Search is view state; navigation never executes an editing command. */
export function useDocumentSearch(document: DocumentModel, enabled: boolean, reveal: (location: DocumentSearchLocation) => void, initial: Pick<DocumentProps, "initialSearchOpen" | "initialSearchQuery" | "initialSearchMode" | "externalSearch"> = {}) {
  const [request, setRequest] = useState(() => { const state = createSearchPanelState(initial); return { ...state, mode: getInitialSearchMode(initial), open: enabled && state.open }; });
  const external = useDocumentExternalSearch(document, initial.externalSearch);
  const [pane, setPane] = useState<"results" | "headings">("results");
  const [externalError, setExternalError] = useState<{ results: typeof external.results; message: string } | null>(null);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const latest = useRef({ enabled, reveal, external, options: initial.externalSearch, mounted: true });
  useLayoutEffect(() => { latest.current = { enabled, reveal, external, options: initial.externalSearch, mounted: true }; });
  useEffect(() => { latest.current.mounted = true; return () => { latest.current.mounted = false; }; }, []);
  if (!enabled && request.open) setRequest({ ...request, open: false });
  const open = enabled && request.open;
  const result = useMemo(() => {
    if (!open || request.mode !== "local" || !request.query.trim()) return { locations: [] as DocumentSearchLocation[], truncated: false, error: "" };
    try {
      const found = searchDocument(document, { keywords: [request.query], matchCase: caseSensitive }, { limit: 1000 });
      const locations = found.matches.flatMap(location => location.matches.map(match => ({ ...location, match })));
      return { locations: locations.slice(0, 1000), truncated: found.truncated || locations.length > 1000, error: "" };
    } catch (cause) {
      return { locations: [] as DocumentSearchLocation[], truncated: false, error: cause instanceof Error ? cause.message : "検索できませんでした。" };
    }
  }, [document, open, request.mode, request.query, caseSensitive]);
  const [cursor, setCursor] = useState<{ result: typeof result; index: number } | null>(null);
  const index = result.locations.length ? cursor?.result === result ? cursor.index : 0 : -1;
  const localActive = result.locations[index];
  const active = request.mode === "external" ? external.active?.location : localActive;
  const revealedIntent = useRef<string | null>(null);
  const externalInitialized = useRef(false);
  const intent = JSON.stringify([request.mode, request.query, caseSensitive, request.focus]);
  useEffect(() => {
    if (!open) { revealedIntent.current = null; return; }
    if (request.mode === "external") {
      const state = latest.current.external;
      if (externalInitialized.current || !state.results.length) return;
      const target = state.selectedId ?? latest.current.options?.initialResultId ?? state.results[0]?.result.id;
      if (target !== undefined) revealExternal(target);
      return;
    }
    if (revealedIntent.current === intent) return;
    revealedIntent.current = intent;
    if (localActive) latest.current.reveal(localActive);
  }, [open, intent, localActive, request.mode, external.results]);
  function openSearch(query?: string): boolean {
    if (!latest.current.mounted || !latest.current.enabled || (query !== undefined && !isSearchPanelQuery(query))) return false;
    setPane("results");
    setRequest(value => ({ ...value, mode: query === undefined ? value.mode : "local", open: true, query: query ?? value.query, focus: value.focus + 1 })); return true;
  }
  function revealExternal(id: string) {
    const state = latest.current;
    if (!state.mounted || !state.enabled) return false;
    externalInitialized.current = true;
    const row = state.external.results.find(row => row.result.id === id);
    if (!row?.location) { setExternalError({ results: state.external.results, message: row?.error ?? "検索結果が見つかりません。検索結果を更新してください。" }); return false; }
    state.external.setSelectedId(id); setExternalError(null); state.reveal(row.location);
    notifyHost(state.options?.onResultSelect, { ...row.result, target: { ...row.result.target } });
    return true;
  }
  function openExternalSearch(resultId?: string): boolean {
    const state = latest.current;
    if (!state.mounted || !state.enabled || !state.external.available || resultId !== undefined && (typeof resultId !== "string" || !state.external.results.some(row => row.result.id === resultId))) return false;
    setPane("results"); setExternalError(null);
    setRequest(value => ({ ...value, open: true, mode: "external", focus: value.focus + 1 }));
    if (resultId !== undefined) revealExternal(resultId);
    return true;
  }
  function goToExternal(index: number) {
    const rows = latest.current.external.results;
    if (!rows.length) return false;
    return revealExternal(rows[(index + rows.length) % rows.length].result.id);
  }
  function closeSearch() { if (latest.current.mounted) setRequest(value => ({ ...value, open: false })); }
  function goTo(index: number) {
    if (!open || !result.locations.length) return;
    const target = (index + result.locations.length) % result.locations.length;
    latest.current.reveal(result.locations[target]);
    setCursor({ result, index: target });
  }
  return { open, mode: request.mode, pane, setPane, external, externalError: (externalError?.results === external.results ? externalError.message : "") || external.active?.error || (external.selectedId && external.index < 0 ? "検索結果が見つかりません。検索結果を更新してください。" : ""), openExternalSearch, goToExternal, query: request.query, focus: request.focus, caseSensitive, setCaseSensitive, ...result, index, active,
    setQuery: (query: string) => setRequest(value => ({ ...value, query })), openSearch, closeSearch, goTo };
}
