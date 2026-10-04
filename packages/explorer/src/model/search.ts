import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import type { ExplorerLocationInfo } from "./events";
import { serializeStableJson } from "../core";

export type ExplorerSearchConditions = Readonly<{
  /** Distinguish uppercase and lowercase characters. Defaults to false. */
  matchCase: boolean;
  /** Match the complete filename, including its extension. Defaults to false. */
  wholeName: boolean;
  /** Treat the query as a regular expression. Defaults to false. */
  useRegex: boolean;
}>;
export const DEFAULT_EXPLORER_SEARCH_CONDITIONS: ExplorerSearchConditions = Object.freeze({ matchCase: false, wholeName: false, useRegex: false });

export type ExplorerSearchOptions = Readonly<{
  /** Search as text changes, or only after Enter. Defaults to input. */
  trigger?: "input" | "submit";
  /** Delay external input searches; local and submitted searches are immediate. Defaults to 0. */
  debounceMs?: number;
  /** Host-owned filters. Update immutably; submitted searches capture these on submit. */
  params?: Readonly<Record<string, unknown>>;
  /** Search result detail area height in px, clamped to 24–480. Defaults to 72. */
  resultDetailsHeight?: number;
}>;

/** A committed query and the current cached draft. The request snapshot is never mutated. */
export type ExplorerSearchRequest = Readonly<{
  query: string;
  conditions: ExplorerSearchConditions;
  params?: Readonly<Record<string, unknown>>;
  entries: readonly ExplorerEntry[];
  location: ExplorerLocationInfo;
  tabId: string;
  windowId: string;
}>;

export type ExplorerSearchContext = Readonly<{
  /** Aborted when this request is superseded or its view is closed. */
  signal: AbortSignal;
}>;

/** Supplemental plain text and host-owned JSON data; never changes the entry. */
export type ExplorerSearchHit = Readonly<{
  entryId: string;
  snippet?: string;
  reason?: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

/** Existing ID-only handlers remain supported, including mixed result arrays. */
export type ExplorerSearchResult = readonly (string | ExplorerSearchHit)[];

/** An atomic set of hits and cache metadata, including every missing ancestor.
 * Entries require folder loading; they hydrate the cache without creating edits. */
export type ExplorerSearchBatch = Readonly<{ hits: ExplorerSearchResult; entries: readonly ExplorerEntry[] }>;
export type ExplorerSearchResponse = ExplorerSearchResult | ExplorerSearchBatch;

/** Each yield appends an atomic batch. First occurrences win across all batches. */
export type ExplorerSearchStream = AsyncIterable<ExplorerSearchResponse>;

/** Return hits in relevance order, optionally with uncached entry metadata, or stream batches.
 * Unknown and duplicate hit IDs are omitted, but count toward cumulative limits. */
export type ExplorerSearchHandler = (
  request: ExplorerSearchRequest,
  context: ExplorerSearchContext,
) => ExplorerSearchResponse | ExplorerSearchStream | Promise<ExplorerSearchResponse | ExplorerSearchStream>;

const MAX_RESULT_COUNT = 100_000;
const MAX_RESULT_LENGTH = 5_000_000;
const MAX_DETAIL_LENGTH = 10_000;
const MAX_METADATA_LENGTH = 100_000;

function assertMetadata(value: unknown): asserts value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("検索結果の metadata は JSON オブジェクトで指定してください");
  const pending: object[] = [value], seen = new WeakSet<object>();
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue; // The serializer diagnoses circular references.
    seen.add(current);
    const array = Array.isArray(current);
    if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null)
      throw new Error("検索結果の metadata は JSON 対応の値だけで指定してください");
    if (Object.getOwnPropertySymbols(current).length)
      throw new Error("検索結果の metadata に Symbol キーは使用できません");
    const keys = Object.keys(current);
    count += keys.length + 1;
    if (count > MAX_METADATA_LENGTH) throw new Error("検索結果の metadata が大きすぎます");
    if (array && (keys.length !== current.length || keys.some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length)))
      throw new Error("検索結果の metadata の配列に空の要素や追加プロパティは使用できません");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!("value" in descriptor)) throw new Error("検索結果の metadata に getter は使用できません");
      const item: unknown = descriptor.value;
      if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) continue;
      if (typeof item === "object") pending.push(item);
      else throw new Error("検索結果の metadata は JSON 対応の値だけで指定してください");
    }
  }
  serializeStableJson(value, { maxLength: MAX_METADATA_LENGTH });
}

