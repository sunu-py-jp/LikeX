import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/import/types"; export { calculateWorkbook } from "./src/model/formula"; export * from "./src/export/export-xlsx"; export * from "./src/model/format-ranges"; export * from "./src/export/xlsx/worksheet"; export * from "./src/export/xlsx/styles";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const styling = {
  links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }],
  parts: { 'xl/styles.xml': '<styleSheet><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills><borders><border/><border><right style="thin"><color rgb="FF000000"/></right></border></borders><cellXfs><xf/><xf fillId="1" applyFill="1"/><xf fillId="1" applyFill="1" borderId="1" applyBorder="1"/><xf fillId="1" applyFill="1"/></cellXfs></styleSheet>' },
};
const read = (xml, options) => m.importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: '帳票', xml }], ...styling })), options);

test('finite identical runs preserve a different terminal border without one cell record per blank', async () => {
  const xml = `<sheetData>${[1, 2, 3].map(row => `<row r="${row}">${Array.from({ length: 17 }, (_, index) => `<c r="${String.fromCharCode(73 + index)}${row}" s="${index % 2 ? 3 : 1}"/>`).join('')}<c r="Z${row}" s="2"/></row>`).join('')}</sheetData>`;
  const result = await read(xml), sheet = result.workbook.sheets[0];
  assert.equal(Object.keys(sheet.cells).length, 0);
  assert.equal(sheet.formatRanges.length, 2);
  assert.deepEqual(sheet.formatRanges.map(item => item.range), [
    { top: 0, left: 8, bottom: 2, right: 24 }, { top: 0, left: 25, bottom: 2, right: 25 },
  ]);
  assert.equal(m.getCellFormat(sheet, 1, 9).background, '#00FF00');
  assert.equal(m.getCellFormat(sheet, 1, 24).borders, undefined);
  assert.equal(m.getCellFormat(sheet, 1, 25).borders.right.style, 'solid');
  const restored = (await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(result.workbook))).workbook.sheets[0];
  assert.equal(Object.keys(restored.cells).length, 0);
  assert.equal(m.getCellFormat(restored, 1, 9).background, '#00FF00');
  assert.equal(m.getCellFormat(restored, 1, 25).borders.right.style, 'solid');
});

test('column defaults, row defaults and explicit default-style exceptions retain Excel precedence', async () => {
  const result = await read('<cols><col min="9" max="26" style="1"/></cols><sheetData><row r="2" s="2" customFormat="1"><c r="I2" s="0"/><c r="J2" s="0"><v>2</v></c><c r="K2"><v>3</v></c></row><row r="3"><c r="I3"><v>4</v></c></row></sheetData>');
  const sheet = result.workbook.sheets[0];
  assert.equal(m.getCellFormat(sheet, 0, 8).background, '#00FF00');
  assert.equal(m.getCellFormat(sheet, 1, 8).background, undefined);
  assert.equal(m.getCellFormat(sheet, 1, 9).background, undefined);
  assert.equal(m.getCellFormat(sheet, 1, 10).borders.right.style, 'solid');
  assert.equal(m.getCellFormat(sheet, 2, 8).background, '#00FF00');
  assert.ok(sheet.formatRanges.some(item => item.range.bottom === 'end'));
  assert.ok(sheet.formatRanges.some(item => item.range.right === 'end'));
  const restored = (await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(result.workbook))).workbook.sheets[0];
  for (const [row, column] of [[0, 8], [1, 8], [1, 9], [1, 10], [2, 8]]) {
    assert.equal(m.getCellFormat(restored, row, column)?.background, m.getCellFormat(sheet, row, column)?.background);
    assert.equal(m.getCellFormat(restored, row, column)?.borders?.right?.style, m.getCellFormat(sheet, row, column)?.borders?.right?.style);
  }
});

test('redundant blank declarations retain entire-row and entire-column end tracking', async () => {
  const rows = await read('<sheetData><row r="2" s="1" customFormat="1"><c r="A2" s="1"/><c r="B2" s="3"/></row></sheetData>');
  assert.deepEqual(rows.workbook.sheets[0].formatRanges.map(item => item.range), [{ top: 1, left: 0, bottom: 1, right: 'end' }]);
  const columns = await read('<cols><col min="9" max="10" style="1"/></cols><sheetData><row r="2"><c r="I2" s="3"/></row></sheetData>');
  assert.deepEqual(columns.workbook.sheets[0].formatRanges.map(item => item.range), [{ top: 0, left: 8, bottom: 'end', right: 9 }]);
});

