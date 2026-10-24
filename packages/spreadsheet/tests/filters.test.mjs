import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model';
export * from './src/commands/apply-spreadsheet-commands'; export * from './src/session/create-spreadsheet-session';
export * from './src/model/filters';`, resolveDir: new URL('../', import.meta.url).pathname,
  sourcefile: 'filters-test-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook, calculateWorkbook,
  resolveSpreadsheetFilterRange, getSpreadsheetFilterValues: choices, getSpreadsheetFilteredRows: hidden,
  normalizeSpreadsheetAutoFilter, getSheet, workbooksEqual, createSpreadsheetSession } =
  await import(`data:text/javascript;base64,${Buffer.from(`${output.outputFiles[0].text}\n//# sourceURL=filters-test-bundle.mjs`).toString('base64')}`);

const range = { top: 1, left: 1, bottom: 5, right: 3 };
const values = { B2: 'Region', C2: 'Item', D2: 'Amount', B3: 'East', C3: 'Apple', D3: '10',
  B4: 'West', C4: 'Pear', D4: '20', B5: 'East', C5: 'Pear', D5: '30', B6: 'West', D6: '40' };
const book = (extra = {}, cells = values) => normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main', rowCount: 20,
  columnCount: 8, cells: Object.fromEntries(Object.entries(cells).map(([address, value]) => [address, { value }])), ...extra }] });
const succeeded = result => { assert.equal(result.ok, true, result.message); return result; };
const run = (workbook, commands, options) => succeeded(apply(workbook, commands, options)).workbook;
const set = (extra = {}) => ({ type: 'filters.setRange', sheetId: 'main', range, ...extra });
const select = (column, values) => ({ type: 'filters.setValues', sheetId: 'main', column, values });
const filtered = (...criteria) => run(book(), [set(), ...criteria]);

test('header-only ranges extend to the last nonempty value/formula in selected columns, not formatting or other columns', () => {
  const sheet = normalizeWorkbook({ sheets: [{ ...book().sheets[0], cells: { ...book().sheets[0].cells,
    C10: { value: '=IF(1,"","")' }, B19: { value: '', format: { bold: true } }, A20: { value: 'outside' } } }] }).sheets[0];
  const header = { top: 1, bottom: 1, left: 1, right: 3 };
  assert.deepEqual(resolveSpreadsheetFilterRange(sheet, header), { ...header, bottom: 9 });
  assert.deepEqual(resolveSpreadsheetFilterRange(sheet, header, false), header);
  assert.deepEqual(resolveSpreadsheetFilterRange(sheet, range), range);
  assert.deepEqual(resolveSpreadsheetFilterRange(sheet, range, true), { ...range, bottom: 9 });
  const empty = book({}, {}).sheets[0];
  assert.deepEqual(resolveSpreadsheetFilterRange(empty, header), header);
});

test('commands persist immutable filters and distinct criteria; equivalent commands are no-ops', () => {
  const before = book(), input = ['West', 'East', 'East'];
  const result = succeeded(apply(before, [set(), select(1, input)]));
  const filter = result.workbook.sheets[0].autoFilter;
  assert.equal(before.sheets[0].autoFilter, undefined);
  assert.deepEqual(filter, { range, columns: [{ column: 1, values: ['East', 'West'] }] });
  assert.ok(Object.isFrozen(filter)); assert.ok(Object.isFrozen(filter.range));
  assert.ok(Object.isFrozen(filter.columns)); assert.ok(Object.isFrozen(filter.columns[0].values));
  input.push('South'); assert.deepEqual(filter.columns[0].values, ['East', 'West']);
  assert.equal(succeeded(apply(result.workbook, [select(1, ['West', 'East'])])).changed, false);
  const json = serializeWorkbook(result.workbook), restored = parseWorkbook(json);
  assert.equal(serializeWorkbook(restored), json);
  assert.deepEqual(getSheet(restored, 'main').autoFilter, filter);
  assert.ok(workbooksEqual(restored, result.workbook));
});

test('values combine with OR within columns and AND across columns without changing raw cells or row heights', () => {
  const workbook = filtered(select(1, ['East']), select(2, ['Pear', 'Apple'])), sheet = workbook.sheets[0];
  assert.deepEqual([...hidden(sheet)], [3, 5]);
  assert.deepEqual(choices(sheet, 1), ['East', 'West']);
  assert.deepEqual(choices(sheet, 2), ['Apple', 'Pear']);
  assert.equal(sheet.cells.D4.value, '20'); assert.equal(sheet.rowHeights, undefined);
  const narrowed = run(workbook, [select(2, ['Pear'])]).sheets[0];
  assert.deepEqual([...hidden(narrowed)], [2, 3, 5]);
  assert.equal(hidden(narrowed).has(range.top), false);
  assert.equal(hidden(narrowed).has(0), false); assert.equal(hidden(narrowed).has(6), false);
});

test('blank, no-selection, reset-column, clear, and remove have distinct semantics', () => {
  const workbook = filtered(select(2, ['']));
  assert.deepEqual([...hidden(workbook.sheets[0])], [2, 3, 4]);
  assert.deepEqual([...hidden(run(workbook, [select(2, [])]).sheets[0])], [2, 3, 4, 5]);
  assert.equal(hidden(run(workbook, [select(2, null)]).sheets[0]).size, 0);
  const cleared = run(workbook, [{ type: 'filters.clear', sheetId: 'main' }]);
  assert.deepEqual(cleared.sheets[0].autoFilter, { range });
  const removed = run(workbook, [{ type: 'filters.remove', sheetId: 'main' }]);
  assert.equal(removed.sheets[0].autoFilter, undefined);
  assert.equal(succeeded(apply(removed, [{ type: 'filters.remove', sheetId: 'main' }])).changed, false);
});

test('matching and choices ignore case while stored criterion spelling is retained', () => {
  const workbook = run(book({}, { B2: 'Item', B3: 'Apple', B4: 'APPLE', B5: 'pear', B6: 'Pear' }),
    [set({ range: { ...range, right: 1 } }), select(1, ['aPpLe'])]);
  assert.deepEqual(choices(workbook.sheets[0], 1), ['Apple', 'pear']);
  assert.deepEqual([...hidden(workbook.sheets[0])], [4, 5]);
  assert.deepEqual(workbook.sheets[0].autoFilter.columns[0].values, ['aPpLe']);
});

test('formatted numbers, booleans, formulas, escaped text and cross-sheet calculations match displayed strings', () => {
  const source = book().sheets[0];
  const workbook = normalizeWorkbook({ sheets: [{ ...source, cells: {
    B2: { value: 'Header' }, B3: { value: '0.5', format: { numberFormat: 'percent' } },
    B4: { value: '=Other!A1', format: { numberFormat: 'currency', useGrouping: false } },
    B5: { value: 'TRUE' }, B6: { value: "'001" } }, autoFilter: { range: { ...range, right: 1 } } },
    { id: 'other', name: 'Other', rowCount: 1, columnCount: 1, cells: { A1: { value: '1000' } } }] });
  const sheet = workbook.sheets[0], calculated = calculateWorkbook(workbook).main;
  assert.deepEqual(choices(sheet, 1, calculated), ['50%', '￥1000', 'TRUE', '001']);
  const next = run(workbook, [select(1, ['50%', '￥1000'])]).sheets[0];
  assert.deepEqual([...hidden(next, calculated)], [4, 5]);
  assert.deepEqual(choices(book({}, { B2: 'Header', B3: '=1+2' }).sheets[0], 1), []);
  const local = run(book({}, { B2: 'Header', B3: '=1+2' }), [set()]).sheets[0];
  assert.deepEqual(choices(local, 1), ['3', '']);
});

test('invalid settings reject atomically and disabled feature prevents all filter mutations', () => {
  const before = book(), serialized = serializeWorkbook(before);
  for (const command of [set({ range: { ...range, bottom: 20 } }), set({ range: { ...range, left: -1 } }),
    set({ range: { ...range, top: 1.5 } }), set({ inferRows: 'yes' }), select(1, ['East']),
    { type: 'filters.setRange', sheetId: 'main', range, unknown: true }]) {
    const result = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { A1: 'staged' } }, command]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
    assert.equal(serializeWorkbook(before), serialized);
  }
  const workbook = filtered();
  for (const command of [select(0, null), select(9, []), select(1, [1]), select(1, undefined)])
    assert.equal(apply(workbook, [command]).ok, false);
  for (const command of [set(), select(1, ['East']), { type: 'filters.clear', sheetId: 'main' }, { type: 'filters.remove', sheetId: 'main' }])
    assert.equal(apply(workbook, [command], { features: { filters: false } }).code, 'FEATURE_DISABLED');
  for (const autoFilter of [{ range, columns: [{ column: 1, values: [] }, { column: 1, values: ['x'] }] },
    { range, columns: [{ column: 0, values: ['x'] }] }, { range, extra: true }, { range, columns: [null] }])
    assert.throws(() => normalizeSpreadsheetAutoFilter(autoFilter, before.sheets[0]));
});

test('row/column insertions shift filters and criteria, deletions shrink them or remove deleted headers', () => {
  const workbook = filtered(select(2, ['Pear']));
  const changed = run(workbook, [{ type: 'rows.insert', sheetId: 'main', index: 1, count: 2 },
    { type: 'columns.insert', sheetId: 'main', index: 2 }]).sheets[0];
  assert.deepEqual(changed.autoFilter, { range: { top: 3, bottom: 7, left: 1, right: 4 }, columns: [{ column: 3, values: ['Pear'] }] });
  const deleted = run(workbook, [{ type: 'rows.delete', sheetId: 'main', index: 3 }, { type: 'columns.delete', sheetId: 'main', index: 2 }]).sheets[0];
  assert.deepEqual(deleted.autoFilter, { range: { ...range, bottom: 4, right: 2 } });
  assert.equal(run(workbook, [{ type: 'rows.delete', sheetId: 'main', index: 1 }]).sheets[0].autoFilter, undefined);
  assert.equal(run(workbook, [{ type: 'columns.delete', sheetId: 'main', index: 1, count: 3 }]).sheets[0].autoFilter, undefined);
});

test('partial cell shifts and cuts reject filter splits; complete shifts and moves preserve metadata', () => {
  const workbook = filtered(select(2, ['Pear']));
  for (const command of [
    { type: 'cells.insert', sheetId: 'main', range: 'C4', shift: 'down' },
    { type: 'cells.delete', sheetId: 'main', range: 'C4', shift: 'left' },
    { type: 'cells.move', sheetId: 'main', source: { sheetId: 'main', top: 2, bottom: 2, left: 1, right: 3 }, target: { row: 8, column: 1 } },
  ]) { const result = apply(workbook, [command]); assert.equal(result.ok, false); assert.match(result.message, /フィルター範囲/); }
  const shifted = run(workbook, [{ type: 'cells.insert', sheetId: 'main', range: 'B4:D4', shift: 'down' }]);
  assert.deepEqual(shifted.sheets[0].autoFilter.range, { ...range, bottom: 6 });
  const moved = run(workbook, [{ type: 'cells.move', sheetId: 'main', source: { ...range, sheetId: 'main' }, target: { row: 8, column: 2 } }]);
  assert.deepEqual(moved.sheets[0].autoFilter, { range: { top: 8, bottom: 12, left: 2, right: 4 }, columns: [{ column: 3, values: ['Pear'] }] });
});

test('sheet duplication retains filter state in a detached public snapshot', () => {
  const workbook = filtered(select(2, ['Pear']));
  const duplicated = run(workbook, [{ type: 'sheets.duplicate', sheetId: 'main' }]);
  assert.deepEqual(duplicated.sheets[1].autoFilter, workbook.sheets[0].autoFilter);
  const snapshot = getSheet(duplicated, duplicated.sheets[1].id);
  assert.notEqual(snapshot.autoFilter, workbook.sheets[0].autoFilter);
  assert.ok(Object.isFrozen(snapshot.autoFilter.columns[0].values));
});

test('a complete cross-sheet cut transfers the sole filter and rejects an existing destination filter', () => {
  const source = filtered(select(2, ['Pear']));
  const workbook = normalizeWorkbook({ sheets: [...source.sheets,
    { id: 'other', name: 'Other', rowCount: 20, columnCount: 10, cells: {} }] });
  const command = { type: 'cells.move', sheetId: 'other', source: { ...range, sheetId: 'main' }, target: { row: 3, column: 2 } };
  const moved = run(workbook, [command]);
  assert.equal(moved.sheets[0].autoFilter, undefined);
  assert.deepEqual(moved.sheets[1].autoFilter, { range: { top: 3, bottom: 7, left: 2, right: 4 }, columns: [{ column: 3, values: ['Pear'] }] });
  assert.deepEqual([...hidden(moved.sheets[1])], [4, 7]);
  const occupied = run(workbook, [{ type: 'filters.setRange', sheetId: 'other', range: { top: 0, bottom: 1, left: 0, right: 0 } }]);
  const result = apply(occupied, [command]);
  assert.equal(result.ok, false); assert.match(result.message, /移動先のフィルター/);
  assert.equal(result.workbook, undefined); assert.ok(workbooksEqual(occupied, parseWorkbook(serializeWorkbook(occupied))));
});

test('a one-row filter has no detail rows and vertical merges do not prevent reading metadata', () => {
  const workbook = normalizeWorkbook({ sheets: [{ ...book({}, {}).sheets[0],
    merges: [{ top: 2, bottom: 3, left: 5, right: 5 }] }] });
  const filtered = run(workbook, [set({ range: { top: 1, bottom: 1, left: 1, right: 3 }, inferRows: false }), select(1, [])]);
  assert.equal(hidden(filtered.sheets[0]).size, 0);
  assert.deepEqual(choices(filtered.sheets[0], 1), []);
});

test('worksheet filters and tables reject overlap in either creation order, normalization, and native parsing', () => {
  const insertTable = { type: 'tables.insert', sheetId: 'main', name: 'Products', target: { row: 1, column: 1 },
    headers: ['Region', 'Item', 'Amount'], data: { type: 'rows', values: [['East', 'Apple', '10'], ['West', 'Pear', '20']] } };
  const withTable = run(book({}, {}), [insertTable]);
  for (const area of [range, { top: 3, bottom: 6, left: 3, right: 4 }]) {
    const result = apply(withTable, [set({ range: area })]);
    assert.equal(result.ok, false); assert.match(result.message, /フィルター範囲.*テーブル/);
    assert.equal(result.workbook, undefined);
  }
  const initial = filtered(select(2, ['Pear'])), serialized = serializeWorkbook(initial);
  const insertion = apply(initial, [{ type: 'cells.set', sheetId: 'main', values: { A1: 'staged' } }, insertTable]);
  assert.equal(insertion.ok, false); assert.match(insertion.message, /フィルター範囲/);
  assert.equal(serializeWorkbook(initial), serialized);
  assert.throws(() => normalizeWorkbook({ ...withTable, sheets: [{ ...withTable.sheets[0], autoFilter: { range } }] }), /フィルター範囲/);
  const file = JSON.parse(serializeWorkbook(withTable)); file.sheets[0].autoFilter = { range };
  assert.throws(() => parseWorkbook(JSON.stringify(file)), /フィルター範囲/);
  for (const area of [{ top: 4, bottom: 5, left: 1, right: 3 }, { top: 1, bottom: 3, left: 4, right: 5 }])
    assert.deepEqual(run(withTable, [set({ range: area })]).sheets[0].autoFilter.range, area);
});

test('table/filter moves cannot create overlap and clearing the filter permits the same table insertion', () => {
  const insert = { type: 'tables.insert', sheetId: 'main', name: 'Adjacent', target: { row: 8, column: 1 },
    headers: ['Name', 'Value'], data: { type: 'rows', values: [['Apple', '10']] } };
  const initial = run(filtered(), [insert]);
  const result = apply(initial, [{ type: 'cells.move', sheetId: 'main',
    source: { sheetId: 'main', top: 8, bottom: 9, left: 1, right: 2 }, target: { row: 2, column: 1 } }]);
  assert.equal(result.ok, false); assert.match(result.message, /フィルター/);
  const next = run(initial, [{ type: 'filters.remove', sheetId: 'main' },
    { ...insert, name: 'Inside', target: { row: 1, column: 1 } }]);
  assert.equal(next.sheets[0].tables.length, 2);
});

test('session filters participate in undo/redo, conditional guards, and revisions', () => {
  const session = createSpreadsheetSession(book());
  const before = session.getWorkbook();
  const result = session.batch([set(), select(1, ['East'])]);
  assert.equal(result.ok, true); assert.equal(session.getWorkbook().sheets[0].autoFilter.columns[0].values[0], 'East');
  session.undo(); assert.ok(workbooksEqual(session.getWorkbook(), before));
  session.redo(); assert.ok(session.getWorkbook().sheets[0].autoFilter);
  assert.equal(apply(session.getWorkbook(), [{ type: 'filters.clear', sheetId: 'main' }], { expected: { workbook: before } }).code, 'PRECONDITION_FAILED');
});
