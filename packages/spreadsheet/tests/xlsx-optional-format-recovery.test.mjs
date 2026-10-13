import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/export/export-xlsx"; export { readXlsxStyles } from "./src/import/styles";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, readXlsxStyles } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const data = '<sheetData><row r="1"><c r="A1" s="1"><v>7</v></c><c r="B1" s="2"><f>A1+2</f><v>9</v></c></row></sheetData>';
const read = (xml = data, styles, extra = {}) => importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: '機能仕様', xml }], ...(styles === undefined ? {} : {
  links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }], parts: { 'xl/styles.xml': styles },
}), ...extra })));
const checkValues = result => { assert.equal(result.workbook.sheets[0].cells.A1.value, '7'); assert.equal(result.workbook.sheets[0].cells.B1.value, '=A1+2'); };

test('missing or invalid cell style references keep values and formulas with explicit fallback warnings', async () => {
  for (const id of ['-1', 'NaN', '0.5', '1000000']) {
    const result = await read(data.replace('s="1"', `s="${id}"`));
    checkValues(result);
    assert.equal(result.workbook.sheets[0].cells.A1.format, undefined);
    assert.ok(result.warnings.some(warning => warning.message.includes('セル書式') && warning.sheetName === '機能仕様'));
  }
});

test('malformed, missing and wrong-root style parts use default styles, preserving XLSX roundtrip values', async () => {
  for (const styles of ['<styleSheet><invalid></styleSheet>', '<notStyles/>']) {
    const result = await read(data, styles); checkValues(result);
    assert.ok(result.warnings.some(warning => warning.message.includes('セル書式を読み込めない')));
    checkValues(await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook)));
  }
  const result = await read(data, undefined, { links: [{ id: 'styles', type: 'styles', target: 'missing.xml' }] });
  checkValues(result); assert.ok(result.warnings.some(warning => warning.message.includes('missing.xml')));
});

test('invalid font properties fall back independently while valid color, bold and number format survive', async () => {
  const styles = '<styleSheet><fonts><font/><font><name val="   "/><sz val="NaN"/><color rgb="FF123456"/><b/></font></fonts><cellXfs><xf/><xf fontId="1" numFmtId="2"/><xf fontId="99"/></cellXfs></styleSheet>';
  const result = await read(data, styles); checkValues(result);
  const format = result.workbook.sheets[0].cells.A1.format;
  assert.equal(format.fontFamily, undefined); assert.equal(format.fontSize, undefined);
  assert.equal(format.bold, true); assert.equal(format.color, '#123456'); assert.equal(format.decimalPlaces, 2);
  assert.ok(result.warnings.some(warning => warning.message.includes('フォント名')));
  assert.ok(result.warnings.some(warning => warning.message.includes('文字サイズ')));
  assert.ok(result.warnings.some(warning => warning.message.includes('参照先が不正なフォント')));
});

test('style counts beyond Excel UI limits are bounded by XML rather than rejected arbitrarily', async () => {
  const result = await read(data.replace('s="1"', 's="65490"'), `<styleSheet><cellXfs>${'<xf/>'.repeat(65490)}<xf numFmtId="9"/></cellXfs></styleSheet>`);
  checkValues(result); assert.equal(result.workbook.sheets[0].cells.A1.format.numberFormat, 'percent');
});

test('theme failures recover separately from valid cell styles', async () => {
  const result = await read(data, undefined, { links: [{ id: 'theme', type: 'theme', target: 'theme.xml' }, { id: 'styles', type: 'styles', target: 'styles.xml' }],
    parts: { 'xl/theme.xml': '<theme><broken></theme>', 'xl/styles.xml': '<styleSheet><cellXfs><xf/><xf numFmtId="9"/><xf/></cellXfs></styleSheet>' } });
  checkValues(result); assert.equal(result.workbook.sheets[0].cells.A1.format.numberFormat, 'percent');
  assert.ok(result.warnings.some(warning => warning.message.includes('テーマ')));
});

test('fallback never consumes cancellation during optional-part reading', async () => {
  for (const type of ['styles', 'theme']) {
    const controller = new AbortController(), reason = new Error('stop optional reading'), warnings = [];
    const context = { archive: { has: () => true, async read() { controller.abort(reason); throw reason; } }, signal: controller.signal, resources: {}, warnings, warn(warning) { warnings.push(warning); } };
    await assert.rejects(readXlsxStyles(new Map([['part', { type: `office/${type}`, target: 'part.xml' }]]), context), error => error === reason);
    assert.equal(warnings.length, 0);
  }
});

