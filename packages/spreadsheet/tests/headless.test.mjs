import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { applySpreadsheetCommands: apply, createWorkbook, setCellValues, normalizeWorkbook, serializeWorkbook,
  parseWorkbook, calculateWorkbook, setCellDataValidation, MAX_SPREADSHEET_COMMANDS, SPREADSHEET_LIMITS } = api;
const first = result => result.workbook.sheets[0];

test('model entry runs in Node with no React, DOM, CSS, UI, lifecycle or core imports', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  for (const input of Object.keys(output.metafile.inputs))
    assert.doesNotMatch(input, /node_modules|\/(?:ui|state|core)\/|\/(?:core|props|spreadsheet)\.tsx?$|\.(?:css|tsx)$/);
  assert.ok(Object.values(output.metafile.outputs).every(file => file.imports.length === 0));
  assert.doesNotMatch(output.outputFiles[0].text, /["']use client["']/);
  for (const excluded of ['Spreadsheet', 'prepareSpreadsheetImage', 'exportSpreadsheetXlsx']) assert.equal(excluded in api, false);
});

test('parsed workbook and AI command JSON insert populated rows in order and preserve formula references', () => {
  const saved = serializeWorkbook(setCellValues(createWorkbook(), 'sheet-1', { A3: '既存', B3: '7', C3: '=B3*2' }));
  const workbook = parseWorkbook(saved);
  const commands = JSON.parse('[{"type":"rows.insert","sheetId":"sheet-1","index":2,"count":2},{"type":"cells.set","sheetId":"sheet-1","values":{"A3":"商品A","B3":"100","A4":"商品B","B4":"200","C4":"=SUM(B3:B4)"}}]');
  const result = apply(workbook, commands);
  assert.equal(result.ok, true); assert.equal(result.changed, true);
  assert.equal(first(result).rowCount, 102);
  assert.equal(first(result).cells.A3.value, '商品A'); assert.equal(first(result).cells.A4.value, '商品B');
  assert.equal(first(result).cells.A5.value, '既存'); assert.equal(first(result).cells.C5.value, '=B5*2');
  assert.equal(calculateWorkbook(result.workbook)['sheet-1'].C4, 300);
  assert.equal(calculateWorkbook(result.workbook)['sheet-1'].C5, 14);
  assert.deepEqual(result.results.map(item => item.type), ['rows.insert', 'cells.set']);
  assert.equal(serializeWorkbook(workbook), saved);
  assert.equal(serializeWorkbook(parseWorkbook(serializeWorkbook(result.workbook))), serializeWorkbook(result.workbook));
});

test('a later rejected command returns no partial data and leaves mutable caller JSON untouched', () => {
  const workbook = JSON.parse(serializeWorkbook(createWorkbook()));
  const commands = [{ type: 'rows.insert', sheetId: 'sheet-1', index: 0 },
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: '一時値', A99999: '範囲外' } }];
  const before = JSON.stringify({ workbook, commands });
  const result = apply(workbook, commands);
  assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_TARGET'); assert.equal(result.commandIndex, 1);
  assert.equal('workbook' in result, false); assert.equal('results' in result, false);
  assert.equal(JSON.stringify({ workbook, commands }), before);
  assert.equal(Object.isFrozen(workbook), false); assert.equal(Object.isFrozen(commands[1].values), false);
});

test('normalization isolates mutable input and changed describes commands, not copy identity', () => {
  const workbook = JSON.parse(serializeWorkbook(setCellValues(createWorkbook(), 'sheet-1', { A1: '1' })));
  const commands = [{ type: 'cells.format', sheetId: 'sheet-1', addresses: ['A1'], format: { bold: true } }];
  const result = apply(workbook, commands);
  assert.equal(result.ok, true);
  workbook.sheets[0].cells.A1.value = 'changed'; commands[0].format.bold = false;
  assert.equal(first(result).cells.A1.value, '1'); assert.equal(first(result).cells.A1.format.bold, true);
  for (const value of [result, result.results, result.results[0], result.workbook, first(result), first(result).cells.A1.format])
    assert.equal(Object.isFrozen(value), true);
  for (const batch of [[], [{ type: 'cells.set', sheetId: 'sheet-1', values: { A1: '2' } },
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: 'changed' } }]]) {
    const unchanged = apply(workbook, batch);
    assert.equal(unchanged.ok, true); assert.equal(unchanged.changed, false);
    assert.notEqual(unchanged.workbook, workbook);
    assert.deepEqual(unchanged.workbook, normalizeWorkbook(workbook));
  }
});

