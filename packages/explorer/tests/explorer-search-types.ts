import type {
  ExplorerEntry,
  ExplorerLocationInfo,
  ExplorerPopupProps,
  ExplorerProps,
  ExplorerSearchContext,
  ExplorerSearchConditions,
  ExplorerSearchRenderContext,
  ExplorerSearchRenderer,
  ExplorerSearchHandler,
  ExplorerSearchOptions,
  ExplorerSearchRequest,
  ExplorerSearchHit,
  ExplorerSearchResult,
  ExplorerSearchStream,
  ExplorerSearchBatch,
  ExplorerSearchResponse,
} from "../src";

export const defaults = {} satisfies ExplorerSearchOptions;
export const input = { trigger: "input", debounceMs: 300 } satisfies ExplorerSearchOptions;
export const submit = { trigger: "submit" } satisfies ExplorerSearchOptions;
export const synchronous: ExplorerSearchHandler = () => ["ranked-first", "ranked-second"] as const;
export const hit = { entryId: "alpha", snippet: "Matching paragraph", reason: "Customer match", metadata: { customer: "A", pages: [1, 2] } } satisfies ExplorerSearchHit;
export const mixed: ExplorerSearchResult = ["beta", hit];
export const richSynchronous: ExplorerSearchHandler = () => mixed;
export const richAsynchronous: ExplorerSearchHandler = async () => mixed;
export const streaming: ExplorerSearchHandler = async function* () { yield [hit]; yield ["beta"]; };
export const promisedStream: ExplorerSearchHandler = async () => (async function* () { yield mixed; })();
export const batch: ExplorerSearchBatch = { hits: mixed, entries: [] };
export const response: ExplorerSearchResponse = batch;
export const hydratedHandler: ExplorerSearchHandler = () => batch;
export const hydratedAsyncHandler: ExplorerSearchHandler = async () => batch;
export const mixedBatchStream: ExplorerSearchStream = (async function* () { yield mixed; yield batch; })();
// @ts-expect-error Metadata batches require both hits and entries.
export const missingBatchHits: ExplorerSearchResponse = { entries: [] };
// @ts-expect-error Batch entries are complete ExplorerEntry metadata, not IDs.
export const invalidBatchEntries: ExplorerSearchBatch = { hits: mixed, entries: ["alpha"] };
export const streamType: ExplorerSearchStream = (async function* () { yield mixed; })();
// @ts-expect-error A stream yields batches, not individual hits.
export const invalidStream: ExplorerSearchStream = (async function* () { yield hit; })();
// @ts-expect-error Each yielded batch still has to contain valid result items.
export const numericStream: ExplorerSearchHandler = async function* () { yield [123]; };
export const detailHeight = { resultDetailsHeight: 120 } satisfies ExplorerSearchOptions;
// @ts-expect-error Supplemental text cannot be a rendered element or arbitrary object.
export const invalidSnippet: ExplorerSearchHit = { entryId: "alpha", snippet: { text: "paragraph" } };
// @ts-expect-error A rich result must identify an existing entry by entryId.
export const missingEntryId: ExplorerSearchHit = { snippet: "paragraph" };
// @ts-expect-error Metadata is a JSON object, not a scalar.
export const scalarMetadata: ExplorerSearchHit = { entryId: "alpha", metadata: "source" };
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


export const detailed = { matchCase: true, wholeName: false, useRegex: true } satisfies ExplorerSearchConditions;
export const withParams = { trigger: "submit", params: { extension: "xlsx", scope: ["current", "child"] } } satisfies ExplorerSearchOptions;
export const renderer: ExplorerSearchRenderer = (context: ExplorerSearchRenderContext) => {
  const text: string = context.query;
  const pending: boolean = context.searching;
  const error: string | null = context.error;
  const matching: boolean = context.conditions.matchCase;
  const params: Readonly<Record<string, unknown>> | undefined = context.params;
  if (!pending && text && matching && params && error) context.clear();
  context.setConditions({ useRegex: false });
  return context.defaultInput;
};
export const customUI = { ...explorer, renderSearch: renderer } satisfies ExplorerProps;
// @ts-expect-error Detail flags are boolean, not string tokens.
export const badConditions = { matchCase: "yes", wholeName: false, useRegex: false } satisfies ExplorerSearchConditions;
// @ts-expect-error Search presentation is synchronous; return a component for asynchronous UI.
export const asyncRenderer: ExplorerSearchRenderer = async context => context.defaultOptions;
