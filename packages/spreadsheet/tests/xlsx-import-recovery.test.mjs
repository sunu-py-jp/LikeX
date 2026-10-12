import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/export/export-xlsx";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const read = (xml, extra = {}) => importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: '機能仕様', xml }], ...extra })));

test('empty source cells outside the model are omitted without growing the canvas or losing supported content', async () => {
  const result = await read('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>機能仕様書</t></is></c><c r="ALM1"/><c/></row><row r="10001"><c r="A10001"/></row><row r="1048576"><c r="XFD1048576" s="1"/></row></sheetData>', {
    links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }], parts: { 'xl/styles.xml': '<styleSheet><cellXfs><xf/><xf numFmtId="14"/></cellXfs></styleSheet>' },
  });
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '機能仕様書');
  assert.equal(sheet.rowCount, 300); assert.equal(sheet.columnCount, 26);
  assert.deepEqual(Object.keys(sheet.cells), ['A1']);
  const warning = result.warnings.find(item => item.message.includes('空セル'));
  assert.equal(warning.count, 4); assert.equal(warning.sheetName, '機能仕様');
});

test('out-of-range values, formulas, invalid source coordinates, references and duplicate cells still reject', async () => {
  for (const cell of ['<c r="ALM1"><v>0</v></c>', '<c r="ALM1"><f>1</f></c>', '<c r="ALM1" t="inlineStr"><is><t> </t></is></c>',
    '<c r="ALM1" s="9"/>', '<c r="ALM1" t="s"><v>0</v></c>', '<c r="XFE1"/>', '<c r="A10001"/>', '<c r="ALM1"/><c r="ALM1"/>']) {
    await assert.rejects(read(`<sheetData><row r="1">${cell}</row></sheetData>`));
  }
  await assert.rejects(read('<sheetData><row r="1048577"><c r="A1048577"/></row></sheetData>'), /行番号/);
  await assert.rejects(read('<sheetData><row r="1"><c r="ALM1"><v>1</v></c></row></sheetData>'), /シート「機能仕様」のセル ALM1/);
  await assert.rejects(read('<sheetData><row r="10001"><c><f>1</f></c></row></sheetData>'), /シート「機能仕様」のセル A10001/);
});

test('omitted empty cells remain subject to the workbook source-cell budget', async () => {
  const rows = Array.from({ length: 60 }, (_, row) => `<row r="${10001 + row}">${'<c/>'.repeat(1000)}</row>`).join('');
  await assert.rejects(importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: 'One', xml: `<sheetData>${rows}</sheetData>` }, { name: 'Two', xml: `<sheetData>${rows}</sheetData>` }] }))), /ブック全体のセル数/);
});

test('out-of-bounds named ranges omit only the definition and preserve ordinary names and sheet contents', async () => {
  const result = await read('<sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData>', {
    workbookExtra: '<definedNames><definedName name="AllRows">機能仕様!$A$1:$A$1048576</definedName><definedName name="AllColumns">機能仕様!$A$1:$XFD$1</definedName><definedName name="Kept">機能仕様!$A$1</definedName></definedNames>',
  });
  assert.equal(result.workbook.sheets[0].cells.A1.value, '7');
  assert.deepEqual(result.workbook.namedRanges.map(item => item.name), ['Kept']);
  assert.equal(result.warnings.filter(item => item.message.includes('シート上限外の名前付き範囲')).length, 2);
  assert.ok(result.warnings.some(item => item.message.includes('AllRows') && item.sheetName === '機能仕様'));
  await assert.rejects(read('<sheetData/>', { workbookExtra: '<definedNames><definedName name="Invalid">機能仕様!$A$1:$XFE$1</definedName></definedNames>' }), /範囲/);
});

test('recognized source named ranges remain budgeted when their out-of-bounds definitions are omitted', async () => {
  const outside = count => Array.from({ length: count }, (_, index) => `<definedName name="Outside_${index}">機能仕様!$A$1:$A$1048576</definedName>`).join('');
  const kept = '<definedName name="Kept">機能仕様!$A$1</definedName>';
  for (const definitions of [outside(1001), outside(1000) + kept])
    await assert.rejects(read('<sheetData/>', { workbookExtra: `<definedNames>${definitions}</definedNames>` }), /名前付き範囲の件数/);
  const boundary = await read('<sheetData/>', { workbookExtra: `<definedNames>${outside(999)}${kept}${kept}</definedNames>` });
  assert.deepEqual(boundary.workbook.namedRanges.map(item => item.name), ['Kept']);
  assert.equal(boundary.warnings.filter(item => item.message.includes('シート上限外の名前付き範囲')).length, 999);
  // Omitting a source range does not reserve its name; a later supported definition still imports.
  const reused = await read('<sheetData/>', { workbookExtra: `<definedNames><definedName name="Kept">機能仕様!$A$1:$A$1048576</definedName>${kept}</definedNames>` });
  assert.deepEqual(reused.workbook.namedRanges.map(item => item.name), ['Kept']);
});

