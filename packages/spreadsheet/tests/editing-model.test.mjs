import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model';
export * from './src/model/editing/search'; export * from './src/model/editing/paste'; export * from './src/model/editing/fill';
export { formatCellValue } from './src/model/formatting'; export { duplicateSheetWithIds } from './src/model/workbook/sheets';
export { stageSpreadsheetCommands } from './src/commands/stage-spreadsheet-commands'; export { resolveSpreadsheetFeatures } from './src/api/resolve-features';
export { captureCopiedCells, prepareCellPaste } from './src/state/clipboard/cell-transfer';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'editing-model.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main', rowCount: 20, columnCount: 8, cells, ...extra }] });
const cell = (value, format, validation) => ({ value, ...(format ? { format } : {}), ...(validation ? { validation } : {}) });
const range = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const value = (workbook, address) => workbook.sheets[0].cells[address]?.value;
let sequence = 0;
const ids = () => `generated-${++sequence}`;
const execute = (workbook, commands, features) => m.stageSpreadsheetCommands(workbook, commands, m.resolveSpreadsheetFeatures(features), ids);

test('search supports sheet/workbook scope, literal metacharacters, case, and whole cell matching', () => {
  const workbook = m.normalizeWorkbook({ sheets: [
    { id: 'a', name: 'A', rowCount: 3, columnCount: 3, cells: { A1: cell('Alpha.*'), B1: cell('alpha'), A2: cell('ALPHA') } },
    { id: 'b', name: 'B', rowCount: 3, columnCount: 3, cells: { A1: cell('alpha') } },
  ] });
  assert.equal(m.findSpreadsheetCells(workbook, { text: 'alpha' }).length, 4);
  assert.equal(m.findSpreadsheetCells(workbook, { text: '.*' }).length, 1);
  assert.equal(m.findSpreadsheetCells(workbook, { text: 'alpha', wholeCell: true }).length, 3);
  assert.deepEqual(m.findSpreadsheetCells(workbook, { text: 'alpha', matchCase: true }, { sheetId: 'a' }).map(match => match.address), ['B1']);
  assert.deepEqual(m.findSpreadsheetCells(workbook, { text: '' }), []);
});

test('display search uses the shared currency/date formatter while formula search sees expressions', () => {
  const workbook = book({ A1: cell('1234', { numberFormat: 'currency' }), A2: cell('=2+3'), A3: cell('45292', { numberFormat: 'date' }) });
  const formatted = m.formatCellValue(1234, { numberFormat: 'currency' });
  assert.equal(m.findSpreadsheetCells(workbook, { text: formatted, wholeCell: true })[0].address, 'A1');
  assert.equal(m.findSpreadsheetCells(workbook, { text: '=2+3', lookIn: 'formulas' })[0].address, 'A2');
  assert.equal(m.findSpreadsheetCells(workbook, { text: '5', wholeCell: true })[0].address, 'A2');
  assert.equal(m.findSpreadsheetCells(workbook, { text: m.formatCellValue(45292, { numberFormat: 'date' }), wholeCell: true })[0].address, 'A3');
});

test('replace treats replacement dollar signs literally and display replacement does not activate formulas', () => {
  const workbook = book({ A1: cell('abc abc'), A2: cell('="abc"'), A3: cell("'00123") });
  const first = m.replaceSpreadsheetCells(workbook, 'main', { text: 'abc', lookIn: 'formulas' }, '$&');
  assert.equal(value(first, 'A1'), '$& $&');
  const second = m.replaceSpreadsheetCells(workbook, 'main', { text: 'abc' }, '=SUM(A1)', ['A2']);
  assert.equal(value(second, 'A2'), "'=SUM(A1)");
  assert.equal(m.calculateWorkbook(second).main.A2, '=SUM(A1)');
  const third = m.replaceSpreadsheetCells(workbook, 'main', { text: '3' }, '4', ['A3']);
  assert.equal(m.calculateWorkbook(third).main.A3, '00124');
});

test('paste values keeps calculated types and cannot turn a string result into executable formula text', () => {
  const workbook = book({ A1: cell('9') });
  const pasted = m.pasteSpreadsheetCells(workbook, 'main', { row: 1, column: 0 }, {
    values: [['=1+1', '="=SUM(A1)"', "'00123", 'TRUE']], displayedValues: [['2', '=SUM(A1)', '00123', 'true']],
    valueTypes: [['number', 'string', 'string', 'boolean']],
  }, 'values', { formulas: false, formatting: true });
  const calculated = m.calculateWorkbook(pasted).main;
  assert.equal(calculated.A2, 2); assert.equal(calculated.B2, '=SUM(A1)'); assert.equal(calculated.C2, '00123'); assert.equal(calculated.D2, true);
});

