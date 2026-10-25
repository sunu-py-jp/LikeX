import { ZStream, Z_NO_FLUSH, Z_OK, Z_BUF_ERROR, Z_STREAM_END, zlibInflateInit2, zlibInflate, zlibInflateEnd } from "pako";
import { PdfBudget, invalidPdf, pdfLimit } from "./pdf-budget";
import { pdfInteger, type PdfDict, type PdfValue } from "./pdf-values";
import { applyPdfPredictor } from "./pdf-predictors";

const CHUNK = 16_384;
const space = (byte: number) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
const malformed = (): never => invalidPdf("圧縮データまたはフィルターの指定が不正です");

/** Fixed-size scratch storage; output is charged before copying or growing storage. */
class Output {
  private chunks: Uint8Array[] = [];
  private current = new Uint8Array(CHUNK);
  private used = 0;
  private length = 0;
  constructor(private readonly budget: PdfBudget) {}
  append(bytes: Uint8Array): void {
    if (bytes.length > this.budget.limits.streamBytes - this.length) pdfLimit();
    this.budget.decodedBytes(bytes.length);
    this.length += bytes.length;
    for (let at = 0; at < bytes.length;) {
      if (this.used === CHUNK) {
        this.chunks.push(this.current);
        this.current = new Uint8Array(CHUNK);
        this.used = 0;
      }
      const count = Math.min(CHUNK - this.used, bytes.length - at);
      this.current.set(bytes.subarray(at, at + count), this.used);
      this.used += count;
      at += count;
    }
  }
  finish(): Uint8Array {
    const result = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) { result.set(chunk, at); at += chunk.length; }
    result.set(this.current.subarray(0, this.used), at);
    return result;
  }
}

async function flate(bytes: Uint8Array, budget: PdfBudget): Promise<Uint8Array> {
  const state = new ZStream(), output = new Output(budget), scratch = new Uint8Array(CHUNK);
  if (zlibInflateInit2(state, 15) !== Z_OK) malformed();
  let at = 0;
  try {
    while (true) {
      if (state.avail_in === 0 && at < bytes.length) {
        const end = Math.min(at + 1024, bytes.length);
        state.input = bytes.subarray(at, end);
        state.next_in = 0;
        state.avail_in = end - at;
        at = end;
      }
      state.output = scratch;
      state.next_out = 0;
      state.avail_out = scratch.length;
      const available = state.avail_in;
      const status = zlibInflate(state, Z_NO_FLUSH);
      const consumed = available - state.avail_in;
      budget.work(consumed);
      output.append(scratch.subarray(0, state.next_out));
      await budget.checkpoint();
      if (status === Z_STREAM_END) {
        if (state.avail_in || at !== bytes.length) malformed();
        return output.finish();
      }
      if (status !== Z_OK && status !== Z_BUF_ERROR || !consumed && !state.next_out) malformed();
    }
  } finally { zlibInflateEnd(state); }
}

async function asciiHex(bytes: Uint8Array, budget: PdfBudget): Promise<Uint8Array> {
  const output = new Output(budget), scratch = new Uint8Array(CHUNK);
  let nibble = -1, used = 0, ended = false;
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4096 === 0) { budget.work(Math.min(4096, bytes.length - i)); await budget.checkpoint(); }
    const byte = bytes[i];
    if (space(byte)) continue;
    if (ended) malformed();
    if (byte === 62) { ended = true; continue; }
    const digit = byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
    if (digit < 0) malformed();
    if (nibble < 0) nibble = digit;
    else { scratch[used++] = nibble * 16 + digit; nibble = -1; }
    if (used === scratch.length) { output.append(scratch); used = 0; }
  }
  if (!ended) malformed();
  if (nibble >= 0) scratch[used++] = nibble * 16;
  output.append(scratch.subarray(0, used));
  return output.finish();
}

async function ascii85(bytes: Uint8Array, budget: PdfBudget): Promise<Uint8Array> {
  const output = new Output(budget), tuple = new Uint8Array(4);
  let count = 0, value = 0, ended = false;
  const emit = (length: number) => {
    if (value > 0xffffffff) malformed();
    tuple[0] = Math.floor(value / 0x1000000);
    tuple[1] = Math.floor(value / 0x10000) & 255;
    tuple[2] = Math.floor(value / 256) & 255;
    tuple[3] = value & 255;
    output.append(tuple.subarray(0, length));
    value = 0; count = 0;
  };
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4096 === 0) { budget.work(Math.min(4096, bytes.length - i)); await budget.checkpoint(); }
    const byte = bytes[i];
    if (space(byte)) continue;
    if (ended) malformed();
    if (byte === 126) {
      if (bytes[++i] !== 62 || count === 1) malformed();
      if (count) { const length = count - 1; while (count++ < 5) value = value * 85 + 84; emit(length); }
      ended = true;
    } else if (byte === 122) {
      if (count) malformed();
      tuple.fill(0); output.append(tuple);
    } else {
      if (byte < 33 || byte > 117) malformed();
      value = value * 85 + byte - 33;
      if (++count === 5) emit(4);
    }
  }
  if (!ended) malformed();
  return output.finish();
}

