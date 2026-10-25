import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  createSpreadsheetSession, SPREADSHEET_LIMITS } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const range = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const book = (cells = {}, extra = {}, workbook = {}) => normalizeWorkbook({ ...workbook, sheets: [
  { id: 'main', name: 'Main', rowCount: 8, columnCount: 8, cells, ...extra }, ...(workbook.sheets ?? []),
] });
const write = (extra = {}) => ({ type: 'cells.writeGrid', sheetId: 'main', target: { row: 1, column: 1 },
  headers: ['Owner', 'Value'], data: { type: 'rows', values: [['A', '1'], ['B', '2']] }, ...extra });
const success = result => { assert.equal(result.ok, true, result.message); return result; };
const first = result => success(result).workbook.sheets[0];
const value = (sheet, address) => sheet.cells[address]?.value;

test('omitted or none insertion retains overwrite behavior without increasing sheet dimensions', () => {
  const before = book({ B2: { value: 'replace' }, H8: { value: 'keep' } });
  const ordinary = success(apply(before, [write()])), explicit = success(apply(before, [write({ insert: 'none' })]));
  assert.equal(serializeWorkbook(ordinary.workbook), serializeWorkbook(explicit.workbook));
  assert.equal(first(ordinary).rowCount, 8); assert.equal(first(ordinary).columnCount, 8);
  assert.equal(value(first(ordinary), 'B2'), 'Owner'); assert.equal(value(first(ordinary), 'H8'), 'keep');
  assert.equal(value(before.sheets[0], 'B2'), 'replace');
});

test('row insertion opens full sheet rows including headers and shifts off-grid content and formula references', () => {
  const before = book({ A1: { value: 'above' }, B2: { value: 'existing' }, H2: { value: '=B2' }, H8: { value: 'last' } },
    { rowHeights: { 1: 37 }, columnWidths: { 1: 120 } }, { sheets: [
      { id: 'other', name: 'Other', rowCount: 8, columnCount: 8, cells: { A1: { value: '=Main!$B$2' } } },
    ] });
  const result = success(apply(before, [write({ insert: 'rows', onConflict: 'error' })])), after = first(result);
  assert.equal(after.rowCount, 11); assert.equal(after.columnCount, 8);
  assert.equal(value(after, 'B2'), 'Owner'); assert.equal(value(after, 'B5'), 'existing');
  assert.equal(value(after, 'H5'), '=B5'); assert.equal(value(after, 'H11'), 'last');
  assert.equal(value(after, 'A1'), 'above'); assert.equal(result.workbook.sheets[1].cells.A1.value, '=Main!$B$5');
  assert.deepEqual(after.rowHeights, { 4: 37 }); assert.deepEqual(after.columnWidths, { 1: 120 });
  assert.deepEqual(result.results[0].range, range(1, 1, 3, 2));
  assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 3 });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].write.changedCount, 6);
});

test('column insertion shifts whole columns even above and below the written data', () => {
  const before = book({ B1: { value: 'above' }, B2: { value: 'existing' }, H8: { value: '=B2' } },
    { columnWidths: { 1: 120, 7: 200 }, rowHeights: { 1: 37 } });
  const result = success(apply(before, [write({ insert: 'columns', onConflict: 'error' })])), after = first(result);
  assert.equal(after.rowCount, 8); assert.equal(after.columnCount, 10);
  assert.equal(value(after, 'D1'), 'above'); assert.equal(value(after, 'D2'), 'existing');
  assert.equal(value(after, 'J8'), '=D2'); assert.equal(value(after, 'C4'), '2');
  assert.deepEqual(after.columnWidths, { 3: 120, 9: 200 }); assert.deepEqual(after.rowHeights, { 1: 37 });
});

test('both-axis insertion retains names, comments, drawings, merge ranges, filters and cross-sheet references', () => {
  const cell = { value: '5', format: { bold: true }, validation: { type: 'number', min: 0, max: 10 } };
  const before = book({ B2: cell, H8: { value: '=B2' } }, {
    comments: { B2: { id: 'note', text: 'retained' } }, merges: [range(1, 1, 1, 2)],
    autoFilter: { range: range(4, 4, 6, 5), columns: [{ column: 4, values: ['yes'] }] },
    drawings: [{ id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 1, column: 1, offsetX: 2, offsetY: 3 },
      width: 120, height: 60, fill: '#ffffff', stroke: '#217346', strokeWidth: 2 }],
  }, { namedRanges: [{ id: 'name', name: 'Original', sheetId: 'main', range: range(1, 1, 1, 2) }] });
  const original = serializeWorkbook(before), result = success(apply(before, [write({ insert: 'both' })])), after = first(result);
  assert.equal(after.rowCount, 11); assert.equal(after.columnCount, 10);
  assert.deepEqual(after.cells.D5, before.sheets[0].cells.B2); assert.equal(value(after, 'J11'), '=D5');
  assert.deepEqual(after.comments.D5, before.sheets[0].comments.B2);
  assert.deepEqual(after.merges, [range(4, 3, 4, 4)]);
  assert.deepEqual(after.drawings[0].anchor, { row: 4, column: 3, offsetX: 2, offsetY: 3 });
  assert.deepEqual(after.autoFilter, { range: range(7, 6, 9, 7), columns: [{ column: 6, values: ['yes'] }] });
  assert.deepEqual(result.workbook.namedRanges[0].range, range(4, 3, 4, 4));
  assert.equal(serializeWorkbook(before), original);
});

