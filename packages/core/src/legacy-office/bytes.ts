const truncated = (): never => { throw new Error("Officeファイルを読み込めません: データが途中で終わっています"); };
const utf16 = new TextDecoder("utf-16le");

/** Little-endian cursor over untrusted bytes. Every read is bounded to the reader's own window. */
export class ByteReader {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly end: number;
  offset: number;
  readonly #view: DataView;
  constructor(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.byteLength || start > end) truncated();
    this.bytes = bytes; this.start = start; this.end = end; this.offset = start;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining(): number { return this.end - this.offset; }
  /** Reserves length bytes and returns where they start; a failed read leaves the cursor in place. */
  #advance(length: number): number {
    if (!Number.isInteger(length) || length < 0 || length > this.end - this.offset) truncated();
    const at = this.offset;
    this.offset += length;
    return at;
  }
  u8(): number { return this.bytes[this.#advance(1)]; }
  u16(): number { return this.#view.getUint16(this.#advance(2), true); }
  u32(): number { return this.#view.getUint32(this.#advance(4), true); }
  i16(): number { return this.#view.getInt16(this.#advance(2), true); }
  i32(): number { return this.#view.getInt32(this.#advance(4), true); }
  f64(): number { return this.#view.getFloat64(this.#advance(8), true); }
  /** A view of the next bytes; copy it before retaining it beyond the source buffer's lifetime. */
  take(length: number): Uint8Array { const at = this.#advance(length); return this.bytes.subarray(at, at + length); }
  skip(length: number): void { this.#advance(length); }
  seek(offset: number): void {
    if (!Number.isInteger(offset) || offset < this.start || offset > this.end) truncated();
    this.offset = offset;
  }
  /** Decodes UTF-16LE code units; unpaired surrogates become U+FFFD. */
  utf16(units: number): string { return utf16.decode(this.take(units * 2)); }
  /** A reader confined to the next length bytes, which this reader skips. */
  sub(length: number): ByteReader { const at = this.#advance(length); return new ByteReader(this.bytes, at, at + length); }
}