test('bad workbook data is rejected before commands with no implicit blank workbook fallback', () => {
  for (const workbook of [undefined, null, {}, { sheets: [] },
    { ...createWorkbook(), schemaVersion: 999 },
    { sheets: [{ ...createWorkbook().sheets[0], cells: { A10001: { value: 'bad' } } }] }]) {
    const result = apply(workbook, []);
    assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED');
    assert.equal('commandIndex' in result, false); assert.equal('workbook' in result, false);
  }
});

test('unknown JSON commands, extra properties and non-string cell values fail with their index', () => {
  const workbook = createWorkbook();
  for (const command of [null, 'cells.set', {}, { type: 'constructor' }, { type: 'runJavaScript', code: 'alert(1)' },
    { type: 'cells.set', sheetId: 'sheet-1', values: { A1: 1 } },
    { type: 'cells.set', sheetId: 'sheet-1', values: {}, unexpected: true },
    JSON.parse('{"type":"cells.set","sheetId":"sheet-1","values":{"__proto__":"bad"}}')]) {
    const result = apply(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { B1: 'valid first' } }, command]);
    assert.equal(result.ok, false); assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false); assert.equal(workbook.sheets[0].cells.B1, undefined);
  }
  assert.equal(apply(workbook, { type: 'cells.set' }).code, 'INVALID_COMMAND');
  assert.equal(apply(workbook, new Array(1)).code, 'INVALID_COMMAND');
  assert.equal(Object.prototype.bad, undefined);
});

test('feature switches and parent switches apply with the same policies as UI commands', () => {
  const command = { type: 'rows.insert', sheetId: 'sheet-1', index: 0 };
  assert.equal(apply(createWorkbook(), [command]).ok, true);
  for (const features of [{ insertRows: false }, { rowColumnOperations: false, insertRows: true }]) {
    const result = apply(createWorkbook(), [command], { features });
    assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED'); assert.equal(result.commandIndex, 0);
  }
  const formula = { type: 'cells.set', sheetId: 'sheet-1', values: { A1: '=SUM(B1:B2)' } };
  assert.equal(apply(createWorkbook(), [formula], { features: { formulas: false } }).code, 'FEATURE_DISABLED');
  for (const options of [null, [], { unexpected: true }, { features: null }, { features: { insertRows: 'false' } }, { features: { madeUp: false } }])
    assert.equal(apply(createWorkbook(), [], options).code, 'INVALID_COMMAND');
});

test('existing validation rules remain enforced and invalid oversized batches or cells return failure', () => {
  const workbook = setCellDataValidation(createWorkbook(), 'sheet-1', ['A1'], { type: 'number', min: 0, max: 10 });
  const rejected = apply(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { A1: '11' } }], { features: { dataValidation: false } });
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'VALIDATION_FAILED'); assert.equal(rejected.commandIndex, 0);
  const accepted = apply(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { A1: '10' } }]);
  assert.equal(accepted.ok, true);
  const overflow = apply(workbook, Array.from({ length: MAX_SPREADSHEET_COMMANDS + 1 }, () => ({ type: 'cells.set', sheetId: 'sheet-1', values: {} })));
  assert.equal(overflow.ok, false); assert.equal(overflow.code, 'VALIDATION_FAILED'); assert.equal(overflow.commandIndex, undefined);
  assert.equal(apply(workbook, [{ type: 'cells.set', sheetId: 'sheet-1', values: { B1: 'x'.repeat(SPREADSHEET_LIMITS.cellLength + 1) } }]).ok, false);
});

test('server-side object creation returns unique IDs that can target a later command batch', () => {
  const created = apply(createWorkbook(), [
    { type: 'sheets.add', name: 'AI結果' },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor: { row: 1, column: 1 }, text: '確認' },
    { type: 'comments.set', sheetId: 'sheet-1', address: 'A1', comment: { text: 'generated' } },
  ]);
  assert.equal(created.ok, true);
  const [sheet, drawing, comment] = created.results;
  assert.equal(new Set([sheet.sheetId, drawing.drawingId, comment.commentId]).size, 3);
  for (const id of [sheet.sheetId, drawing.drawingId, comment.commentId]) assert.match(id, /^[0-9a-f-]{36}$/);
  const updated = apply(created.workbook, [
    { type: 'cells.set', sheetId: sheet.sheetId, values: { A1: '内容' } },
    { type: 'shapes.update', sheetId: drawing.sheetId, drawingId: drawing.drawingId, patch: { text: '確定' } },
  ]);
  assert.equal(updated.ok, true); assert.equal(updated.workbook.sheets[1].cells.A1.value, '内容');
  assert.equal(first(updated).drawings[0].text, '確定');
});
