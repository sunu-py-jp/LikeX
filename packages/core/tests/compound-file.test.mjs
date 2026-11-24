import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createCompoundFile, compoundFileLayout as layout } from './cfb-fixture.mjs';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { openCompoundFile, COMPOUND_FILE_LIMITS } from './index.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { openCompoundFile, COMPOUND_FILE_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const pattern = (length, seed) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 255);
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const streams = () => [
  { path: 'Workbook', content: pattern(9000, 1) },
  { path: 'Tiny', content: pattern(10, 2) },
  { path: 'Empty', content: new Uint8Array() },
  { path: '\u0005SummaryInformation', content: pattern(700, 3) },
  { path: 'ObjectPool/_1/Ole10Native', content: pattern(4096, 4) },
  { path: 'ObjectPool/_1/資料', content: pattern(65, 5) },
];
/** Directory entry offset of the nth entry in a default 512-byte-sector fixture. */
const entryOffset = (bytes, index) => 512 + view(bytes).getUint32(layout.headerFirstDirectory, true) * 512 + index * 128;

for (const sectorSize of [512, 4096])
  test(`streams in the mini stream, in regular sectors and in nested storages are read back (${sectorSize}-byte sectors)`, async () => {
    const source = streams(), file = await openCompoundFile(createCompoundFile(source, { sectorSize }));
    assert.deepEqual([...file.paths].sort(), source.map(item => item.path).sort());
    assert.ok(Object.isFrozen(file.paths));
    for (const { path, content } of source) {
      assert.equal(file.has(path), true);
      assert.equal(file.size(path), content.length);
      assert.deepEqual(file.read(path), content);
    }
    assert.equal(file.has('Missing'), false);
    assert.throws(() => file.read('Missing'), /Officeファイルを読み込めません: 必要なストリームがありません（Missing）/);
  });

test('stream names are matched without regard to case, as in the container format', async () => {
  const file = await openCompoundFile(createCompoundFile(streams()));
  assert.deepEqual(file.read('WORKBOOK'), pattern(9000, 1));
  assert.equal(file.has('objectpool/_1/ole10native'), true);
});

test('every accepted input type yields isolated bytes', async () => {
  const bytes = createCompoundFile(streams());
  for (const input of [bytes, bytes.buffer.slice(0), new Blob([bytes]), new File([bytes], 'book.xls')])
    assert.deepEqual((await openCompoundFile(input)).read('Tiny'), pattern(10, 2));
  const file = await openCompoundFile(bytes);
  bytes.fill(0);
  const first = file.read('Tiny'); first.fill(9);
  assert.deepEqual(file.read('Tiny'), pattern(10, 2));
});

test('FAT sectors listed in DIFAT sectors are followed', async () => {
  const content = pattern(300_000, 7), bytes = createCompoundFile([{ path: 'Big', content }, { path: 'Small', content: pattern(20, 8) }], { headerDifatEntries: 1 });
  assert.notEqual(view(bytes).getUint32(72, true), 0, 'the fixture uses DIFAT sectors');
  const file = await openCompoundFile(bytes);
  assert.deepEqual(file.read('Big'), content);
  assert.deepEqual(file.read('Small'), pattern(20, 8));
});

test('a file with more FAT sectors than the header can list is read through its DIFAT chain', async () => {
  const content = new Uint8Array(7_300_000).fill(0x5a); content.set([1, 2, 3], 0); content.set([4, 5, 6], content.length - 3);
  const bytes = createCompoundFile([{ path: 'Big', content }]);
  assert.ok(view(bytes).getUint32(44, true) > 109 && view(bytes).getUint32(72, true) > 0, 'the fixture needs DIFAT sectors');
  assert.deepEqual((await openCompoundFile(bytes)).read('Big'), content);
});

test('a compound file written by another producer is readable', async () => {
  const file = await openCompoundFile(await readFile(new URL('./fixtures/textutil-sample.doc', import.meta.url)));
  assert.ok(file.has('WordDocument'));
  assert.equal(view(file.read('WordDocument')).getUint16(0, true), 0xa5ec, 'the Word stream starts with its identifier');
  assert.ok(file.has('1Table') || file.has('0Table'));
});

test('read caps and limits are enforced before bytes are copied', async () => {
  const bytes = createCompoundFile(streams()), file = await openCompoundFile(bytes);
  assert.throws(() => file.read('Workbook', 100), /読み込むデータのサイズが上限を超えています/);
  assert.throws(() => file.read('Workbook', -1), /読み込みサイズの上限が不正です/);
  await assert.rejects(openCompoundFile(bytes, undefined, { inputBytes: 1000 }), /ファイルサイズが上限を超えています/);
  await assert.rejects(openCompoundFile(bytes, undefined, { entries: 3 }), /ストリーム数が上限を超えています/);
  await assert.rejects(openCompoundFile(bytes, undefined, { streamBytes: 8000 }), /ストリームのサイズが上限を超えています/);
  await assert.rejects(openCompoundFile(bytes, undefined, { entries: 0 }), /読み込み上限が不正です/);
  assert.equal(COMPOUND_FILE_LIMITS.inputBytes, 32 * 1024 * 1024);
});

