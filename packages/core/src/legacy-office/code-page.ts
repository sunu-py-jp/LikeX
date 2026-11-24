/** Windows code page numbers stored in legacy Office files, as WHATWG encoding labels. */
const LABELS: Readonly<Record<number, string>> = {
  866: "ibm866", 874: "windows-874", 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5", 1200: "utf-16le",
  1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254",
  1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257", 1258: "windows-1258",
  10000: "macintosh", 10007: "x-mac-cyrillic", 20866: "koi8-r", 21866: "koi8-u", 20932: "euc-jp", 51932: "euc-jp",
  50220: "iso-2022-jp", 50221: "iso-2022-jp", 50222: "iso-2022-jp", 54936: "gb18030", 65001: "utf-8",
  28591: "windows-1252", 28592: "iso-8859-2", 28595: "iso-8859-5", 28597: "iso-8859-7", 28599: "windows-1254",
};
const decoders = new Map<string, TextDecoder | null>();
function decoderFor(label: string): TextDecoder | null {
  let decoder = decoders.get(label);
  if (decoder === undefined) {
    // Runtimes without full encoding data reject the label; the caller then falls back.
    try { decoder = new TextDecoder(label); } catch { decoder = null; }
    decoders.set(label, decoder);
  }
  return decoder;
}
export function isSupportedCodePage(codePage: number): boolean {
  const label = LABELS[codePage];
  return !!label && !!decoderFor(label);
}
/** Windows-1252 differs from Latin-1 only in 0x80–0x9F; unassigned bytes keep their value. */
const WINDOWS_1252 = [0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178];
/** Decoded here because some runtimes treat the windows-1252 label as plain Latin-1. */
function decodeWindows1252(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    const chunk = Array.from(bytes.subarray(index, index + 8192), byte => byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252[byte - 0x80] : byte);
    text += String.fromCharCode(...chunk);
  }
  return text;
}
/** Decodes single- and double-byte text. Unknown pages are read as Windows-1252, the format default. */
export function decodeCodePage(bytes: Uint8Array, codePage: number): string {
  const label = LABELS[codePage] ?? "windows-1252", decoder = label === "windows-1252" ? null : decoderFor(label);
  return decoder ? decoder.decode(bytes) : decodeWindows1252(bytes);
}
