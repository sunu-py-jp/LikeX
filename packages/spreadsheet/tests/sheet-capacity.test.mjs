import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './model-entry'; export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, serializeWorkbook, parseWorkbook, addSheet, calculateWorkbook, importSpreadsheetXlsx, exportSpreadsheetXlsx, SPREADSHEET_LIMITS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheet = (index, extra = {}) => ({ id: `s${index}`, name: `S${index}`, rowCount: 20, columnCount: 6,
  cells: { A1: { value: 'Header' }, A2: { value: String(index) }, B1: { value: '=A2*2' } }, ...extra });

test('a workbook holds up to 1,000 sheets and rejects the next one', () => {
  assert.equal(SPREADSHEET_LIMITS.sheets, 1000);
  const full = normalizeWorkbook({ sheets: Array.from({ length: 1000 }, (_, index) => sheet(index)) });
  assert.equal(full.sheets.length, 1000);
  assert.equal(calculateWorkbook(full).s999.B1, 1998);
  assert.equal(parseWorkbook(serializeWorkbook(full)).sheets.length, 1000);
  assert.throws(() => addSheet(full, 'One more'), /シート数の上限/);
  assert.throws(() => normalizeWorkbook({ sheets: Array.from({ length: 1001 }, (_, index) => sheet(index)) }), /1〜1,000枚/);
});

test('a full workbook with a comment, table and shape on every sheet survives an XLSX round trip', async () => {
  const workbook = normalizeWorkbook({ sheets: Array.from({ length: 1000 }, (_, index) => sheet(index, {
    comments: { A2: { id: `c${index}`, text: `note ${index}` } },
    tables: [{ id: `t${index}`, name: `Table${index}`, range: { top: 0, left: 0, bottom: 1, right: 0 }, columns: [{ id: `col${index}`, name: 'Header' }] }],
    drawings: [{ id: `d${index}`, type: 'shape', shape: 'rectangle', anchor: { row: 3, column: 1, offsetX: 0, offsetY: 0 },
      width: 60, height: 30, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }],
  })) });
  const bytes = new Uint8Array(await (await exportSpreadsheetXlsx(workbook)).arrayBuffer());
  // Each sheet adds its worksheet, relationships, drawing, comments and table parts to the archive.
  let entries = 0;
  for (let index = 0; index + 3 < bytes.length; index++)
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 1 && bytes[index + 3] === 2) entries++;
  assert.ok(entries > 4096, `the archive has ${entries} entries`);
  const result = await importSpreadsheetXlsx(bytes);
  assert.equal(result.workbook.sheets.length, 1000); assert.deepEqual(result.warnings, []);
  for (const index of [0, 499, 999]) {
    const imported = result.workbook.sheets[index];
    assert.equal(imported.name, `S${index}`); assert.equal(imported.cells.A2.value, String(index)); assert.equal(imported.cells.B1.value, '=A2*2');
    assert.equal(Object.values(imported.comments)[0].text, `note ${index}`);
    assert.equal(imported.tables[0].name, `Table${index}`); assert.equal(imported.drawings.length, 1);
  }
});
