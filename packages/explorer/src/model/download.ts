import { createSnapshot, type ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";

export type ExplorerDownloadProgress = Readonly<{
  phase: "accepted" | "preparing" | "ready" | "transferring";
  message?: string;
}>;

/** A host may confirm completion only for a transfer it can actually observe. */
export type ExplorerDownloadResult = Readonly<{
  status: "handed-off" | "completed" | "cancelled";
  message?: string;
}>;

export type ExplorerDownloadItem = ExplorerItemInfo & Readonly<{
  /** Relative to the download root; folders include a trailing slash. */
  archivePath: string;
}>;

export type ExplorerDownloadContext = Readonly<{
  requestId: string;
  windowId: string;
  ownerDocument: Document | null;
  signal: AbortSignal;
  /** The selected item and its descendants, captured when the request starts. */
  items: readonly ExplorerDownloadItem[];
  reportProgress: (progress: ExplorerDownloadProgress) => void;
}>;

export type ExplorerDownloadHandler = (
  request: ExplorerItemInfo,
  context: ExplorerDownloadContext,
) => ExplorerDownloadResult | Promise<ExplorerDownloadResult>;

/** Copy metadata at each host boundary; the immutable File body stays shared. */
export function cloneDownloadRequest(request: ExplorerItemInfo): ExplorerItemInfo {
  return { ...request, source: request.source ? { ...request.source } : null };
}

/** Describe a validated draft subtree without reading file bodies or imposing ZIP limits. */
export function createDownloadItems(
  entries: readonly ExplorerEntry[],
  id: string,
): readonly ExplorerDownloadItem[] {
  const snapshot = createSnapshot(entries).entries;
  const index = getEntryIndex(snapshot);
  const root = index.byId.get(id);
  if (!root) throw new Error("ダウンロードする項目が見つかりません");
  const items: ExplorerDownloadItem[] = [];
  const pending = [{ entry: root, parentPath: "" }];
  while (pending.length) {
    const { entry, parentPath } = pending.pop()!;
    // Preserve valid Unicode exactly, rather than letting a downstream encoder
    // replace lone surrogates and collapse otherwise distinct archive paths.
    if (/[\uD800-\uDFFF]/u.test(entry.name))
      throw new Error("項目名に正しくないUnicode文字が含まれています");
    const archivePath = `${parentPath}${entry.name}${entry.kind === "folder" ? "/" : ""}`;
    items.push({ ...describeEntry(snapshot, entry, index), archivePath });
    if (entry.kind !== "folder") continue;
    const children = index.childrenByParent.get(entry.id) ?? [];
    for (let position = children.length - 1; position >= 0; position--)
      pending.push({ entry: children[position], parentPath: archivePath });
  }
  return items;
}
