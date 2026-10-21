import { OFFICE_PACKAGE_LIMITS, type OfficePackageInput, type OfficePackageSignal } from "./types";
import type { OfficePackageArchive } from "./zip-reader";

/** Caller-selected ZIP budgets; the ordinary Office import defaults remain unchanged. */
export type OfficePackageReadLimits = {
  readonly inputBytes: number; readonly entries: number; readonly entryBytes: number; readonly totalBytes: number;
};
export type OfficePackageStreamingArchive = OfficePackageArchive & {
  /** Reads one part without caching its inflated bytes. A lower cap can be set for metadata parts. */
  read(path: string, maxBytes?: number): Promise<Uint8Array>;
  /** Fully consume this stream to validate the member's actual size and CRC. */
  stream(path: string): AsyncIterable<Uint8Array>;
  /** Validates all members, including unread or partially consumed members, discarding inflated bytes. */
  validate(): Promise<void>;
};

type Member = { name: string; start: number; compressed: number; expanded: number; method: number; crc: number };
const invalid = (message: string): never => { throw new Error(`Officeファイルを読み込めません: ${message}`); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const CHUNK_BYTES = 64 * 1024;
function zipName(bytes: Uint8Array): string {
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid("ZIP内のファイル名が不正です"); }
  if (!name || name.length > 512 || /[\\\u0000-\u001f\u007f?#:]/.test(name) || name.startsWith("/") || /%/.test(name) ||
    name.replace(/\/$/, "").split("/").some(part => !part || part === "." || part === "..")) return invalid("ZIP内のパスが不正です");
  return name;
}

/**
 * Validates the complete ZIP structure before exposing parts. Keeps only compressed
 * input and inflates one bounded chunk at a time; call validate() before accepting
 * an import to retain CRC validation for every member, including ignored content.
 */
export async function openOfficePackageReader(input: OfficePackageInput, signal?: OfficePackageSignal,
  requestedLimits?: Partial<OfficePackageReadLimits>): Promise<OfficePackageStreamingArchive> {
  const limits = { ...OFFICE_PACKAGE_LIMITS, ...requestedLimits };
  for (const key of ["inputBytes", "entries", "entryBytes", "totalBytes"] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) invalid("ZIPの読み込み上限が不正です");
  signal?.throwIfAborted();
  const binary = input instanceof ArrayBuffer || input instanceof Uint8Array;
  if (!binary && (!input || typeof input !== "object" || typeof input.arrayBuffer !== "function")) invalid("入力形式が不正です");
  const size = binary ? input.byteLength : input.size;
  if (!Number.isSafeInteger(size) || size < 0) invalid("ファイルサイズが不正です");
  const inputLimitMessage = `ファイルサイズが${limits.inputBytes / (1024 * 1024)} MiBを超えています`;
  if (size > limits.inputBytes) invalid(inputLimitMessage);
  let bytes: Uint8Array<ArrayBuffer>;
  if (input instanceof Uint8Array) bytes = Uint8Array.from(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input.slice(0));
  else {
    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { signal?.throwIfAborted(); return input.arrayBuffer(); })
        .then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
    });
    signal?.throwIfAborted();
    if (!(data instanceof ArrayBuffer)) invalid("入力データがArrayBufferではありません");
    if (data.byteLength > limits.inputBytes) invalid(inputLimitMessage);
    if (data.byteLength !== size) invalid("宣言されたファイルサイズと実際のデータが一致しません");
    bytes = new Uint8Array(data.slice(0));
  }
  signal?.throwIfAborted();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true), u32 = (offset: number) => view.getUint32(offset, true);
  if (bytes.length < 22 || u32(0) !== 0x04034b50) invalid("暗号化されていないOOXMLファイルを指定してください");
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--)
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  if (end < 0) invalid("ZIPの終端が不正です");
  const count = u16(end + 10), directorySize = u32(end + 12), directoryStart = u32(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff || (end >= 20 && u32(end - 20) === 0x07064b50)) invalid("ZIP64には対応していません");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || count > limits.entries || directoryStart + directorySize !== end)
    invalid("ZIPの目録が不正または上限を超えています");
  const checkExtra = (start: number, finish: number) => {
    for (let at = start; at < finish;) {
      if (at + 4 > finish || at + 4 + u16(at + 2) > finish) invalid("ZIP拡張情報が不正です");
      if (u16(at) === 1) invalid("ZIP64には対応していません");
      at += 4 + u16(at + 2);
    }
  };
  const members: Member[] = [], files = new Map<string, Member>(), names = new Set<string>(), ranges: [number, number][] = [];
  let cursor = directoryStart, total = 0;
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted();
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) invalid("ZIPの目録が壊れています");
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16), compressed = u32(cursor + 20), expanded = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32), offset = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || offset === 0xffffffff || compressed === 0xffffffff || expanded === 0xffffffff) invalid("ZIP64または不正なZIPです");
    if (flags & ~0x080e || flags & 1 || u16(cursor + 34) || (method !== 0 && method !== 8)) invalid("暗号化または未対応のZIP圧縮形式です");
    checkExtra(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    const name = zipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength)), key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) invalid("ZIP内のファイル名が重複しています");
    names.add(key);
    if (expanded > limits.entryBytes || total + expanded > limits.totalBytes) invalid("展開サイズが上限を超えています");
    total += expanded;
    if (method === 0 && compressed !== expanded || name.endsWith("/") && expanded !== 0) invalid("ZIPの非圧縮サイズが不正です");
    if (offset + 30 > directoryStart || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) invalid("ZIPのローカルヘッダーが不正です");
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28), start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > directoryStart || zipName(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) invalid("ZIP内のデータ位置が不正です");
    checkExtra(offset + 30 + localNameLength, start);
    let finish = start + compressed;
    if (flags & 8) {
      if (finish + 4 <= directoryStart && u32(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > directoryStart || u32(finish) !== crc || u32(finish + 4) !== compressed || u32(finish + 8) !== expanded) invalid("ZIPデータ記述子が不正です");
      finish += 12;
    } else if (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== expanded) invalid("ZIPヘッダーのサイズが一致しません");
    ranges.push([offset, finish]);
    const member = { name, start, compressed, expanded, method, crc };
    members.push(member);
    if (!name.endsWith("/")) files.set(name, member);
    cursor = next;
    if (index % 16 === 15) await nextTurn();
  }
  if (cursor !== end) invalid("ZIP目録に余分なデータがあります");
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges[0]?.[0] !== 0 || ranges[ranges.length - 1]?.[1] !== directoryStart) invalid("ZIP内に未登録のデータがあります");
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] !== ranges[i - 1][1]) invalid("ZIP内のファイルが重複、または未登録です");
  const verified = new Set<Member>();
  async function* streamMember(member: Member): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted();
    let crc = 0xffffffff, actual = 0, sinceYield = 0;
    const checkChunk = (chunk: Uint8Array) => {
      actual += chunk.byteLength;
      if (actual > member.expanded || actual > limits.entryBytes) invalid("実際の展開サイズが上限を超えています");
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    };
    if (member.method === 0) {
      for (let at = member.start; at < member.start + member.compressed; at += CHUNK_BYTES) {
        signal?.throwIfAborted();
        const chunk = bytes.slice(at, Math.min(at + CHUNK_BYTES, member.start + member.compressed));
        checkChunk(chunk);
        yield chunk;
        sinceYield += chunk.byteLength;
        if (sinceYield >= 1024 * 1024) { sinceYield = 0; await nextTurn(); }
      }
    } else {
      if (typeof DecompressionStream === "undefined") invalid("この環境はOOXMLの展開に対応していません");
      const reader = new Blob([bytes.subarray(member.start, member.start + member.compressed)]).stream()
        .pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
      signal?.addEventListener("abort", abort, { once: true });
      let done = false;
      try {
        while (true) {
          signal?.throwIfAborted();
          const result = await reader.read();
          signal?.throwIfAborted();
          if (result.done) { done = true; break; }
          for (let at = 0; at < result.value.byteLength; at += CHUNK_BYTES) {
            const chunk = result.value.subarray(at, Math.min(at + CHUNK_BYTES, result.value.byteLength));
            checkChunk(chunk);
            yield chunk;
            signal?.throwIfAborted();
            sinceYield += chunk.byteLength;
            if (sinceYield >= 1024 * 1024) { sinceYield = 0; await nextTurn(); }
          }
        }
      } finally {
        signal?.removeEventListener("abort", abort);
        if (!done) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    signal?.throwIfAborted();
    if (actual !== member.expanded) invalid("ZIPの展開サイズが一致しません");
    if (((crc ^ 0xffffffff) >>> 0) !== member.crc) invalid("ZIPのCRCが一致しません");
    verified.add(member);
  }
  const memberFor = (path: string) => files.get(path) ?? invalid(`必要なファイルがありません（${path}）`);
  return {
    paths: Object.freeze([...files.keys()]), has: path => files.has(path),
    stream(path) { return streamMember(memberFor(path)); },
    async read(path: string, maxBytes: number = limits.entryBytes) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) invalid("読み込みサイズの上限が不正です");
      const member = memberFor(path);
      if (member.expanded > maxBytes) invalid("読み込むデータのサイズが上限を超えています");
      const result = new Uint8Array(member.expanded);
      let at = 0;
      for await (const chunk of streamMember(member)) { result.set(chunk, at); at += chunk.byteLength; }
      return result;
    },
    async validate() {
      for (const member of members) {
        signal?.throwIfAborted();
        if (!verified.has(member)) for await (const chunk of streamMember(member)) { void chunk; }
      }
      signal?.throwIfAborted();
    },
  };
}
