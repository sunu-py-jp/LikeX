import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/model/index"; export * from "./src/import/import-xlsx"; export * from "./src/export/export-xlsx"; export { createGridMergeCache } from "./src/ui/grid/grid-merge-cache";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, serializeWorkbook, parseWorkbook, importSpreadsheetXlsx, exportSpreadsheetXlsx,
  mergeCells, cellAddress, getMergedRange, createGridMergeCache, SPREADSHEET_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const merges = count => Array.from({ length: count }, (_, index) => ({ top: Math.floor(index / 100), bottom: Math.floor(index / 100), left: (index % 100) * 2, right: (index % 100) * 2 + 1 }));
const makeSheet = (name, count) => ({ id: name, name, rowCount: 200, columnCount: 200, cells: {}, merges: merges(count) });
const sheetXml = (count, values = true) => {
  const ranges = merges(count);
  const rows = new Map();
  if (values) for (const [index, range] of ranges.entries()) {
    const row = range.top + 1;
    rows.set(row, (rows.get(row) ?? '') + `<c r="${cellAddress(range.top, range.left)}"><v>${index + 1}</v></c>`);
  }
  return `<sheetData>${[...rows].map(([row, cells]) => `<row r="${row}">${cells}</row>`).join('')}</sheetData><mergeCells>${ranges.map(range => `<mergeCell ref="${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}"/>`).join('')}</mergeCells>`;
};
const importSheets = sheets => importSpreadsheetXlsx(zip(fixture({ sheets })));

test('single-sheet 1,001 and multi-sheet totals over the former 1,000 limit import without lost merges', async () => {
  for (const counts of [[1001], [600, 600]]) {
    const source = { sheets: counts.map((count, index) => makeSheet(`仕様${index + 1}`, count)) };
    const model = normalizeWorkbook(source);
    assert.deepEqual(model.sheets.map(sheet => sheet.merges.length), counts);
    const imported = await importSheets(counts.map((count, index) => ({ name: source.sheets[index].name, xml: sheetXml(count) })));
    assert.deepEqual(imported.workbook.sheets.map(sheet => sheet.merges.length), counts);
    for (const [index, sheet] of imported.workbook.sheets.entries()) assert.deepEqual(sheet.merges, source.sheets[index].merges);
    assert.equal(imported.warnings.length, 0);
  }
});

test('the 10,000 workbook boundary survives native and XLSX roundtrips without dropping ranges or values', async () => {
  assert.equal(SPREADSHEET_LIMITS.merges, 10000);
  const result = await importSheets([{ name: '最大仕様', xml: sheetXml(SPREADSHEET_LIMITS.merges) }]);
  const expected = result.workbook.sheets[0];
  assert.equal(expected.merges.length, SPREADSHEET_LIMITS.merges);
  assert.equal(Object.keys(expected.cells).length, SPREADSHEET_LIMITS.merges);
  const native = parseWorkbook(serializeWorkbook(result.workbook));
  assert.deepEqual(native.sheets[0].merges, expected.merges);
  const roundtrip = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(native));
  assert.deepEqual(roundtrip.workbook.sheets[0].merges, expected.merges);
  assert.deepEqual(Object.keys(roundtrip.workbook.sheets[0].cells).sort(), Object.keys(expected.cells).sort());
  for (const [address, cell] of Object.entries(expected.cells)) assert.equal(roundtrip.workbook.sheets[0].cells[address].value, cell.value);
});

