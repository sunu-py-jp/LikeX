export type EmbeddedImageOptions = { maxBytes?: number; maxDimension?: number; maxPixels?: number };

/** Inspect embedded PNG/JPEG dimensions without DOM, network access or image decoding. */
export function inspectEmbeddedImage(input: unknown, options: EmbeddedImageOptions = {}): { src: string; bytes: number; width: number; height: number } {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024, maxDimension = options.maxDimension ?? 16_384, maxPixels = options.maxPixels ?? 64_000_000;
  if (![maxBytes, maxDimension, maxPixels].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Image limits must be positive integers.");
  const fail = (): never => { throw new Error("Images must contain valid embedded PNG or JPEG data within the size limits."); };
  if (typeof input !== "string" || input.length > 40 + Math.ceil(maxBytes / 3) * 4) return fail();
  const match = /^data:image\/(png|jpeg);base64,/.exec(input);
  if (!match) return fail();
  const payload = input.slice(match[0].length);
  if (!payload || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return fail();
  let binary: string;
  try { binary = atob(payload); } catch { return fail(); }
  if (binary.length > maxBytes || btoa(binary) !== payload) return fail();
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
  let width = 0, height = 0;
  if (match[1] === "png") {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index] === value)) return fail();
    const view = new DataView(bytes.buffer);
    width = view.getUint32(16); height = view.getUint32(20);
  } else {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216) return fail();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) return fail();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) return fail();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return fail();
        height = bytes[offset + 3] * 256 + bytes[offset + 4]; width = bytes[offset + 5] * 256 + bytes[offset + 6]; break;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension || width * height > maxPixels) return fail();
  return { src: input, bytes: bytes.length, width, height };
}
