/**
 * Device-independent bitmaps: the pixel format in which Office 97 keeps a pasted screen shot.
 * No browser decodes one without its file header, and the document models hold PNG and JPEG only,
 * so a bitmap is rewritten as PNG. Uncompressed bitmaps of every colour depth are read.
 */
export const DIB_LIMITS = Object.freeze({ dimension: 16_384, pixels: 25_000_000 });

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  table ??= Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = table[(crc ^ bytes[index]) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
/** A PNG chunk: length, type, data, and a checksum over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.length), view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) result[4 + index] = type.charCodeAt(index);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}
/** Where a colour mask starts and how many bits it has; a channel of any width is widened to eight bits. */
function channel(mask: number): (pixel: number) => number {
  if (!mask) return () => 0;
  let shift = 0, size = 0;
  while (!(mask >>> shift & 1)) shift++;
  while (shift + size < 32 && mask >>> shift + size & 1) size++;
  const top = 2 ** size - 1;
  return pixel => size === 8 ? pixel >>> shift & 255 : Math.round((pixel >>> shift & top) * 255 / top);
}

/**
 * Converts a bitmap without its file header to an 8-bit RGB PNG. Returns undefined for data that
 * is not a readable bitmap, for run-length compressed bitmaps, and beyond the size limits.
 */
export async function convertDibToPng(dib: Uint8Array, limits: { dimension: number; pixels: number } = DIB_LIMITS): Promise<Uint8Array | undefined> {
  if (dib.length < 12 || typeof CompressionStream === "undefined") return undefined;
  const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength), headerSize = view.getUint32(0, true);
  let width: number, height: number, bits: number, compression = 0, colours = 0, colourBytes = 4;
  // The oldest header has 16-bit sizes and three-byte colours; the later ones extend the 40-byte header.
  if (headerSize === 12) { width = view.getUint16(4, true); height = view.getUint16(6, true); bits = view.getUint16(10, true); colourBytes = 3; }
  else if (headerSize >= 40 && headerSize <= 124 && dib.length >= headerSize) {
    width = view.getInt32(4, true); height = view.getInt32(8, true); bits = view.getUint16(14, true); compression = view.getUint32(16, true); colours = view.getUint32(32, true);
  } else return undefined;
  // A negative height states the rows from the top instead of from the bottom.
  const topDown = height < 0;
  height = Math.abs(height);
  if (![1, 4, 8, 16, 24, 32].includes(bits) || width < 1 || height < 1 || width > limits.dimension || height > limits.dimension || width * height > limits.pixels) return undefined;
  const masked = compression === 3 && (bits === 16 || bits === 32);
  if (compression !== 0 && !masked) return undefined;
  let offset = headerSize, masks = bits === 16 ? [0x7c00, 0x03e0, 0x001f] : [0xff0000, 0xff00, 0xff];
  if (masked) {
    // The masks follow a 40-byte header and are part of the longer ones.
    const at = headerSize >= 52 ? 40 : headerSize;
    if (at + 12 > dib.length) return undefined;
    masks = [view.getUint32(at, true), view.getUint32(at + 4, true), view.getUint32(at + 8, true)];
    if (headerSize < 52) offset += 12;
  }
  const paletteSize = bits <= 8 ? Math.min(colours || 1 << bits, 1 << bits) : 0, palette = offset;
  // Deeper bitmaps may still carry a table of suggested colours before their pixels.
  offset += (bits <= 8 ? paletteSize : Math.min(colours, 256)) * colourBytes;
  const stride = (width * bits + 31 >>> 5) * 4;
  if (offset + stride * height > dib.length) return undefined;

  const rowBytes = 1 + width * 3, raw = new Uint8Array(rowBytes * height);
  const red = channel(masks[0]), green = channel(masks[1]), blue = channel(masks[2]);
  for (let y = 0; y < height; y++) {
    const source = offset + (topDown ? y : height - 1 - y) * stride;
    // Each row starts with the filter byte, left at zero: the pixels are stored as they are.
    let target = y * rowBytes + 1;
    for (let x = 0; x < width; x++) {
      if (bits === 24) { const at = source + x * 3; raw[target++] = dib[at + 2]; raw[target++] = dib[at + 1]; raw[target++] = dib[at]; continue; }
      if (bits > 8) {
        const pixel = bits === 16 ? view.getUint16(source + x * 2, true) : view.getUint32(source + x * 4, true);
        raw[target++] = red(pixel); raw[target++] = green(pixel); raw[target++] = blue(pixel);
        continue;
      }
      const index = bits === 8 ? dib[source + x] : bits === 4 ? dib[source + (x >>> 1)] >>> (x & 1 ? 0 : 4) & 15 : dib[source + (x >>> 3)] >>> 7 - (x & 7) & 1;
      // A colour beyond the table is black.
      if (index < paletteSize) { const at = palette + index * colourBytes; raw[target++] = dib[at + 2]; raw[target++] = dib[at + 1]; raw[target++] = dib[at]; }
      else target += 3;
    }
  }
  const header = new Uint8Array(13), fields = new DataView(header.buffer);
  fields.setUint32(0, width); fields.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { png.set(part, at); at += part.length; }
  return png;
}
