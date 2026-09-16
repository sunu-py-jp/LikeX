import { SLIDE_LIMITS } from "./limits";

const fail = (): never => { throw new Error("画像はサイズ上限内のPNG / JPEG / GIF / WebPの埋め込みデータを指定してください"); };
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const be32 = (bytes: Uint8Array, offset: number) => bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
const le16 = (bytes: Uint8Array, offset: number) => bytes[offset] + bytes[offset + 1] * 0x100;
const le24 = (bytes: Uint8Array, offset: number) => le16(bytes, offset) + bytes[offset + 2] * 0x10000;
const le32 = (bytes: Uint8Array, offset: number) => le24(bytes, offset) + bytes[offset + 3] * 0x1000000;

function dimensions(bytes: Uint8Array, format: string): [number, number] {
  if (format === "png") {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
      be32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return fail();
    return [be32(bytes, 16), be32(bytes, 20)];
  }
  if (format === "gif") {
    if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return fail();
    return [le16(bytes, 6), le16(bytes, 8)];
  }
  if (format === "jpeg") {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) return fail();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return fail();
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return fail();
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) return fail();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return fail();
        return [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]];
      }
      offset += length;
    }
    return fail();
  }
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || le32(bytes, 4) + 8 !== bytes.length) return fail();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, 4), length = le32(bytes, offset + 4), start = offset + 8;
    if (start + length > bytes.length) return fail();
    if (kind === "VP8X") {
      if (length !== 10) return fail();
      return [1 + le24(bytes, start + 4), 1 + le24(bytes, start + 7)];
    }
    if (kind === "VP8 ") {
      if (length < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return fail();
      return [le16(bytes, start + 6) & 0x3fff, le16(bytes, start + 8) & 0x3fff];
    }
    if (kind === "VP8L") {
      if (length < 5 || bytes[start] !== 0x2f) return fail();
      return [1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8),
        1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10)];
    }
    offset = start + length + (length % 2);
  }
  return fail();
}

/** Inspect bounded embedded bytes without DOM, image decoding or network access. */
export function validateSlideImageSource(value: unknown): { src: string; bytes: number } {
  if (typeof value !== "string" || value.length > 40 + Math.ceil(SLIDE_LIMITS.imageBytes / 3) * 4) return fail();
  const prefix = /^data:image\/(png|jpeg|gif|webp);base64,/.exec(value);
  if (!prefix) return fail();
  const payload = value.slice(prefix[0].length);
  if (!payload.length || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return fail();
  const byteLength = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (byteLength > SLIDE_LIMITS.imageBytes) return fail();
  let binary: string;
  try { binary = atob(payload); } catch { return fail(); }
  if (btoa(binary) !== payload) return fail();
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const [width, height] = dimensions(bytes, prefix[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > SLIDE_LIMITS.imageDimension || height > SLIDE_LIMITS.imageDimension || width * height > SLIDE_LIMITS.imagePixels) return fail();
  return { src: value, bytes: byteLength };
}
