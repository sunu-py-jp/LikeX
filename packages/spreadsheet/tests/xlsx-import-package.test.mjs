import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The package reader is the seam shared with converters that synthesize an XLSX package in memory.
const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXlsx } from './src/model-entry';
export { importSpreadsheetXlsxPackage } from './src/import/import-xlsx';
export { createOfficePackageFromParts, openOfficePackageReader } from './src/ooxml';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-package-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, importSpreadsheetXlsxPackage, createOfficePackageFromParts, openOfficePackageReader } =
  await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const readFixture = name => readFile(new URL(`./fixtures/xlsx/${name}.xlsx`, import.meta.url));
const limits = { entryBytes: 640 * 1024 * 1024, totalBytes: 640 * 1024 * 1024, entries: 16_384 };
async function memoryPackage(bytes, signal) {
  const archive = await openOfficePackageReader(bytes), parts = [];
  for (const path of archive.paths) parts.push([path, await archive.read(path)]);
  return createOfficePackageFromParts(parts, { limits, signal });
}

for (const name of ['xlsxwriter-sample', 'xlsxwriter-warnings', 'openpyxl-sample'])
  for (const emptyCellFormatting of ['preserve', 'omit'])
    test(`${name} imports identically from the ZIP and from an in-memory package (${emptyCellFormatting})`, async () => {
      const bytes = await readFixture(name);
      const expected = await importSpreadsheetXlsx(bytes, { emptyCellFormatting });
      const actual = await importSpreadsheetXlsxPackage(await memoryPackage(bytes), { emptyCellFormatting });
      assert.deepEqual(actual, expected);
      assert.ok(Object.isFrozen(actual) && Object.isFrozen(actual.warnings));
    });

test('the package reader keeps option validation, cancellation and the Excel error context', async () => {
  const bytes = await readFixture('openpyxl-sample');
  await assert.rejects(importSpreadsheetXlsxPackage(await memoryPackage(bytes), { emptyCellFormatting: 'drop' }), /emptyCellFormatting は preserve または omit/);
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importSpreadsheetXlsxPackage(await memoryPackage(bytes), { signal: controller.signal }), { name: 'AbortError' });
  const broken = createOfficePackageFromParts([['xl/workbook.xml', new TextEncoder().encode('<workbook/>')]]);
  await assert.rejects(importSpreadsheetXlsxPackage(broken), /^Error: Excelファイルを読み込めません: 必要なファイルがありません（\[Content_Types\]\.xml）/);
});

test('importSpreadsheetXlsx still accepts only OOXML packages', async () => {
  const compoundFile = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(504)]);
  await assert.rejects(importSpreadsheetXlsx(compoundFile), /Excelファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
  await assert.rejects(importSpreadsheetXlsx(new File([compoundFile], 'legacy.xls')), /Excelファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
});
