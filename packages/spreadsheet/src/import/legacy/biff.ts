import { ByteReader } from "../../core";

/** Record framing and string encodings of the BIFF8 Workbook stream ([MS-XLS]). */
export const fail = (message: string): never => { throw new Error(`Excelファイルを読み込めません: ${message}`); };
export type BiffRecord = { readonly type: number; readonly data: Uint8Array; readonly continues: readonly Uint8Array[] };

export const RT = Object.freeze({
  BOF: 0x0809, EOF: 0x000a, CONTINUE: 0x003c, FILEPASS: 0x002f, CODEPAGE: 0x0042, DATEMODE: 0x0022,
  FONT: 0x0031, FORMAT: 0x041e, XF: 0x00e0, PALETTE: 0x0092, BOUNDSHEET: 0x0085, SST: 0x00fc,
  EXTERNSHEET: 0x0017, SUPBOOK: 0x01ae, EXTERNNAME: 0x0023, NAME: 0x0018, MSODRAWINGGROUP: 0x00eb, PROTECT: 0x0012,
  ROW: 0x0208, COLINFO: 0x007d, DEFCOLWIDTH: 0x0055, STANDARDWIDTH: 0x0099, DEFAULTROWHEIGHT: 0x0225,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, LABELSST: 0x00fd, LABEL: 0x0204, RSTRING: 0x00d6, BLANK: 0x0201, MULBLANK: 0x00be, BOOLERR: 0x0205,
  FORMULA: 0x0006, STRING: 0x0207, SHRFMLA: 0x04bc, ARRAY: 0x0221, TABLE: 0x0236, MERGEDCELLS: 0x00e5,
  NOTE: 0x001c, OBJ: 0x005d, TXO: 0x01b6, MSODRAWING: 0x00ec, DVAL: 0x01b2, DV: 0x01be,
  AUTOFILTERINFO: 0x009d, AUTOFILTER: 0x009e, FILTERMODE: 0x009b,
  SETUP: 0x00a1, LEFTMARGIN: 0x0026, RIGHTMARGIN: 0x0027, TOPMARGIN: 0x0028, BOTTOMMARGIN: 0x0029,
  HORIZONTALPAGEBREAKS: 0x001b, VERTICALPAGEBREAKS: 0x001a, WSBOOL: 0x0081, WINDOW2: 0x023e, PANE: 0x0041,
  CONDFMT: 0x01b0, HLINK: 0x01b8, SCENPROTECT: 0x00dd, OBJPROTECT: 0x0063,
});
const NO_CONTINUES: readonly Uint8Array[] = Object.freeze([]);