async function runLength(bytes: Uint8Array, budget: PdfBudget): Promise<Uint8Array> {
  const output = new Output(budget), repeat = new Uint8Array(128);
  let at = 0, ended = false;
  while (at < bytes.length) {
    const code = bytes[at++];
    budget.work();
    if (code === 128) { ended = true; break; }
    if (code < 128) {
      const count = code + 1;
      if (count > bytes.length - at) malformed();
      output.append(bytes.subarray(at, at + count)); at += count;
    } else {
      if (at === bytes.length) malformed();
      repeat.fill(bytes[at++]); output.append(repeat.subarray(0, 257 - code));
    }
    await budget.checkpoint();
  }
  if (!ended) malformed();
  for (; at < bytes.length; at++) {
    if (at % 4096 === 0) { budget.work(Math.min(4096, bytes.length - at)); await budget.checkpoint(); }
    if (!space(bytes[at])) malformed();
  }
  return output.finish();
}

async function lzw(bytes: Uint8Array, params: PdfDict | undefined, budget: PdfBudget): Promise<Uint8Array> {
  const early = pdfInteger(params?.get("EarlyChange") ?? 1, 1);
  const prefixes = new Uint16Array(4096), suffixes = new Uint8Array(4096), sequence = new Uint8Array(4096);
  const output = new Output(budget);
  let next = 258, width = 9, previous = -1, at = 0, held = 0, bits = 0, codes = 0;
  const expand = (code: number): number => {
    let length = 0;
    while (code >= 258) {
      if (code >= next || length >= sequence.length - 1) malformed();
      sequence[length++] = suffixes[code]; code = prefixes[code];
    }
    if (code >= 256) malformed();
    sequence[length++] = code;
    sequence.subarray(0, length).reverse();
    return length;
  };
  while (true) {
    while (bits < width) {
      if (at === bytes.length) malformed();
      held = (held << 8) | bytes[at++]; bits += 8;
    }
    const code = (held >>> (bits - width)) & ((1 << width) - 1);
    bits -= width;
    budget.work();
    if (++codes % 128 === 0) await budget.checkpoint();
    if (code === 257) {
      if (at !== bytes.length) malformed();
      return output.finish();
    }
    if (code === 256) { next = 258; width = 9; previous = -1; continue; }
    let length: number;
    if (code < next) length = expand(code);
    else if (code === next && previous >= 0) {
      length = expand(previous);
      if (length === sequence.length) malformed();
      sequence[length] = sequence[0]; length++;
    } else return malformed();
    const first = sequence[0];
    output.append(sequence.subarray(0, length));
    if (previous >= 0 && next < 4096) {
      prefixes[next] = previous; suffixes[next] = first; next++;
      if (width < 12 && next + early === 1 << width) width++;
    }
    previous = code;
  }
}

/** Decode only metadata streams, preserving per-inspection work and memory limits. */
export async function decodePdfStream(bytes: Uint8Array, dict: PdfDict, budget: PdfBudget): Promise<Uint8Array> {
  budget.work(0);
  if (bytes.length > budget.limits.streamBytes) pdfLimit();
  const filter = dict.get("Filter"), parameters = dict.get("DecodeParms");
  if (filter === undefined || filter === null) {
    budget.decodedBytes(bytes.length);
    await budget.checkpoint();
    return bytes;
  }
  const filters = Array.isArray(filter) ? filter : [filter];
  if (!filters.length || filters.length > budget.limits.filters) malformed();
  let params: (PdfValue | undefined)[];
  if (Array.isArray(parameters)) {
    if (!Array.isArray(filter) || parameters.length !== filters.length) malformed();
    params = parameters;
  } else if (parameters === undefined || parameters === null) params = [];
  else {
    if (Array.isArray(filter)) malformed();
    params = [parameters];
  }
  let result = bytes;
  for (let i = 0; i < filters.length; i++) {
    const name = filters[i], parameter = params[i];
    if (!name || typeof name !== "object" || !("kind" in name) || name.kind !== "name") return malformed();
    if (parameter !== undefined && parameter !== null && !(parameter instanceof Map)) malformed();
    const options = parameter instanceof Map ? parameter : undefined;
    switch (name.value) {
      case "FlateDecode": case "Fl": result = await flate(result, budget); break;
      case "LZWDecode": case "LZW": result = await lzw(result, options, budget); break;
      case "ASCIIHexDecode": case "AHx": result = await asciiHex(result, budget); break;
      case "ASCII85Decode": case "A85": result = await ascii85(result, budget); break;
      case "RunLengthDecode": case "RL": result = await runLength(result, budget); break;
      default: return invalidPdf(`未対応のPDFフィルターです（${name.value}）`);
    }
    if (name.value === "FlateDecode" || name.value === "Fl" || name.value === "LZWDecode" || name.value === "LZW")
      result = await applyPdfPredictor(result, options, budget);
    await budget.checkpoint();
  }
  return result;
}
