import type { MaybePromise } from "./contracts";

export type ZipArchiveContent = Blob | (() => MaybePromise<Blob>);
export type ZipArchiveEntry = Readonly<{ path: string; updatedAt?: string }> & (
  | Readonly<{ directory: true; content?: never }>
  | Readonly<{ directory?: false; content: ZipArchiveContent }>
);
export type ZipArchiveOptions = Readonly<{ signal?: AbortSignal; type?: string }>;

// Classic ZIP, STORE method. ZIP64 sentinel values are rejected explicitly.
// Format reference: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
const UINT32_MAX = 0xffffffff;
const MAX_ENTRIES = 0xfffe;
const UTF8_FLAG = 0x0800;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = UINT32_MAX;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ UINT32_MAX) >>> 0;
}

function dosTime(value?: string) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1980) return { time: 0, date: 0x21 };
  if (date.getFullYear() > 2107) return { time: 0xbf7d, date: 0xff9f };
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type PreparedEntry = { path: string; name: Uint8Array<ArrayBuffer>; directory: boolean;
  content?: ZipArchiveContent; updatedAt?: string };
type PathNode = { directory?: boolean; children: Map<string, PathNode> };

function prepareEntries(entries: Iterable<ZipArchiveEntry> | AsyncIterable<ZipArchiveEntry>, signal?: AbortSignal): MaybePromise<PreparedEntry[]> {
  const result: PreparedEntry[] = [];
  const root: PathNode = { children: new Map() };
  const add = (entry: ZipArchiveEntry) => {
    signal?.throwIfAborted();
    if (result.length >= MAX_ENTRIES) throw new Error("ZIPに含められる項目数は65,534件までです");
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") throw new Error("ZIPのパスが正しくありません");
    const { path, content, updatedAt } = entry;
    if (entry.directory !== undefined && typeof entry.directory !== "boolean") throw new Error("ZIPの項目種別が正しくありません");
    const directory = entry.directory === true;
    if (/[\uD800-\uDFFF]/u.test(path)) throw new Error("項目名に正しくないUnicode文字が含まれています");
    if (!path || /^[\/\\]/.test(path) || /[\\:\u0000-\u001f\u007f]/.test(path)) throw new Error("ZIPには安全な相対パスを指定してください");
    const canonical = directory && path.endsWith("/") ? path.slice(0, -1) : path;
    const segments = canonical.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment)))
      throw new Error("ZIPには安全な相対パスを指定してください");
    if (updatedAt !== undefined && typeof updatedAt !== "string") throw new Error("ZIPの更新日時が正しくありません");
    if (directory && content !== undefined) throw new Error("ZIPのフォルダにはファイル内容を指定できません");
    if (!directory && !content) throw new Error(`「${path}」のファイルの内容が返されませんでした`);
    const archivePath = canonical + (directory ? "/" : "");
    const name = encoder.encode(archivePath);
    if (name.byteLength > 0xffff) throw new Error("フォルダの階層が深すぎるため、ZIPに保存できません");
    // A trie avoids constructing every full ancestor path for deeply nested entries.
    let node = root;
    for (const segment of segments) {
      if (node.directory === false) throw new Error(`ZIPのファイルとフォルダが競合しています: ${path}`);
      const child = node.children.get(segment) ?? { children: new Map<string, PathNode>() };
      node.children.set(segment, child);
      node = child;
    }
    if (node.directory !== undefined) throw new Error(`ZIPのパスが重複しています: ${path}`);
    if (!directory && node.children.size) throw new Error(`ZIPのファイルとフォルダが競合しています: ${path}`);
    node.directory = directory;
    result.push({ path: archivePath, name, directory, content, updatedAt });
  };
  if (entries && typeof (entries as Iterable<ZipArchiveEntry>)[Symbol.iterator] === "function") {
    // Preserve synchronous preflight and content-read startup for ordinary arrays.
    for (const entry of entries as Iterable<ZipArchiveEntry>) add(entry);
    return result;
  }
  if (entries && typeof (entries as AsyncIterable<ZipArchiveEntry>)[Symbol.asyncIterator] === "function") {
    return (async () => {
      for await (const entry of entries as AsyncIterable<ZipArchiveEntry>) add(entry);
      signal?.throwIfAborted();
      return result;
    })();
  }
  throw new Error("ZIPの項目は反復可能な一覧で指定してください");
}

function isBlob(content: unknown): content is Blob {
  if (!content || typeof (content as Blob).arrayBuffer !== "function") return false;
  try {
    // Web IDL brand check accepts genuine Blobs from another browser window.
    Blob.prototype.slice.call(content, 0, 0);
    return true;
  } catch { return false; }
}

/** Validate all entry paths first, then read content sequentially and return a complete ZIP. */
export async function createZipArchive(
  entries: Iterable<ZipArchiveEntry> | AsyncIterable<ZipArchiveEntry>,
  { signal, type = "application/zip" }: ZipArchiveOptions = {},
): Promise<Blob> {
  signal?.throwIfAborted();
  const prepared = prepareEntries(entries, signal);
  const items = Array.isArray(prepared) ? prepared : await prepared;
  const localParts: BlobPart[] = [], centralParts: BlobPart[] = [];
  let localSize = 0, centralSize = 0;
  for (const { path, name, directory, content: source, updatedAt } of items) {
    signal?.throwIfAborted();
    let content: Blob | undefined;
    if (!directory) {
      try {
        content = typeof source === "function" ? await source() : source;
        if (!isBlob(content)) throw new Error("ファイルの内容が返されませんでした");
      } catch (error) {
        signal?.throwIfAborted();
        throw new Error(`「${path}」を読み込めませんでした${error instanceof Error ? `: ${error.message}` : ""}`);
      }
    }
    // A lazy host reader cannot necessarily abort in-flight work. Stop before
    // allocating its buffer or starting any remaining entry once it completes.
    signal?.throwIfAborted();
    const size = content?.size ?? 0;
    const nextLocalSize = localSize + 30 + name.byteLength + size;
    const nextCentralSize = centralSize + 46 + name.byteLength;
    if (!Number.isSafeInteger(size) || size < 0 || size >= UINT32_MAX || nextLocalSize + nextCentralSize + 22 >= UINT32_MAX)
      throw new Error("ZIPのサイズが上限（4 GiB未満）を超えています");
    let bytes: Uint8Array;
    try { bytes = content ? new Uint8Array(await content.arrayBuffer()) : new Uint8Array(); }
    catch (error) { signal?.throwIfAborted(); throw error; }
    signal?.throwIfAborted();
    if (bytes.byteLength !== size) throw new Error(`「${path}」のファイルサイズを確認できませんでした`);
    const crc = crc32(bytes), stamp = dosTime(updatedAt);
    const local = new ArrayBuffer(30), localView = new DataView(local);
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
    const central = new ArrayBuffer(46), centralView = new DataView(central);
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
    centralView.setUint32(38, directory ? 0x10 : 0, true);
    centralView.setUint32(42, localSize, true);
    centralParts.push(central, name);
    localSize = nextLocalSize; centralSize = nextCentralSize;
  }
  signal?.throwIfAborted();
  const end = new ArrayBuffer(22), endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, items.length, true);
  endView.setUint16(10, items.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localSize, true);
  return new Blob([...localParts, ...centralParts, end], { type });
}