/** Sequential reader of the record stream. CONTINUE records are attached to the record they extend. */
export class BiffStream {
  readonly bytes: Uint8Array;
  offset: number;
  readonly #view: DataView;
  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes; this.offset = offset;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** Type of the record at the cursor, or undefined at the end of the stream. */
  peekType(): number | undefined { return this.offset + 4 <= this.bytes.length ? this.#view.getUint16(this.offset, true) : undefined; }
  next(): BiffRecord | undefined {
    if (this.offset + 4 > this.bytes.length) return undefined;
    const type = this.#view.getUint16(this.offset, true), data = this.#payload();
    let continues: Uint8Array[] | undefined;
    while (this.peekType() === RT.CONTINUE) (continues ??= []).push(this.#payload());
    return { type, data, continues: continues ?? NO_CONTINUES };
  }
  #payload(): Uint8Array {
    const size = this.#view.getUint16(this.offset + 2, true), start = this.offset + 4;
    if (start + size > this.bytes.length) fail("データが途中で終わっています");
    this.offset = start + size;
    return this.bytes.subarray(start, start + size);
  }
}

const latin = (bytes: Uint8Array): string => {
  // Compressed BIFF8 text stores the low byte of each UTF-16 code unit; it is not a code page.
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
};
const utf16 = new TextDecoder("utf-16le");

/** Reads a record across its CONTINUE records. Character data restates its width after every break. */
export class ContinuedReader {
  readonly #chunks: readonly Uint8Array[];
  #index = 0;
  #reader: ByteReader;
  constructor(record: BiffRecord) {
    this.#chunks = [record.data, ...record.continues];
    this.#reader = new ByteReader(this.#chunks[0]);
  }
  get done(): boolean {
    while (!this.#reader.remaining && this.#index + 1 < this.#chunks.length) this.#reader = new ByteReader(this.#chunks[++this.#index]);
    return !this.#reader.remaining;
  }
  #byte(): number { if (this.done) fail("データが途中で終わっています"); return this.#reader.u8(); }
  u8(): number { return this.#byte(); }
  u16(): number { return this.#reader.remaining >= 2 ? this.#reader.u16() : this.#byte() | this.#byte() << 8; }
  u32(): number { return this.#reader.remaining >= 4 ? this.#reader.u32() : (this.u16() | this.u16() << 16) >>> 0; }
  skip(length: number): void {
    for (let left = length; left > 0;) {
      if (this.done) fail("データが途中で終わっています");
      const step = Math.min(left, this.#reader.remaining);
      this.#reader.skip(step); left -= step;
    }
  }
  /** Reads count UTF-16 code units; a continuation starts with its own option flags. */
  characters(count: number, wide: boolean): string {
    let text = "";
    for (let left = count; left > 0;) {
      if (!this.#reader.remaining) {
        if (this.done) fail("データが途中で終わっています");
        wide = (this.#reader.u8() & 1) === 1;
      }
      const width = wide ? 2 : 1, step = Math.min(left, Math.floor(this.#reader.remaining / width));
      if (!step) fail("文字列の区切りが不正です");
      const bytes = this.#reader.take(step * width);
      text += wide ? utf16.decode(bytes) : latin(bytes);
      left -= step;
    }
    return text;
  }
}

export type RichString = { readonly text: string; readonly rich: boolean };
/** XLUnicodeRichExtendedString: text with optional formatting runs and phonetic data, which are skipped. */
export function readRichString(reader: ContinuedReader): RichString {
  const count = reader.u16(), flags = reader.u8(), runs = flags & 0x08 ? reader.u16() : 0, extended = flags & 0x04 ? reader.u32() : 0;
  const text = reader.characters(count, (flags & 1) === 1);
  reader.skip(runs * 4); reader.skip(extended);
  return { text, rich: runs > 0 };
}
/** Characters without a length prefix: option flags, then count code units. */
export function readCharacters(reader: ByteReader, count: number): string {
  const flags = reader.u8(), runs = flags & 0x08 ? reader.u16() : 0, extended = flags & 0x04 ? reader.u32() : 0;
  const text = flags & 1 ? reader.utf16(count) : latin(reader.take(count));
  reader.skip(Math.min(reader.remaining, runs * 4 + extended));
  return text;
}
/** XLUnicodeString (16-bit length) or ShortXLUnicodeString (8-bit length). */
export function readString(reader: ByteReader, lengthBytes: 1 | 2 = 2): string {
  return readCharacters(reader, lengthBytes === 1 ? reader.u8() : reader.u16());
}

/** Escapes text nodes. Control characters use the SpreadsheetML _xHHHH_ form that the reader decodes. */
export function xmlText(value: string): string {
  return value.replace(/_x([0-9a-fA-F]{4})_/g, "_x005F_x$1_")
    .replace(/[&<>]|[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|\r/g, character =>
      character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : `_x${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}
/** Escapes attribute values; characters XML cannot carry are dropped. */
export function xmlAttribute(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[&<>"\t\n\r]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" })[character]!);
}
/** Column letters and A1 addresses, zero-based. */
export function columnName(column: number): string {
  let name = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
export const cellName = (row: number, column: number): string => `${columnName(column)}${row + 1}`;
