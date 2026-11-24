import { OFFICE_PACKAGE_LIMITS, type OfficePackageSignal } from "./types";
import type { OfficePackageReadLimits, OfficePackageStreamingArchive } from "./zip-stream-reader";

/** Parts of an Office package that already exist in memory, in package order. */
export type OfficePackageParts = Iterable<readonly [path: string, content: Uint8Array]>;
export type OfficePackageFromPartsOptions = { signal?: OfficePackageSignal; limits?: Partial<OfficePackageReadLimits> };

const invalid = (message: string): never => { throw new Error(`Officeファイルを読み込めません: ${message}`); };
const CHUNK_BYTES = 64 * 1024;

/**
 * Serves in-memory parts through the same contract as the streaming ZIP reader, so a
 * converter can hand a synthesized package to an importer without writing a ZIP.
 * Paths, duplicates and budgets follow the ZIP rules; there is no CRC to validate.
 */
export function createOfficePackageFromParts(parts: OfficePackageParts, options: OfficePackageFromPartsOptions = {}): OfficePackageStreamingArchive {
  const { signal } = options, limits = { ...OFFICE_PACKAGE_LIMITS, ...options.limits };
  for (const key of ["entries", "entryBytes", "totalBytes"] as const)
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) invalid("パッケージの読み込み上限が不正です");
  const files = new Map<string, Uint8Array>(), names = new Set<string>();
  let total = 0;
  for (const [path, content] of parts) {
    if (typeof path !== "string" || !path || path.length > 512 || /[\\\u0000-\u001f\u007f?#:%]/.test(path) || path.startsWith("/") ||
      path.split("/").some(part => !part || part === "." || part === "..")) invalid("パッケージ内のパスが不正です");
    if (!(content instanceof Uint8Array)) invalid(`パーツの内容が不正です（${path}）`);
    const key = path.toLocaleLowerCase("en-US");
    if (names.has(key)) invalid("パッケージ内のファイル名が重複しています");
    names.add(key);
    total += content.byteLength;
    if (files.size >= limits.entries || content.byteLength > limits.entryBytes || total > limits.totalBytes) invalid("パッケージのサイズが上限を超えています");
    // The package owns its bytes: later changes to the source must not reach an importer.
    files.set(path, Uint8Array.from(content));
  }
  if (!files.size) invalid("パッケージにパーツがありません");
  const partFor = (path: string) => files.get(path) ?? invalid(`必要なファイルがありません（${path}）`);
  async function* streamPart(part: Uint8Array): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted();
    for (let at = 0; at < part.byteLength; at += CHUNK_BYTES) {
      yield part.slice(at, Math.min(at + CHUNK_BYTES, part.byteLength));
      signal?.throwIfAborted();
    }
  }
  return {
    paths: Object.freeze([...files.keys()]), has: path => files.has(path),
    stream(path) { return streamPart(partFor(path)); },
    async read(path: string, maxBytes: number = limits.entryBytes) {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) invalid("読み込みサイズの上限が不正です");
      const part = partFor(path);
      if (part.byteLength > maxBytes) invalid("読み込むデータのサイズが上限を超えています");
      return part.slice();
    },
    async validate() { signal?.throwIfAborted(); },
  };
}