test('invalid row and column dimensions fall back independently to safe standard sizes', async () => {
  const result = await read('<sheetFormatPr defaultRowHeight="NaN" defaultColWidth="Infinity"/><cols><col min="0" max="1" width="9"/><col min="1" max="1" width="-2"/><col min="2" max="2" width="20"/></cols>' + data.replace('<row r="1">', '<row r="1" ht="NaN">'));
  checkValues(result); const sheet = result.workbook.sheets[0];
  assert.equal(sheet.rowHeights[0], 20); assert.equal(sheet.columnWidths[0], 64); assert.equal(sheet.columnWidths[1], 140);
  assert.ok(result.warnings.some(warning => warning.message.includes('不正な行高')));
  assert.ok(result.warnings.some(warning => warning.message.includes('不正な列幅')));
  assert.ok(result.warnings.some(warning => warning.message.includes('不正な標準')));
  assert.ok(result.warnings.some(warning => warning.message.includes('範囲が不正な列')));
});

test('merge metadata recovery keeps the first valid nonoverlapping merge and every cell value', async () => {
  const result = await read(data + '<mergeCells><mergeCell ref="bad"/><mergeCell ref="A1:C1"/><mergeCell ref="A2:B3"/><mergeCell ref="B3:C4"/><mergeCell ref="A2:B3"/><mergeCell ref="A10000:A10001"/><mergeCell ref="D2:E2"/></mergeCells>');
  checkValues(result);
  assert.deepEqual(result.workbook.sheets[0].merges, [{ top: 1, bottom: 2, left: 0, right: 1 }, { top: 1, bottom: 1, left: 3, right: 4 }]);
  assert.ok(result.warnings.some(warning => warning.message.includes('重複する結合') && warning.count === 2));
  assert.ok(result.warnings.some(warning => warning.message.includes('結合を解除')));
  checkValues(await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook)));
});

test('empty in-bounds source placeholders neither grow the canvas nor consume stored cells', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => `<row r="${index + 1}">${'<c/>'.repeat(1000)}</row>`).join('');
  const result = await read(`<sheetData>${rows}<row r="9999"><c r="ALL9999"/></row></sheetData>`);
  const sheet = result.workbook.sheets[0]; assert.deepEqual(Object.keys(sheet.cells), []);
  assert.equal(sheet.columnCount, 26); assert.equal(sheet.rowCount, 300);
});

test('indexed content and overlap recovery matches a simple first-valid reference for mixed rectangles', async () => {
  let seed = 1927;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const address = (row, column) => `${String.fromCharCode(65 + column)}${row + 1}`;
  const occupied = Array.from({ length: 120 }, () => ({ row: random(100), column: random(20) }));
  const unique = [...new Map(occupied.map(position => [address(position.row, position.column), position])).values()];
  const rows = new Map();
  for (const { row, column } of unique) rows.set(row, [...rows.get(row) ?? [], `<c r="${address(row, column)}"><v>1</v></c>`]);
  const ranges = Array.from({ length: 2000 }, () => { const top = random(95), left = random(15); return { top, left, bottom: top + random(5), right: left + 1 + random(5) }; });
  const expected = [];
  for (const range of ranges) {
    if (unique.some(({ row, column }) => row >= range.top && row <= range.bottom && column >= range.left && column <= range.right && (row !== range.top || column !== range.left))) continue;
    if (expected.some(other => range.top <= other.bottom && range.bottom >= other.top && range.left <= other.right && range.right >= other.left)) continue;
    expected.push(range);
  }
  expected.sort((a, b) => a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right);
  const xml = `<sheetData>${[...rows].map(([row, cells]) => `<row r="${row + 1}">${cells.join('')}</row>`).join('')}</sheetData><mergeCells>${ranges.map(range => `<mergeCell ref="${address(range.top, range.left)}:${address(range.bottom, range.right)}"/>`).join('')}</mergeCells>`;
  const result = await read(xml); assert.deepEqual(result.workbook.sheets[0].merges, expected);
  assert.equal(Object.keys(result.workbook.sheets[0].cells).length, unique.length);
});
