import type { OfficePackageInput, OfficePackageSignal } from "../ooxml/types";

/** Budgets for one compound file; every declared size is checked before bytes are copied. */
export type CompoundFileLimits = { readonly inputBytes: number; readonly entries: number; readonly streamBytes: number };
export const COMPOUND_FILE_LIMITS: CompoundFileLimits = Object.freeze({ inputBytes: 32 * 1024 * 1024, entries: 16_384, streamBytes: 32 * 1024 * 1024 });
/** Streams of a compound file ([MS-CFB]), the container of the Office 97–2003 binary formats. */
export type CompoundFile = {
  /** Stream paths; storages are joined with "/". Names match without regard to case. */
  readonly paths: readonly string[];
  has(path: string): boolean;
  size(path: string): number;
  /** Returns a copy of the stream. A lower cap can be set for metadata streams. */
  read(path: string, maxBytes?: number): Uint8Array;
};

type Stream = { path: string; size: number; mini: boolean; sectors: readonly number[] };
const invalid = (message: string): never => { throw new Error(`Officeファイルを読み込めません: ${message}`); };
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAX_REGULAR = 0xfffffffa, END_OF_CHAIN = 0xfffffffe, NO_STREAM = 0xffffffff, MINI_SECTOR = 64, ENTRY_BYTES = 128;
const key = (path: string) => path.toUpperCase();

/**
 * Validates the whole allocation structure before exposing streams: every sector chain is
 * resolved once, so loops, shared sectors and declared sizes beyond the data are rejected
 * up front. Reads never touch the filesystem or network and never execute content.
 */
