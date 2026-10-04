import type { ExplorerHistoryView, TabViewState } from "./use-explorer-tabs";
import type { ExplorerLocation } from "./view-state";

function captureView(previous: TabViewState): ExplorerHistoryView {
  return {
    query: previous.query, searchText: previous.searchText,
    searchConditions: { ...previous.searchConditions }, committedSearchConditions: { ...previous.committedSearchConditions },
    searchParams: previous.searchParams, searchParamsError: previous.searchParamsError,
    selectedIds: [...previous.selectedIds], anchor: previous.anchor,
  };
}
function captureHistory(previous: TabViewState) {
  const views = previous.history.map((_, index) => previous.historyViews?.[index]);
  views[previous.historyIndex] = captureView(previous);
  return views;
}

/** Shared history/search/selection transition for GUI and host navigation. */
export function explorerLocationPatch(previous: TabViewState, location: ExplorerLocation,
  expanded: readonly string[], selectedIds: readonly string[] = [], record = true): Partial<TabViewState> {
  // Leaving a search is a view transition even when its parent folder is unchanged.
  const push = record && (previous.requestedLocation !== location || Boolean(previous.query.trim()));
  const history = push ? [...previous.history.slice(0, previous.historyIndex + 1), location] : previous.history;
  const views = captureHistory(previous);
  return {
    requestedLocation: location, selectedIds: [...selectedIds], anchor: selectedIds[0] ?? null,
    query: "", searchText: "", restoredSearchParamsSource: undefined, history,
    historyViews: push ? [...views.slice(0, previous.historyIndex + 1), undefined] : views,
    historyIndex: push ? history.length - 1 : previous.historyIndex,
    expanded: [...new Set([...previous.expanded, ...expanded])],
  };
}

/** Save the departing view and restore the target without adding a history entry. */
export function explorerHistoryPatch(previous: TabViewState, index: number, location: ExplorerLocation,
  expanded: readonly string[], searchParamsSource: string): Partial<TabViewState> {
  if (index < 0 || index >= previous.history.length) return {};
  const historyViews = captureHistory(previous), view = historyViews[index];
  return {
    requestedLocation: location, historyIndex: index, historyViews,
    query: view?.query ?? "", searchText: view?.searchText ?? "",
    searchConditions: view?.searchConditions ?? previous.searchConditions,
    committedSearchConditions: view?.committedSearchConditions ?? previous.committedSearchConditions,
    searchParams: view?.searchParams, searchParamsError: view?.searchParamsError,
    selectedIds: [...(view?.selectedIds ?? [])], anchor: view?.anchor ?? null,
    searchRevision: previous.searchRevision + 1,
    restoredSearchParamsSource: view ? searchParamsSource : undefined,
    expanded: [...new Set([...previous.expanded, ...expanded])],
  };
}
