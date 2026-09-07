import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import type { ExplorerLocationInfo } from "./events";

export type ExplorerSearchOptions = Readonly<{
  /** Search as text changes, or only after Enter. Defaults to input. */
  trigger?: "input" | "submit";
  /** Delay external input searches; local and submitted searches are immediate. Defaults to 0. */
  debounceMs?: number;
}>;

/** A committed query and the current local draft; search never changes these entries. */
export type ExplorerSearchRequest = Readonly<{
  query: string;
  entries: readonly ExplorerEntry[];
  location: ExplorerLocationInfo;
  tabId: string;
  windowId: string;
}>;

export type ExplorerSearchContext = Readonly<{
  /** Aborted when this request is superseded or its view is closed. */
  signal: AbortSignal;
}>;

/** Return existing entry IDs in relevance order. Unknown and duplicate IDs are omitted. */
export type ExplorerSearchHandler = (
  request: ExplorerSearchRequest,
  context: ExplorerSearchContext,
) => readonly string[] | Promise<readonly string[]>;

/** Host responses are a display filter, never a way to insert or modify draft data. */
export function resolveExplorerSearchIds(
  result: readonly string[],
  entries: readonly ExplorerEntry[],
): readonly string[] {
  if (!Array.isArray(result) || result.some(id => typeof id !== "string"))
    throw new Error("検索結果はファイル・フォルダの ID の配列で返してください");
  const known = getEntryIndex(entries).byId;
  const seen = new Set<string>();
  return result.filter(id => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
