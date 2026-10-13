import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export { importSpreadsheetXlsx } from './src/import/import-xlsx';
export { exportSpreadsheetXlsx } from './src/export/export-xlsx';
export { calculateWorkbook } from './src/model/formula';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, calculateWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const read = rows => importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: '共有数式', xml: `<sheetData>${rows}</sheetData>` }] })));
const masterRow = ref => `<row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="shared" si="0" ref="${ref}">A1*2</f><v>4</v></c></row>`;

test('shared formula metadata can span the Excel grid without expanding the model or dropping stored formulas', async () => {
  for (const ref of ['B1:B1048576', 'B1:XFD2']) {
    const result = await read(`${masterRow(ref)}<row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0"/><v>6</v></c></row>`);
    const sheet = result.workbook.sheets[0];
    assert.equal(sheet.cells.B1.value, '=A1*2');
    assert.equal(sheet.cells.B2.value, '=A2*2');
    assert.equal(calculateWorkbook(result.workbook)[sheet.id].B2, 6);
    assert.equal(sheet.rowCount, 300); assert.equal(sheet.columnCount, 26);
    assert.deepEqual(Object.keys(sheet.cells), ['A1', 'B1', 'A2', 'B2']);
    assert.equal(result.warnings.length, 0);
    const roundtrip = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
    assert.equal(roundtrip.workbook.sheets[0].cells.B2.value, '=A2*2');
  }
});

test('a dependent shared formula with its own text uses the master expression', async () => {
  const result = await read(`${masterRow('B1:B3')}<row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0">999</f><v>6</v></c></row><row r="3"><c r="A3"><v>4</v></c><c r="B3"><f t="shared" si="0">UNSUPPORTED()</f><v>8</v></c></row>`);
  const sheet = result.workbook.sheets[0], calculated = calculateWorkbook(result.workbook)[sheet.id];
  assert.equal(sheet.cells.B2.value, '=A2*2'); assert.equal(calculated.B2, 6);
  assert.equal(sheet.cells.B3.value, '=A3*2'); assert.equal(calculated.B3, 8);
  assert.equal(result.warnings.length, 0);
});

test('shared formula metadata still rejects malformed and out-of-Excel-grid references', async () => {
  for (const ref of ['B1:B1048577', 'B1:XFE2', 'B2:B1', 'B1:B2:B3', 'Other!B1:B2', ' B1:B2'])
    await assert.rejects(read(masterRow(ref)), /共有数式.*参照範囲/);
});

test('shared formula recovery never accepts actual populated cells beyond the model bounds', async () => {
  await assert.rejects(read(`${masterRow('B1:B1048576')}<row r="10001"><c r="B10001"><f t="shared" si="0"/><v>1</v></c></row>`), /シート「共有数式」のセル B10001/);
  await assert.rejects(read('<row r="1"><c r="A1"><f t="shared" si="0" ref="A1:XFD1">1</f><v>1</v></c><c r="ALM1"><f t="shared" si="0"/><v>1</v></c></row>'), /シート「共有数式」のセル ALM1/);
});

test('missing masters, repeated master definitions and followers outside their group still reject', async () => {
  await assert.rejects(read('<row r="1"><c r="B1"><f t="shared" si="0"/><v>1</v></c></row>'), /共有数式の元データ/);
  await assert.rejects(read(`${masterRow('B1:B2')}<row r="2"><c r="B2"><f t="shared" si="0" ref="B2:B3">2</f><v>2</v></c></row>`), /共有数式.*重複/);
  await assert.rejects(read(`${masterRow('B1:B2')}<row r="3"><c r="B3"><f t="shared" si="0">2</f><v>2</v></c></row>`), /共有数式の参照範囲/);
});