test('native excess remains rejected while XLSX excess omits only merge presentation with warnings', async () => {
  const max = SPREADSHEET_LIMITS.merges;
  assert.throws(() => normalizeWorkbook({ sheets: [makeSheet('単独', max + 1)] }), error => /10001/.test(error.message) && /10000/.test(error.message) && /単独/.test(error.message));
  assert.throws(() => normalizeWorkbook({ sheets: [makeSheet('前半', 5000), makeSheet('後半', 5001)] }), error => /ブック全体: 10001/.test(error.message) && /上限: 10000/.test(error.message) && /「後半」5001/.test(error.message));
  for (const counts of [[max + 1], [5000, 5001]]) {
    const result = await importSheets(counts.map((count, index) => ({ name: `仕様${index + 1}`, xml: sheetXml(count, false) })));
    assert.equal(result.workbook.sheets.reduce((count, sheet) => count + (sheet.merges?.length ?? 0), 0), max);
    assert.ok(result.warnings.some(warning => warning.message.includes('10000') && warning.sheetName === `仕様${counts.length}`));
  }
  const atLimit = normalizeWorkbook({ sheets: [makeSheet('全件', max), makeSheet('追加先', 0)] });
  assert.throws(() => mergeCells(atLimit, '追加先', { top: 0, left: 0, bottom: 0, right: 1 }), /ブック全体: 10001/);
  assert.equal(atLimit.sheets[1].merges, undefined, 'failed command keeps the input unchanged');
  await assert.rejects(exportSpreadsheetXlsx({ sheets: [makeSheet('超過', max + 1)] }), /10001/);
});

test('single-cell declarations omitted during import do not consume the retained merge budget', async () => {
  const xml = `<sheetData/><mergeCells>${'<mergeCell ref="A1"/>'.repeat(5001)}</mergeCells>`;
  const omitted = await importSheets([{ name: '空結合1', xml }, { name: '空結合2', xml }]);
  assert.ok(omitted.workbook.sheets.every(sheet => !sheet.merges));
  const boundary = await importSheets([{ name: '空結合', xml: `<sheetData/><mergeCells>${'<mergeCell ref="A1"/>'.repeat(SPREADSHEET_LIMITS.merges)}</mergeCells>` }]);
  assert.equal(boundary.workbook.sheets[0].merges, undefined);
  assert.equal(boundary.warnings.find(warning => warning.message.includes('1セル')).count, SPREADSHEET_LIMITS.merges);
});

test('indexed merge lookup and mounted row cache agree with linear lookup for horizontal, vertical and large ranges', () => {
  const definitions = [
    { top: 0, left: 0, bottom: 9999, right: 0 },
    ...Array.from({ length: 100 }, (_, row) => ({ top: row * 100, left: 1, bottom: row * 100 + 1, right: 20 })),
    ...Array.from({ length: 100 }, (_, row) => ({ top: row * 100 + 2, left: 21, bottom: row * 100 + 98, right: 23 })),
  ];
  const sheet = normalizeWorkbook({ sheets: [{ id: 's', name: '索引', rowCount: 10000, columnCount: 30, cells: {}, merges: definitions }] }).sheets[0];
  const cache = createGridMergeCache(sheet.merges, sheet.columnCount);
  for (let row = 0; row < 10000; row += 17) {
    cache.include([row]);
    for (let column = 0; column < 30; column++) {
      const expected = definitions.find(range => row >= range.top && row <= range.bottom && column >= range.left && column <= range.right);
      assert.deepEqual(getMergedRange(sheet, { row, column }), expected);
      assert.deepEqual(cache.cells.get(row * sheet.columnCount + column), expected);
    }
  }
});

test('caller-owned mutable arrays and ranges never reuse stale lookup results', () => {
  const range = { top: 0, left: 0, bottom: 0, right: 1 };
  const sheet = { merges: [range] };
  assert.equal(getMergedRange(sheet, { row: 0, column: 1 }), range);
  range.top = range.bottom = 1;
  assert.equal(getMergedRange(sheet, { row: 0, column: 1 }), undefined);
  assert.equal(getMergedRange(sheet, { row: 1, column: 1 }), range);
  Object.freeze(sheet.merges);
  range.top = range.bottom = 2;
  assert.equal(getMergedRange(sheet, { row: 1, column: 1 }), undefined);
  assert.equal(getMergedRange(sheet, { row: 2, column: 1 }), range);
});

test('unvalidated frozen overlapping input preserves the public first-match lookup behavior', () => {
  const first = Object.freeze({ top: 0, left: 0, bottom: 10, right: 10 });
  const second = Object.freeze({ top: 0, left: 2, bottom: 2, right: 3 });
  const sheet = { merges: Object.freeze([first, second]) };
  assert.equal(getMergedRange(sheet, { row: 1, column: 2 }), first);
  assert.equal(getMergedRange(sheet, { row: 5, column: 2 }), first);
});