test('paste formulas translates relative references while formats-only retains values and target validation', () => {
  const workbook = book({ B3: cell('4', { italic: true }, { type: 'number', min: 0 }) });
  const payload = { values: [['=$A$1+A1']], formats: [[{ bold: true, wrap: true }]], source: { sheetId: 'main', row: 0, column: 0 } };
  const formulas = m.pasteSpreadsheetCells(workbook, 'main', { row: 1, column: 1 }, payload, 'formulas');
  assert.equal(value(formulas, 'B2'), '=$A$1+B2');
  const formats = m.pasteSpreadsheetCells(workbook, 'main', { row: 2, column: 1 }, payload, 'formats');
  assert.equal(value(formats, 'B3'), '4'); assert.equal(formats.sheets[0].cells.B3.format.bold, true);
  assert.equal(formats.sheets[0].cells.B3.format.italic, undefined); assert.equal(formats.sheets[0].cells.B3.validation.type, 'number');
});

test('copy-all replaces rule and value atomically; values-only honors the destination rule', () => {
  const workbook = book({ B1: cell('1', undefined, { type: 'number', min: 0 }) });
  const payload = { values: [['ok']], formats: [[undefined]], validations: [[{ type: 'list', values: ['ok'] }]] };
  const copied = m.pasteSpreadsheetCells(workbook, 'main', { row: 0, column: 1 }, payload, 'all');
  assert.equal(value(copied, 'B1'), 'ok'); assert.equal(copied.sheets[0].cells.B1.validation.type, 'list');
  assert.throws(() => m.pasteSpreadsheetCells(workbook, 'main', { row: 0, column: 1 }, payload, 'values'));
  assert.equal(value(workbook, 'B1'), '1');
});

test('autofill supports numeric sequences, copy, reverse extension, and relative/absolute formulas', () => {
  const workbook = book({ A3: cell('3'), A4: cell('5'), B1: cell('=$A$1+A1') });
  const down = m.fillSpreadsheetCells(workbook, 'main', range(2, 0, 3), range(0, 0, 6));
  assert.deepEqual(['A1', 'A2', 'A5', 'A6', 'A7'].map(address => value(down, address)), ['-1', '1', '7', '9', '11']);
  const repeated = m.fillSpreadsheetCells(workbook, 'main', range(2, 0, 3), range(2, 0, 5), 'copy');
  assert.deepEqual(['A5', 'A6'].map(address => value(repeated, address)), ['3', '5']);
  const formulas = m.fillSpreadsheetCells(workbook, 'main', range(0, 1), range(0, 1, 2));
  assert.equal(value(formulas, 'B3'), '=$A$1+A3');
});

test('autofill ISO dates crosses month, year and leap boundaries in both directions', () => {
  const workbook = book({ A2: cell('2024-02-28'), B2: cell('2026-12-31'), C1: cell('2026-09-30') });
  const leap = m.fillSpreadsheetCells(workbook, 'main', range(1, 0), range(0, 0, 3));
  assert.deepEqual(['A1', 'A3', 'A4'].map(address => value(leap, address)), ['2024-02-27', '2024-02-29', '2024-03-01']);
  assert.equal(value(m.fillSpreadsheetCells(workbook, 'main', range(1, 1), range(1, 1, 2)), 'B3'), '2027-01-01');
  assert.equal(value(m.fillSpreadsheetCells(workbook, 'main', range(0, 2), range(0, 2, 1)), 'C2'), '2026-10-01');
});

test('autofill preserves explicit identifiers and booleans, increments text suffixes, and copies a single number by default', () => {
  const workbook = book({ A1: cell("'00123"), B1: cell('TRUE'), C1: cell('項目01'), D1: cell('7') });
  const filled = m.fillSpreadsheetCells(workbook, 'main', range(0, 0, 0, 3), range(0, 0, 2, 3));
  assert.equal(value(filled, 'A3'), "'00123"); assert.equal(value(filled, 'B3'), 'TRUE');
  assert.equal(value(filled, 'C3'), '項目03'); assert.equal(value(filled, 'D3'), '7');
  assert.equal(value(m.fillSpreadsheetCells(workbook, 'main', range(0, 3), range(0, 3, 2), 'series'), 'D3'), '9');
});

