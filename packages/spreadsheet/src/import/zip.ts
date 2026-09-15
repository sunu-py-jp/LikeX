import { XLSX_IMPORT_LIMITS as limits, type SpreadsheetExcelImportInput, type SpreadsheetExcelImportSignal } from "./types";

export type XlsxArchive = {
  readonly paths: readonly string[];
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array>;
};
const invalid = (message: string): never => { throw new Error(`Excelファイルを読み込めません: ${message}`); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function zipName(bytes: Uint8Array): string {
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid("ZIP内のファイル名が不正です"); }
  if (!name || name.length > 512 || /[\\\u0000-\u001f\u007f?#:]/.test(name) || name.startsWith("/") || /%/i.test(name) ||
    name.replace(/\/$/, "").split("/").some(part => !part || part === "." || part === "..")) return invalid("ZIP内のパスが不正です");
  return name;
}
/** Reads STORE/DEFLATE only. No filesystem writes, network, ZIP64, or encrypted members. */
export async function openXlsxArchive(input: SpreadsheetExcelImportInput, signal?: SpreadsheetExcelImportSignal): Promise<XlsxArchive> {
  signal?.throwIfAborted();
  const binary = input instanceof ArrayBuffer || input instanceof Uint8Array;
  if (!binary && (!input || typeof input !== "object" || typeof input.arrayBuffer !== "function")) invalid("入力形式が不正です");
  const size = binary ? input.byteLength : input.size;
  if (!Number.isSafeInteger(size) || size < 0) invalid("ファイルサイズが不正です");
  if (size > limits.inputBytes) invalid("ファイルサイズが32 MiBを超えています");
  let bytes: Uint8Array<ArrayBuffer>;
  if (input instanceof Uint8Array) bytes = Uint8Array.from(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input.slice(0));
  else {
    const data = await input.arrayBuffer();
    signal?.throwIfAborted();
    if (!(data instanceof ArrayBuffer)) invalid("入力データがArrayBufferではありません");
    if (data.byteLength > limits.inputBytes) invalid("ファイルサイズが32 MiBを超えています");
    if (data.byteLength !== size) invalid("宣言されたファイルサイズと実際のデータが一致しません");
    bytes = new Uint8Array(data.slice(0));
  }
  signal?.throwIfAborted();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true), u32 = (offset: number) => view.getUint32(offset, true);
  if (bytes.length < 22 || u32(0) !== 0x04034b50) invalid("暗号化されていない.xlsxファイルを指定してください");
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
  if (end < 0) invalid("ZIPの終端が不正です");
  const count = u16(end + 10), directorySize = u32(end + 12), directoryStart = u32(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff || (end >= 20 && u32(end - 20) === 0x07064b50)) invalid("ZIP64には対応していません");
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || count > limits.entries || directoryStart + directorySize !== end) invalid("ZIPの目録が不正または上限を超えています");
  const files = new Map<string, Uint8Array>(), names = new Set<string>(), ranges: [number, number][] = [];
  let cursor = directoryStart, total = 0;
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted();
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) invalid("ZIPの目録が壊れています");
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16), compressed = u32(cursor + 20), expanded = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32), offset = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || offset === 0xffffffff || compressed === 0xffffffff || expanded === 0xffffffff) invalid("ZIP64または不正なZIPです");
    if (flags & ~0x080e || flags & 1 || u16(cursor + 34) || (method !== 0 && method !== 8)) invalid("暗号化または未対応のZIP圧縮形式です");
    for (let p = cursor + 46 + nameLength; p < cursor + 46 + nameLength + extraLength;) {
      if (p + 4 > cursor + 46 + nameLength + extraLength || p + 4 + u16(p + 2) > cursor + 46 + nameLength + extraLength) invalid("ZIP拡張情報が不正です");
      if (u16(p) === 1) invalid("ZIP64には対応していません");
      p += 4 + u16(p + 2);
    }
    const name = zipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) invalid("ZIP内のファイル名が重複しています");
    names.add(key);
    if (expanded > limits.entryBytes || total + expanded > limits.totalBytes) invalid("展開サイズが上限を超えています");
    if (offset + 30 > directoryStart || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) invalid("ZIPのローカルヘッダーが不正です");
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28), start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > directoryStart || zipName(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) invalid("ZIP内のデータ位置が不正です");
    for (let p = offset + 30 + localNameLength; p < start;) {
      if (p + 4 > start || p + 4 + u16(p + 2) > start) invalid("ZIP拡張情報が不正です");
      if (u16(p) === 1) invalid("ZIP64には対応していません");
      p += 4 + u16(p + 2);
    }
    let finish = start + compressed;
    if (flags & 8) {
      if (finish + 4 <= directoryStart && u32(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > directoryStart || u32(finish) !== crc || u32(finish + 4) !== compressed || u32(finish + 8) !== expanded) invalid("ZIPデータ記述子が不正です");
      finish += 12;
    } else if (u32(offset + 14) !== crc || u32(offset + 18) !== compressed || u32(offset + 22) !== expanded) invalid("ZIPヘッダーのサイズが一致しません");
    ranges.push([offset, finish]);
    let result: Uint8Array;
    if (method === 0) {
      if (compressed !== expanded) invalid("ZIPの非圧縮サイズが一致しません");
      result = bytes.slice(start, start + compressed);
    } else {
      if (typeof DecompressionStream === "undefined") invalid("この環境は.xlsxの展開に対応していません");
      const chunks: Uint8Array[] = [];
      let actual = 0;
      const stream = new Blob([bytes.slice(start, start + compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          signal?.throwIfAborted();
          const chunk = await reader.read();
          signal?.throwIfAborted();
          if (chunk.done) break;
          actual += chunk.value.byteLength;
          if (actual > expanded || actual > limits.entryBytes || total + actual > limits.totalBytes) { await reader.cancel(); invalid("実際の展開サイズが上限を超えています"); }
          chunks.push(chunk.value);
        }
      } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
      if (actual !== expanded) invalid("ZIPの展開サイズが一致しません");
      result = new Uint8Array(actual);
      let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; }
    }
    if (crc32(result) !== crc) invalid("ZIPのCRCが一致しません");
    total += result.byteLength;
    if (!name.endsWith("/")) files.set(name, result);
    else if (result.byteLength) invalid("ZIPディレクトリにデータがあります");
    cursor = next;
    if (index % 16 === 15) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (cursor !== end) invalid("ZIP目録に余分なデータがあります");
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges[0]?.[0] !== 0 || ranges[ranges.length - 1]?.[1] !== directoryStart) invalid("ZIP内に未登録のデータがあります");
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] !== ranges[i - 1][1]) invalid("ZIP内のファイルが重複、または未登録です");
  return { paths: Object.freeze([...files.keys()]), has: path => files.has(path), async read(path) {
    signal?.throwIfAborted();
    return files.get(path) ?? invalid(`必要なファイルがありません（${path}）`);
  } };
}
