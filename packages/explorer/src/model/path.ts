import type { ExplorerEntry } from "./draft";
import { nameKey } from "./entries";
import { getEntryIndex, type EntryIndex } from "./entry-index";

type PathEntry = Pick<ExplorerEntry, "id" | "parent" | "name" | "kind">;

export const DEFAULT_ROOT_LABEL = "ファイル";

function folderChain(
  byId: ReadonlyMap<string, PathEntry>,
  id: string,
): PathEntry[] {
  const chain: PathEntry[] = [];
  const visited = new Set<string>();
  let current = id;
  while (current !== "root") {
    if (visited.has(current)) {
      throw new Error("フォルダの階層が循環しているため、パスを確認できません");
    }
    visited.add(current);
    const entry = byId.get(current);
    if (!entry) throw new Error("指定されたフォルダが見つかりません");
    if (entry.kind !== "folder") {
      throw new Error(
        `「${entry.name}」はファイルです。フォルダを指定してください`,
      );
    }
    chain.push(entry);
    current = entry.parent;
  }
  return chain.reverse();
}

/** Return an address within this Explorer's draft, independent of storage IDs. */
export function formatExplorerPath(
  entries: readonly PathEntry[],
  id: string,
  index: EntryIndex<PathEntry> = getEntryIndex(entries),
): string {
  const cached = index.paths.get(id);
  if (cached !== undefined) return cached;
  const chain: PathEntry[] = [];
  const visited = new Set<string>();
  let current = id;
  while (!index.paths.has(current)) {
    if (visited.has(current)) throw new Error("フォルダの階層が循環しているため、パスを確認できません");
    visited.add(current);
    const entry = index.byId.get(current);
    if (!entry) throw new Error("指定されたフォルダが見つかりません");
    if (entry.kind !== "folder") throw new Error(`「${entry.name}」はファイルです。フォルダを指定してください`);
    chain.push(entry);
    current = entry.parent;
  }
  let path = index.paths.get(current)!;
  for (const entry of chain.reverse()) {
    path = `${path === "/" ? "" : path}/${entry.name}`;
    index.paths.set(entry.id, path);
  }
  return path || "/";
}

/** Resolve only folders in the supplied draft; this never reads external paths. */
export function resolveExplorerPath(
  entries: readonly PathEntry[],
  value: string,
  currentParent = "root",
  rootLabel = DEFAULT_ROOT_LABEL,
): string {
  const input = value.trim();
  if (!input) throw new Error("移動先のフォルダのパスを入力してください");
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || /^[\\/]{2}/.test(input)) {
    throw new Error(
      "URLやドライブ、ネットワークのパスは使用できません。このエクスプローラー内のフォルダを指定してください",
    );
  }

  const absolute = /^[\\/]/.test(input);
  const segments = input.split(/[\\/]+/).filter(Boolean);
  // The unprefixed breadcrumb label is an alias. An absolute path preserves
  // the literal folder name; dot segments always retain their relative meaning.
  const label = rootLabel.trim() || DEFAULT_ROOT_LABEL;
  const first = segments[0];
  const rootAlias =
    !absolute &&
    first !== undefined &&
    first !== "." &&
    first !== ".." &&
    nameKey(first) === nameKey(label);
  if (rootAlias) segments.shift();

  const { byId, namesByParent } = getEntryIndex(entries);
  const chain = absolute || rootAlias ? [] : folderChain(byId, currentParent);
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      chain.pop();
      continue;
    }
    const parent = chain.at(-1)?.id ?? "root";
    const key = nameKey(segment);
    const entry = namesByParent.get(parent)?.get(key);
    if (!entry) throw new Error(`フォルダ「${segment}」が見つかりません`);
    if (entry.kind !== "folder") {
      throw new Error(
        `「${entry.name}」はファイルです。フォルダを指定してください`,
      );
    }
    chain.push(entry);
  }
  return chain.at(-1)?.id ?? "root";
}
