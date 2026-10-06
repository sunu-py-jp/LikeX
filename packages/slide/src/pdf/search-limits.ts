/** Counts are UTF-16 code units. Limits reject the search instead of publishing partial results. */
export const PDF_SEARCH_LIMITS = Object.freeze({ pageTextCharacters: 1_000_000,
  totalTextCharacters: 20_000_000, textItemsPerPage: 100_000, totalMatchRanges: 100_000 });
