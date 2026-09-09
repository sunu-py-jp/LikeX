import { createZipArchive, type ZipArchiveEntry } from "../core";
import { createSnapshot, type ExplorerEntry } from "./draft";
import { readEntryFile, type ExplorerFileReader } from "./file-content";

/** Capture names and content references before any asynchronous host read starts. */
function* archiveItems(entries: readonly ExplorerEntry[], folderId: string, readFile?: ExplorerFileReader): Iterable<ZipArchiveEntry> {
  const snapshot = createSnapshot(entries).entries;
  const folder = snapshot.find(entry => entry.id === folderId);
  if (!folder || folder.kind !== "folder") throw new Error("ダウンロードするフォルダが見つかりません");
  const children = new Map<string, ExplorerEntry[]>();
  for (const entry of snapshot) {
    const siblings = children.get(entry.parent) ?? [];
    siblings.push(entry);
    children.set(entry.parent, siblings);
  }
  const pending = [{ entry: folder, parentPath: "" }];
  while (pending.length) {
    const { entry, parentPath } = pending.pop()!;
    const path = `${parentPath}${entry.name}${entry.kind === "folder" ? "/" : ""}`;
    if (entry.kind === "folder") {
      yield { path, directory: true, updatedAt: entry.updatedAt };
      const descendants = children.get(entry.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index--)
        pending.push({ entry: descendants[index], parentPath: path });
    } else yield { path, updatedAt: entry.updatedAt, content: () => readEntryFile(entry, readFile) };
  }
}

/** Build the current folder tree locally; return only after every file was read. */
export async function createFolderArchive(
  entries: readonly ExplorerEntry[], folderId: string, readFile?: ExplorerFileReader, signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  return createZipArchive(archiveItems(entries, folderId, readFile), { signal });
}
