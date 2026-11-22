import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook, calculateWorkbook, SPREADSHEET_LIMITS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** `count` stored cells laid out ten per row. */
const cells = count => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${columns[index % 10]}${Math.floor(index / 10) + 1}`, { value: '1' }]));
const sheet = (id, count) => ({ id, name: id, rowCount: 10_000, columnCount: 11, cells: cells(count) });

test('the stored-cell limit applies to each sheet, not to the workbook total', () => {
  assert.equal(SPREADSHEET_LIMITS.cells, 100_000);
  const workbook = normalizeWorkbook({ sheets: [sheet('first', SPREADSHEET_LIMITS.cells), sheet('second', SPREADSHEET_LIMITS.cells), sheet('third', 1)] });
  assert.deepEqual(workbook.sheets.map(item => Object.keys(item.cells).length), [100_000, 100_000, 1]);
  assert.throws(() => normalizeWorkbook({ sheets: [sheet('small', 1), sheet('over', SPREADSHEET_LIMITS.cells + 1)] }), /1シートに保存できるセル数の上限/);

  const restored = parseWorkbook(serializeWorkbook(workbook));
  assert.deepEqual(restored.sheets.map(item => Object.keys(item.cells).length), [100_000, 100_000, 1]);
  assert.equal(serializeWorkbook(restored), serializeWorkbook(workbook));
});

test('commands may fill other sheets beside a full sheet and reject only the sheet that would overflow', () => {
  const workbook = normalizeWorkbook({ sheets: [sheet('full', SPREADSHEET_LIMITS.cells), sheet('open', SPREADSHEET_LIMITS.cells - 1)] });
  const accepted = apply(workbook, [{ type: 'cells.set', sheetId: 'open', values: { K1: 'last' } }]);
  assert.equal(accepted.ok, true);
  assert.equal(Object.keys(accepted.workbook.sheets[1].cells).length, SPREADSHEET_LIMITS.cells);
  for (const sheetId of ['full', 'open']) {
    const rejected = apply(accepted.workbook, [{ type: 'cells.set', sheetId, values: { K2: 'overflow' } }]);
    assert.equal(rejected.ok, false); assert.equal(rejected.code, 'VALIDATION_FAILED');
  }
  assert.equal(accepted.workbook.sheets[0].cells.K2, undefined);
});

test('the formula evaluation budget applies to each sheet and is charged to the sheet that owns the formula', () => {
  // Each row costs well over ten steps, so 30,000 rows exhaust one sheet's 200,000-step budget.
  const heavyCells = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [`H${index + 1}`, { value: `=SUM(A${index + 1}:G${index + 1})` }]));
  const heavy = id => ({ id, name: id, rowCount: 10_000, columnCount: 26, cells: Object.fromEntries(Object.entries(heavyCells).slice(0, 10_000)) });
  const heavySheets = [heavy('heavy1'), heavy('heavy2'), heavy('heavy3')].map((item, index) => ({ ...item,
    cells: { ...item.cells, ...Object.fromEntries(Array.from({ length: 10_000 }, (_, row) => [`I${row + 1}`, { value: `=SUM(A${row + 1}:G${row + 1})+${index}` }])),
      ...Object.fromEntries(Array.from({ length: 10_000 }, (_, row) => [`J${row + 1}`, { value: `=SUM(A${row + 1}:G${row + 1})*2` }])) } }));
  const light = { id: 'light', name: 'light', rowCount: 10, columnCount: 5, cells: { A1: { value: '=1+1' }, A2: { value: '=heavy1!H1+5' }, A3: { value: '=heavy1!J10000' } } };
  const limited = values => Object.values(values).filter(value => value === '#LIMIT!').length;

  const result = calculateWorkbook(normalizeWorkbook({ sheets: [...heavySheets, light] }));
  for (const id of ['heavy1', 'heavy2', 'heavy3']) {
    assert.equal(result[id].H1, 0, `${id} starts with its own budget`);
    assert.ok(limited(result[id]) > 0, `${id} exhausts only its own budget`);
  }
  assert.equal(limited(result.heavy1), limited(result.heavy2)); assert.equal(limited(result.heavy2), limited(result.heavy3));
  assert.equal(result.light.A1, 2); assert.equal(result.light.A2, 5);
  assert.equal(result.light.A3, '#LIMIT!', 'a referenced formula that exceeded its own sheet budget still reports the limit');

  // Work done for a referenced formula is charged to its own sheet, so a sheet that reads an
  // exhausted sheet first keeps its budget for its own formulas.
  const reader = { id: 'reader', name: 'reader', rowCount: 10_000, columnCount: 5, cells: {
    ...Object.fromEntries(Array.from({ length: 10_000 }, (_, row) => [`A${row + 1}`, { value: `=heavy1!H${row + 1}+heavy1!I${row + 1}+heavy1!J${row + 1}` }])),
    B1: { value: '=1+1' } } };
  const referenced = calculateWorkbook(normalizeWorkbook({ sheets: [reader, heavySheets[0]] }));
  assert.equal(referenced.reader.A1, 0);
  assert.equal(referenced.reader.A10000, '#LIMIT!', 'the referenced sheet ran out of its own budget');
  assert.equal(referenced.reader.B1, 2, 'the reading sheet still has its own budget');
});
