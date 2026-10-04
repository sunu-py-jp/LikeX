import { createDraftSnapshot, type ExplorerEntry, type ExplorerSnapshot } from "./draft";
import { getEntryIndex } from "./entry-index";
import { getEntryPath } from "./entries";
import type { ExplorerEntryPermissionCheck } from "./entry-permissions";

export type ExplorerFolderLoadRequest = Readonly<{ folderId: string; path: string }>;
export type ExplorerFolderLoadContext = Readonly<{ signal: AbortSignal }>;
/** Return the complete immediate child listing; do not include descendants. */
export type ExplorerFolderLoadHandler = (request: ExplorerFolderLoadRequest, context: ExplorerFolderLoadContext) =>
  readonly ExplorerEntry[] | Promise<readonly ExplorerEntry[]>;
export type ExplorerFolderLoadingOptions = Readonly<{
  /** Read on mount. Cached entries require their ancestor chain; omitted folders are not complete. */
  initialLoadedFolderIds?: readonly string[];
}>;
export type ExplorerFolderLoadOptions = Readonly<{ recursive?: boolean; signal?: AbortSignal }>;
export type ExplorerFolderLoadState = Readonly<{ status: "unloaded" | "loading" | "loaded" | "error"; error: string | null }>;
export type ExplorerFolderLoadEvent =
  | Readonly<{ type: "folder-load"; status: "start"; folderId: string; path: string }>
  | Readonly<{ type: "folder-load"; status: "success"; folderId: string; path: string; addedCount: number }>
  | Readonly<{ type: "folder-load"; status: "error"; folderId: string; path: string; message: string }>;

/** @internal Validate the host's initial completeness declarations. */
export function initialExplorerLoadedFolders(entries: readonly ExplorerEntry[], ids: readonly string[] = []): Set<string> {
  if (!Array.isArray(ids)) throw new Error("取得済みフォルダ ID は配列で指定してください");
  const index = getEntryIndex(entries);
  for (const id of ids) if (typeof id !== "string" || id !== "root" && index.byId.get(id)?.kind !== "folder")
    throw new Error("取得済みフォルダが初期一覧に見つかりません");
  return new Set(ids);
}

/** Hydrate a folder's immediate listing without replacing known identities or local changes. */
export function mergeExplorerFolderEntries(baseline: ExplorerSnapshot, draft: ExplorerSnapshot, folderId: string,
  response: readonly ExplorerEntry[]): { baseline: ExplorerSnapshot; draft: ExplorerSnapshot; addedCount: number } {
  if (!Array.isArray(response) || response.length > 100_000) throw new Error("フォルダの取得結果は 100,000 件以内の一覧で返してください");
  const before = getEntryIndex(baseline.entries), current = getEntryIndex(draft.entries);
  if (folderId !== "root" && (before.byId.get(folderId)?.kind !== "folder" || current.byId.get(folderId)?.kind !== "folder"))
    throw new Error("取得するフォルダが見つかりません");
  for (const entry of response) if (!entry || typeof entry !== "object" || entry.parent !== folderId)
    throw new Error("取得結果には指定フォルダの直下の項目だけを含めてください");
  const ancestors = getEntryPath(baseline.entries, folderId);
  const validated = createDraftSnapshot([...ancestors, ...response]).entries.slice(ancestors.length);
  const added: ExplorerEntry[] = [];
  for (const entry of validated) {
    const original = before.byId.get(entry.id);
    if (original) {
      if (original.parent !== folderId || original.kind !== entry.kind)
        throw new Error("取得結果の ID が別の既存項目と競合しています");
      continue; // Includes locally renamed, moved or deleted cached entries.
    }
    if (current.byId.has(entry.id)) throw new Error("取得結果の ID がローカルの新規項目と競合しています");
    added.push(entry);
  }
  if (!added.length) return { baseline, draft, addedCount: 0 };
  // Both trees must be valid before either can be published, including name collisions.
  const nextBaseline = createDraftSnapshot([...baseline.entries, ...added]);
  const nextDraft = createDraftSnapshot([...draft.entries, ...added]);
  return { baseline: nextBaseline, draft: nextDraft, addedCount: added.length };
}

/** @internal Loading is a separate prerequisite from host edit permission. */
export function assertExplorerFoldersLoaded(entries: readonly ExplorerEntry[], checks: readonly ExplorerEntryPermissionCheck[],
  isLoaded: (id: string) => boolean): void {
  const index = getEntryIndex(entries), required = new Set<string>();
  for (const check of checks) {
    const entry = index.byId.get(check.id);
    if (check.operation === "rename" && entry) required.add(entry.parent);
    if (["createFile", "createFolder", "upload", "copy", "move"].includes(check.operation) && !check.recursive
      && (check.id === "root" || entry?.kind === "folder"))
      required.add(check.id);
    if (check.recursive) {
      const pending = [check.id], visited = new Set<string>();
      while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        if (id === "root" || index.byId.get(id)?.kind === "folder") {
          required.add(id);
          for (const child of index.folderChildrenByParent.get(id) ?? []) pending.push(child.id);
        }
      }
    }
  }
  for (const id of required) if (!isLoaded(id))
    throw new Error(`フォルダ「${index.byId.get(id)?.name ?? id}」の「配下を読み込む」を実行してから操作してください`);
}
