/** Decode preview bytes without changing the original file or its download content. */
export function decodePreviewText(bytes: Uint8Array): string {
  // An explicit BOM takes precedence over the fallback heuristic, including
  // when a bounded header ends partway through a multibyte character.
  const bomEncoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
    : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "utf-8"
    : undefined;
  if (bomEncoding) return new TextDecoder(bomEncoding).decode(bytes);

  // Blob.text() silently replaces invalid UTF-8 bytes. Strict decoding lets
  // Japanese legacy text fall back to the browser's Shift_JIS decoder instead.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}
