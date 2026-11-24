import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The package readers are the seam shared with converters that synthesize a PPTX package in memory.
const output = await build({ stdin: { contents: `export { importSlidePptx, importSlidePptxMasters } from './src/model-entry';
export { importSlidePptxPackage } from './src/import/import-pptx';
export { importSlidePptxMastersPackage } from './src/import/pptx-masters';
export { createOfficePackageFromParts, openOfficePackage } from './src/ooxml';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'pptx-package-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSlidePptx, importSlidePptxMasters, importSlidePptxPackage, importSlidePptxMastersPackage, createOfficePackageFromParts, openOfficePackage } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const readFixture = name => readFile(new URL(`./fixtures/${name}.pptx`, import.meta.url));
async function memoryPackage(bytes, signal) {
  const archive = await openOfficePackage(bytes), parts = [];
  for (const path of archive.paths) parts.push([path, await archive.read(path)]);
  return createOfficePackageFromParts(parts, { signal });
}

for (const name of ['powerpoint-basic', 'openxml-sdk-powerpoint-fly-in']) {
  test(`${name} imports identically from the ZIP and from an in-memory package`, async () => {
    const bytes = await readFixture(name), seen = [];
    const expected = await importSlidePptx(bytes);
    const actual = await importSlidePptxPackage(await memoryPackage(bytes), { onDiagnostic: diagnostic => seen.push(diagnostic) });
    assert.deepEqual(actual, expected);
    assert.deepEqual(seen, [...expected.diagnostics]);
  });
  test(`${name} masters import identically from the ZIP and from an in-memory package`, async () => {
    const bytes = await readFixture(name);
    assert.deepEqual(await importSlidePptxMastersPackage(await memoryPackage(bytes)), await importSlidePptxMasters(bytes));
  });
}

test('the PPTX package reader keeps cancellation and the PowerPoint error context', async () => {
  const bytes = await readFixture('powerpoint-basic');
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importSlidePptxPackage(await memoryPackage(bytes), { signal: controller.signal }), { name: 'AbortError' });
  const text = value => new TextEncoder().encode(value);
  const notPresentation = createOfficePackageFromParts([['[Content_Types].xml', text('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
    ['_rels/.rels', text('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')]]);
  await assert.rejects(importSlidePptxPackage(notPresentation), /PowerPointを読み込めません: \.pptx または \.potx形式のプレゼンテーションではありません/);
});
