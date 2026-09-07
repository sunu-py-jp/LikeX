import { createSnapshot, type ExplorerEntry } from "./draft";
import { readEntryFile, type ExplorerFileReader } from "./file-content";

// Classic ZIP, STORE method. ZIP64 sentinel values are rejected explicitly.
// Format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const UINT32_MAX = 0xffffffff;
const MAX_ENTRIES = 0xfffe;
const UTF8_FLAG = 0x0800;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = UINT32_MAX;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ UINT32_MAX) >>> 0;
}

function dosTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1980)
    return { time: 0, date: 0x21 };
  if (date.getFullYear() > 2107) return { time: 0xbf7d, date: 0xff9f };
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >>> 1),
    date:
      ((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

type ArchiveItem = {
  entry: ExplorerEntry;
  path: string;
  name: Uint8Array<ArrayBuffer>;
};

function archiveItems(
  entries: readonly ExplorerEntry[],
  folderId: string,
): ArchiveItem[] {
  const snapshot = createSnapshot(entries).entries;
  const folder = snapshot.find((entry) => entry.id === folderId);
  if (!folder || folder.kind !== "folder")
    throw new Error("ダウンロードするフォルダが見つかりません");
  const children = new Map<string, ExplorerEntry[]>();
  for (const entry of snapshot) {
    const siblings = children.get(entry.parent) ?? [];
    siblings.push(entry);
    children.set(entry.parent, siblings);
  }
  const items: ArchiveItem[] = [];
  const pending = [{ entry: folder, parentPath: "" }];
  while (pending.length) {
    const { entry, parentPath } = pending.pop()!;
    // TextEncoder replaces lone UTF-16 surrogates; reject them rather than
    // silently changing a name or merging distinct paths in the archive.
    if (/[\uD800-\uDFFF]/u.test(entry.name))
      throw new Error("項目名に正しくないUnicode文字が含まれています");
    const path = `${parentPath}${entry.name}${entry.kind === "folder" ? "/" : ""}`;
    const name = encoder.encode(path);
    if (name.byteLength > 0xffff)
      throw new Error("フォルダの階層が深すぎるため、ZIPに保存できません");
    items.push({ entry, path, name });
    if (items.length > MAX_ENTRIES)
      throw new Error("ZIPに含められる項目数は65,534件までです");
    if (entry.kind === "folder") {
      const descendants = children.get(entry.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index--)
        pending.push({ entry: descendants[index], parentPath: path });
    }
  }
  return items;
}

/** Build the current folder tree locally; return only after every file was read. */
export async function createFolderArchive(
  entries: readonly ExplorerEntry[],
  folderId: string,
  readFile?: ExplorerFileReader,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const items = archiveItems(entries, folderId);
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let localSize = 0;
  let centralSize = 0;

  for (const { entry, path, name } of items) {
    signal?.throwIfAborted();
    let content: Blob | undefined;
    if (entry.kind === "file") {
      try {
        content = await readEntryFile(entry, readFile);
        if (!content || typeof content.arrayBuffer !== "function")
          throw new Error("ファイルの内容が返されませんでした");
      } catch (error) {
        signal?.throwIfAborted();
        throw new Error(
          `「${path}」を読み込めませんでした${error instanceof Error ? `: ${error.message}` : ""}`,
        );
      }
    }
    // The existing ExplorerFileReader cannot abort an in-flight host request. Stop at
    // its completion before allocating bytes or requesting any remaining file.
    signal?.throwIfAborted();
    const size = content?.size ?? 0;
    const nextLocalSize = localSize + 30 + name.byteLength + size;
    const nextCentralSize = centralSize + 46 + name.byteLength;
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size >= UINT32_MAX ||
      nextLocalSize + nextCentralSize + 22 >= UINT32_MAX
    )
      throw new Error("ZIPのサイズが上限（4 GiB未満）を超えています");
    // Only keep each file's temporary byte buffer while calculating its CRC.
    const bytes = content
      ? new Uint8Array(await content.arrayBuffer())
      : new Uint8Array();
    signal?.throwIfAborted();
    if (bytes.byteLength !== size)
      throw new Error(`「${path}」のファイルサイズを確認できませんでした`);
    const crc = crc32(bytes);
    const stamp = dosTime(entry.updatedAt);

    const local = new ArrayBuffer(30);
    const localView = new DataView(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.byteLength, true);
    localParts.push(local, name);
    if (content) localParts.push(content);

    const central = new ArrayBuffer(46);
    const centralView = new DataView(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(38, entry.kind === "folder" ? 0x10 : 0, true);
    centralView.setUint32(42, localSize, true);
    centralParts.push(central, name);
    localSize = nextLocalSize;
    centralSize = nextCentralSize;
  }

  signal?.throwIfAborted();
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, items.length, true);
  endView.setUint16(10, items.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localSize, true);
  return new Blob([...localParts, ...centralParts, end], {
    type: "application/zip",
  });
}
