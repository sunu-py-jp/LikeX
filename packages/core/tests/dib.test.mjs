import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `export * from './legacy-office.ts';` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { convertDibToPng } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const u16 = value => [value & 255, (value >>> 8) & 255];
const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

/** A bitmap as it is stored without its file header: the information header, masks or palette, then padded rows. */
function dib({ width, height, bits, rows, palette = [], compression = 0, masks = [], headerSize = 40, colours = 0 }) {
  const header = headerSize === 12 ? [...u32(12), ...u16(width), ...u16(height), ...u16(1), ...u16(bits)]
    : [...u32(headerSize), ...u32(width), ...u32(height), ...u16(1), ...u16(bits), ...u32(compression), ...u32(0), ...u32(2835), ...u32(2835), ...u32(colours), ...u32(0), ...new Array(headerSize - 40).fill(0)];
  const stride = ((width * bits + 31) >>> 5) << 2;
  return Uint8Array.from([...header, ...masks.flatMap(u32), ...palette.flat(), ...rows.flatMap(row => [...row, ...new Array(stride - row.length).fill(0)])]);
}
/** Pixels of a PNG written by the converter: 8-bit RGB, unfiltered rows. */
function pixels(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), chunks = [];
  for (let at = 8; at < png.length;) { const length = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8)); chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) }); at += 12 + length; }
  assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset), width = header.getUint32(0), height = header.getUint32(4);
  assert.deepEqual([...chunks[0].data.subarray(8)], [8, 2, 0, 0, 0], '8-bit RGB, no interlace');
  const raw = inflateSync(chunks[1].data), rows = [];
  assert.equal(raw.length, height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (1 + width * 3)], 0, 'rows are stored unfiltered');
    rows.push(Array.from({ length: width }, (_, x) => [...raw.subarray(y * (1 + width * 3) + 1 + x * 3, y * (1 + width * 3) + 4 + x * 3)].map(value => value.toString(16).padStart(2, '0')).join('')));
  }
  return { width, height, rows };
}
const RED = 'ff0000', GREEN = '00ff00', BLUE = '0000ff', WHITE = 'ffffff', BLACK = '000000';

test('true-colour bitmaps are stored bottom-up in blue-green-red order, with rows padded to four bytes', async () => {
  // Stored rows: the bottom row first.
  const png = await convertDibToPng(dib({ width: 3, height: 2, bits: 24, rows: [[0, 0, 255, 0, 255, 0, 255, 0, 0], [255, 255, 255, 0, 0, 0, 0x30, 0x20, 0x10]] }));
  assert.deepEqual(pixels(png), { width: 3, height: 2, rows: [[WHITE, BLACK, '102030'], [RED, GREEN, BLUE]] });
  // A negative height states rows from the top; the fourth byte of a 32-bit pixel is not a colour.
  const topDown = await convertDibToPng(dib({ width: 2, height: -2, bits: 32, rows: [[0, 0, 255, 0, 0, 255, 0, 9], [255, 0, 0, 200, 255, 255, 255, 0]] }));
  assert.deepEqual(pixels(topDown).rows, [[RED, GREEN], [BLUE, WHITE]]);
});

test('palette bitmaps of 8, 4 and 1 bits per pixel take their colours from the colour table', async () => {
  const palette = [[0, 0, 0, 0], [255, 255, 255, 0], [0, 0, 255, 0], [255, 0, 0, 0]];
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 3, height: 1, bits: 8, colours: 4, palette, rows: [[2, 3, 1]] }))).rows, [[RED, BLUE, WHITE]]);
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 3, height: 1, bits: 4, colours: 4, palette, rows: [[0x23, 0x10]] }))).rows, [[RED, BLUE, WHITE]]);
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 10, height: 1, bits: 1, palette: palette.slice(0, 2), rows: [[0b10100000, 0b01000000]] }))).rows,
    [[WHITE, BLACK, WHITE, BLACK, BLACK, BLACK, BLACK, BLACK, BLACK, WHITE]]);
  // The oldest header has 16-bit sizes and three-byte colours.
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 2, height: 1, bits: 1, headerSize: 12, palette: [[0, 0, 255], [0, 255, 0]], rows: [[0b10000000]] }))).rows, [[GREEN, RED]]);
  // An index beyond the table is black instead of reading past it.
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 2, height: 1, bits: 8, colours: 2, palette: palette.slice(0, 2), rows: [[1, 200]] }))).rows, [[WHITE, BLACK]]);
});

test('16-bit pixels and stated colour masks are widened to eight bits per channel', async () => {
  // Five bits per channel unless masks say otherwise.
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 3, height: 1, bits: 16, rows: [[...u16(0x7c00), ...u16(0x03e0), ...u16(0x7fff)]] }))).rows, [[RED, GREEN, WHITE]]);
  const masks565 = [0xf800, 0x07e0, 0x001f];
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 3, height: 1, bits: 16, compression: 3, masks: masks565, rows: [[...u16(0xf800), ...u16(0x07e0), ...u16(0x001f)]] }))).rows, [[RED, GREEN, BLUE]]);
  assert.deepEqual(pixels(await convertDibToPng(dib({ width: 2, height: 1, bits: 32, compression: 3, masks: [0x000000ff, 0x0000ff00, 0x00ff0000], rows: [[255, 0, 0, 0, 0, 0, 255, 0]] }))).rows, [[RED, BLUE]]);
});

test('bitmaps that are compressed, cut short or too large are refused', async () => {
  const good = dib({ width: 2, height: 2, bits: 24, rows: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]] });
  assert.ok(await convertDibToPng(good));
  for (const bad of [good.subarray(0, good.length - 1), good.subarray(0, 20), new Uint8Array(0), dib({ width: 2, height: 1, bits: 8, compression: 1, palette: [[0, 0, 0, 0]], rows: [[2, 0, 0, 0]] }),
    dib({ width: 0, height: 1, bits: 24, rows: [[]] }), dib({ width: 1, height: 1, bits: 7, rows: [[0]] }), dib({ width: 1, height: 1, bits: 24, headerSize: 30 + 40, rows: [[0, 0, 0]] }).fill(13, 0, 1)])
    assert.equal(await convertDibToPng(bad), undefined);
  assert.equal(await convertDibToPng(good, { dimension: 1, pixels: 100 }), undefined);
  assert.equal(await convertDibToPng(good, { dimension: 100, pixels: 3 }), undefined);
  // A size stated far beyond the data is refused before any row is allocated.
  assert.equal(await convertDibToPng(dib({ width: 16_000, height: 16_000, bits: 24, rows: [[0, 0, 0]] })), undefined);
});
