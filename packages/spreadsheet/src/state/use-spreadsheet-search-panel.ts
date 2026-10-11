import { useLayoutEffect, useRef, useState } from "react";
import { createSearchPanelState, isSearchPanelQuery, type SearchPanelInitialState } from "../core";

/** Search belongs to the view, independent of the ribbon and the editing session. */
export function useSpreadsheetSearchPanel(props: SearchPanelInitialState, features: { search: boolean; replace: boolean }, readOnly: boolean) {
  type State = { mode: "find" | "replace" | null; query: string; focus: number };
  const [request, setRequest] = useState<State>(() => {
    const initial = createSearchPanelState(props);
    return { mode: initial.open && features.search ? "find" : null, query: initial.query, focus: initial.focus };
  });
  const latest = useRef({ features, readOnly, mounted: true });
  useLayoutEffect(() => {
    latest.current = { features, readOnly, mounted: true };
    return () => { latest.current.mounted = false; };
  });
  const enabled = request.mode === "find" ? features.search : features.replace && !readOnly;
  if (request.mode && !enabled) setRequest({ ...request, mode: null });
  function openSearch(query?: string): boolean {
    if (!latest.current.mounted || !latest.current.features.search || query !== undefined && !isSearchPanelQuery(query)) return false;
    setRequest(previous => ({ mode: "find", query: query ?? previous.query, focus: previous.focus + 1 }));
    return true;
  }
  function openReplace(): boolean {
    if (!latest.current.mounted || !latest.current.features.replace || latest.current.readOnly) return false;
    setRequest(previous => ({ ...previous, mode: "replace", focus: previous.focus + 1 }));
    return true;
  }
  function closeSearch() {
    if (latest.current.mounted) setRequest(previous => ({ ...previous, mode: null }));
  }
  function setSearchPanelQuery(query: string) {
    if (latest.current.mounted) setRequest(previous => previous.query === query ? previous : { ...previous, query });
  }
  return { searchPanel: { ...request, mode: enabled ? request.mode : null }, openSearch, openReplace, closeSearch, setSearchPanelQuery };
}
