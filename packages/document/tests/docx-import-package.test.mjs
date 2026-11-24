import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The package reader is the seam shared with converters that synthesize a DOCX package in memory.
const output = await build({ stdin: { contents: `export { importDocumentDocx } from './src/io';
export { importDocumentDocxPackage } from './src/io/import-docx';
export { createOfficePackageFromParts, openOfficePackage } from './src/ooxml';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'docx-package-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importDocumentDocx, importDocumentDocxPackage, createOfficePackageFromParts, openOfficePackage } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const fixture = await readFile(new URL('./fixtures/word-basic.docx', import.meta.url));
async function memoryPackage(bytes, signal) {
  const archive = await openOfficePackage(bytes), parts = [];
  for (const path of archive.paths) parts.push([path, await archive.read(path)]);
  return createOfficePackageFromParts(parts, { signal });
}

// Block ids are random per import; number them by first appearance so references stay comparable.
function stableIds(value) {
  const seen = new Map();
  return JSON.parse(JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, id => {
    if (!seen.has(id)) seen.set(id, `id-${seen.size + 1}`);
    return seen.get(id);
  }));
}

test('a Word document imports identically from the ZIP and from an in-memory package', async () => {
  const expected = stableIds(await importDocumentDocx(fixture));
  assert.ok(JSON.stringify(expected).includes('"id-1"'), 'the fixture carries generated block ids');
  assert.deepEqual(stableIds(await importDocumentDocxPackage(await memoryPackage(fixture))), expected);
});

test('the DOCX package reader keeps cancellation and the Word error context', async () => {
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importDocumentDocxPackage(await memoryPackage(fixture), { signal: controller.signal }), { name: 'AbortError' });
  const text = value => new TextEncoder().encode(value);
  const notDocument = createOfficePackageFromParts([['[Content_Types].xml', text('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
    ['_rels/.rels', text('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')]]);
  await assert.rejects(importDocumentDocxPackage(notDocument), /Word文書を読み込めません: \.docx形式の文書ではありません/);
});

test('importDocumentDocx still accepts only OOXML packages', async () => {
  const compoundFile = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(504)]);
  await assert.rejects(importDocumentDocx(compoundFile), /Officeファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
  await assert.rejects(importDocumentDocx(new File([fixture], 'legacy.doc')), /Word文書を読み込めません: \.docx形式を指定してください/);
});
