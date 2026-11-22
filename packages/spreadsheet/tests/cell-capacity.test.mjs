import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook, SPREADSHEET_LIMITS } =
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
