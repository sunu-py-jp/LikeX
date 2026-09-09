// Header fixtures for metadata/model tests; browser decode is mocked separately.
export function jpegHeader({ width = 2, height = 3, orientation, littleEndian = true } = {}) {
  const sof = Buffer.from([255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1]);
  if (orientation === undefined) return Buffer.concat([Buffer.from([255, 216]), sof]);
  const exif = Buffer.alloc(32);
  exif.write('Exif\0\0', 0, 'binary');
  exif.write(littleEndian ? 'II' : 'MM', 6, 'ascii');
  const short = (value, offset) => littleEndian ? exif.writeUInt16LE(value, offset) : exif.writeUInt16BE(value, offset);
  const long = (value, offset) => littleEndian ? exif.writeUInt32LE(value, offset) : exif.writeUInt32BE(value, offset);
  short(42, 8); long(8, 10); short(1, 14);
  short(0x0112, 16); short(3, 18); long(1, 20); short(orientation, 24);
  return Buffer.concat([Buffer.from([255, 216, 255, 225, 0, exif.length + 2]), exif, sof]);
}

export function pngHeader(width, height) {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