export async function openCompoundFile(input: OfficePackageInput, signal?: OfficePackageSignal,
  requestedLimits?: Partial<CompoundFileLimits>): Promise<CompoundFile> {
  const limits = { ...COMPOUND_FILE_LIMITS, ...requestedLimits };
  for (const name of ["inputBytes", "entries", "streamBytes"] as const)
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) invalid("複合ファイルの読み込み上限が不正です");
  signal?.throwIfAborted();
  const binary = input instanceof ArrayBuffer || input instanceof Uint8Array;
  if (!binary && (!input || typeof input !== "object" || typeof input.arrayBuffer !== "function")) invalid("入力形式が不正です");
  const declared = binary ? input.byteLength : input.size;
  if (!Number.isSafeInteger(declared) || declared < 0) invalid("ファイルサイズが不正です");
  if (declared > limits.inputBytes) invalid("ファイルサイズが上限を超えています");
  let bytes: Uint8Array<ArrayBuffer>;
  if (input instanceof Uint8Array) bytes = Uint8Array.from(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input.slice(0));
  else {
    const data = await input.arrayBuffer();
    signal?.throwIfAborted();
    if (!(data instanceof ArrayBuffer)) invalid("入力データがArrayBufferではありません");
    if (data.byteLength > limits.inputBytes) invalid("ファイルサイズが上限を超えています");
    if (data.byteLength !== declared) invalid("宣言されたファイルサイズと実際のデータが一致しません");
    bytes = new Uint8Array(data.slice(0));
  }
  if (bytes.length < 512 || SIGNATURE.some((value, index) => bytes[index] !== value)) invalid("複合ファイルではありません");
  const view = new DataView(bytes.buffer), u16 = (offset: number) => view.getUint16(offset, true), u32 = (offset: number) => view.getUint32(offset, true);
  if (u16(28) !== 0xfffe) invalid("複合ファイルのバイト順に対応していません");
  const sectorShift = u16(30), major = u16(26);
  if (!(sectorShift === 9 && major === 3 || sectorShift === 12 && major === 4) || u16(32) !== 6) invalid("複合ファイルのセクターサイズに対応していません");
  const sectorSize = 1 << sectorShift, perSector = sectorSize / 4;
  // The header occupies the first sector; a trailing partial sector carries no addressable data.
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize);
  if (sectorCount < 1) invalid("複合ファイルのサイズが不正です");
  const sectorOffset = (sector: number) => {
    if (sector >= sectorCount) invalid("複合ファイルのセクター番号が範囲外です");
    return (sector + 1) * sectorSize;
  };
  const fatCount = u32(44), difatCount = u32(72), cutoff = u32(56);
  if (!fatCount) invalid("複合ファイルのFATがありません");
  if (fatCount > sectorCount || difatCount > sectorCount) invalid("複合ファイルのFATが不正です");
  const fatSectors: number[] = [];
  // The header lists the first 109 FAT sectors; unused slots are skipped rather than trusted to be trailing.
  for (let index = 0; index < 109 && fatSectors.length < fatCount; index++) if (u32(76 + index * 4) !== NO_STREAM) fatSectors.push(u32(76 + index * 4));
  for (let sector = u32(68), seen = 0; fatSectors.length < fatCount; seen++) {
    if (sector >= MAX_REGULAR || seen >= difatCount) invalid("複合ファイルのFATが不正です");
    const base = sectorOffset(sector);
    for (let slot = 0; slot < perSector - 1 && fatSectors.length < fatCount; slot++) fatSectors.push(u32(base + slot * 4));
    sector = u32(base + (perSector - 1) * 4);
  }
  const fat = new Uint32Array(fatCount * perSector);
  fatSectors.forEach((sector, index) => {
    const base = sectorOffset(sector);
    for (let slot = 0; slot < perSector; slot++) fat[index * perSector + slot] = u32(base + slot * 4);
  });
  signal?.throwIfAborted();
  // Each sector may belong to one chain only, which also bounds all chain walks by the file size.
  const claimed = new Uint8Array(sectorCount);
  const chain = (start: number, needed?: number): number[] => {
    const sectors: number[] = [];
    for (let sector = start; needed === undefined ? sector !== END_OF_CHAIN : sectors.length < needed; sector = fat[sector]) {
      if (sector === END_OF_CHAIN && needed !== undefined) invalid("複合ファイルのストリームのデータが不足しています");
      if (sector >= sectorCount || sector >= fat.length) invalid("複合ファイルのセクター番号が範囲外です");
      if (claimed[sector]) invalid("複合ファイルのセクターの連鎖が循環しています");
      claimed[sector] = 1;
      sectors.push(sector);
    }
    return sectors;
  };
  const gather = (sectors: readonly number[], size: number) => {
    const result = new Uint8Array(size);
    sectors.forEach((sector, index) => {
      const offset = (sector + 1) * sectorSize, length = Math.min(sectorSize, size - index * sectorSize);
      if (length > 0) result.set(bytes.subarray(offset, offset + length), index * sectorSize);
    });
    return result;
  };
  const firstDirectory = u32(48);
  if (firstDirectory >= MAX_REGULAR) invalid("複合ファイルのディレクトリがありません");
  const directorySectors = chain(firstDirectory), directory = gather(directorySectors, directorySectors.length * sectorSize);
  const entries = new DataView(directory.buffer), entryCount = directory.length / ENTRY_BYTES;
  const entryType = (id: number) => directory[id * ENTRY_BYTES + 66];
  const entryU32 = (id: number, offset: number) => entries.getUint32(id * ENTRY_BYTES + offset, true);
  if (entryType(0) !== 5) invalid("複合ファイルのルートエントリが不正です");
  const streamSize = (id: number) => {
    // Version 3 writers may leave garbage in the upper half; version 4 must stay within the budget.
    if (major === 4 && entryU32(id, 124)) invalid("複合ファイルのストリームのサイズが上限を超えています");
    const size = entryU32(id, 120);
    if (size > limits.streamBytes) invalid("複合ファイルのストリームのサイズが上限を超えています");
    return size;
  };
  const miniStreamSize = streamSize(0);
  const miniStream = miniStreamSize ? gather(chain(entryU32(0, 116), Math.ceil(miniStreamSize / sectorSize)), miniStreamSize) : new Uint8Array();
  const miniFatSectors = u32(64) && u32(60) < MAX_REGULAR ? chain(u32(60)) : [];
  const miniFat = new Uint32Array(miniFatSectors.length * perSector);
  miniFatSectors.forEach((sector, index) => {
    const base = (sector + 1) * sectorSize;
    for (let slot = 0; slot < perSector; slot++) miniFat[index * perSector + slot] = u32(base + slot * 4);
  });
  const miniSectorCount = Math.ceil(miniStream.length / MINI_SECTOR), miniClaimed = new Uint8Array(miniSectorCount);
  const miniChain = (start: number, needed: number): number[] => {
    const sectors: number[] = [];
    for (let sector = start; sectors.length < needed; sector = miniFat[sector]) {
      if (sector === END_OF_CHAIN) invalid("複合ファイルのストリームのデータが不足しています");
      if (sector >= miniSectorCount || sector >= miniFat.length) invalid("複合ファイルのセクター番号が範囲外です");
      if (miniClaimed[sector]) invalid("複合ファイルのセクターの連鎖が循環しています");
      miniClaimed[sector] = 1;
      sectors.push(sector);
    }
    return sectors;
  };
  signal?.throwIfAborted();
  const streams = new Map<string, Stream>(), paths: string[] = [], visited = new Uint8Array(entryCount);
  const decoder = new TextDecoder("utf-16le");
  let total = 0;
  const pending: { child: number; prefix: string }[] = [{ child: entryU32(0, 76), prefix: "" }];
  while (pending.length) {
    const { child, prefix } = pending.pop()!, siblings = new Set<string>(), stack = [child];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === NO_STREAM) continue;
      if (id >= entryCount) invalid("複合ファイルのディレクトリの参照が範囲外です");
      if (visited[id] || id === 0) invalid("複合ファイルのディレクトリが循環しています");
      visited[id] = 1;
      if (++total > limits.entries) invalid("複合ファイルのストリーム数が上限を超えています");
      const type = entryType(id), nameBytes = entries.getUint16(id * ENTRY_BYTES + 64, true);
      if (type !== 1 && type !== 2) invalid("複合ファイルのエントリの種類が不正です");
      if (nameBytes < 4 || nameBytes > 64 || nameBytes % 2) invalid("複合ファイルのエントリ名が不正です");
      const name = decoder.decode(directory.subarray(id * ENTRY_BYTES, id * ENTRY_BYTES + nameBytes - 2));
      if (/[/\\:!\u0000]/.test(name)) invalid("複合ファイルのエントリ名が不正です");
      if (siblings.has(key(name))) invalid("複合ファイルのストリーム名が重複しています");
      siblings.add(key(name));
      stack.push(entryU32(id, 68), entryU32(id, 72));
      const path = prefix + name;
      if (type === 1) { pending.push({ child: entryU32(id, 76), prefix: `${path}/` }); continue; }
      const size = streamSize(id), mini = size > 0 && size < cutoff;
      const sectors = !size ? [] : mini ? miniChain(entryU32(id, 116), Math.ceil(size / MINI_SECTOR)) : chain(entryU32(id, 116), Math.ceil(size / sectorSize));
      streams.set(key(path), { path, size, mini, sectors });
      paths.push(path);
    }
  }
  signal?.throwIfAborted();
  const streamFor = (path: string) => streams.get(key(path)) ?? invalid(`必要なストリームがありません（${path}）`);
  return {
    paths: Object.freeze(paths), has: path => streams.has(key(path)), size: path => streamFor(path).size,
    read(path, maxBytes = limits.streamBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) invalid("読み込みサイズの上限が不正です");
      const stream = streamFor(path);
      if (stream.size > maxBytes) invalid("読み込むデータのサイズが上限を超えています");
      if (!stream.mini) return gather(stream.sectors, stream.size);
      const result = new Uint8Array(stream.size);
      stream.sectors.forEach((sector, index) => {
        const length = Math.min(MINI_SECTOR, stream.size - index * MINI_SECTOR);
        result.set(miniStream.subarray(sector * MINI_SECTOR, sector * MINI_SECTOR + length), index * MINI_SECTOR);
      });
      return result;
    },
  };
}
