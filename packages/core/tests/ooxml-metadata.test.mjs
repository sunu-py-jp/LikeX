import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { deflateRawSync } from 'node:zlib';

const result = await build({ stdin: { resolveDir: new URL('../src', import.meta.url).pathname, contents: `
  export { openOfficePackage, openOfficePackageMetadata } from './ooxml/zip-reader.ts';
  export { createZipArchive } from './zip.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { openOfficePackage, openOfficePackageMetadata, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const archive = async () => createZipArchive([
  { path: 'metadata.xml', content: new Blob(['<metadata/>']) },
  { path: 'media.bin', content: new Blob([new Uint8Array(17 * 1024 * 1024)]) },
]);
async function compressedArchive(content, declaredSize = content.length) {
  const original = new Uint8Array(await (await createZipArchive([{ path: 'one.xml', content: new Blob([content]) }])).arrayBuffer());
  const headerSize = 30 + 'one.xml'.length, end = original.length - 22, view = new DataView(original.buffer), directoryOffset = view.getUint32(end + 16, true);
  const local = original.slice(0, headerSize), directory = original.slice(directoryOffset, end), trailer = original.slice(end), compressed = deflateRawSync(content);
  const localView = new DataView(local.buffer), directoryView = new DataView(directory.buffer), trailerView = new DataView(trailer.buffer);
  localView.setUint16(8, 8, true); localView.setUint32(18, compressed.length, true); localView.setUint32(22, declaredSize, true);
  directoryView.setUint16(10, 8, true); directoryView.setUint32(20, compressed.length, true); directoryView.setUint32(24, declaredSize, true);
  trailerView.setUint32(16, headerSize + compressed.length, true);
  return new Blob([local, compressed, directory, trailer]);
}

test('metadata profile only reads selected members while full imports retain their original limits', async () => {
  const source = await archive(), reads = [];
  const reader = await openOfficePackageMetadata({ size: source.size, slice(start, end) { reads.push(end - start); return source.slice(start, end); } });
  assert.deepEqual(reader.paths, ['metadata.xml', 'media.bin']);
  assert.equal(new TextDecoder().decode(await reader.read('metadata.xml')), '<metadata/>');
  assert.ok(Math.max(...reads) < 100_000);
  await assert.rejects(reader.read('media.bin'), /メタデータ.*上限/);
  await assert.rejects(openOfficePackage(source), /展開サイズ.*上限/);
});

test('metadata profile validates every local header and verifies CRC only for requested payloads', async () => {
  const source = await createZipArchive([{ path: 'one.xml', content: new Blob(['first']) }, { path: 'two.xml', content: new Blob(['second']) }]);
  const original = new Uint8Array(await source.arrayBuffer());
  const corruptPayload = original.slice(); corruptPayload[30 + 'one.xml'.length] ^= 1;
  const reader = await openOfficePackageMetadata(new Blob([corruptPayload]));
  assert.equal(new TextDecoder().decode(await reader.read('two.xml')), 'second');
  await assert.rejects(reader.read('one.xml'), /CRC/);
  const badHeader = original.slice(); badHeader[37 + 5] = 0;
  await assert.rejects(openOfficePackageMetadata(new Blob([badHeader])), /ローカルヘッダー/);
});

test('metadata profile rejects encrypted, ZIP64, and truncated directories before exposing parts', async () => {
  const source = await createZipArchive([{ path: 'one.xml', content: new Blob(['first']) }]);
  const original = new Uint8Array(await source.arrayBuffer()), end = original.length - 22;
  const view = new DataView(original.buffer), directory = view.getUint32(end + 16, true);
  for (const mutate of [
    data => new DataView(data.buffer).setUint16(directory + 8, 1, true),
    data => new DataView(data.buffer).setUint16(end + 10, 0xffff, true),
    data => new DataView(data.buffer).setUint32(end + 12, 0x10000000, true),
  ]) { const data = original.slice(); mutate(data); await assert.rejects(openOfficePackageMetadata(new Blob([data]))); }
});

test('metadata profile aborts immediately even if a slice read cannot be cancelled', async () => {
  const controller = new AbortController();
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const source = { size: 100, slice() { return { arrayBuffer() { started(); return new Promise(resolve => { release = resolve; }); } }; } };
  const operation = openOfficePackageMetadata(source, controller.signal);
  await ready;
  const rejected = assert.rejects(operation, { name: 'AbortError' });
  controller.abort(); await rejected;
  release(new ArrayBuffer(4));
});

test('metadata input limit is enforced before any slice allocation', async () => {
  await assert.rejects(openOfficePackageMetadata({ size: 512 * 1024 * 1024 + 1, slice() { assert.fail('must not allocate'); } }), /512 MiB/);
});

test('metadata profile inflates DEFLATE parts and rejects actual output exceeding its declared size', async () => {
  const content = new TextEncoder().encode('<metadata>' + 'content'.repeat(3000) + '</metadata>');
  const valid = await openOfficePackageMetadata(await compressedArchive(content));
  assert.deepEqual(await valid.read('one.xml'), content);
  const bomb = await openOfficePackageMetadata(await compressedArchive(content, 1));
  await assert.rejects(bomb.read('one.xml'), /実際の展開サイズ/);
});