test('hierarchical matrix footprints include both header axes and protruding holes before insertion', () => {
  const before = book({ B2: { value: 'shift with old sheet' } }, { merges: [range(1, 1, 1, 2)] });
  const result = success(apply(before, [write({ insert: 'both', headerLayout: 'protruding', rowHeaderLayout: 'protruding',
    headers: ['Fixed', { label: 'Group', children: ['Nested'] }],
    rowHeaders: ['First', { label: 'Area', children: ['Second'] }],
  })])), after = first(result);
  assert.equal(after.rowCount, 12); assert.equal(after.columnCount, 12);
  assert.equal(value(after, 'F6'), 'shift with old sheet'); assert.equal(value(after, 'D2'), undefined);
  assert.equal(value(after, 'D3'), 'Fixed'); assert.equal(value(after, 'E2'), 'Group');
  assert.equal(value(after, 'D4'), 'A'); assert.equal(value(after, 'C4'), 'First');
  assert.deepEqual(result.results[0].range, range(1, 1, 4, 4));
  assert.deepEqual(result.results[0].layout.dataRange, range(3, 3, 4, 4));
  assert.ok(after.merges.some(item => JSON.stringify(item) === JSON.stringify(range(5, 5, 5, 6))));
});

test('structured table insertion counts static numbering and relocates an existing table intact', () => {
  const initial = success(apply(book(), [write({ type: 'tables.insert', name: 'OldTable' })])).workbook;
  const oldTable = initial.sheets[0].tables[0];
  const result = success(apply(initial, [write({ type: 'tables.insert', name: 'NewTable', insert: 'both', rowNumbers: {} })]));
  const after = first(result), previous = after.tables.find(table => table.id === oldTable.id), created = after.tables.find(table => table.name === 'NewTable');
  assert.equal(after.rowCount, 11); assert.equal(after.columnCount, 11);
  assert.deepEqual(previous.range, range(4, 4, 6, 5)); assert.deepEqual(previous.columns, oldTable.columns);
  assert.deepEqual(created.range, range(1, 1, 3, 3)); assert.deepEqual(created.columns.map(item => item.name), ['No.', 'Owner', 'Value']);
  assert.equal(value(after, 'B3'), '1'); assert.equal(value(after, 'B4'), '2');
  assert.equal(result.results[0].tableId, created.id); assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 4 });
});

test('append targets are accepted only along inserted axes and headerless data starts exactly at target', () => {
  const emptyHeaders = { headers: undefined, data: { type: 'rows', values: [['A', '1']] } };
  for (const [insert, target, expected] of [
    ['rows', { row: 8, column: 0 }, [9, 8, 'A9']],
    ['columns', { row: 0, column: 8 }, [8, 10, 'I1']],
    ['both', { row: 8, column: 8 }, [9, 10, 'I9']],
  ]) {
    const result = success(apply(book(), [write({ ...emptyHeaders, insert, target })])), after = first(result);
    assert.equal(after.rowCount, expected[0]); assert.equal(after.columnCount, expected[1]);
    assert.equal(value(after, expected[2]), 'A'); assert.deepEqual(result.results[0].layout.dataRange, range(target.row, target.column, target.row, target.column + 1));
  }
  for (const [insert, target] of [['none', { row: 8, column: 0 }], ['rows', { row: 0, column: 8 }],
    ['columns', { row: 8, column: 0 }], ['both', { row: 9, column: 0 }], ['both', { row: 0, column: 9 }]]) {
    const failure = apply(book(), [write({ ...emptyHeaders, insert, target })]);
    assert.equal(failure.ok, false); assert.equal(failure.workbook, undefined);
  }
});

test('insertion requires the appropriate feature gates while ordinary writing keeps its existing permissions', () => {
  for (const [insert, features] of [['rows', { insertRows: false }], ['columns', { insertColumns: false }],
    ['both', { insertColumns: false }], ['both', { rowColumnOperations: false }], ['rows', { formatting: false }]]) {
    const result = apply(book(), [write({ insert })], { features });
    assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED'); assert.equal(result.workbook, undefined);
  }
  assert.equal(apply(book(), [write({ insert: 'none' })], { features: { insertRows: false, insertColumns: false } }).ok, true);
  assert.equal(apply(book(), [write({ insert: 'rows' })], { features: { insertColumns: false, tables: false } }).ok, true);
  assert.equal(apply(book(), [write({ type: 'tables.insert', name: 'Table1', insert: 'rows' })], { features: { tables: false } }).code, 'FEATURE_DISABLED');
});

