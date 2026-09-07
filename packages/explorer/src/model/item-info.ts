import type { ExplorerEntry } from "./draft";
import { formatExplorerPath } from "./path";
import { getEntryIndex, type EntryIndex } from "./entry-index";
import { entryExtension } from "./entries";

/** An isolated description of an item at the time of a host notification. */
export type ExplorerItemInfo = Readonly<
  Omit<ExplorerEntry, "source"> & {
    source: Readonly<NonNullable<ExplorerEntry["source"]>> | null;
    /** Absolute path in the current draft, including the name, without rootLabel. */
    path: string;
    /** Last file extension, lowercase without a dot; empty for folders/dotfiles. */
    extension: string;
  }
>;

export function describeEntry(
  entries: readonly ExplorerEntry[],
  entry: ExplorerEntry,
  index: EntryIndex<ExplorerEntry> = getEntryIndex(entries),
): ExplorerItemInfo {
  const parentPath = formatExplorerPath(entries, entry.parent, index);
  return {
    ...entry,
    source: entry.source ? { ...entry.source } : null,
    path: `${parentPath === "/" ? "" : parentPath}/${entry.name}`,
    extension: entryExtension(entry),
  };
}

/** Build one callback payload using a single index, also for external arrays. */
export function describeEntries(entries: readonly ExplorerEntry[], selected: readonly ExplorerEntry[] = entries): ExplorerItemInfo[] {
  const index = getEntryIndex(entries);
  return selected.map(entry => describeEntry(entries, entry, index));
}
