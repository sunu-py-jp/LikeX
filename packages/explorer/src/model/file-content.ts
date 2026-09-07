import type { ExplorerEntry } from "./draft";

/** Host callback resolving an opaque content ID; distinct from the browser's FileReader class. */
export type ExplorerFileReader = (sourceId: string) => Promise<Blob>;

/** @deprecated Use ExplorerFileReader to avoid confusion with the browser FileReader. */
export type FileReader = ExplorerFileReader;

export async function readEntryFile(
  entry: ExplorerEntry,
  readFile?: ExplorerFileReader,
): Promise<Blob> {
  if (entry.kind !== "file" || !entry.source)
    throw new Error("この項目にはファイルの内容がありません");
  if (entry.source.kind === "local") return entry.source.file;
  if (!readFile)
    throw new Error("このファイルの読み込み方法が設定されていません");
  return readFile(entry.source.id);
}
