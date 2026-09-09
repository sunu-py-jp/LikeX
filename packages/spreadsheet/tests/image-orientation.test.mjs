import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { jpegHeader, pngHeader } from './image-fixtures.mjs';

const output = await build({ entryPoints: [new URL('../src/model/image-resources.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { imageMetadata, normalizeImageResource, getImageDisplaySize } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const resource = (bytes, mimeType = 'image/jpeg', width = 2, height = 3) => ({ name: 'image', mimeType, width, height,
  dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` });

test('JPEG IFD0 orientations swap only the displayed dimensions and preserve encoded dimensions', () => {
  for (const littleEndian of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const bytes = jpegHeader({ orientation, littleEndian });
      const expected = orientation >= 5 ? { width: 3, height: 2 } : { width: 2, height: 3 };
      const normalized = normalizeImageResource(resource(bytes));
      assert.equal(normalized.width, 2); assert.equal(normalized.height, 3);
      assert.deepEqual(getImageDisplaySize(normalized), expected);
      assert.deepEqual(getImageDisplaySize(JSON.parse(JSON.stringify(normalized))), expected);
    }
  }
});

test('non-oriented resources retain their existing dimensions and verified display metadata is cached', t => {
  for (const value of [resource(jpegHeader()), resource(pngHeader(400, 300), 'image/png', 400, 300)]) {
    const normalized = normalizeImageResource(value);
    const decoder = t.mock.method(globalThis, 'atob', () => { throw new Error('cached resource should not decode again'); });
    assert.deepEqual(getImageDisplaySize(normalized), { width: value.width, height: value.height });
    assert.equal(decoder.mock.callCount(), 0);
    decoder.mock.restore();
  }
});

test('invalid EXIF offsets, byte order, IFD lengths, tags and values remain bounded and are ignored', () => {
  const cases = [
    bytes => bytes.writeUInt32LE(0xffffffff, 16),
    bytes => bytes.writeUInt32LE(0, 16),
    bytes => bytes.writeUInt16LE(0xffff, 20),
    bytes => bytes.write('XX', 12, 'ascii'),
    bytes => bytes.writeUInt16LE(0, 14),
    bytes => bytes.writeUInt16LE(2, 24),
    bytes => bytes.writeUInt32LE(0xffffffff, 26),
    bytes => bytes.writeUInt16LE(9, 30),
    bytes => bytes.writeUInt16LE(0x9999, 22),
  ];
  for (const mutate of cases) {
    const bytes = jpegHeader({ orientation: 6 }); mutate(bytes);
    assert.deepEqual(imageMetadata(bytes, 'image/jpeg'), { width: 2, height: 3, displayWidth: 2, displayHeight: 3 });
  }
});

test('EXIF bytes cannot read outside an APP1 segment into later JPEG markers', () => {
  const bytes = jpegHeader({ orientation: 6 });
  // The TIFF header fits, but the first IFD would cross the end of this APP1.
  const truncated = Buffer.concat([bytes.subarray(0, 20), bytes.subarray(38)]);
  truncated.writeUInt16BE(16, 4);
  assert.deepEqual(imageMetadata(truncated, 'image/jpeg'), { width: 2, height: 3, displayWidth: 2, displayHeight: 3 });
  for (let end = 0; end < bytes.length; end++) assert.throws(() => imageMetadata(bytes.subarray(0, end), 'image/jpeg'));
});
