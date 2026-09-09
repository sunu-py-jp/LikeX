import { SPREADSHEET_LIMITS, type SpreadsheetImageResource, type SpreadsheetSheet, type SpreadsheetWorkbook } from "./types";

const fail = (): never => { throw new Error("画像は有効な PNG / JPEG / WebP / GIF を指定し、サイズと寸法の上限を守ってください"); };
const verifiedImages = new WeakMap<SpreadsheetImageResource, number>();
const verifiedResources = new WeakSet<NonNullable<SpreadsheetWorkbook["resources"]>>();
const be32 = (bytes: Uint8Array, start: number) => ((bytes[start] * 0x1000000) + (bytes[start + 1] << 16) + (bytes[start + 2] << 8) + bytes[start + 3]);
const le16 = (bytes: Uint8Array, start: number) => bytes[start] + (bytes[start + 1] << 8);
const le24 = (bytes: Uint8Array, start: number) => le16(bytes, start) + (bytes[start + 2] << 16);
const le32 = (bytes: Uint8Array, start: number) => le24(bytes, start) + bytes[start + 3] * 0x1000000;
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Read bounded image headers without DOM, network access, or decoding pixels. */
export function imageDimensions(bytes: Uint8Array, mimeType: SpreadsheetImageResource["mimeType"]): [number, number] {
  if (mimeType === "image/png") {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
      be32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return fail();
    return [be32(bytes, 16), be32(bytes, 20)];
  }
  if (mimeType === "image/gif") {
    if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return fail();
    return [le16(bytes, 6), le16(bytes, 8)];
  }
  if (mimeType === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) return fail();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return fail();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
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

export function validateObjectId(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value))
    throw new Error("オブジェクトの ID が正しくありません");
  return value;
}

export function normalizeImageResource(input: SpreadsheetImageResource): SpreadsheetImageResource {
  if (verifiedImages.has(input)) return input;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.name !== "string" || input.name.length > 1000 ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(input.mimeType) || typeof input.dataUrl !== "string") return fail();
  const prefix = `data:${input.mimeType};base64,`;
  if (!input.dataUrl.startsWith(prefix) || input.dataUrl.length > prefix.length + Math.ceil(SPREADSHEET_LIMITS.imageBytes / 3) * 4) return fail();
  const payload = input.dataUrl.slice(prefix.length);
  if (!payload.length || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return fail();
  const byteLength = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (byteLength > SPREADSHEET_LIMITS.imageBytes) return fail();
  let binary: string;
  try { binary = atob(payload); } catch { return fail(); }
  if (btoa(binary) !== payload) return fail();
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const [width, height] = imageDimensions(bytes, input.mimeType);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > SPREADSHEET_LIMITS.imageDimension || height > SPREADSHEET_LIMITS.imageDimension ||
    width * height > SPREADSHEET_LIMITS.imagePixels || input.width !== width || input.height !== height) return fail();
  const resource = Object.freeze({ name: input.name, mimeType: input.mimeType, dataUrl: input.dataUrl, width, height });
  verifiedImages.set(resource, byteLength);
  return resource;
}

export function normalizeResources(input: SpreadsheetWorkbook["resources"]): SpreadsheetWorkbook["resources"] {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  if (verifiedResources.has(input)) return input;
  if (input.images === undefined) return undefined;
  if (!input.images || typeof input.images !== "object" || Array.isArray(input.images)) return fail();
  const entries = Object.entries(input.images);
  if (entries.length > SPREADSHEET_LIMITS.images) return fail();
  const images: Record<string, SpreadsheetImageResource> = Object.create(null);
  let bytes = 0;
  for (const [id, inputImage] of entries) {
    validateObjectId(id);
    const image = normalizeImageResource(inputImage);
    bytes += verifiedImages.get(image)!;
    if (bytes > SPREADSHEET_LIMITS.totalImageBytes) throw new Error("ブック全体の画像サイズは20 MiB以内にしてください");
    images[id] = image;
  }
  if (!entries.length) return undefined;
  const resources = Object.freeze({ images: Object.freeze(images) });
  verifiedResources.add(resources);
  return resources;
}

/** Pruning is used only when an image reference is removed, never on ordinary cell edits. */
export function pruneImageResources(resources: SpreadsheetWorkbook["resources"], sheets: readonly SpreadsheetSheet[]): SpreadsheetWorkbook["resources"] {
  if (!resources?.images) return resources;
  const used = new Set(sheets.flatMap(sheet => (sheet.drawings ?? []).flatMap(drawing => drawing.type === "image" ? [drawing.resourceId] : [])));
  const entries = Object.entries(resources.images);
  if (entries.every(([id]) => used.has(id))) return resources;
  return normalizeResources({ images: Object.fromEntries(entries.filter(([id]) => used.has(id))) });
}
