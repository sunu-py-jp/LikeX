import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { createSpreadsheetSession, copySpreadsheetCells, normalizeWorkbook, SPREADSHEET_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const input = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 2, columnCount: 2,
  cells: { A1: { value: 'first' }, B2: { value: 'last' } } }] });
const sheet = session => session.getWorkbook().sheets[0];
const paste = (target, payload = { values: [['a', 'b'], ['c', 'd']] }) => ({ type: 'cells.paste', sheetId: 'one', target, payload });
const move = target => ({ type: 'cells.move', sheetId: 'one', source: { sheetId: 'one', top: 0, left: 0, bottom: 1, right: 1 }, target });

test('merged cells, styles, validation and comments paste beyond both edges as one reversible transaction', () => {
  const source = normalizeWorkbook({ sheets: [{ id: 'source', name: 'Source', rowCount: 2, columnCount: 2,
    cells: { A1: { value: 'title', format: { bold: true }, validation: { type: 'list', values: ['title'] } }, A2: { value: '10' }, B2: { value: '20' } },
    merges: [{ top: 0, left: 0, bottom: 0, right: 1 }], comments: { A1: { id: 'old-note', text: 'annotation' } },
  }] });
  const payload = copySpreadsheetCells(source, 'source', { top: 0, left: 0, bottom: 1, right: 1 });
  const session = createSpreadsheetSession(input()), before = session.getWorkbook();
  const result = session.execute(paste({ row: 1, column: 1 }, payload));
  assert.equal(result.ok, true, result.message); assert.equal(result.changed, true);
  assert.equal(sheet(session).rowCount, 3); assert.equal(sheet(session).columnCount, 3);
  assert.equal(sheet(session).cells.A1.value, 'first'); assert.equal(sheet(session).cells.B2.value, 'title');
  assert.equal(sheet(session).cells.C3.value, '20'); assert.equal(sheet(session).cells.B2.format.bold, true);
  assert.deepEqual(sheet(session).cells.B2.validation, source.sheets[0].cells.A1.validation);
  assert.deepEqual(sheet(session).merges, [{ top: 1, left: 1, bottom: 1, right: 2 }]);
  assert.equal(sheet(session).comments.B2.text, 'annotation'); assert.notEqual(sheet(session).comments.B2.id, 'old-note');
  assert.deepEqual(result.results[0].placement, { nextRow: 3, nextColumn: 3 });
  const after = session.getWorkbook();
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
});

test('a target outside current capacity is permitted and does not shift existing references or metadata', () => {
  const value = input(); value.sheets[0].cells.B1 = { value: '=E5' };
  value.sheets[0].rowHeights = { 1: 40 }; value.sheets[0].columnWidths = { 1: 150 };
  value.namedRanges = [{ id: 'name', name: 'Origin', sheetId: 'one', range: { top: 0, left: 0, bottom: 0, right: 0 } }];
  const session = createSpreadsheetSession(value), before = session.getWorkbook();
  const result = session.execute(paste({ row: 4, column: 4 }, { values: [['7']] }));
  assert.equal(result.ok, true, result.message);
  assert.equal(sheet(session).rowCount, 5); assert.equal(sheet(session).columnCount, 5);
  assert.equal(sheet(session).cells.B1.value, '=E5'); assert.equal(sheet(session).cells.E5.value, '7');
  assert.deepEqual(sheet(session).rowHeights, before.sheets[0].rowHeights);
  assert.deepEqual(sheet(session).columnWidths, before.sheets[0].columnWidths);
  assert.deepEqual(session.getWorkbook().namedRanges, before.namedRanges);
});

test('all paste modes allocate only the required tail dimensions', () => {
  for (const mode of ['all', 'values', 'formulas', 'formats']) {
    const session = createSpreadsheetSession(input());
    const result = session.execute({ ...paste({ row: 1, column: 1 }, { values: [['=2+3', 'text']], displayedValues: [['5', 'text']], formats: [[{ bold: true }, null]] }), mode });
    assert.equal(result.ok, true, `${mode}: ${result.message}`);
    assert.equal(sheet(session).rowCount, 2); assert.equal(sheet(session).columnCount, 3);
    assert.equal(sheet(session).cells.B2.value, mode === 'formats' ? 'last' : mode === 'values' ? '5' : '=2+3');
  }
});

test('growth requires only the affected insertion features for both paste and cut', () => {
  for (const command of [paste, move]) {
    for (const [feature, target] of [['insertRows', { row: 1, column: 0 }], ['insertColumns', { row: 0, column: 1 }], ['rowColumnOperations', { row: 1, column: 1 }]]) {
      const session = createSpreadsheetSession(input(), { features: { [feature]: false } }), before = session.getWorkbook();
      const result = session.execute(command(target));
      assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED');
      assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
      assert.equal(session.execute(command({ row: 0, column: 0 })).ok, true, 'existing capacity remains usable');
    }
    const rowsOnly = createSpreadsheetSession(input(), { features: { insertColumns: false } });
    assert.equal(rowsOnly.execute(command({ row: 1, column: 0 })).ok, true);
    const columnsOnly = createSpreadsheetSession(input(), { features: { insertRows: false } });
    assert.equal(columnsOnly.execute(command({ row: 0, column: 1 })).ok, true);
  }
});

