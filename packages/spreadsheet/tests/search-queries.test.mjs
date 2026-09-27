import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { findSpreadsheetSheets, findSpreadsheetCells, normalizeWorkbook, createSpreadsheetSession, getSheetReader, getRange } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sample = () => normalizeWorkbook({ sheets: [
  { id: 'sales', name: 'Sales 2026', rowCount: 20, columnCount: 8, cells: { C3: { value: 'Target' }, B2: { value: 'target' }, B3: { value: '=2+3' }, A1: { value: 'target outside' }, C2: { value: '1234', format: { numberFormat: 'number', decimalPlaces: 0 } } } },
  { id: 'archive', name: 'sales 2025', rowCount: 20, columnCount: 8, cells: { B2: { value: 'TARGET' } } },
  { id: 'notes', name: 'Notes.v2', rowCount: 20, columnCount: 8, cells: { A1: { value: 'target' } } },
] });

test('sheet keyword search returns literal matches and original tab indices without cell payloads', () => {
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: 'sales' }), [
    { sheetId: 'sales', name: 'Sales 2026', index: 0, rowCount: 20, columnCount: 8 },
    { sheetId: 'archive', name: 'sales 2025', index: 1, rowCount: 20, columnCount: 8 },
  ]);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: '.', wholeName: false }).map(item => item.sheetId), ['notes']);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: 'sales', matchCase: true }).map(item => item.index), [1]);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: 'SALES 2026', wholeName: true }).map(item => item.sheetId), ['sales']);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: 'sales', wholeName: true }), []);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: '' }), []);
  assert.deepEqual(findSpreadsheetSheets(sample(), { text: 'missing' }), []);
});

test('sheet and cell match snapshots are frozen and detached without freezing the caller', () => {
  const workbook = structuredClone(sample());
  const sheets = findSpreadsheetSheets(workbook, { text: 'sales' });
  const cells = findSpreadsheetCells(workbook, { text: 'target' }, { sheetId: 'sales', range: 'B2:C3' });
  assert.ok(Object.isFrozen(sheets)); assert.ok(Object.isFrozen(sheets[0]));
  assert.ok(Object.isFrozen(cells)); assert.ok(Object.isFrozen(cells[0]));
  assert.throws(() => { sheets[0].name = 'changed'; }, TypeError);
  assert.throws(() => { cells[0].matchedText = 'changed'; }, TypeError);
  workbook.sheets[0].name = 'Changed'; workbook.sheets[0].cells.B2.value = 'Changed';
  assert.equal(sheets[0].name, 'Sales 2026'); assert.equal(cells[0].value, 'target');
  assert.equal(Object.isFrozen(workbook.sheets[0]), false);
});

test('cell search scopes A1 rectangles, zero-based objects and single cells with row-major order', () => {
  const workbook = sample(), query = { text: 'target' };
  const expected = [
    { sheetId: 'sales', address: 'B2', value: 'target', matchedText: 'target' },
    { sheetId: 'sales', address: 'C3', value: 'Target', matchedText: 'Target' },
  ];
  assert.deepEqual(findSpreadsheetCells(workbook, query, { sheetId: 'sales', range: '$b$2:c3' }), expected);
  assert.deepEqual(findSpreadsheetCells(workbook, query, { sheetId: 'sales', range: { top: 1, left: 1, bottom: 2, right: 2 } }), expected);
  assert.deepEqual(findSpreadsheetCells(workbook, query, { sheetId: 'sales', range: 'B2' }), expected.slice(0, 1));
  assert.deepEqual(findSpreadsheetCells(workbook, query).map(item => `${item.sheetId}!${item.address}`), ['sales!A1', 'sales!B2', 'sales!C3', 'archive!B2', 'notes!A1']);
  assert.deepEqual(findSpreadsheetCells(workbook, { text: '=2+3', lookIn: 'formulas', wholeCell: true }, { sheetId: 'sales', range: 'B3' }), [{ sheetId: 'sales', address: 'B3', value: '=2+3', matchedText: '=2+3' }]);
  assert.deepEqual(findSpreadsheetCells(workbook, { text: '5', wholeCell: true }, { sheetId: 'sales', range: 'B3' }), [{ sheetId: 'sales', address: 'B3', value: '=2+3', matchedText: '5' }]);
});

