import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { createSpreadsheetAutoFitCommand: fit, applySpreadsheetCommands: apply, createSpreadsheetSession,
  normalizeWorkbook, serializeWorkbook, parseWorkbook, exportSpreadsheetXlsx, importSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = () => normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet1', rowCount: 8, columnCount: 6,
  cells: { A1: { value: 'alpha' }, B1: { value: '=A2*2', format: { numberFormat: 'number', decimalPlaces: 2 } },
    A2: { value: '12' }, C1: { value: 'one\ntwo', format: { fontSize: 20, wrap: true } },
    D1: { value: 'merged title is excluded', format: { fontSize: 40 } },
    F1: { value: 'TRUE', validation: { type: 'checkbox' } } },
  merges: [{ top: 0, bottom: 0, left: 3, right: 4 }] }] });

test('JSON autoFit is deterministic in Node and shares the public injected measurement helper', () => {
  const workbook = book(), before = serializeWorkbook(workbook);
  const target = { sheetId: 's', axis: 'column', indices: [0, 1, 3, 5] };
  const command = fit(workbook, target);
  assert.deepEqual(command, fit(parseWorkbook(before), target));
  assert.equal(command.columnWidths[3], 24, 'a multi-column merge does not grow one individual column');
  const result = apply(workbook, [{ type: 'dimensions.autoFit', ...target }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.workbook.sheets[0].columnWidths, command.columnWidths);
  assert.equal(result.results[0].type, 'dimensions.autoFit');
  assert.equal(serializeWorkbook(workbook), before);
  const texts = [];
  const measured = fit(workbook, { sheetId: 's', axis: 'column', indices: [1] }, {
    measureText(text) { texts.push(text); return text.length * 10; },
  });
  assert.ok(texts.includes('24.00'), 'measurement uses the formatted calculated value');
  assert.equal(measured.columnWidths[1], 66);
  assert.ok(Object.keys(output.metafile.inputs).every(path => !/\/(ui|state)\/|react|\.tsx$/.test(path)));
});

test('autoFit follows preceding edits, records one batch history entry and obeys resize guards', () => {
  const session = createSpreadsheetSession(book()), before = session.getWorkbook();
  const result = session.batch([
    { type: 'cells.set', sheetId: 's', values: { A1: 'a much longer value' } },
    { type: 'dimensions.autoFit', sheetId: 's', axis: 'column', indices: [0] },
    { type: 'dimensions.autoFit', sheetId: 's', axis: 'row', indices: [0] },
  ]);
  assert.equal(result.ok, true);
  assert.ok(session.getWorkbook().sheets[0].columnWidths[0] > fit(before, { sheetId: 's', axis: 'column', indices: [0] }).columnWidths[0]);
  assert.equal(session.getWorkbook().sheets[0].rowHeights[0], 62);
  assert.equal(session.undo(), true);
  assert.deepEqual(session.getWorkbook(), before);
  assert.equal(session.undo(), false);
  assert.equal(apply(before, [{ type: 'dimensions.autoFit', sheetId: 's', axis: 'row', indices: [0] }], { features: { resize: false } }).code, 'FEATURE_DISABLED');
});

test('bad autoFit targets and bad measurements reject without partial batch changes', () => {
  const workbook = book();
  for (const target of [
    { sheetId: 'missing', axis: 'row', indices: [0] }, { sheetId: 's', axis: 'depth', indices: [0] },
    { sheetId: 's', axis: 'row', indices: [] }, { sheetId: 's', axis: 'row', indices: [8] },
    { sheetId: 's', axis: 'column', indices: [1.5] }, { sheetId: 's', axis: 'column', indices: [NaN] },
  ]) {
    assert.throws(() => fit(workbook, target));
    const result = apply(workbook, [{ type: 'cells.set', sheetId: 's', values: { A1: 'unpublished' } }, { type: 'dimensions.autoFit', ...target }]);
    assert.equal(result.ok, false);
    assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false);
  }
  assert.throws(() => fit(workbook, { sheetId: 's', axis: 'column', indices: [0] }, { measureText: () => NaN }), /文字幅/);
  assert.equal(workbook.sheets[0].cells.A1.value, 'alpha');
});


test('computed autoFit dimensions survive native JSON and XLSX import/export', async () => {
  const result = apply(book(), [
    { type: 'dimensions.autoFit', sheetId: 's', axis: 'column', indices: [0, 1, 2] },
    { type: 'dimensions.autoFit', sheetId: 's', axis: 'row', indices: [0] },
  ]);
  assert.equal(result.ok, true);
  const source = result.workbook.sheets[0];
  const native = parseWorkbook(serializeWorkbook(result.workbook));
  assert.deepEqual(native.sheets[0].rowHeights, source.rowHeights);
  assert.deepEqual(native.sheets[0].columnWidths, source.columnWidths);
  const imported = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  for (const [row, height] of Object.entries(source.rowHeights))
    assert.equal(imported.workbook.sheets[0].rowHeights[row], height);
  for (const [column, width] of Object.entries(source.columnWidths))
    assert.ok(Math.abs(imported.workbook.sheets[0].columnWidths[column] - width) < 1);
});
