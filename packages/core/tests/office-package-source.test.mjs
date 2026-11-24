import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { createOfficePackageFromParts, detectOfficeContainer, detectOfficeContainerBytes, openOfficePackageReader, createZipArchive } from './index.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createOfficePackageFromParts, detectOfficeContainer, detectOfficeContainerBytes, openOfficePackageReader, createZipArchive } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const bytes = text => new TextEncoder().encode(text);
const text = value => new TextDecoder().decode(value);
const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const cfbSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

test('an in-memory package serves the same parts as the ZIP reader', async () => {
  const zip = await createZipArchive([
    { path: '[Content_Types].xml', content: new Blob(['<Types/>']) },
    { path: 'xl/workbook.xml', content: new Blob(['<workbook>日本語</workbook>']) },
  ]);
  const archive = await openOfficePackageReader(zip);
  const parts = new Map();
  for (const path of archive.paths) parts.set(path, await archive.read(path));
  const memory = createOfficePackageFromParts(parts);
  assert.deepEqual(memory.paths, archive.paths);
  assert.ok(Object.isFrozen(memory.paths));
  for (const path of archive.paths) {
    assert.equal(memory.has(path), true);
    assert.deepEqual(await memory.read(path), await archive.read(path));
    assert.equal(text(Buffer.concat(await collect(memory.stream(path)))), text(await archive.read(path)));
  }
  assert.equal(memory.has('missing.xml'), false);
  await memory.validate();
});

test('in-memory parts are isolated from the source and from earlier reads', async () => {
  const source = bytes('abc'), memory = createOfficePackageFromParts([['a.xml', source]]);
  source[0] = 0x7a;
  const first = await memory.read('a.xml');
  first[1] = 0x7a;
  assert.equal(text(await memory.read('a.xml')), 'abc');
});

test('in-memory packages keep the reader contract for missing parts, caps and chunking', async () => {
  const large = new Uint8Array(150_000).fill(0x41), memory = createOfficePackageFromParts(new Map([['big.bin', large], ['small.xml', bytes('<a/>')]]));
  await assert.rejects(memory.read('none.xml'), /Officeファイルを読み込めません: 必要なファイルがありません（none\.xml）/);
  await assert.rejects(memory.read('big.bin', 1000), /読み込むデータのサイズが上限を超えています/);
  await assert.rejects(memory.read('small.xml', -1), /読み込みサイズの上限が不正です/);
  assert.throws(() => memory.stream('none.xml'), /必要なファイルがありません/);
  const chunks = await collect(memory.stream('big.bin'));
  assert.ok(chunks.length > 1 && chunks.every(chunk => chunk.byteLength <= 64 * 1024));
  assert.equal(chunks.reduce((total, chunk) => total + chunk.byteLength, 0), large.byteLength);
});

test('in-memory packages reject unsafe paths, duplicates and budgets like ZIP input', () => {
  for (const path of ['', '/a.xml', 'a/../b.xml', 'a//b.xml', 'a\\b.xml', 'a%20b.xml', 'a?.xml', 'a:b.xml', './a.xml', 'x'.repeat(513)])
    assert.throws(() => createOfficePackageFromParts([[path, bytes('x')]]), /パスが不正です/, path);
  assert.throws(() => createOfficePackageFromParts([['A.xml', bytes('x')], ['a.XML', bytes('y')]]), /重複/);
  assert.throws(() => createOfficePackageFromParts([['a.xml', 'text']]), /内容が不正です/);
  assert.throws(() => createOfficePackageFromParts([]), /パーツがありません/);
  assert.throws(() => createOfficePackageFromParts([['a', bytes('12345')]], { limits: { entryBytes: 4 } }), /上限を超えています/);
  assert.throws(() => createOfficePackageFromParts([['a', bytes('123')], ['b', bytes('123')]], { limits: { totalBytes: 5 } }), /上限を超えています/);
  assert.throws(() => createOfficePackageFromParts([['a', bytes('1')], ['b', bytes('2')]], { limits: { entries: 1 } }), /上限を超えています/);
  assert.throws(() => createOfficePackageFromParts([['a', bytes('1')]], { limits: { entries: 0 } }), /読み込み上限が不正です/);
});

test('in-memory packages observe cancellation', async () => {
  const controller = new AbortController(), memory = createOfficePackageFromParts([['a.xml', bytes('<a/>')]], { signal: controller.signal });
  controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(memory.read('a.xml'), { name: 'AbortError' });
  await assert.rejects(memory.validate(), { name: 'AbortError' });
  await assert.rejects(collect(memory.stream('a.xml')), { name: 'AbortError' });
});

test('container detection recognises ZIP and compound-file signatures without trusting names', async () => {
  const zip = new Uint8Array(await (await createZipArchive([{ path: 'a.txt', content: new Blob(['a']) }])).arrayBuffer());
  const cfb = Uint8Array.from([...cfbSignature, 0, 0, 0, 0]);
  assert.equal(detectOfficeContainerBytes(zip), 'zip');
  assert.equal(detectOfficeContainerBytes(cfb), 'cfb');
  assert.equal(detectOfficeContainerBytes(cfb.subarray(0, 7)), 'unknown');
  assert.equal(detectOfficeContainerBytes(bytes('plain text')), 'unknown');
  assert.equal(detectOfficeContainerBytes(new Uint8Array()), 'unknown');
  assert.equal(await detectOfficeContainer(zip), 'zip');
  assert.equal(await detectOfficeContainer(cfb.buffer), 'cfb');
  assert.equal(await detectOfficeContainer(new File([cfb], 'renamed.xlsx')), 'cfb');
  assert.equal(await detectOfficeContainer(new File([zip], 'renamed.xls')), 'zip');
});

test('container detection reads only the leading bytes of sliceable input and honours cancellation', async () => {
  const requested = [];
  const input = { size: 1_000_000, slice(start, end) { requested.push([start, end]); return { arrayBuffer: async () => Uint8Array.from(cfbSignature).buffer }; },
    arrayBuffer() { throw new Error('the whole file must not be read'); } };
  assert.equal(await detectOfficeContainer(input), 'cfb');
  assert.deepEqual(requested, [[0, 8]]);
  const whole = { size: 8, arrayBuffer: async () => Uint8Array.from(cfbSignature).buffer };
  assert.equal(await detectOfficeContainer(whole), 'cfb');
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(detectOfficeContainer(input, controller.signal), { name: 'AbortError' });
  await assert.rejects(detectOfficeContainer(null), /入力形式が不正です/);
});
