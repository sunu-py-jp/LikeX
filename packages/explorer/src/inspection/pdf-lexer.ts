import { PdfBudget, invalidPdf, pdfLimit } from "./pdf-budget";
import { pdfInteger, type PdfValue } from "./pdf-values";

const whitespace = (byte: number | undefined) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
const delimiter = (byte: number | undefined) => byte === undefined || whitespace(byte) ||
  byte === 40 || byte === 41 || byte === 60 || byte === 62 || byte === 91 || byte === 93 || byte === 47 || byte === 37;
const digit = (byte: number | undefined) => byte !== undefined && byte >= 48 && byte <= 57;
const hex = (byte: number): number => byte >= 48 && byte <= 57 ? byte - 48 :
  byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
const opaqueString = Object.freeze({ kind: "string" as const });

/** PDF syntax only. Strings are validated but never retained: metadata needs no text. */
export class PdfLexer {
  constructor(readonly bytes: Uint8Array, readonly budget: PdfBudget, public offset = 0, readonly end = bytes.length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || offset > end || end > bytes.length) invalidPdf("データ位置が不正です");
  }
  private peek() { return this.offset < this.end ? this.bytes[this.offset] : undefined; }
  private async charge(start: number): Promise<number> {
    this.budget.work(this.offset - start);
    await this.budget.checkpoint();
    return this.offset;
  }

  async skip(): Promise<void> {
    let charged = this.offset, comment = false;
    while (this.offset < this.end) {
      const byte = this.bytes[this.offset];
      if (comment) { if (byte === 10 || byte === 13) comment = false; }
      else if (byte === 37) comment = true;
      else if (!whitespace(byte)) break;
      this.offset++;
      if (this.offset - charged >= 4096) charged = await this.charge(charged);
    }
    await this.charge(charged);
  }
  async atEnd(): Promise<boolean> { await this.skip(); return this.offset === this.end; }

  async consume(keyword: string): Promise<boolean> {
    await this.skip();
    if (keyword.length > this.end - this.offset) return false;
    for (let index = 0; index < keyword.length; index++) if (this.bytes[this.offset + index] !== keyword.charCodeAt(index)) return false;
    if (!delimiter(this.offset + keyword.length < this.end ? this.bytes[this.offset + keyword.length] : undefined)) return false;
    this.offset += keyword.length;
    this.budget.work(keyword.length);
    return true;
  }
  async word(): Promise<string> {
    await this.skip();
    const start = this.offset, parts: string[] = [];
    let charged = start;
    while (!delimiter(this.peek())) {
      if (this.offset - start >= this.budget.limits.tokenLength) pdfLimit();
      this.offset++;
      if (this.offset - charged >= 4096) {
        parts.push(String.fromCharCode(...this.bytes.subarray(charged, this.offset)));
        charged = await this.charge(charged);
      }
    }
    if (this.offset === start) invalidPdf("トークンが不正です");
    parts.push(String.fromCharCode(...this.bytes.subarray(charged, this.offset)));
    await this.charge(charged);
    return parts.join("");
  }
  async integer(maximum = Number.MAX_SAFE_INTEGER): Promise<number> {
    const token = await this.word();
    if (token.length > this.budget.limits.integerDigits || !/^\d+$/.test(token)) invalidPdf("整数値が不正です");
    return pdfInteger(Number(token), maximum);
  }

  private async name(): Promise<PdfValue> {
    this.offset++; // /
    const codes: number[] = [], parts: string[] = [];
    let charged = this.offset - 1, length = 0;
    while (!delimiter(this.peek())) {
      if (length >= this.budget.limits.nameLength) pdfLimit();
      const byte = this.bytes[this.offset++];
      if (byte === 35) {
        if (this.offset + 2 > this.end) invalidPdf("名前のエスケープが不正です");
        const high = hex(this.bytes[this.offset++]), low = hex(this.bytes[this.offset++]);
        if (high < 0 || low < 0 || (high === 0 && low === 0)) invalidPdf("名前のエスケープが不正です");
        codes.push(high * 16 + low);
      } else codes.push(byte);
      length++;
      if (this.offset - charged >= 4096) {
        parts.push(String.fromCharCode(...codes)); codes.length = 0;
        charged = await this.charge(charged);
      }
    }
    parts.push(String.fromCharCode(...codes));
    await this.charge(charged);
    return { kind: "name", value: parts.join("") };
  }
  private async literalString(): Promise<PdfValue> {
    let depth = 1, charged = this.offset++;
    while (this.offset < this.end) {
      const byte = this.bytes[this.offset++];
      if (byte === 92) {
        // Escaped punctuation, octal bytes, and line continuations cannot close the string.
        if (this.offset < this.end) {
          const escaped = this.bytes[this.offset++];
          if (escaped === 13 && this.bytes[this.offset] === 10 && this.offset < this.end) this.offset++;
        }
      } else if (byte === 40) {
        if (++depth > this.budget.limits.depth) pdfLimit();
      } else if (byte === 41 && --depth === 0) {
        await this.charge(charged);
        return opaqueString;
      }
      if (this.offset - charged >= 4096) charged = await this.charge(charged);
    }
    invalidPdf("文字列が途中で終わっています");
  }
  private async hexString(): Promise<PdfValue> {
    let charged = this.offset++;
    while (this.offset < this.end) {
      const byte = this.bytes[this.offset++];
      if (byte === 62) { await this.charge(charged); return opaqueString; }
      if (!whitespace(byte) && hex(byte) < 0) invalidPdf("16進文字列が不正です");
      if (this.offset - charged >= 4096) charged = await this.charge(charged);
    }
    invalidPdf("文字列が途中で終わっています");
  }

  async value(depth = 0): Promise<PdfValue> {
    if (depth > this.budget.limits.depth) pdfLimit();
    this.budget.value();
    await this.skip();
    const byte = this.peek();
    if (byte === 47) return this.name();
    if (byte === 40) return this.literalString();
    if (byte === 60) {
      if (this.bytes[this.offset + 1] !== 60 || this.offset + 1 >= this.end) return this.hexString();
      this.offset += 2;
      const dictionary = new Map<string, PdfValue>();
      for (;;) {
        await this.skip();
        if (this.bytes[this.offset] === 62 && this.bytes[this.offset + 1] === 62 && this.offset + 1 < this.end) {
          this.offset += 2; return dictionary;
        }
        if (this.peek() !== 47) invalidPdf("辞書のキーが不正です");
        this.budget.value();
        const key = await this.name() as { kind: "name"; value: string };
        if (dictionary.has(key.value)) invalidPdf("辞書のキーが重複しています");
        dictionary.set(key.value, await this.value(depth + 1));
      }
    }
    if (byte === 91) {
      this.offset++;
      const array: PdfValue[] = [];
      for (;;) {
        await this.skip();
        if (this.peek() === 93) { this.offset++; return array; }
        array.push(await this.value(depth + 1));
      }
    }
    const token = await this.word();
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (token.length > this.budget.limits.numberLength || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) invalidPdf("値が不正です");
    const number = Number(token);
    if (!Number.isFinite(number)) invalidPdf("数値が不正です");
    // A number is a reference only when followed by an integer and a complete R token.
    if (/^\d+$/.test(token)) {
      const afterNumber = this.offset;
      await this.skip();
      if (digit(this.peek())) {
        const generation = await this.word();
        if (/^\d+$/.test(generation) && await this.consume("R")) {
          const object = pdfInteger(number), generationNumber = pdfInteger(Number(generation), 65535);
          if (!object) invalidPdf("参照番号が不正です");
          return { kind: "ref", object, generation: generationNumber };
        }
      }
      this.offset = afterNumber;
    }
    return number;
  }
}
