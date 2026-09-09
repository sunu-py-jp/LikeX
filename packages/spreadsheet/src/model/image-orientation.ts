/** Read only JPEG IFD0 Orientation. Malformed or unsupported EXIF is ignored. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return 1;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return 1;
    if (marker === 0xe1) {
      const start = offset + 2, end = offset + length;
      if (end - start >= 14 && [69, 120, 105, 102, 0, 0].every((value, index) => bytes[start + index] === value)) {
        const orientation = tiffOrientation(bytes, start + 6, end);
        if (orientation !== undefined) return orientation;
      }
    }
    offset += length;
  }
  return 1;
}

function tiffOrientation(bytes: Uint8Array, start: number, end: number): number | undefined {
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  if (!little && !(bytes[start] === 0x4d && bytes[start + 1] === 0x4d)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
  if (view.getUint16(2, little) !== 42) return;
  const ifd = view.getUint32(4, little);
  if (ifd < 8 || ifd > view.byteLength - 2) return;
  const count = view.getUint16(ifd, little), entries = ifd + 2;
  if (entries + count * 12 + 4 > view.byteLength) return;
  for (let index = 0; index < count; index++) {
    const entry = entries + index * 12;
    if (view.getUint16(entry, little) !== 0x0112 || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) continue;
    const orientation = view.getUint16(entry + 8, little);
    if (orientation >= 1 && orientation <= 8) return orientation;
  }
}
