import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/export/export-xlsx";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx: read, exportSpreadsheetXlsx: write } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const content = '<sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><f>A1+1</f><v>43</v></c></row></sheetData>';

test('missing optional relationships and malformed optional rels keep cell data; required data/path errors reject', async () => {
  for (const relationXml of [`<Relationships><Relationship Id="print" Type="${rel}printerSettings" Target="../printerSettings/missing.bin"/></Relationships>`, '<Relationships><broken>']) {
    const source = fixture({ sheets: [{ name: 'Data', xml: content }], parts: { 'xl/worksheets/_rels/sheet1.xml.rels': relationXml } });
    const result = await read(zip(source));
    assert.equal(result.workbook.sheets[0].cells.B1.value, '=A1+1');
    assert.ok(result.warnings.some(item => item.code === 'omitted'));
  }
  const missing = fixture(); delete missing['xl/worksheets/sheet1.xml'];
  await assert.rejects(read(zip(missing)), /必須の参照先/);
  const traversal = fixture({ parts: { 'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="bad" Type="${rel}printerSettings" Target="../../../escape"/></Relationships>` } });
  await assert.rejects(read(zip(traversal)), /パッケージ外/);
  const badWorkbook = fixture({ parts: { 'xl/_rels/workbook.xml.rels': '<Relationships><broken>' } });
  await assert.rejects(read(zip(badWorkbook)));
});

test('chartsheets omit only the graph sheet, preserve source IDs, and retain normal worksheet formulas on roundtrip', async () => {
  const source = fixture({ sheets: [{ name: 'Chart', xml: '' }, { name: 'Data', xml: content }] });
  source['xl/_rels/workbook.xml.rels'] = source['xl/_rels/workbook.xml.rels'].replace('relationships/worksheet', 'relationships/chartsheet');
  const result = await read(zip(source));
  assert.equal(result.workbook.sheets.length, 1); assert.equal(result.workbook.sheets[0].id, 'xlsx-sheet-2');
  assert.ok(result.warnings.some(item => item.sheetName === 'Chart' && item.message.includes('グラフ専用')));
  const restored = await read(await write(result.workbook));
  assert.equal(restored.workbook.sheets[0].cells.B1.value, '=A1+1');
  delete source['xl/worksheets/sheet1.xml'];
  const missingChart = await read(zip(source));
  assert.equal(missingChart.workbook.sheets.length, 1);
  assert.equal(missingChart.workbook.sheets[0].cells.B1.value, '=A1+1');
  assert.ok(missingChart.warnings.some(item => item.sheetName === 'Chart' && item.message.includes('参照先がない')));
});

test('unused shared strings do not trigger cell-count or cell-length limits, while referenced oversized strings reject', async () => {
  const parts = { 'xl/sharedStrings.xml': `<sst>${'<si><t>unused</t></si>'.repeat(100001)}<si><t>${'x'.repeat(100001)}</t></si><si><t>last</t></si></sst>` };
  const source = fixture({ sheets: [{ name: 'Data', xml: '<sheetData><row r="1"><c r="A1" t="s"><v>100002</v></c></row></sheetData>' }],
    parts, links: [{ id: 'strings', type: 'sharedStrings', target: 'sharedStrings.xml' }] });
  const result = await read(zip(source));
  assert.equal(result.workbook.sheets[0].cells.A1.value, 'last');
  source['xl/worksheets/sheet1.xml'] = source['xl/worksheets/sheet1.xml'].replace('<v>100002</v>', '<v>100001</v>');
  await assert.rejects(read(zip(source)), /セルの文字数/);
});

test('stored-cell budget prioritizes data in later sheets over empty formatting and skips validation without partial expansion', async () => {
  const rows = Array.from({ length: 101 }, (_, row) => `<row r="${row + 1}">${'<c s="1"/>'.repeat(1000)}</row>`).join('');
  const source = fixture({ sheets: [
    { name: 'Formatted', xml: `<sheetData>${rows}</sheetData><dataValidations><dataValidation type="whole" sqref="A200"><formula1>0</formula1><formula2>10</formula2></dataValidation></dataValidations>` },
    { name: 'Data', xml: content },
  ], links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }], parts: { 'xl/styles.xml': '<styleSheet><cellXfs><xf/><xf numFmtId="14"/></cellXfs></styleSheet>' } });
  const result = await read(zip(source));
  assert.equal(Object.keys(result.workbook.sheets[0].cells).length, 99998);
  assert.equal(result.workbook.sheets[0].cells.A200, undefined);
  assert.equal(result.workbook.sheets[1].cells.B1.value, '=A1+1');
  assert.equal(result.warnings.find(item => item.message.includes('空セルの書式')).count, 1002);
  assert.ok(result.warnings.some(item => item.message.includes('入力規則')));
});

test('actual cell data above the model budget still rejects instead of silently losing values', async () => {
  const rows = Array.from({ length: 100 }, (_, row) => `<row r="${row + 1}">${'<c><v>1</v></c>'.repeat(1000)}</row>`).join('');
  await assert.rejects(read(zip(fixture({ sheets: [{ name: 'Full', xml: `<sheetData>${rows}</sheetData>` }, { name: 'More', xml: content }] }))), /値・数式を持つセル数/);
});

test('invalid/excess names and namespace conflicts skip definitions while retaining table and cell data', async () => {
  const tableContent = content.replace('</row>', '<c r="C1" t="inlineStr"><is><t>One</t></is></c><c r="D1" t="inlineStr"><is><t>Two</t></is></c></row>');
  const source = fixture({ sheets: [{ name: 'Data', xml: tableContent + '<tableParts><tablePart id="table"/></tableParts>' }, { name: 'Other', xml: tableContent + '<tableParts><tablePart id="table"/></tableParts>' }],
    workbookExtra: `<definedNames><definedName name="DataTable">Data!A1</definedName>${Array.from({ length: 1001 }, (_, i) => `<definedName name="Named_${i}">Data!B1</definedName>`).join('')}</definedNames>`,
    parts: { 'xl/table.xml': '<table name="DataTable" ref="C1:D2"><tableColumns><tableColumn name="One"/><tableColumn name="Two"/></tableColumns></table>',
      ...Object.fromEntries([1, 2].map(i => [`xl/worksheets/_rels/sheet${i}.xml.rels`, `<Relationships><Relationship Id="table" Type="${rel}table" Target="../table.xml"/></Relationships>`])) } });
  const result = await read(zip(source));
  assert.equal(result.workbook.namedRanges.length, 1000);
  assert.equal(result.workbook.sheets[0].tables.length, 1); assert.equal(result.workbook.sheets[1].tables?.length ?? 0, 0);
  assert.equal(result.workbook.sheets[1].cells.B1.value, '=A1+1');
  assert.ok(result.warnings.some(item => item.message.includes('名前が重複するテーブル')));
  assert.ok(result.warnings.some(item => item.message.includes('名前付き範囲の上限')));
});