test('conflicting merged cells retain all values, formulas and comments by removing only the merge', async () => {
  const result = await read('<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1+1</f><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>残存値</t></is></c></row><row r="4"><c r="A4"><v>4</v></c></row></sheetData><mergeCells><mergeCell ref="A1:C2"/><mergeCell ref="A4:C4"/><mergeCell ref="D4"/></mergeCells>', {
    parts: {
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>',
      'xl/comments1.xml': '<comments><authors><author>Writer</author></authors><commentList><comment ref="B1" authorId="0"><text><t>補足</t></text></comment></commentList></comments>',
    },
  });
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '1'); assert.equal(sheet.cells.B1.value, '=A1+1'); assert.equal(sheet.cells.A2.value, '残存値');
  assert.equal(sheet.comments.B1.text, '補足'); assert.equal(sheet.comments.A1, undefined);
  assert.deepEqual(sheet.merges, [{ top: 3, left: 0, bottom: 3, right: 2 }]);
  assert.ok(result.warnings.some(item => item.code === 'adjusted' && item.message.includes('結合を解除')));
  assert.ok(result.warnings.some(item => item.code === 'omitted' && item.message.includes('1セル')));
  const roundtrip = (await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook))).workbook.sheets[0];
  for (const [address, cell] of Object.entries(sheet.cells)) assert.equal(roundtrip.cells[address].value, cell.value);
  assert.equal(roundtrip.cells.A2.format.numberFormat, 'text'); assert.deepEqual(roundtrip.merges, sheet.merges);
  assert.equal(roundtrip.comments.B1.text, '補足');
});

test('merge recovery does not accept overlapping, malformed, oversized or excessive merge metadata', async () => {
  for (const merges of ['<mergeCell ref="A1:B2"/><mergeCell ref="B2:C3"/>', '<mergeCell ref="B2:A1"/>', '<mergeCell ref="A1:A10001"/>', '<mergeCell ref="A1"/>'.repeat(1001)]) {
    await assert.rejects(read(`<sheetData/><mergeCells>${merges}</mergeCells>`));
  }
});

test('a comment without a residual value preserves the merge and relocates the comment with a warning', async () => {
  const result = await read('<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"/></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells>', {
    parts: {
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>',
      'xl/comments1.xml': '<comments><authors><author>Writer</author></authors><commentList><comment ref="B1" authorId="0"><text><t>補足</t></text></comment></commentList></comments>',
    },
  });
  const sheet = result.workbook.sheets[0];
  assert.deepEqual(sheet.merges, [{ top: 0, left: 0, bottom: 0, right: 1 }]);
  assert.equal(sheet.comments.A1.text, '補足'); assert.equal(sheet.comments.B1, undefined);
  assert.ok(result.warnings.some(item => item.message.includes('結合セルのコメントを左上')));
});

test('narrow worksheet sizes preserve explicit and default dimensions down to 1px', async () => {
  const result = await read('<sheetFormatPr defaultColWidth="2" defaultRowHeight="3"/><cols><col min="1" max="1" width="1"/><col min="2" max="2" width="0" hidden="1"/></cols><sheetData><row r="1" ht="0.75"><c r="A1"><v>1</v></c></row><row r="2" ht="0" hidden="1"/></sheetData>');
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.columnWidths[0], 7); assert.equal(sheet.columnWidths[1], 1); assert.equal(sheet.columnWidths[2], 14);
  assert.equal(sheet.rowHeights[0], 1); assert.equal(sheet.rowHeights[1], 1); assert.equal(sheet.rowHeights[2], 4);
  assert.ok(result.warnings.some(item => item.message.includes('非表示')));
  assert.ok(result.warnings.some(item => item.message.includes('サイズ')));
});
