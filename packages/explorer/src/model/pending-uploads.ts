import type { ExplorerEntry } from "./draft";
import { addEntryAndAncestors, getEntryIndex } from "./entry-index";

/** Local file bodies not yet represented by the saved baseline, plus their current ancestors. */
export function getPendingUploadEntryIds(
  baselineEntries: readonly ExplorerEntry[],
  currentEntries: readonly ExplorerEntry[],
): ReadonlySet<string> {
  const pending = new Set<string>();
  if (baselineEntries === currentEntries) return pending;
  const baseline = getEntryIndex(baselineEntries).byId;
  const current = getEntryIndex(currentEntries).byId;
  for (const entry of currentEntries) {
    if (entry.kind !== "file" || entry.source?.kind !== "local") continue;
    const previous = baseline.get(entry.id);
    if (previous?.source?.kind === "local" && previous.source.file === entry.source.file) continue;
    addEntryAndAncestors(pending, entry.id, current);
  }
  return pending;
}
