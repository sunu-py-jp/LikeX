import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { crc32, deflateRawSync } from 'node:zlib';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { openOfficePackageReader } from './ooxml/zip-stream-reader.ts';
  export { openOfficePackage } from './ooxml/zip-reader.ts';
  export { createZipArchive } from './zip.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { openOfficePackageReader, openOfficePackage, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const MiB = 1024 * 1024;
const largerLimits = { inputBytes: 32 * MiB, entryBytes: 100 * MiB, totalBytes: 100 * MiB };
const text = bytes => new TextDecoder().decode(bytes);

function compressedArchive(entries) {
  const locals = [], directories = [];
  let offset = 0, directoryBytes = 0;
  for (const { path, content, declaredSize = content.length, declaredCrc = crc32(content), descriptor = false } of entries) {
    const name = new TextEncoder().encode(path), compressed = deflateRawSync(content);
    const local = new Uint8Array(30), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800 | (descriptor ? 8 : 0), true);
    lv.setUint16(8, 8, true); lv.setUint16(26, name.length, true);
    if (!descriptor) { lv.setUint32(14, declaredCrc, true); lv.setUint32(18, compressed.length, true); lv.setUint32(22, declaredSize, true); }
    const central = new Uint8Array(46), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800 | (descriptor ? 8 : 0), true);
    cv.setUint16(10, 8, true); cv.setUint32(16, declaredCrc, true); cv.setUint32(20, compressed.length, true); cv.setUint32(24, declaredSize, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    locals.push(local, name, compressed);
    if (descriptor) {
      const data = new Uint8Array(16), view = new DataView(data.buffer);
      view.setUint32(0, 0x08074b50, true); view.setUint32(4, declaredCrc, true); view.setUint32(8, compressed.length, true); view.setUint32(12, declaredSize, true);
      locals.push(data); offset += 16;
    }
    directories.push(central, name); offset += local.length + name.length + compressed.length; directoryBytes += central.length + name.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directoryBytes, true); ev.setUint32(16, offset, true);
  return new Blob([...locals, ...directories, end]);
}

test('streaming archive reads STORE/DEFLATE parts and preserves ordinary import budgets', async () => {
  const stored = await createZipArchive([{ path: 'one.xml', content: new Blob(['<one/>']) }, { path: 'folder', directory: true }]);
  const reader = await openOfficePackageReader(stored);
  assert.deepEqual(reader.paths, ['one.xml']); assert.equal(reader.has('one.xml'), true);
  assert.equal(text(await reader.read('one.xml')), '<one/>'); await reader.validate();
  const content = new Uint8Array(17 * MiB).fill(32), source = compressedArchive([{ path: 'sheet.xml', content, descriptor: true }]);
  await assert.rejects(openOfficePackage(source), /展開サイズ.*上限/);
  await assert.rejects(openOfficePackageReader(source), /展開サイズ.*上限/);
  const larger = await openOfficePackageReader(source, undefined, largerLimits);
  let actual = 0, largest = 0;
  for await (const chunk of larger.stream('sheet.xml')) { actual += chunk.length; largest = Math.max(largest, chunk.length); }
  assert.equal(actual, content.length); assert.ok(largest <= 64 * 1024); await larger.validate();
});

test('streaming validation accepts an expanded archive above64MiB without retaining its inflated member', async () => {
  const content = new Uint8Array(65 * MiB);
  const source = compressedArchive([{ path: 'sheet.xml', content }]);
  const reader = await openOfficePackageReader(source, undefined, largerLimits);
  await reader.validate();
  // Metadata readers can retain their smaller cap before allocating the large output buffer.
  await assert.rejects(reader.read('sheet.xml', 16 * MiB), /読み込むデータ.*上限/);
});