test('formulas override inherited text formatting instead of becoming literal strings on import and roundtrip', async () => {
  for (const axis of ['column', 'row']) {
    const result = await m.importSpreadsheetXlsx(zip(fixture({
      sheets: [{ name: 'Formulas', xml: `${axis === 'column' ? '<cols><col min="1" max="1" style="1"/></cols>' : ''}<sheetData><row r="1"${axis === 'row' ? ' s="1" customFormat="1"' : ''}><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData>` }],
      links: styling.links,
      parts: { 'xl/styles.xml': '<styleSheet><cellXfs><xf/><xf numFmtId="49"/></cellXfs></styleSheet>' },
    })));
    const sheet = result.workbook.sheets[0];
    assert.equal(sheet.cells.A1.value, '=1+1');
    assert.equal(m.getCellFormat(sheet, 0, 0).numberFormat, 'general');
    assert.equal(m.calculateWorkbook(result.workbook)[sheet.id].A1, 2);
    const restored = (await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(result.workbook))).workbook;
    assert.equal(restored.sheets[0].cells.A1.value, '=1+1');
    assert.equal(m.calculateWorkbook(restored)[restored.sheets[0].id].A1, 2);
  }
});

test('full-row/full-column formats export with style attributes and finite rectangles expand only on output', () => {
  const sheet = { id: 's', name: 'Sheet', rowCount: 100, columnCount: 30, cells: { I3: { value: '123', format: { numberFormat: 'text' } } }, formatRanges: [
    { range: { top: 0, left: 8, bottom: 'end', right: 25 }, format: { background: '#123456' } },
    { range: { top: 0, left: 0, bottom: 0, right: 7 }, format: { bold: true } },
  ] };
  const workbook = { schemaVersion: 1, sheets: [sheet] };
  const xml = m.worksheetXml(workbook, sheet, m.createXlsxStyles(workbook), {});
  assert.equal((xml.match(/<c /g) ?? []).length, 9);
  assert.match(xml, /<col min="9" max="9" style="\d+"\/>/);
  assert.match(xml, /r="I3"[^>]*t="inlineStr"/);
  const rowSheet = { ...sheet, cells: {}, formatRanges: [{ range: { top: 4, left: 0, bottom: 6, right: 'end' }, format: { bold: true } }] };
  const rowBook = { schemaVersion: 1, sheets: [rowSheet] };
  const rowXml = m.worksheetXml(rowBook, rowSheet, m.createXlsxStyles(rowBook), {});
  assert.equal((rowXml.match(/<c /g) ?? []).length, 0);
  assert.match(rowXml, /<row r="5" s="\d+" customFormat="1"><\/row>/);
});

test('import byte budgets resolve input128MiB and expanded5x, allow independent overrides, and reject invalid options', async () => {
  const MiB = 1024 * 1024;
  assert.equal(m.resolveXlsxImportLimits().inputBytes, 128 * MiB);
  assert.equal(m.resolveXlsxImportLimits().totalBytes, 640 * MiB);
  assert.equal(m.resolveXlsxImportLimits({ inputBytes: 1000 }).totalBytes, 5000);
  assert.equal(m.resolveXlsxImportLimits({ inputBytes: 1000, expandedBytes: 2000 }).worksheetXmlBytes, 2000);
  for (const limits of [null, [], { inputBytes: null }, { expandedBytes: null }, { inputBytes: 0 }, { expandedBytes: -1 }, { inputBytes: 1.5 }, { expandedBytes: Infinity }, { inputBytes: Number.MAX_SAFE_INTEGER }])
    await assert.rejects(read('<sheetData/>', { limits }), /limits|inputBytes|expandedBytes/);
  const entries = fixture({ sheets: [{ name: 'Large', xml: `<sheetData/>${' '.repeat(20_000)}` }] });
  const file = zip(entries);
  await assert.rejects(m.importSpreadsheetXlsx(file, { limits: { inputBytes: file.length - 1, expandedBytes: 100_000 } }), /ファイルサイズ/);
  await assert.rejects(m.importSpreadsheetXlsx(file, { limits: { inputBytes: file.length } }), /展開サイズ/);
  const result = await m.importSpreadsheetXlsx(file, { limits: { inputBytes: file.length, expandedBytes: 100_000 } });
  assert.equal(result.workbook.sheets[0].name, 'Large');
});

test('the workbook-wide range budget omits only later optional formatting and retains later data', async () => {
  const rows = Array.from({ length: 100 }, (_, row) => `<row r="${row + 1}">${Array.from({ length: 1000 }, (_, column) => `<c s="${(row + column) % 2 + 1}"/>`).join('')}</row>`).join('');
  const source = fixture({ sheets: [
    { name: 'Full', xml: `<sheetData>${rows}</sheetData>` },
    { name: 'Later', xml: '<sheetData><row r="1"><c r="A1" s="1"/><c r="B1"><v>42</v></c></row></sheetData>' },
  ], ...styling });
  const result = await m.importSpreadsheetXlsx(zip(source));
  assert.equal(result.workbook.sheets[0].formatRanges.length, 100000);
  assert.equal(result.workbook.sheets[1].formatRanges?.length ?? 0, 0);
  assert.equal(result.workbook.sheets[1].cells.B1.value, '42');
  assert.equal(result.warnings.find(item => item.sheetName === 'Later' && item.message.includes('書式範囲の上限')).count, 1);
});
