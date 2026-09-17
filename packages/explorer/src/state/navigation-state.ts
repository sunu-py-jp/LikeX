import type { TabViewState } from "./use-explorer-tabs";
import type { ExplorerLocation } from "./view-state";

/** Shared history/search/selection transition for GUI and host navigation. */
export function explorerLocationPatch(previous: TabViewState, location: ExplorerLocation,
  expanded: readonly string[], selectedIds: readonly string[] = [], record = true): Partial<TabViewState> {
  const changedLocation = previous.requestedLocation !== location;
  const history = record && changedLocation
    ? [...previous.history.slice(0, previous.historyIndex + 1), location] : previous.history;
  return {
    requestedLocation: location, selectedIds: [...selectedIds], anchor: selectedIds[0] ?? null,
    query: "", searchText: "", history,
    historyIndex: record && changedLocation ? history.length - 1 : previous.historyIndex,
    expanded: [...new Set([...previous.expanded, ...expanded])],
  };
}