test('invalid insertion modes, bounds and capacity failures do not publish earlier batch changes', () => {
  const before = book(), original = serializeWorkbook(before);
  for (const patch of [{ insert: null }, { insert: true }, { insert: 'down' }, { insert: {} },
    { insert: 'rows', target: { row: 1, column: 7 } }, { insert: 'columns', target: { row: 7, column: 1 } },
    { insert: 'both', target: { row: -1, column: 0 } }, { insert: 'both', target: { row: 0.5, column: 0 } }]) {
    const result = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { A1: 'staged' } }, write(patch)]);
    assert.equal(result.ok, false, JSON.stringify(patch)); assert.equal(result.commandIndex, 1); assert.equal(result.workbook, undefined);
    assert.equal(serializeWorkbook(before), original);
  }
  for (const [insert, extra] of [['rows', { rowCount: SPREADSHEET_LIMITS.rows }], ['columns', { columnCount: SPREADSHEET_LIMITS.columns }]]) {
    const source = book({}, extra), result = apply(source, [write({ insert })]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined);
  }
});

test('failures after structural insertion leave the session and its undo history untouched', () => {
  const before = book({ A1: { value: 'existing' } }), session = createSpreadsheetSession(before);
  const baseline = session.getWorkbook(), history = session.getHistoryState();
  for (const command of [
    write({ type: 'tables.insert', name: 'A1', insert: 'both' }),
    write({ insert: 'both', headerStyle: { background: 'bad; color: red' } }),
    write({ insert: 'both', headers: ['only one'] }),
  ]) {
    const result = session.execute(command); assert.equal(result.ok, false);
    assert.equal(session.getWorkbook(), baseline); assert.deepEqual(session.getHistoryState(), history);
  }
  const formulas = createSpreadsheetSession(before, { features: { formulas: false } });
  const failure = formulas.execute(write({ insert: 'both', data: { type: 'rows', values: [['A', '=1+2']] } }));
  assert.equal(failure.code, 'FEATURE_DISABLED'); assert.equal(formulas.getWorkbook().sheets[0].rowCount, 8);
  assert.equal(formulas.getHistoryState().undoCount, 0);
});

test('insertion inside an existing table body works, while column splits and expanded merged conflicts reject atomically', () => {
  const initial = success(apply(book(), [write({ type: 'tables.insert', name: 'Existing' })])).workbook;
  const body = success(apply(initial, [write({ insert: 'rows', target: { row: 2, column: 1 }, headers: undefined,
    data: { type: 'rows', values: [['Added', '3']] } })]));
  assert.deepEqual(first(body).tables[0].range, range(1, 1, 4, 2)); assert.equal(value(first(body), 'B3'), 'Added');
  assert.equal(value(first(body), 'B4'), 'A'); assert.equal(value(first(body), 'B5'), 'B');
  const split = apply(initial, [write({ insert: 'columns', target: { row: 1, column: 2 } })]);
  assert.equal(split.ok, false); assert.match(split.message, /テーブル内の列/); assert.equal(split.workbook, undefined);
  const merged = book({ B1: { value: 'merge' } }, { merges: [range(0, 1, 2, 1)] });
  const original = serializeWorkbook(merged), conflict = apply(merged, [write({ insert: 'rows' })]);
  assert.equal(conflict.ok, false); assert.match(conflict.message, /結合/); assert.equal(conflict.workbook, undefined);
  assert.equal(serializeWorkbook(merged), original);
});

test('insertion and writing produce one receipt and one reversible native-persisted edit', () => {
  const session = createSpreadsheetSession(book({ B2: { value: 'original' } })), before = session.getWorkbook();
  const result = success(session.execute(write({ insert: 'both' }))), after = session.getWorkbook();
  assert.equal(result.results.length, 1); assert.deepEqual(session.getHistoryState(), { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 });
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
  const saved = serializeWorkbook(after); assert.equal(serializeWorkbook(parseWorkbook(saved)), saved);
  assert.doesNotMatch(saved, /"insert":/);
});

test('row grouping composes with insertion and numbering without changing the caller data or group-key indices', () => {
  const command = write({ insert: 'rows', rowNumbers: { start: 5 }, rowGrouping: { byColumns: [0] },
    data: { type: 'rows', values: [['A', 'First'], ['A', 'Second'], ['B', 'Third']] } });
  const input = structuredClone(command), before = book({ B2: { value: 'keep below' } });
  const result = success(apply(before, [command])), after = first(result);
  assert.equal(after.rowCount, 12); assert.equal(value(after, 'B6'), 'keep below');
  assert.equal(value(after, 'B3'), '5'); assert.equal(value(after, 'B4'), '6'); assert.equal(value(after, 'B5'), '7');
  assert.equal(value(after, 'C3'), 'A'); assert.equal(value(after, 'C4'), ''); assert.equal(value(after, 'C5'), 'B');
  assert.equal(after.cells.C3.format.borders.bottom, undefined); assert.equal(after.cells.C4.format.borders.bottom.width, 1);
  assert.equal(after.cells.C5.format.borders.bottom, undefined); assert.deepEqual(command, input);
  assert.deepEqual(result.results[0].range, range(1, 1, 4, 3));
});