test('malformed headers are rejected', async () => {
  const valid = createCompoundFile(streams());
  const broken = mutate => { const copy = valid.slice(); mutate(view(copy), copy); return copy; };
  await assert.rejects(openCompoundFile(new Uint8Array(100)), /複合ファイルではありません/);
  await assert.rejects(openCompoundFile(broken((_, bytes) => { bytes[0] = 0x50; })), /複合ファイルではありません/);
  await assert.rejects(openCompoundFile(valid.subarray(0, 600)), /複合ファイルのサイズが不正です/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint16(layout.headerSectorShift, 10, true))), /セクターサイズに対応していません/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint16(layout.headerMiniSectorShift, 7, true))), /セクターサイズに対応していません/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint16(28, 0xfeff, true))), /バイト順に対応していません/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint32(layout.headerFatCount, 0, true))), /FATがありません/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint32(layout.headerDifat, 9999, true))), /セクター番号が範囲外です/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint32(layout.headerFirstDirectory, 0xfffffffe, true))), /ディレクトリがありません/);
});

test('looping or truncated sector chains are rejected instead of being followed', async () => {
  const valid = createCompoundFile([{ path: 'Workbook', content: pattern(9000, 1) }]);
  const fatAt = sector => 512 + sector * 4;
  const start = view(valid).getUint32(entryOffset(valid, 1) + layout.entry.start, true);
  const loop = valid.slice(); view(loop).setUint32(fatAt(start), start, true);
  await assert.rejects(openCompoundFile(loop), /セクターの連鎖が循環しています/);
  const short = valid.slice(); view(short).setUint32(fatAt(start), 0xfffffffe, true);
  await assert.rejects(openCompoundFile(short), /ストリームのデータが不足しています/);
  const outside = valid.slice(); view(outside).setUint32(fatAt(start), 0x00ffffff, true);
  await assert.rejects(openCompoundFile(outside), /セクター番号が範囲外です/);
  const oversized = valid.slice(); view(oversized).setUint32(entryOffset(oversized, 1) + layout.entry.size, 0x7fffffff, true);
  await assert.rejects(openCompoundFile(oversized), /ストリームのサイズが上限を超えています|ストリームのデータが不足しています/);
});

test('malformed directories are rejected', async () => {
  const valid = createCompoundFile(streams());
  const broken = mutate => { const copy = valid.slice(); mutate(view(copy), copy); return copy; };
  const first = view(valid).getUint32(entryOffset(valid, 0) + layout.entry.child, true);
  await assert.rejects(openCompoundFile(broken(data => data.setUint32(entryOffset(valid, first) + layout.entry.right, first, true))), /ディレクトリが循環しています/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint32(entryOffset(valid, first) + layout.entry.left, 5000, true))), /ディレクトリの参照が範囲外です/);
  await assert.rejects(openCompoundFile(broken((_, bytes) => { bytes[entryOffset(valid, 0) + layout.entry.type] = 2; })), /ルートエントリが不正です/);
  await assert.rejects(openCompoundFile(broken(data => data.setUint16(entryOffset(valid, first) + layout.entry.nameLength, 66, true))), /エントリ名が不正です/);
  await assert.rejects(openCompoundFile(broken((_, bytes) => { bytes[entryOffset(valid, first) + layout.entry.type] = 9; })), /エントリの種類が不正です/);
});

test('duplicate stream names in one storage are rejected', async () => {
  const bytes = createCompoundFile([{ path: 'Same', content: pattern(10, 1) }, { path: 'Other', content: pattern(10, 2) }]);
  const data = view(bytes), other = [1, 2].find(index => data.getUint16(entryOffset(bytes, index), true) === 'O'.charCodeAt(0));
  [...'Same\u0000'].forEach((character, position) => data.setUint16(entryOffset(bytes, other) + position * 2, character.charCodeAt(0), true));
  data.setUint16(entryOffset(bytes, other) + layout.entry.nameLength, 10, true);
  await assert.rejects(openCompoundFile(bytes), /ストリーム名が重複しています/);
});

test('opening observes cancellation', async () => {
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(openCompoundFile(createCompoundFile(streams()), controller.signal), { name: 'AbortError' });
  await assert.rejects(openCompoundFile(null), /入力形式が不正です/);
});
