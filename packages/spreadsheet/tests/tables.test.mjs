import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/commands/apply-spreadsheet-commands';
export * from './src/model'; export * from './src/model/tables/data';`, resolveDir: new URL('../', import.meta.url).pathname,
  sourcefile: 'tables-test-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook, calculateWorkbook,
  parseTableDelimitedText } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main', rowCount: 20, columnCount: 10, cells, ...extra }] });
const write = (extra = {}) => ({ type: 'cells.writeTable', sheetId: 'main', target: { row: 1, column: 1 },
  headers: ['Product', 'Count'], data: { type: 'rows', values: [['Apple', '2'], ['Pear', '3']] }, ...extra });
const insert = (extra = {}) => write({ type: 'tables.insert', name: 'Orders', ...extra });
const cell = (result, address) => result.workbook.sheets[0].cells[address];
const succeeded = result => { assert.equal(result.ok, true, result.message); return result; };

test('bordered writes preserve unrelated formatting and publish no table metadata', () => {
  const before = book({ B2: { value: '', format: { bold: true, background: '#123456', numberFormat: 'currency' } } });
  const result = succeeded(apply(before, [write({ headerStyle: { background: '#ffeeaa', color: '#112233' } })]));
  assert.equal(result.workbook.sheets[0].tables, undefined);
  assert.equal(cell(result, 'B2').value, 'Product');
  assert.equal(cell(result, 'B2').format.bold, true);
  assert.equal(cell(result, 'B2').format.numberFormat, 'currency');
  assert.equal(cell(result, 'B2').format.background, '#ffeeaa');
  assert.equal(cell(result, 'B2').format.color, '#112233');
  assert.equal(cell(result, 'C4').value, '3');
  assert.equal(Object.keys(cell(result, 'C4').format.borders).length, 4);
  assert.equal(cell(result, 'C4').format.background, undefined);
  assert.equal(before.sheets[0].cells.B2.value, '');
  assert.deepEqual(result.results[0].range, { top: 1, left: 1, bottom: 3, right: 2 });
  assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 3 });
  assert.equal(result.results[0].write.changedCount, 6);
});

test('structured insertion persists definitions with stable identity and header text, including static numbering', () => {
  const result = succeeded(apply(book(), [insert({ rowNumbers: { start: 20, header: 'No.' } })]));
  const table = result.workbook.sheets[0].tables[0];
  assert.equal(result.results[0].tableId, table.id);
  assert.equal(table.name, 'Orders');
  assert.deepEqual(table.columns.map(column => column.name), ['No.', 'Product', 'Count']);
  assert.deepEqual(table.range, { top: 1, left: 1, bottom: 3, right: 3 });
  assert.equal(cell(result, 'B3').value, '20'); assert.equal(cell(result, 'B4').value, '21');
  assert.equal(serializeWorkbook(parseWorkbook(serializeWorkbook(result.workbook))), serializeWorkbook(result.workbook));
  assert.ok(Object.isFrozen(table)); assert.ok(Object.isFrozen(table.columns)); assert.ok(Object.isFrozen(table.columns[0]));
  const edited = succeeded(apply(result.workbook, [{ type: 'cells.set', sheetId: 'main', values: { C2: 'Item' } }]));
  assert.equal(edited.workbook.sheets[0].tables[0].columns[1].name, 'Item');
  assert.equal(edited.workbook.sheets[0].tables[0].columns[1].id, table.columns[1].id);
  assert.equal(table.columns[1].name, 'Product');
});

test('header labels are literal strings and an empty detail set remains a one-row table', () => {
  const labels = ['00123', '=SUM(A1)', "'quote", 'false'];
  const result = succeeded(apply(book(), [insert({ headers: labels, data: { type: 'rows', values: [] } })]));
  const calculated = calculateWorkbook(result.workbook).main;
  assert.deepEqual(['B2', 'C2', 'D2', 'E2'].map(address => calculated[address]), labels);
  assert.deepEqual(result.workbook.sheets[0].tables[0].columns.map(column => column.name), labels);
  assert.deepEqual(result.results[0].range, { top: 1, left: 1, bottom: 1, right: 4 });
});

test('CSV and TSV parsing supports escaped quotes, quoted separators and CRLF within values', () => {
  assert.deepEqual(parseTableDelimitedText('"A,B","a""b"\r\n"two\r\nlines",\r\n', ','), [['A,B', 'a"b'], ['two\r\nlines', '']]);
  assert.deepEqual(parseTableDelimitedText('"A\tB"\t"two\nlines"\n', '\t'), [['A\tB', 'two\nlines']]);
  assert.deepEqual(parseTableDelimitedText('', ','), []);
  assert.deepEqual(parseTableDelimitedText('\ufeff"Apple",2\r\n', ','), [['Apple', '2']]);
  const result = succeeded(apply(book(), [insert({ data: { type: 'csv', text: '"Red, apple",2\r\nPear,3\r\n' } })]));
  assert.equal(cell(result, 'B3').value, 'Red, apple');
  for (const text of ['"unterminated', '"closed"extra,2', 'mis"placed,2']) assert.throws(() => parseTableDelimitedText(text, ','), /引用符/);
});

test('write conflicts are atomic and skip preserves existing values and formats cell by cell', () => {
  const before = book({ B3: { value: 'Existing', format: { bold: true, background: '#abcdef' } } });
  const failure = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { J20: 'staged' } }, write({ onConflict: 'error' })]);
  assert.equal(failure.ok, false); assert.equal(failure.code, 'WRITE_CONFLICT');
  assert.equal(failure.workbook, undefined); assert.equal(before.sheets[0].cells.J20, undefined);
  const result = succeeded(apply(before, [write({ onConflict: 'skip' })]));
  assert.deepEqual(cell(result, 'B3'), before.sheets[0].cells.B3);
  assert.equal(cell(result, 'C3').value, '2');
  assert.deepEqual(result.results[0].write, { changedCount: 5, skippedCount: 1, skippedAddresses: ['B3'] });
  assert.equal(cell(succeeded(apply(before, [write()])), 'B3').value, 'Apple');
});

test('structured skip rejects mismatched headers and permits matching headers plus mixed detail cells', () => {
  const before = book({ B2: { value: 'Different' }, B3: { value: 'Existing' } });
  const failure = apply(before, [insert({ onConflict: 'skip' })]);
  assert.equal(failure.ok, false); assert.equal(failure.code, 'WRITE_CONFLICT');
  const matching = book({ B2: { value: 'Product' }, B3: { value: 'Existing' } });
  const result = succeeded(apply(matching, [insert({ onConflict: 'skip' })]));
  assert.equal(result.workbook.sheets[0].tables[0].columns[0].name, 'Product');
  assert.equal(cell(result, 'B3').value, 'Existing');
  assert.equal(cell(result, 'C3').value, '2');
  assert.deepEqual(result.results[0].write.skippedAddresses, ['B3']);
});

test('invalid headers, sparse/ragged matrices, excessive areas and bad configuration cannot partially write', () => {
  const invalid = [
    { headers: ['Product', 'product'] }, { headers: ['', 'Count'] }, { headers: ['two\nlines', 'Count'] },
    { headers: new Array(2) }, { data: { type: 'rows', values: [new Array(2)] } },
    { data: { type: 'rows', values: new Array(1) } }, { data: { type: 'rows', values: [['only-one']] } },
    { rowNumbers: { start: Number.MAX_SAFE_INTEGER } }, { rowNumbers: { header: 'Product' } },
    { target: { row: 19, column: 0 } }, { headerStyle: { bold: true } },
    { data: { type: 'csv', text: 'only-one' } }, { onConflict: 'unknown' },
  ];
  for (const patch of invalid) {
    const result = apply(book(), [insert(patch)]);
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.equal(result.workbook, undefined);
  }
  const huge = normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main', cells: {}, rowCount: 10000, columnCount: 10 }] });
  assert.equal(apply(huge, [insert({ data: { type: 'rows', values: Array.from({ length: 4999 }, () => ['', '']) }, rowNumbers: {} })]).ok, false);
  const wide = normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main', cells: {}, rowCount: 10, columnCount: 200 }] });
  assert.equal(apply(wide, [write({ headers: Array(106).fill('x'.repeat(100000)), data: { type: 'rows', values: [] } })]).ok, false);
});

test('merged intersections and existing tables are never silently replaced by overwrite', () => {
  const merged = book({}, { merges: [{ top: 2, left: 1, bottom: 2, right: 2 }] });
  assert.equal(apply(merged, [insert()]).ok, false);
  assert.equal(apply(merged, [write()]).ok, false);
  const initial = succeeded(apply(book(), [insert()])).workbook;
  assert.equal(apply(initial, [insert({ name: 'Second' })]).ok, false);
  assert.equal(apply(initial, [{ type: 'cells.merge', sheetId: 'main', range: { top: 1, left: 1, bottom: 1, right: 2 }, discardContent: true }]).ok, false);
  assert.equal(apply(initial, [{ type: 'cells.set', sheetId: 'main', values: { B2: '', C2: '' } }]).ok, false);
});

test('table names share the workbook namespace with names and other tables', () => {
  const input = { ...book(), namedRanges: [{ id: 'named', name: 'orders', sheetId: 'main', range: { top: 0, left: 0, bottom: 0, right: 0 } }] };
  assert.equal(apply(input, [insert()]).ok, false);
  for (const name of ['A1', 'R', 'two words', '_LikeX_list_1']) assert.equal(apply(book(), [insert({ name })]).ok, false);
  const initial = succeeded(apply(book(), [insert()])).workbook;
  assert.equal(apply(initial, [insert({ name: 'orders', target: { row: 7, column: 1 } })]).ok, false);
});

test('deleting a table can preserve cells, clear values, or remove cell records and honors feature guards', () => {
  const initial = succeeded(apply(book(), [insert()])).workbook, table = initial.sheets[0].tables[0];
  const remove = clear => ({ type: 'tables.delete', sheetId: 'main', tableId: table.id, ...(clear ? { clear } : {}) });
  const retained = succeeded(apply(initial, [remove()]));
  assert.equal(retained.workbook.sheets[0].tables, undefined); assert.deepEqual(cell(retained, 'B2'), initial.sheets[0].cells.B2);
  const values = succeeded(apply(initial, [remove('values')]));
  assert.equal(cell(values, 'B2').value, ''); assert.deepEqual(cell(values, 'B2').format, initial.sheets[0].cells.B2.format);
  const all = succeeded(apply(initial, [remove('all')]));
  assert.equal(cell(all, 'B2'), undefined); assert.deepEqual(all.results[0].range, table.range);
  assert.equal(apply(initial, [remove('all')], { features: { formatting: false } }).code, 'FEATURE_DISABLED');
  assert.equal(apply(initial, [remove()], { features: { tables: false } }).code, 'FEATURE_DISABLED');
  assert.equal(apply(initial, [remove('unknown')]).ok, false);
});

test('table creation observes formulas, formatting and table feature switches without affecting literal headers', () => {
  for (const features of [{ tables: false }, { formatting: false }])
    assert.equal(apply(book(), [insert()], { features }).code, 'FEATURE_DISABLED');
  assert.equal(apply(book(), [insert({ data: { type: 'rows', values: [['Apple', '=1+2']] } })], { features: { formulas: false } }).code, 'FEATURE_DISABLED');
  assert.equal(apply(book(), [insert({ headers: ['=label', 'Count'] })], { features: { formulas: false } }).ok, true);
});
