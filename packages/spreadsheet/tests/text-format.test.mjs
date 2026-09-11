import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: {
  contents: `export * from './src/model-entry'; export * from './src/model/formatting';
export * from './src/model/editing/fill'; export * from './src/model/editing/paste';
export * from './src/model/workbook/sheets'; export * from './src/export/xlsx/worksheet'; export * from './src/export/xlsx/styles';`,
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const textCell = (value, extra = {}) => ({ value, format: { numberFormat: 'text' }, ...extra });
const book = (cells = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Main', rowCount: 12, columnCount: 8, cells }] });
const range = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const calculate = workbook => m.calculateWorkbook(workbook).s;
const apply = (workbook, commands, features) => m.applySpreadsheetCommands(workbook, commands, { features });
const raw = (workbook, address) => workbook.sheets[0].cells[address]?.value;

test('text format keeps numeric identifiers, long integers, booleans and formula-like input as exact strings', () => {
  const values = ['00123', '123456789012345678901234567890', '=1+1', 'TRUE', 'false', '1e100', '2026-09-11', ' 00123 '];
  const workbook = book(Object.fromEntries(values.map((value, row) => [`A${row + 1}`, textCell(value)])));
  const calculated = calculate(workbook);
  values.forEach((value, row) => {
    assert.equal(calculated[`A${row + 1}`], value);
    assert.equal(m.formatCellValue(calculated[`A${row + 1}`], workbook.sheets[0].cells[`A${row + 1}`].format), value);
  });
  assert.equal(m.cellNumberFormatCode({ numberFormat: 'text', decimalPlaces: 2, negativeFormat: 'red' }), '@');
  assert.equal(m.formatCellValue(1234, { numberFormat: 'text' }), '1234');
});

test('apostrophe escaping, references and blank-cell behavior stay consistent in text format', () => {
  const workbook = book({ A1: textCell("'00123"), A2: textCell("''literal"), A3: textCell("'=1+1"),
    A4: textCell(''), B1: { value: '=A1' }, B2: { value: '=LEN(A1)' }, B3: { value: '=A3' },
    B4: { value: '=SUM(A1:A3)' }, B5: { value: '=COUNT(A1:A3)' } });
  assert.deepEqual({ ...calculate(workbook) }, { A1: '00123', A2: "'literal", A3: '=1+1', A4: '',
    B1: '00123', B2: 5, B3: '=1+1', B4: 0, B5: 0 });
});

test('format changes reinterpret preserved values and round-trip through JSON and headless history', () => {
  const original = book({ A1: { value: '00123' }, A2: { value: '=1+1' }, A3: { value: 'TRUE' } });
  const session = m.createSpreadsheetSession(m.parseWorkbook(m.serializeWorkbook(original)));
  const commands = JSON.parse('[{"type":"cells.format","sheetId":"s","addresses":["A1","A2","A3"],"format":{"numberFormat":"text"}}]');
  assert.equal(session.batch(commands).ok, true);
  assert.deepEqual({ ...calculate(session.getWorkbook()) }, { A1: '00123', A2: '=1+1', A3: 'TRUE' });
  assert.equal(session.getCell('s', 'A1').value, '00123');
  assert.equal(session.sheet('s').getCell('A2').format.numberFormat, 'text');
  assert.equal(m.getRange(session.getWorkbook(), 's', 'A1:A3')[2][0].value, 'TRUE');
  assert.equal(session.undo(), true);
  assert.deepEqual({ ...calculate(session.getWorkbook()) }, { A1: 123, A2: 2, A3: true });
  assert.equal(session.redo(), true);
  const saved = m.parseWorkbook(m.serializeWorkbook(session.getWorkbook()));
  const general = m.formatCells(saved, 's', ['A1', 'A2', 'A3'], { numberFormat: 'general' });
  assert.deepEqual({ ...calculate(general) }, { A1: 123, A2: 2, A3: true });
  assert.equal(raw(general, 'A1'), '00123');
  assert.equal(raw(general, 'A2'), '=1+1');
});

test('copy and fill preserve text formulas and identifiers without relative rewriting or numeric series', () => {
  const workbook = book({ A1: textCell('=A1'), B1: textCell('00123') });
  const payload = m.copySpreadsheetCells(workbook, 's', range(0, 0, 0, 1));
  assert.deepEqual(payload.valueTypes, [['string', 'string']]);
  const pasted = m.pasteSpreadsheetCells(workbook, 's', { row: 2, column: 2 }, payload, 'all', { formulas: false, formatting: true });
  assert.equal(raw(pasted, 'C3'), '=A1');
  assert.equal(calculate(pasted).C3, '=A1');
  assert.equal(calculate(pasted).D3, '00123');
  for (const mode of ['auto', 'copy', 'series']) {
    const filled = m.fillSpreadsheetCells(workbook, 's', range(0, 0, 0, 1), range(0, 0, 3, 1), mode,
      { formulas: false, formatting: true, dataValidation: true });
    assert.equal(raw(filled, 'A4'), '=A1');
    assert.equal(calculate(filled).B4, '00123');
  }
});

test('text transfers preserve string type even when destination formatting cannot be changed', () => {
  const workbook = book({ A1: textCell('=A1'), B1: textCell('00123'), C1: textCell("''literal") });
  const payload = m.copySpreadsheetCells(workbook, 's', range(0, 0, 0, 2));
  for (const mode of ['all', 'formulas', 'values']) {
    const pasted = m.pasteSpreadsheetCells(workbook, 's', { row: 2, column: 0 }, payload, mode, { formulas: false, formatting: false });
    assert.equal(calculate(pasted).A3, '=A1');
    assert.equal(calculate(pasted).B3, '00123');
    assert.equal(calculate(pasted).C3, "'literal");
  }
  const filled = m.fillSpreadsheetCells(workbook, 's', range(0, 0, 0, 2), range(0, 0, 2, 2), 'auto',
    { formulas: false, formatting: false, dataValidation: true });
  assert.equal(calculate(filled).A3, '=A1');
  assert.equal(calculate(filled).B3, '00123');
});

test('row/column edits, cut moves, sheet renames and duplication only rewrite real formulas', () => {
  const workbook = book({ A1: textCell('=A1'), B1: textCell('=Main!A1'), C1: { value: '=A1' } });
  const inserted = m.insertColumns(m.insertRows(workbook, 's', 0), 's', 0);
  assert.equal(raw(inserted, 'B2'), '=A1');
  assert.equal(raw(inserted, 'C2'), '=Main!A1');
  assert.equal(raw(inserted, 'D2'), '=B2');
  const removed = m.deleteColumns(m.deleteRows(inserted, 's', 0), 's', 0);
  assert.equal(raw(removed, 'B1'), '=Main!A1');
  const moved = apply(workbook, [{ type: 'cells.move', sheetId: 's', source: { sheetId: 's', ...range(0, 0) }, target: { row: 2, column: 0 } }], { formulas: false });
  assert.equal(moved.ok, true); assert.equal(raw(moved.workbook, 'A3'), '=A1');
  assert.equal(raw(moved.workbook, 'C1'), '=A3');
  assert.equal(raw(m.renameSheet(workbook, 's', 'Renamed'), 'B1'), '=Main!A1');
  let id = 0;
  const duplicate = m.duplicateSheetWithIds(workbook, 's', 'Copy', () => `new-${++id}`).workbook;
  assert.equal(duplicate.sheets[1].cells.B1.value, '=Main!A1');
  assert.equal(m.deleteSheet(duplicate, 's').sheets[0].cells.B1.value, '=Main!A1');
});

test('formula feature gates allow text inputs and refuse changing text into active formulas', () => {
  const original = book();
  const text = apply(original, [
    { type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { numberFormat: 'text' } },
    { type: 'cells.set', sheetId: 's', values: { a1: '=1+1' } },
  ], { formulas: false });
  assert.equal(text.ok, true); assert.equal(calculate(text.workbook).A1, '=1+1');
  const format = numberFormat => ({ type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { numberFormat } });
  assert.equal(apply(text.workbook, [format('general')], { formulas: false }).code, 'FEATURE_DISABLED');
  assert.equal(apply(text.workbook, [{ ...format('text'), format: { bold: true } }], { formulas: false }).ok, true);
  assert.equal(apply(text.workbook, [format('general')]).ok, true);
  const paste = { type: 'cells.paste', sheetId: 's', target: { row: 0, column: 0 }, mode: 'formats', payload: { values: [['']], formats: [[null]] } };
  assert.equal(apply(text.workbook, [paste], { formulas: false }).ok, false);
  assert.equal(raw(text.workbook, 'A1'), '=1+1');
  const external = { type: 'cells.paste', sheetId: 's', target: { row: 0, column: 0 }, payload: { values: [['=A9']] } };
  assert.equal(apply(text.workbook, [external], { formulas: false }).ok, true);
});

test('raw replacement and table writes respect destination text format when formulas are disabled', () => {
  const workbook = book({ A1: textCell('=A1'), A2: textCell('') });
  const replacement = apply(workbook, [{ type: 'cells.replace', sheetId: 's', query: { text: 'A1', lookIn: 'formulas' }, replacement: 'B2' }], { formulas: false });
  assert.equal(replacement.ok, true); assert.equal(calculate(replacement.workbook).A1, '=B2');
  const table = apply(workbook, [{ type: 'cells.writeTable', sheetId: 's', target: { row: 0, column: 0 }, headers: ['Text'], data: { type: 'rows', values: [['=1+1']] } }], { formulas: false });
  assert.equal(table.ok, true); assert.equal(calculate(table.workbook).A2, '=1+1');
});

test('persisted validation checks text-formatted formula-like values as strings', () => {
  const workbook = book({ A1: textCell('=A1', { validation: { type: 'list', values: ['=A1'] } }),
    A2: textCell('=1+1', { validation: { type: 'textLength', min: 4, max: 4 } }),
    A3: textCell('2026-09-11', { validation: { type: 'date' } }) });
  assert.equal(calculate(workbook).A1, '=A1');
  assert.equal(calculate(workbook).A2, '=1+1');
  assert.equal(m.effectiveCellFormat(workbook.sheets[0].cells.A3).numberFormat, 'text');
});

test('text-formatted table headers accept formula-like labels and keep table metadata and XLSX literal', () => {
  const inserted = apply(book(), [{ type: 'tables.insert', sheetId: 's', target: { row: 0, column: 0 },
    name: 'Records', headers: ['Header'], data: { type: 'rows', values: [['row']] } }]);
  assert.equal(inserted.ok, true);
  const edited = apply(inserted.workbook, [
    { type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { numberFormat: 'text' } },
    { type: 'cells.set', sheetId: 's', values: { A1: '=A1' } },
  ], { formulas: false });
  assert.equal(edited.ok, true);
  assert.equal(edited.workbook.sheets[0].tables[0].columns[0].name, '=A1');
  const saved = m.parseWorkbook(m.serializeWorkbook(edited.workbook));
  assert.equal(calculate(saved).A1, '=A1');
  const xml = m.worksheetXml(saved, saved.sheets[0], m.createXlsxStyles(saved), m.calculateWorkbook(saved));
  assert.match(xml, /t="inlineStr"><is><t xml:space="preserve">=A1<\/t>/);
  assert.doesNotMatch(xml, /<f>/);
  const invalid = apply(saved, [{ type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { numberFormat: 'general' } }]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /ヘッダには数式ではなく文字列/);
});

test('XLSX exports text format as @ and inline strings with no active formula elements', () => {
  const values = ['00123', '123456789012345678901234567890', '=1+1', 'TRUE', '=WEBSERVICE("https://example.test")', "'=A1"];
  const workbook = book(Object.fromEntries(values.map((value, row) => [`A${row + 1}`, textCell(value)])));
  const styles = m.createXlsxStyles(workbook);
  const xml = m.worksheetXml(workbook, workbook.sheets[0], styles, m.calculateWorkbook(workbook));
  assert.match(styles.xml, /formatCode="@"/);
  assert.doesNotMatch(xml, /<f>|<v>| t="b"/);
  assert.equal((xml.match(/t="inlineStr"/g) ?? []).length, values.length);
  assert.match(xml, />00123<\/t>/);
  assert.match(xml, />123456789012345678901234567890<\/t>/);
  assert.match(xml, />=A1<\/t>/);
  assert.match(xml, />TRUE<\/t>/);
});
