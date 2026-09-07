"use client";

import { useMemo } from "react";
import type { ExplorerEntry } from "../model/draft";
import type { ExplorerSelectionMode } from "../model/config";
import { entryExtension } from "../model/entries";
import { getEntryIndex } from "../model/entry-index";
import { naturalNameOrder } from "../model/text";
import { FAVORITES, RECENT, type ExplorerLocation } from "./view-state";
import type { TabViewState } from "./use-explorer-tabs";

type ListingOptions = {
  entries: readonly ExplorerEntry[];
  location: ExplorerLocation;
  query: string;
  sort: TabViewState["sort"];
  selectedIds: readonly string[];
  selectionMode: ExplorerSelectionMode;
  /** null uses the built-in listing; an array preserves host search ranking. */
  searchResultIds?: readonly string[] | null;
};

/** Derive the current listing and effective selection without changing the draft or tab state. */
export function useExplorerListing({ entries, location, query, sort, selectedIds, selectionMode, searchResultIds = null }: ListingOptions) {
  const entryIndex = getEntryIndex(entries);
  const { key, asc } = sort;
  const visible = useMemo(() => {
    if (searchResultIds !== null) {
      // The search boundary already validates and deduplicates IDs.
      return searchResultIds.flatMap(id => entryIndex.byId.get(id) ?? []);
    }
    const needle = query.trim().toLocaleLowerCase("ja-JP");
    const result = needle
      ? entries.filter(entry => entryIndex.searchNames.get(entry.id)!.includes(needle))
      : location === FAVORITES ? entries.filter(entry => !!entry.favorite)
      : location === RECENT ? entries.filter(entry => entry.kind === "file")
      : [...(entryIndex.childrenByParent.get(location as string) ?? [])];
    const sortKey = location === RECENT ? "updatedAt" : key;
    const direction = location === RECENT ? -1 : asc ? 1 : -1;
    result.sort((a, b) => {
      if (location !== RECENT && a.kind !== b.kind)
        return a.kind === "folder" ? -1 : 1;
      return direction * (sortKey === "size"
        ? a.size - b.size
        : sortKey === "extension"
          ? naturalNameOrder.compare(entryExtension(a), entryExtension(b))
          : naturalNameOrder.compare(String(a[sortKey]), String(b[sortKey])));
    });
    return result;
  }, [entries, entryIndex, location, query, key, asc, searchResultIds]);

  const visiblePositions = useMemo(() => new Map(visible.map((entry, index) => [entry.id, index])), [visible]);
  const selected = useMemo(() => {
    const ids = [...new Set(selectedIds.filter(id => visiblePositions.has(id)))];
    return selectionMode === "none" ? [] : selectionMode === "single" ? ids.slice(0, 1) : ids;
  }, [selectedIds, visiblePositions, selectionMode]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedEntries = useMemo(() => visible.filter(entry => selectedSet.has(entry.id)), [visible, selectedSet]);

  return { visible, visiblePositions, selected, selectedSet, selectedEntries };
}
