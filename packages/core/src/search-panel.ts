/** View-only search state shared by the Office editors and PDF viewer. */
export type SearchPanelInitialState = {
  /** Read once at mount. Defaults to false; disabled search takes precedence. */
  initialSearchOpen?: boolean;
  /** Read once at mount, even when initially closed. Invalid values become empty. */
  initialSearchQuery?: string;
};

export type SearchPanelHandle = {
  /**
   * Open and focus search. Omitted query retains the previous text; "" clears it.
   * Returns false for disabled/unmounted views or invalid queries (over 4,096 characters).
   * Acceptance does not mean asynchronous search has completed.
   */
  openSearch(query?: string): boolean;
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
