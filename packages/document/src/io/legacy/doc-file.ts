import { ByteReader, type CompoundFile } from "../../core";

/** Container-level structures of a Word 97–2003 document ([MS-DOC]): FIB, piece table and formatting pages. */
export const fail = (message: string): never => { throw new Error(`Word文書を読み込めません: ${message}`); };
export type DocPiece = { cpStart: number; cpEnd: number; offset: number; compressed: boolean };
/** Formatting exception for a range of file offsets in the WordDocument stream. */
export type DocRun = { start: number; end: number; grpprl: Uint8Array; istd: number };
export type DocFile = {
  main: Uint8Array; table: Uint8Array; data: Uint8Array | undefined;
  /** Character counts of the document parts, in the order they follow each other. */
  counts: { text: number; footnotes: number; headers: number; comments: number; endnotes: number; textboxes: number };
  /** Reads an (offset, length) pair of the FIB; missing pairs of older writers read as empty. */
  pair(index: number): { offset: number; length: number };
  pieces: DocPiece[]; characters: DocRun[]; paragraphs: DocRun[];
};
/** Indexes of the FIB offset pairs used by the importer. */
export const FIB = Object.freeze({ styles: 1, sections: 6, headers: 11, characterPages: 12, paragraphPages: 13, fonts: 15, fields: 16, pieceTable: 33,
  shapes: 40, drawings: 50, textboxes: 56, lists: 73, listOverrides: 74 });
const PAGE_BYTES = 512, MAX_PIECES = 1_000_000;

function readPieces(table: Uint8Array, offset: number, length: number, mainLength: number): DocPiece[] {
  const reader = new ByteReader(table, offset, offset + length);
  // Property modifiers precede the piece table and are not needed to place text.
  while (reader.remaining && reader.bytes[reader.offset] === 0x01) { reader.skip(1); reader.skip(reader.u16()); }
  if (!reader.remaining || reader.u8() !== 0x02) return fail("本文の位置情報が不正です");
  const size = reader.u32(), count = (size - 4) / 12;
  if (!Number.isInteger(count) || count < 1 || count > MAX_PIECES) return fail("本文の位置情報が不正です");
  const positions = Array.from({ length: count + 1 }, () => reader.u32()), pieces: DocPiece[] = [];
  for (let index = 0; index < count; index++) {
    reader.skip(2);
    const raw = reader.u32(), compressed = !!(raw & 0x40000000), cpStart = positions[index], cpEnd = positions[index + 1];
    reader.skip(2);
    // Compressed text stores one byte per character at half the stated offset.
    const position = compressed ? (raw & 0x3fffffff) >>> 1 : raw & 0x3fffffff;
    if (cpEnd < cpStart || position + (cpEnd - cpStart) * (compressed ? 1 : 2) > mainLength) return fail("本文の位置情報が不正です");
    pieces.push({ cpStart, cpEnd, offset: position, compressed });
  }
  return pieces;
}
/** Reads every formatting page listed by a bin table. Damaged entries are skipped: they only lose formatting. */
function readRuns(main: Uint8Array, table: Uint8Array, offset: number, length: number, paragraph: boolean): DocRun[] {
  const count = Math.floor((length - 4) / 8), runs: DocRun[] = [];
  if (count < 1) return runs;
  const bins = new ByteReader(table, offset + (count + 1) * 4, offset + length), view = new DataView(main.buffer, main.byteOffset, main.byteLength), seen = new Set<number>();
  for (let index = 0; index < count; index++) {
    const page = (bins.u32() & 0x3fffff) * PAGE_BYTES;
    if (seen.has(page) || page + PAGE_BYTES > main.length) continue;
    seen.add(page);
    const entries = main[page + PAGE_BYTES - 1], offsets = page + (entries + 1) * 4, width = paragraph ? 13 : 1;
    if (offsets + entries * width > page + PAGE_BYTES - 1) continue;
    for (let entry = 0; entry < entries; entry++) {
      const start = view.getUint32(page + entry * 4, true), end = view.getUint32(page + (entry + 1) * 4, true);
      let at = page + main[offsets + entry * width] * 2, grpprl: Uint8Array = new Uint8Array(), istd = 0;
      if (at !== page && at < page + PAGE_BYTES - 1) {
        let size = main[at++];
        if (paragraph) size = size ? size * 2 - 1 : main[at++] * 2;
        if (at + size <= page + PAGE_BYTES && (!paragraph || size >= 2)) {
          if (paragraph) { istd = view.getUint16(at, true); grpprl = main.subarray(at + 2, at + size); }
          else grpprl = main.subarray(at, at + size);
        }
      }
      if (end > start) runs.push({ start, end, grpprl, istd });
    }
  }
  return runs.sort((a, b) => a.start - b.start);
}

/** Opens the streams and validates the structures needed to locate text and its formatting. */
export function openDocFile(file: CompoundFile): DocFile {
  if (!file.has("WordDocument")) return fail(".doc形式（Word 97–2003）の文書ではありません");
  const main = file.read("WordDocument");
  if (main.length < 154) return fail(".doc形式（Word 97–2003）の文書ではありません");
  const head = new ByteReader(main);
  if (head.u16() !== 0xa5ec) return fail(".doc形式（Word 97–2003）の文書ではありません");
  const version = head.u16();
  head.skip(6);
  const flags = head.u16();
  if (version < 0x00c1) return fail("Word 95以前の形式には対応していません");
  if (flags & 0x0100) return fail("パスワードで保護または暗号化された文書には対応していません");
  const tableName = flags & 0x0200 ? "1Table" : "0Table";
  if (!file.has(tableName)) return fail("文書の構造が不正です");
  const table = file.read(tableName), view = new DataView(main.buffer, main.byteOffset, main.byteLength), pairs = view.getUint16(152, true);
  const pair = (index: number) => {
    const at = 154 + index * 8;
    if (index >= pairs || at + 8 > main.length) return { offset: 0, length: 0 };
    const offset = view.getUint32(at, true), length = view.getUint32(at + 4, true);
    // Offsets point into the table stream; an entry beyond it is treated as absent.
    return offset + length <= table.length ? { offset, length } : { offset: 0, length: 0 };
  };
  const count = (index: number) => Math.max(0, view.getInt32(64 + index * 4, true));
  const pieceTable = pair(FIB.pieceTable);
  if (!pieceTable.length) return fail("本文の位置情報がありません");
  const characterPages = pair(FIB.characterPages), paragraphPages = pair(FIB.paragraphPages);
  return {
    main, table, data: file.has("Data") ? file.read("Data") : undefined, pair,
    counts: { text: count(3), footnotes: count(4), headers: count(5), comments: count(7), endnotes: count(8), textboxes: count(9) },
    pieces: readPieces(table, pieceTable.offset, pieceTable.length, main.length),
    characters: readRuns(main, table, characterPages.offset, characterPages.length, false),
    paragraphs: readRuns(main, table, paragraphPages.offset, paragraphPages.length, true),
  };
}
/** Finds the run that contains a file offset. Runs are sorted and do not overlap. */
export function runAt(runs: readonly DocRun[], offset: number): DocRun | undefined {
  let low = 0, high = runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1, run = runs[middle];
    if (offset < run.start) high = middle - 1;
    else if (offset >= run.end) low = middle + 1;
    else return run;
  }
  return undefined;
}
