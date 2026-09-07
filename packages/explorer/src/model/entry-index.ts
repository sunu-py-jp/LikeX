import { nameKey } from "./text";

type IndexableEntry = { id: string; parent: string; name?: string; kind?: string; size?: number };
export type EntryIndex<T extends IndexableEntry> = {
  byId: ReadonlyMap<string, T>;
  positions: ReadonlyMap<string, number>;
  childrenByParent: ReadonlyMap<string, readonly T[]>;
  folderChildrenByParent: ReadonlyMap<string, readonly T[]>;
  namesByParent: ReadonlyMap<string, ReadonlyMap<string, T>>;
  searchNames: ReadonlyMap<string, string>;
  paths: Map<string, string>;
  totalSize: number;
  fileCount: number;
};

const indexes = new WeakMap<readonly IndexableEntry[], EntryIndex<IndexableEntry>>();

/** A draft's immutable array owns one shared index. Mutable external arrays
 * are deliberately rebuilt so callers can still edit their own input data. */
export function getEntryIndex<T extends IndexableEntry>(entries: readonly T[]): EntryIndex<T> {
  const cached = indexes.get(entries);
  if (cached) return cached as EntryIndex<T>;
  const byId = new Map<string, T>();
  const positions = new Map<string, number>();
  const childrenByParent = new Map<string, T[]>();
  const folderChildrenByParent = new Map<string, T[]>();
  const namesByParent = new Map<string, Map<string, T>>();
  const searchNames = new Map<string, string>();
  let totalSize = 0, fileCount = 0;
  entries.forEach((entry, position) => {
    byId.set(entry.id, entry);
    positions.set(entry.id, position);
    const children = childrenByParent.get(entry.parent) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parent, children);
    if (entry.kind === "folder") {
      const folders = folderChildrenByParent.get(entry.parent) ?? [];
      folders.push(entry);
      folderChildrenByParent.set(entry.parent, folders);
    } else if (entry.kind === "file") fileCount++;
    totalSize += entry.size ?? 0;
    if (entry.name !== undefined) {
      const names = namesByParent.get(entry.parent) ?? new Map<string, T>();
      const key = nameKey(entry.name);
      if (!names.has(key)) names.set(key, entry);
      namesByParent.set(entry.parent, names);
      searchNames.set(entry.id, entry.name.toLocaleLowerCase("ja-JP"));
    }
  });
  const index = { byId, positions, childrenByParent, folderChildrenByParent, namesByParent, searchNames,
    totalSize, fileCount, paths: new Map([["root", "/"]]) };
  if (Object.isFrozen(entries) && entries.every(Object.isFrozen)) indexes.set(entries, index);
  return index;
}

/** Traverse only the selected subtree; preserve source ordering for callbacks. */
export function subtreeEntries<T extends IndexableEntry>(entries: readonly T[], id: string): T[] {
  const index = getEntryIndex(entries);
  const found: T[] = [];
  const seen = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const entry = index.byId.get(current);
    if (entry) found.push(entry);
    for (const child of index.childrenByParent.get(current) ?? []) pending.push(child.id);
  }
  return found.sort((a, b) => index.positions.get(a.id)! - index.positions.get(b.id)!);
}