function freezeHit(hit: ExplorerSearchHit): ExplorerSearchHit {
  const pending: object[] = [hit];
  while (pending.length) {
    const current = pending.pop()!;
    for (const value of Object.values(current)) if (value && typeof value === "object") pending.push(value);
    Object.freeze(current);
  }
  return hit;
}

/** Validate and snapshot host results. Text is never interpreted as HTML. The
 * response is limited to 100,000 items / 5,000,000 JSON characters; details to
 * 10,000 characters each and metadata to 100,000 JSON characters per hit. */
export function resolveExplorerSearchHits(
  result: ExplorerSearchResult,
  entries: readonly ExplorerEntry[],
): readonly ExplorerSearchHit[] {
  return createExplorerSearchResultAccumulator(entries).append(result);
}

/** @internal Shared atomic validation for a complete response or streamed batches. */
export function createExplorerSearchResultAccumulator(entries: readonly ExplorerEntry[]) {
  const seen = new Set<string>();
  let count = 0, remaining = MAX_RESULT_LENGTH - 2;
  let hits: readonly ExplorerSearchHit[] = Object.freeze([]);
  const prepare = (result: ExplorerSearchResult) => {
    if (!Array.isArray(result)) throw new Error("検索結果は 100,000 件以内の ID または検索ヒットの配列で返してください");
    const batchCount = result.length;
    if (batchCount > MAX_RESULT_COUNT - count)
      throw new Error("検索結果は 100,000 件以内の ID または検索ヒットの配列で返してください");
    const candidates: ExplorerSearchHit[] = [];
    let budget = remaining;
    for (let index = 0; index < batchCount; index++) {
      const source: unknown = result[index];
      let candidate: ExplorerSearchHit;
      if (typeof source === "string") candidate = { entryId: source };
      else {
        if (!source || typeof source !== "object" || Array.isArray(source)
          || Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null)
          throw new Error("検索結果は ID または entryId を持つ検索ヒットで指定してください");
        const values: Record<string, unknown> = {};
        for (const key of ["entryId", "snippet", "reason", "metadata"] as const) {
          const descriptor = Object.getOwnPropertyDescriptor(source, key);
          if (!descriptor) continue;
          if (!("value" in descriptor)) throw new Error("検索ヒットに getter は使用できません");
          values[key] = descriptor.value;
        }
        if (typeof values.entryId !== "string") throw new Error("検索ヒットの entryId は文字列で指定してください");
        for (const key of ["snippet", "reason"] as const) {
          if (values[key] !== undefined && (typeof values[key] !== "string" || values[key].length > MAX_DETAIL_LENGTH))
            throw new Error(`検索結果の ${key} は 10,000 文字以内のプレーンテキストで指定してください`);
        }
        if (values.metadata !== undefined) assertMetadata(values.metadata);
        candidate = values as ExplorerSearchHit;
      }
      if (count + index) budget--;
      if (budget < 1) throw new Error("検索結果は 5,000,000 JSON 文字以内で返してください");
      // Bound the complete response, including ignored/duplicate IDs, before any
      // cloning. Project only public hit fields; entry hydration is a separate transaction.
      const serialized = serializeStableJson(candidate, { maxLength: budget });
      budget -= serialized.length;
      candidates.push(freezeHit(JSON.parse(serialized) as ExplorerSearchHit));
    }
    // The caller may validate/hydrate entry metadata before accepting these hits.
    // Preparation never consumes budgets or first-occurrence IDs on failure.
    let committed = false;
    return Object.freeze({ commit(currentEntries: readonly ExplorerEntry[] = entries): readonly ExplorerSearchHit[] {
      if (committed) return hits;
      committed = true;
      const known = getEntryIndex(currentEntries).byId, added: ExplorerSearchHit[] = [];
      for (const candidate of candidates) {
        if (!known.has(candidate.entryId) || seen.has(candidate.entryId)) continue;
        seen.add(candidate.entryId); added.push(candidate);
      }
      count += batchCount; remaining = budget;
      if (added.length) hits = Object.freeze([...hits, ...added]);
      return hits;
    } });
  };
  return Object.freeze({ prepare, append(result: ExplorerSearchResult, currentEntries: readonly ExplorerEntry[] = entries) {
    return prepare(result).commit(currentEntries);
  } });
}

/** Host responses are a display filter, never a way to insert or modify draft data. */
export function resolveExplorerSearchIds(
  result: ExplorerSearchResult,
  entries: readonly ExplorerEntry[],
): readonly string[] {
  return Object.freeze(resolveExplorerSearchHits(result, entries).map(hit => hit.entryId));
}