test('search validates missing sheets and invalid ranges even for an empty query', () => {
  for (const text of ['', 'target']) {
    for (const options of [{ sheetId: 'missing' }, { sheetId: '' }, { range: 'B2' }, { sheetId: 'sales', range: 'C3:B2' }, { sheetId: 'sales', range: 'A1:I20' }, { sheetId: 'sales', range: 'sales!A1' }, { sheetId: 'sales', range: null }, { sheetId: 'sales', range: { top: 1.5, left: 0, bottom: 2, right: 2 } }])
      assert.throws(() => findSpreadsheetCells(sample(), { text }, options));
  }
  for (const query of [null, { text: 1 }, { text: 'sales', matchCase: 'yes' }, { text: 'sales', wholeName: 1 }]) assert.throws(() => findSpreadsheetSheets(sample(), query));
  const duplicate = structuredClone(sample()); duplicate.sheets[1].id = 'sales';
  assert.throws(() => findSpreadsheetSheets(duplicate, { text: '' }), /重複/);
  assert.throws(() => findSpreadsheetCells(duplicate, { text: '' }, { sheetId: 'sales' }), /重複/);
});

test('sparse search accepts a full-sheet rectangle larger than the matrix retrieval limit', () => {
  const workbook = normalizeWorkbook({ sheets: [{ id: 'large', name: 'Large', rowCount: 10_000, columnCount: 1_000, cells: { A1: { value: 'needle' }, ALL10000: { value: 'needle' } } }] });
  const range = { top: 0, left: 0, bottom: 9999, right: 999 };
  assert.deepEqual(findSpreadsheetCells(workbook, { text: 'needle', lookIn: 'formulas' }, { sheetId: 'large', range }).map(item => item.address), ['A1', 'ALL10000']);
  assert.throws(() => getRange(workbook, 'large', range), /10,000/);
});

test('live session and scoped readers follow edits, renames, reordering and undo while fixed readers do not', () => {
  const session = createSpreadsheetSession(sample()), scoped = session.sheet('sales'), fixed = getSheetReader(sample(), 'sales');
  const history = session.getHistoryState();
  assert.equal(scoped.findCells({ text: 'target' }, { range: 'B2' }).length, 1);
  assert.deepEqual(scoped.getCells(), session.getSheetCells('sales'));
  assert.deepEqual(session.getHistoryState(), history);
  assert.equal(session.batch([{ type: 'cells.set', sheetId: 'sales', values: { B2: 'new word' } }, { type: 'sheets.rename', sheetId: 'sales', name: 'Forecast' }, { type: 'sheets.move', sheetId: 'sales', index: 2 }]).ok, true);
  assert.deepEqual(session.findSheets({ text: 'forecast' }).map(item => item.index), [2]);
  assert.equal(session.findCells({ text: 'new word' }, { sheetId: 'sales', range: 'B2' }).length, 1);
  assert.equal(scoped.getCells().find(cell => cell.address === 'B2').value, 'new word');
  assert.equal(fixed.getCells().find(cell => cell.address === 'B2').value, 'target');
  assert.equal(scoped.findCells({ text: 'target' }, { range: 'B2' }).length, 0);
  assert.equal(fixed.findCells({ text: 'target' }, { range: 'B2' }).length, 1);
  assert.equal(session.undo(), true);
  assert.equal(session.getSheetCells('sales').find(cell => cell.address === 'B2').value, 'target');
  assert.equal(scoped.findCells({ text: 'target' }, { range: 'B2' }).length, 1);
  assert.deepEqual(session.findSheets({ text: 'Sales 2026', wholeName: true }).map(item => item.index), [0]);
  assert.equal(session.execute({ type: 'sheets.delete', sheetId: 'sales' }).ok, true);
  assert.throws(() => scoped.findCells({ text: '' }), /シート/);
});
