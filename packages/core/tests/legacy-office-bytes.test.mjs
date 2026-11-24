import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCompoundFile } from './cfb-fixture.mjs';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { ByteReader, decodeCodePage, isSupportedCodePage, readCompoundFileTitle, openCompoundFile } from './index.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { ByteReader, decodeCodePage, isSupportedCodePage, readCompoundFileTitle, openCompoundFile } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const truncated = /Officeファイルを読み込めません: データが途中で終わっています/;

test('little-endian values are read in sequence', () => {
  const data = new Uint8Array(27), view = new DataView(data.buffer);
  data[0] = 0xfe; view.setUint16(1, 0xbeef, true); view.setUint32(3, 0xdeadbeef, true); view.setInt16(7, -2, true); view.setInt32(9, -3, true);
  view.setFloat64(13, 1.5, true); view.setUint16(21, 0x65e5, true); view.setUint16(23, 0x672c, true); data[25] = 0x41; data[26] = 0x42;
  const reader = new ByteReader(data);
  assert.deepEqual([reader.u8(), reader.u16(), reader.u32(), reader.i16(), reader.i32(), reader.f64()], [0xfe, 0xbeef, 0xdeadbeef, -2, -3, 1.5]);
  assert.equal(reader.utf16(2), '日本');
  assert.equal(reader.offset, 25);
  assert.equal(reader.remaining, 2);
  assert.deepEqual([...reader.take(2)], [0x41, 0x42]);
  assert.equal(reader.remaining, 0);
});

test('reads beyond the window fail instead of returning partial values', () => {
  const reader = new ByteReader(Uint8Array.from([1, 2, 3, 4, 5, 6]), 1, 4);
  assert.equal(reader.remaining, 3);
  assert.equal(reader.u16(), 0x0302);
  assert.throws(() => reader.u16(), truncated);
  assert.equal(reader.offset, 3, 'a failed read does not advance');
  assert.throws(() => reader.take(2), truncated);
  assert.throws(() => reader.skip(-1), truncated);
  assert.throws(() => reader.seek(5), truncated);
  assert.throws(() => reader.utf16(1), truncated);
  reader.seek(1); reader.skip(3);
  assert.equal(reader.remaining, 0);
  assert.throws(() => new ByteReader(new Uint8Array(4), 3, 9), truncated);
});

test('a sub-reader is bounded to its own length and advances its parent', () => {
  const reader = new ByteReader(Uint8Array.from([9, 1, 0, 2, 0, 7]), 1);
  const child = reader.sub(4);
  assert.equal(reader.offset, 5);
  assert.deepEqual([child.u16(), child.u16()], [1, 2]);
  assert.throws(() => child.u8(), truncated);
  assert.equal(reader.u8(), 7);
  assert.throws(() => reader.sub(1), truncated);
});

test('legacy code pages decode to text and unknown pages fall back to Windows-1252', () => {
  assert.equal(decodeCodePage(Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), 932), '日本語');
  assert.equal(decodeCodePage(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), 1252), 'café');
  assert.equal(decodeCodePage(Uint8Array.from([0x93, 0x80, 0x99, 0x81, 0xa9]), 1252), '\u201c\u20ac\u2122\u0081\u00a9', 'the 0x80–0x9F block is not Latin-1');
  assert.equal(decodeCodePage(Uint8Array.from([0xcf, 0xf0, 0xe8]), 1251), 'При');
  assert.equal(decodeCodePage(Uint8Array.from([0xe6, 0x97, 0xa5]), 65001), '日');
  assert.equal(decodeCodePage(Uint8Array.from([0xe5, 0x65, 0x2c, 0x67]), 1200), '日本');
  assert.equal(decodeCodePage(Uint8Array.from([0x63, 0xe9]), 12345), 'cé');
  assert.equal(isSupportedCodePage(932), true);
  assert.equal(isSupportedCodePage(12345), false);
});

/** Minimal [MS-OLEPS] property set with a code page and a title. */
function summary(codePage, type, titleBytes) {
  const property = Uint8Array.from([...u32(type), ...u32(type === 0x1f ? titleBytes.length / 2 : titleBytes.length), ...titleBytes, 0, 0, 0, 0].slice(0, 8 + Math.ceil(titleBytes.length / 4) * 4));
  const codePageProperty = [...u32(2), ...u32(codePage)], listEnd = 8 + 2 * 8;
  const set = [...u32(listEnd + codePageProperty.length + property.length), ...u32(2), ...u32(1), ...u32(listEnd), ...u32(2), ...u32(listEnd + codePageProperty.length), ...codePageProperty, ...property];
  return Uint8Array.from([0xfe, 0xff, 0, 0, ...u32(0x00020006), ...new Array(16).fill(0), ...u32(1), ...new Array(16).fill(0xab), ...u32(48), ...set]);
}
const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

test('the document title is read from the summary information stream', async () => {
  const open = stream => openCompoundFile(createCompoundFile([{ path: '\u0005SummaryInformation', content: stream }, { path: 'Workbook', content: new Uint8Array(8) }]));
  assert.equal(readCompoundFileTitle(await open(summary(932, 0x1e, [0x8c, 0xa9, 0x90, 0xcf, 0x8f, 0x91, 0]))), '見積書');
  assert.equal(readCompoundFileTitle(await open(summary(1252, 0x1e, [0x51, 0x33, 0x20, 0x70, 0x6c, 0x61, 0x6e, 0]))), 'Q3 plan');
  assert.equal(readCompoundFileTitle(await open(summary(1200, 0x1f, [0x08, 0x8a, 0x3b, 0x75, 0, 0]))), '計画');
  assert.equal(readCompoundFileTitle(await open(summary(65001, 0x1e, [0xe6, 0x97, 0xa5, 0]))), '日');
});

test('a missing, empty or malformed summary stream yields no title', async () => {
  const open = streams => openCompoundFile(createCompoundFile(streams));
  assert.equal(readCompoundFileTitle(await open([{ path: 'Workbook', content: new Uint8Array(8) }])), undefined);
  const valid = summary(1252, 0x1e, [0x41, 0]);
  for (const stream of [valid.subarray(0, 30), valid.subarray(0, valid.length - 6), new Uint8Array(200), summary(1252, 0x1e, [0])])
    assert.equal(readCompoundFileTitle(await open([{ path: '\u0005SummaryInformation', content: stream }])), undefined);
  const huge = valid.slice(); new DataView(huge.buffer).setUint32(huge.length - 8 + 4 - 4, 0x7fffffff, true);
  assert.equal(readCompoundFileTitle(await open([{ path: '\u0005SummaryInformation', content: huge }])), undefined);
});

test('the title of a document written by another producer is read without failing', async () => {
  const file = await openCompoundFile(await readFile(new URL('./fixtures/textutil-sample.doc', import.meta.url)));
  const title = readCompoundFileTitle(file);
  assert.ok(title === undefined || typeof title === 'string');
});