test('streaming archive enforces declared entry and aggregate budgets before returning parts', async () => {
  const source = compressedArchive([{ path: 'a.xml', content: new Uint8Array(1), declaredSize: 60 * MiB }, { path: 'b.xml', content: new Uint8Array(1), declaredSize: 41 * MiB }]);
  await assert.rejects(openOfficePackageReader(source, undefined, largerLimits), /展開サイズ.*上限/);
  await assert.rejects(openOfficePackageReader(compressedArchive([{ path: 'a.xml', content: new Uint8Array(1), declaredSize: 101 * MiB }]), undefined, largerLimits), /展開サイズ.*上限/);
  let read = false;
  await assert.rejects(openOfficePackageReader({ size: 32 * MiB + 1, async arrayBuffer() { read = true; return new ArrayBuffer(0); } }), /ファイルサイズ.*32 MiB/);
  assert.equal(read, false);
});

test('streaming validation catches unread corrupt members and interrupted-stream CRC errors', async () => {
  const source = compressedArchive([{ path: 'ok.xml', content: new TextEncoder().encode('<ok/>') }, { path: 'ignored.xml', content: new Uint8Array(2 * MiB), declaredCrc: 123 }]);
  const reader = await openOfficePackageReader(source);
  assert.equal(text(await reader.read('ok.xml')), '<ok/>');
  for await (const chunk of reader.stream('ignored.xml')) { assert.ok(chunk.length); break; }
  await assert.rejects(reader.validate(), /CRC/);
});

test('streaming archive rejects actual output larger or smaller than the declaration', async () => {
  for (const declaredSize of [1, 100_001]) {
    const source = compressedArchive([{ path: 'one.xml', content: new Uint8Array(100_000), declaredSize }]);
    const reader = await openOfficePackageReader(source);
    await assert.rejects(reader.validate(), /実際の展開サイズ|展開サイズが一致/);
  }
});

test('streaming archive cancels while inflating and while awaiting input', async () => {
  const controller = new AbortController(), source = compressedArchive([{ path: 'one.xml', content: new Uint8Array(2 * MiB) }]);
  const reader = await openOfficePackageReader(source, controller.signal);
  const operation = (async () => { for await (const chunk of reader.stream('one.xml')) { assert.ok(chunk.length); controller.abort(); } })();
  await assert.rejects(operation, { name: 'AbortError' });
  await assert.rejects(reader.validate(), { name: 'AbortError' });
  let release, started;
  const ready = new Promise(resolve => { started = resolve; }), waiting = new AbortController();
  const opening = openOfficePackageReader({ size: 100, arrayBuffer() { started(); return new Promise(resolve => { release = resolve; }); } }, waiting.signal);
  await ready; const rejected = assert.rejects(opening, { name: 'AbortError' }); waiting.abort(); await rejected;
  release(new ArrayBuffer(100));
});

test('streaming archive rejects malformed directory headers, paths and descriptors', async () => {
  const source = compressedArchive([{ path: 'one.xml', content: new TextEncoder().encode('one'), descriptor: true }]);
  const original = new Uint8Array(await source.arrayBuffer()), end = original.length - 22;
  const directory = new DataView(original.buffer).getUint32(end + 16, true);
  const variants = [
    bytes => new DataView(bytes.buffer).setUint16(directory + 8, 1, true),
    bytes => new DataView(bytes.buffer).setUint16(end + 10, 0xffff, true),
    bytes => new DataView(bytes.buffer).setUint32(end + 12, 0xffffffff, true),
    bytes => new DataView(bytes.buffer).setUint32(directory + 42, 1, true),
    bytes => { bytes[directory - 1] ^= 1; },
    bytes => { bytes[30] = '/'.charCodeAt(0); bytes[directory + 46] = '/'.charCodeAt(0); },
  ];
  for (const mutate of variants) { const bytes = original.slice(); mutate(bytes); await assert.rejects(openOfficePackageReader(bytes)); }
});

test('streaming archive validates configured budgets and avoids caching mutable read results', async () => {
  const source = compressedArchive([{ path: 'one.xml', content: new TextEncoder().encode('one') }]);
  for (const value of [0, -1, NaN, Infinity, 1.5]) await assert.rejects(openOfficePackageReader(source, undefined, { entryBytes: value }), /上限が不正/);
  const reader = await openOfficePackageReader(source), first = await reader.read('one.xml'); first[0] = 0;
  assert.equal(text(await reader.read('one.xml')), 'one');
});
