export type SearchPanelMode = "local" | "external";

/** A host-ranked navigation result. It is not a literal keyword match or a replace target. */
export type ExternalSearchResult<TTarget> = {
  /** Stable and unique within this result set. */
  id: string;
  title?: string;
  snippet?: string;
  locationLabel?: string;
  target: TTarget;
};

/** The host owns retrieval, ranking and refreshing stale results. No network request is made by the view. */
export type ExternalSearchOptions<TTarget> = {
  title?: string;
  results: readonly ExternalSearchResult<TTarget>[];
  /** Used once when this external result session first opens; otherwise starts with the first result. */
  initialResultId?: string;
  onResultSelect?: (result: ExternalSearchResult<TTarget>) => void;
};

/** View-only search state shared by the Office editors and PDF viewer. */
export type SearchPanelInitialState = {
  /** Read once at mount. Defaults to false; disabled search takes precedence. */
  initialSearchOpen?: boolean;
  /** Read once at mount, even when initially closed. Invalid values become empty. */
  initialSearchQuery?: string;
  /** External results default to external mode unless an initial keyword is supplied. Read once at mount. */
  initialSearchMode?: SearchPanelMode;
};

export type SearchPanelHandle = {
  /**
   * Open and focus search. Omitted query retains the previous text; "" clears it.
   * Returns false for disabled/unmounted views or invalid queries (over 4,096 characters).
   * Acceptance does not mean asynchronous search has completed.
   */
  openSearch(query?: string): boolean;
  /** Open host-supplied results. An explicit id requests navigation; false means unavailable/invalid. */
  openExternalSearch(resultId?: string): boolean;
  /** Close search without editing document data. Preserve the query for reopening. */
  closeSearch(): void;
};

export function isSearchPanelQuery(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096;
}

/** No DOM or React dependency; each view owns its state and focus lifecycle. */
export function createSearchPanelState(options: SearchPanelInitialState = {}) {
  return { open: options.initialSearchOpen === true,
    query: isSearchPanelQuery(options.initialSearchQuery) ? options.initialSearchQuery : "", focus: 0 };
}

export function getInitialSearchMode(options: SearchPanelInitialState & { externalSearch?: unknown } = {}): SearchPanelMode {
  if (!options.externalSearch || options.initialSearchMode === "local") return "local";
  if (options.initialSearchMode === "external") return "external";
  return isSearchPanelQuery(options.initialSearchQuery) && options.initialSearchQuery.trim() ? "local" : "external";
}

/** Reject malformed entries and duplicate ids without reordering host results. Targets are validated by each view. */
export function normalizeExternalSearchResults<TTarget>(results: readonly ExternalSearchResult<TTarget>[] | undefined): ExternalSearchResult<TTarget>[] {
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  return results.filter(result => {
    if (!result || typeof result !== "object" || typeof result.id !== "string" || !result.id.trim() || result.id.length > 4096 || seen.has(result.id) || result.target == null) return false;
    if ([result.title, result.snippet, result.locationLabel].some(value => value !== undefined && typeof value !== "string")) return false;
    seen.add(result.id);
    return true;
  });
}