test('global bounds and transfer size reject atomically before creating capacity or history', () => {
  for (const command of [paste, move]) for (const target of [
    { row: SPREADSHEET_LIMITS.rows - 1, column: 0 }, { row: 0, column: SPREADSHEET_LIMITS.columns - 1 },
    { row: Number.MAX_SAFE_INTEGER, column: 0 }, { row: -1, column: 0 }, { row: 0.5, column: 0 },
  ]) {
    const session = createSpreadsheetSession(input()), before = session.getWorkbook();
    const result = session.batch([{ type: 'cells.set', sheetId: 'one', values: { A2: 'must roll back' } }, command(target)]);
    assert.equal(result.ok, false); assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  }
  const session = createSpreadsheetSession(input()), before = session.getWorkbook();
  assert.equal(session.execute(paste({ row: 0, column: 0 }, { values: Array.from({ length: 101 }, () => Array(100).fill('')) })).ok, false);
  assert.equal(session.getWorkbook(), before);
  assert.equal(session.execute(paste({ row: SPREADSHEET_LIMITS.rows - 1, column: SPREADSHEET_LIMITS.columns - 1 }, { values: [['boundary']] })).ok, true);
});

test('failed validation, write conflict and formula policy leave dimensions and earlier batch writes untouched', () => {
  for (const variant of ['validation', 'conflict', 'formula']) {
    const value = input();
    if (variant === 'validation') value.sheets[0].cells.B2 = { value: '2', validation: { type: 'number' } };
    const session = createSpreadsheetSession(value, { features: variant === 'formula' ? { formulas: false } : {} }), before = session.getWorkbook();
    const result = session.batch([{ type: 'cells.set', sheetId: 'one', values: { A2: 'roll back' } },
      { ...paste({ row: 1, column: 1 }, { values: [[variant === 'formula' ? '=1' : 'invalid', 'tail']] }), ...(variant === 'conflict' ? { onConflict: 'error' } : {}) }]);
    assert.equal(result.ok, false, variant); assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  }
});

test('cut expands without dropping source metadata and keeps formulas pointing at moved cells', () => {
  const value = input(); value.sheets[0].cells.B1 = { value: '=A1' };
  value.sheets[0].comments = { A1: { id: 'note', text: 'move me' } };
  const session = createSpreadsheetSession(value), before = session.getWorkbook();
  const result = session.execute(move({ row: 1, column: 1 }));
  assert.equal(result.ok, true, result.message);
  assert.equal(sheet(session).rowCount, 3); assert.equal(sheet(session).columnCount, 3);
  assert.equal(sheet(session).cells.A1, undefined); assert.equal(sheet(session).cells.B2.value, 'first');
  assert.equal(sheet(session).cells.C2.value, '=B2'); assert.equal(sheet(session).comments.B2.id, 'note');
  assert.deepEqual(result.results[0].placement, { nextRow: 3, nextColumn: 3 });
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
});

test('cross-sheet cuts grow only the target and preserve full merged cells and comment IDs', () => {
  const session = createSpreadsheetSession({ sheets: [{ id: 'one', name: 'One', rowCount: 2, columnCount: 2, cells: { A1: { value: 'title' } },
    merges: [{ top: 0, left: 0, bottom: 0, right: 1 }], comments: { A1: { id: 'note', text: 'comment' } } },
  { id: 'two', name: 'Two', rowCount: 1, columnCount: 1, cells: {} }] });
  const result = session.execute({ ...move({ row: 1, column: 1 }), sheetId: 'two' });
  assert.equal(result.ok, true, result.message);
  const [source, target] = session.getWorkbook().sheets;
  assert.equal(source.rowCount, 2); assert.equal(source.columnCount, 2); assert.equal(source.cells.A1, undefined);
  assert.equal(target.rowCount, 3); assert.equal(target.columnCount, 3); assert.equal(target.cells.B2.value, 'title');
  assert.equal(target.comments.B2.id, 'note'); assert.deepEqual(target.merges, [{ top: 1, left: 1, bottom: 1, right: 2 }]);
});

test('an invalid original cut source cannot become valid through destination expansion', () => {
  const session = createSpreadsheetSession(input()), before = session.getWorkbook();
  const command = move({ row: 2, column: 2 }); command.source.bottom = 2;
  assert.equal(session.execute(command).ok, false); assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
});

test('a skipped cut destination cancels the entire cut including automatic capacity', () => {
  const value = input(); value.sheets[0].cells.A2 = { value: 'occupied' };
  const session = createSpreadsheetSession(value), before = session.getWorkbook();
  const result = session.execute({ type: 'cells.move', sheetId: 'one', source: { sheetId: 'one', top: 0, left: 0, bottom: 0, right: 1 },
    target: { row: 1, column: 1 }, onConflict: 'skip' });
  assert.equal(result.ok, true, result.message); assert.equal(result.changed, false);
  assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  assert.deepEqual(result.results[0].write.skippedAddresses, ['B2']);
});

test('successful blank-cell paste still reserves its requested range, while skipped existing values remain untouched', () => {
  const session = createSpreadsheetSession(input());
  const result = session.execute({ ...paste({ row: 1, column: 1 }, { values: [['replacement', '']] }), onConflict: 'skip' });
  assert.equal(result.ok, true, result.message); assert.equal(result.changed, true);
  assert.equal(sheet(session).columnCount, 3); assert.equal(sheet(session).cells.B2.value, 'last'); assert.equal(sheet(session).cells.C2, undefined);
  assert.deepEqual(result.results[0].write, { changedCount: 0, skippedCount: 1, skippedAddresses: ['B2'] });
});
