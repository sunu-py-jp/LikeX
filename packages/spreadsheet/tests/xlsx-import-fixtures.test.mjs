import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Independent producers exercise ordinary compressed XLSX, not only LikeX's own writer.
const buildResult = await build({ stdin: { contents: `export * from './src/model-entry';
export { exportSpreadsheetXlsx } from './src/export/export-xlsx';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-fixture-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, calculateWorkbook, parseWorkbook, serializeWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const readFixture = name => readFile(new URL(`./fixtures/xlsx/${name}.xlsx`, import.meta.url));

test('XlsxWriter workbook imports shared strings, formulas, styles, tables, validations, names and embedded drawings', async () => {
  const bytes = await readFixture('xlsxwriter-sample'), original = Buffer.from(bytes);
  const { workbook, warnings } = await importSpreadsheetXlsx(bytes);
  assert.deepEqual(bytes, original, 'input bytes remain untouched');
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['売上', '空シート']);
  const sheet = workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '2026年度 売上サンプル');
  assert.equal(sheet.cells.A1.format.bold, true);
  assert.equal(sheet.cells.A1.format.color.toUpperCase(), '#216E39');
  assert.equal(sheet.cells.D8.value, '=SUM(D4:D6)');
  assert.equal(calculateWorkbook(workbook)[sheet.id].D8, 980);
  assert.equal(sheet.cells.B10.value, '00123');
  assert.equal(sheet.cells.B10.format.numberFormat, 'text');
  assert.equal(sheet.cells.C10.value, '=literal');
  assert.equal(calculateWorkbook(workbook)[sheet.id].C10, '=literal');
  assert.equal(sheet.cells.D10.value, 'TRUE');
  assert.equal(sheet.cells.A10.format.numberFormat, 'date');
  assert.equal(sheet.cells.A10.validation.type, 'date');
  assert.equal(sheet.cells.A10.validation.min, '2026-01-01');
  assert.deepEqual(sheet.merges[0], { top: 0, left: 0, bottom: 0, right: 3 });
  assert.equal(sheet.tables[0].name, 'Sales');
  assert.deepEqual(sheet.cells.B12.validation.values, ['未着手', '進行中', '完了']);
  assert.equal(sheet.cells.C12.validation.type, 'number');
  assert.equal(sheet.comments.A4.text, 'テスト用コメント');
  assert.equal(workbook.namedRanges[0].name, '売上明細');
  const image = sheet.drawings.find(item => item.type === 'image');
  assert.equal(image.alt, 'テスト画像');
  assert.ok(Math.abs(image.width - 80) < 0.001); assert.ok(Math.abs(image.height - 40) < 0.001);
  const resource = workbook.resources.images[image.resourceId];
  assert.equal(resource.width, 160); assert.equal(resource.height, 80);
  assert.ok(sheet.drawings.some(item => item.type === 'text' && item.text.includes('文字入りテキストボックス')));
  assert.ok(!warnings.some(item => /画像/.test(item.message)), JSON.stringify(warnings));
  assert.deepEqual(parseWorkbook(serializeWorkbook(workbook)), workbook);
});

test('openpyxl inline strings and uncached supported formulas stay usable without a browser', async () => {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  const { workbook } = await importSpreadsheetXlsx(await readFixture('openpyxl-sample'));
  const sheet = workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '00123');
  assert.equal(sheet.cells.A2.value, '=SUM(B1:B2)');
  assert.equal(calculateWorkbook(workbook)[sheet.id].A2, 5);
  assert.equal(sheet.cells.C1.format.numberFormat, 'date');
  assert.deepEqual(sheet.merges[0], { top: 3, left: 0, bottom: 3, right: 2 });
});

test('unsupported formulas retain the cached result and charts produce reviewable warnings', async () => {
  const { workbook, warnings } = await importSpreadsheetXlsx(await readFixture('xlsxwriter-warnings'));
  assert.equal(workbook.sheets[0].cells.A16.value, '42');
  assert.ok(warnings.some(item => item.code === 'unsupported' && /数式/.test(item.message)));
  assert.ok(warnings.some(item => /グラフ/.test(item.message)));
});

test('an independently generated workbook can be imported, exported, and imported again', async () => {
  const source = await importSpreadsheetXlsx(await readFixture('xlsxwriter-sample'));
  const blob = await exportSpreadsheetXlsx(source.workbook);
  const result = await importSpreadsheetXlsx(blob);
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A4.value, 'りんご');
  assert.equal(calculateWorkbook(result.workbook)[sheet.id].D8, 980);
  assert.equal(sheet.tables[0].name, 'Sales');
  assert.deepEqual(sheet.cells.B12.validation.values, ['未着手', '進行中', '完了']);
  assert.equal(sheet.drawings.filter(item => item.type === 'image').length, 1);
  assert.ok(sheet.drawings.some(item => item.type === 'text' && item.text.includes('文字入りテキストボックス')));
});
