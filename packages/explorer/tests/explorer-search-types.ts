import type {
  ExplorerEntry,
  ExplorerLocationInfo,
  ExplorerPopupProps,
  ExplorerProps,
  ExplorerSearchContext,
  ExplorerSearchHandler,
  ExplorerSearchOptions,
  ExplorerSearchRequest,
} from "../src";

export const defaults = {} satisfies ExplorerSearchOptions;
export const input = { trigger: "input", debounceMs: 300 } satisfies ExplorerSearchOptions;
export const submit = { trigger: "submit" } satisfies ExplorerSearchOptions;
export const synchronous: ExplorerSearchHandler = () => ["ranked-first", "ranked-second"] as const;
export const asynchronous: ExplorerSearchHandler = async (request, context) => {
  const query: string = request.query;
  const entries: readonly ExplorerEntry[] = request.entries;
  const location: ExplorerLocationInfo = request.location;
  const tabId: string = request.tabId;
  const windowId: string = request.windowId;
  const signal: AbortSignal = context.signal;
  if (signal.aborted || !tabId || !windowId) return [];
  const folderId: string | null = location.kind === "folder" ? location.id : null;
  return entries.filter(entry => entry.name.includes(query) && (folderId === null || entry.parent === folderId))
    .map(entry => entry.id);
};
export const explorer = { initialEntries: [], search: input, onSearchRequest: asynchronous } satisfies ExplorerProps;
export const popup = { ...explorer, search: submit, renderTrigger: () => null } satisfies ExplorerPopupProps;
export const disabled = { ...explorer, features: { search: false } } satisfies ExplorerProps;

// @ts-expect-error Search trigger is a closed union of input and submit.
export const invalidTrigger = { trigger: "change" } satisfies ExplorerSearchOptions;
// @ts-expect-error Debounce is a numeric duration, not a CSS time string.
export const invalidDelay = { debounceMs: "300ms" } satisfies ExplorerSearchOptions;
// @ts-expect-error Search returns entry IDs, never numeric indices.
export const numericResult: ExplorerSearchHandler = () => [1, 2];
// @ts-expect-error Asynchronous results must also be string ID arrays.
export const numericAsyncResult: ExplorerSearchHandler = async () => [1, 2];
// @ts-expect-error Search cannot replace the draft by returning complete entries.
export const entryResult: ExplorerSearchHandler = request => request.entries;
// @ts-expect-error A completed search must explicitly return an ID array.
export const missingResult: ExplorerSearchHandler = async () => {};

export function rejectSearchMutation(request: ExplorerSearchRequest, context: ExplorerSearchContext) {
  // @ts-expect-error Query belongs to the immutable request.
  request.query = "other query";
  // @ts-expect-error Request entries cannot be replaced by the search handler.
  request.entries = [];
  // @ts-expect-error The request exposes a readonly entry array.
  request.entries.push(request.entries[0]);
  // @ts-expect-error Source tab identity is immutable.
  request.tabId = "other-tab";
  // @ts-expect-error Source window identity is immutable.
  request.windowId = "other-window";
  // @ts-expect-error Location metadata is readonly too.
  request.location.name = "other-folder";
  // @ts-expect-error The host cannot replace the component's abort signal.
  context.signal = new AbortController().signal;
}