test('autofill rejects ambiguous geometry, partial merges, disabled formulas and violated copied rules atomically', () => {
  const workbook = book({ A1: cell('1', undefined, { type: 'number', max: 2 }), A2: cell('2', undefined, { type: 'number', max: 2 }), B1: cell('=1') });
  assert.throws(() => m.fillSpreadsheetCells(workbook, 'main', range(0, 0, 1), range(0, 0, 2)));
  assert.throws(() => m.fillSpreadsheetCells(workbook, 'main', range(0, 0), range(0, 0, 1, 1)));
  assert.throws(() => m.fillSpreadsheetCells(workbook, 'main', range(0, 1), range(0, 1, 2), 'auto', { formulas: false, formatting: true, dataValidation: true }));
  assert.equal(value(workbook, 'A3'), undefined);
});

test('sheet duplication renews object IDs, keeps formats/rules, rewrites only self references and survives JSON', () => {
  const workbook = book({ A1: cell('2', { bold: true }, { type: 'number', min: 0 }), B1: cell("='Main'!A1+A1") }, {
    comments: { A1: { id: 'comment', text: 'note' } },
    drawings: [{ id: 'text', type: 'text', text: 'label', anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 40, fontSize: 12, color: '#000000', background: '#ffffff' }],
  });
  const duplicated = m.duplicateSheetWithIds(workbook, 'main', undefined, ids);
  const copy = duplicated.workbook.sheets[1];
  assert.equal(copy.name, 'Main (2)'); assert.notEqual(copy.id, 'main');
  assert.equal(copy.cells.B1.value, "='Main (2)'!A1+A1"); assert.equal(workbook.sheets[0].cells.B1.value, "='Main'!A1+A1");
  assert.notEqual(copy.comments.A1.id, 'comment'); assert.notEqual(copy.drawings[0].id, 'text');
  assert.deepEqual(copy.cells.A1.validation, workbook.sheets[0].cells.A1.validation);
  assert.equal(m.workbooksEqual(m.parseWorkbook(m.serializeWorkbook(duplicated.workbook)), duplicated.workbook), true);
  assert.equal(m.duplicateSheetWithIds(duplicated.workbook, 'main', undefined, ids).workbook.sheets[1].name, 'Main (3)');
});

test('new external command routes enforce feature flags and reject a failed batch without a partial result', () => {
  const workbook = book({ A1: cell('one') });
  for (const [command, feature] of [
    [{ type: 'cells.replace', sheetId: 'main', query: { text: 'one' }, replacement: 'two' }, 'replace'],
    [{ type: 'cells.fill', sheetId: 'main', source: range(0, 0), target: range(0, 0, 1) }, 'autoFill'],
    [{ type: 'cells.paste', sheetId: 'main', target: { row: 1, column: 0 }, payload: { values: [['two']] }, mode: 'values' }, 'pasteSpecial'],
    [{ type: 'sheets.duplicate', sheetId: 'main' }, 'duplicateSheet'],
  ]) assert.equal(execute(workbook, [command], { [feature]: false }).code, 'FEATURE_DISABLED');
  const failed = execute(workbook, [{ type: 'cells.replace', sheetId: 'main', query: { text: 'one' }, replacement: 'two' },
    { type: 'cells.fill', sheetId: 'main', source: range(0, 0), target: range(100, 0) }]);
  assert.equal(failed.ok, false); assert.equal(value(workbook, 'A1'), 'one');
});

test('checkbox policy prevents copied or filled rules from bypassing the setting feature', () => {
  const workbook = book({ A1: cell('TRUE', undefined, { type: 'checkbox' }), B1: cell('1') });
  const copied = m.pasteSpreadsheetCells(workbook, 'main', { row: 0, column: 1 }, { values: [['TRUE']], validations: [[{ type: 'checkbox' }]] }, 'all',
    { formulas: true, formatting: true, dataValidation: true, checkboxes: false });
  assert.equal(copied.sheets[0].cells.B1.validation, undefined);
  const filled = m.fillSpreadsheetCells(workbook, 'main', range(0, 0), range(0, 0, 1), 'auto',
    { formulas: true, formatting: true, dataValidation: true, checkboxes: false });
  assert.equal(filled.sheets[0].cells.A2.validation, undefined);
  assert.equal(workbook.sheets[0].cells.A1.validation.type, 'checkbox');
});

test('autofill retains zero padding and does not round large numeric-looking identifiers', () => {
  const workbook = book({ A1: cell('001'), A2: cell('002'), B1: cell('9007199254740993001'), B2: cell('9007199254740993002') });
  const filled = m.fillSpreadsheetCells(workbook, 'main', range(0, 0, 1, 1), range(0, 0, 3, 1));
  assert.equal(value(filled, 'A3'), '003'); assert.equal(value(filled, 'A4'), '004');
  assert.equal(value(filled, 'B3'), '9007199254740993001'); assert.equal(value(filled, 'B4'), '9007199254740993002');
});
