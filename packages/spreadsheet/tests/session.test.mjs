import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: {
  contents: 'export * from "./src/session/create-spreadsheet-session"; export { createWorkbook, serializeWorkbook } from "./src/model";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'session-test.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { createSpreadsheetSession, createWorkbook, serializeWorkbook } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const set = value => ({ type: 'cells.set', sheetId: 'sheet-1', values: { A1: value } });
const value = session => session.getWorkbook().sheets[0].cells.A1?.value;

test('a headless session imports no React, DOM, component state, UI, CSS or Core runtime', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  for (const input of Object.keys(output.metafile.inputs))
    assert.doesNotMatch(input, /node_modules|\/(?:ui|state|core)\/|\/(?:core|props|spreadsheet)\.tsx?$|\.(?:css|tsx)$/);
  assert.ok(Object.values(output.metafile.outputs).every(file => file.imports.length === 0));
  assert.doesNotMatch(output.outputFiles[0].text, /["']use client["']/);
});

test('an ordered batch has one history entry and Undo/Redo restore the identical snapshots and IDs', () => {
  const session = createSpreadsheetSession(createWorkbook()), before = session.getWorkbook();
  const result = session.batch([set('first'), { type: 'sheets.add', name: 'Added' },
    { type: 'shapes.insert', sheetId: 'sheet-1', shape: 'rectangle', anchor: { row: 0, column: 1 }, text: 'Label' }]);
  assert.equal(result.ok, true); assert.equal(result.changed, true);
  assert.equal('workbook' in result, false);
  const after = session.getWorkbook(), afterState = session.getHistoryState();
  assert.deepEqual(afterState, { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 });
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
  assert.equal(session.undo(), false);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
  assert.equal(session.getWorkbook().sheets[1].id, result.results[1].sheetId);
  assert.equal(session.getWorkbook().sheets[0].drawings[0].id, result.results[2].drawingId);
  assert.equal(session.getShape('sheet-1', result.results[2].drawingId).text, 'Label');
  assert.equal(session.redo(), false);
  for (const object of [session, after, after.sheets[0], after.sheets[0].cells.A1, afterState, result])
    assert.equal(Object.isFrozen(object), true);
});

test('retained query methods follow command commits, Undo/Redo and workbook replacement', () => {
  const session = createSpreadsheetSession(createWorkbook());
  const { getCell, getRange, getSheet } = session;
  assert.equal(getCell('sheet-1', 'A1'), undefined);
  session.execute(set('first'));
  const first = getCell('sheet-1', 'A1');
  assert.equal(first.value, 'first'); assert.equal(Object.isFrozen(first), true);
  session.execute(set('second')); assert.equal(getCell('sheet-1', 'A1').value, 'second');
  session.undo(); assert.equal(getCell('sheet-1', 'A1').value, 'first');
  session.redo(); assert.equal(getRange('sheet-1', 'A1:B1')[0][0].value, 'second');
  assert.equal(getRange('sheet-1', 'A1:B1')[0][1], null);
  assert.equal(first.value, 'first');
  session.replaceWorkbook(createWorkbook());
  assert.equal(getCell('sheet-1', 'A1'), undefined); assert.equal(getSheet('sheet-1').name, 'Sheet1');
});

test('failed and net-unchanged batches leave workbook identity and the existing Redo branch untouched', () => {
  const session = createSpreadsheetSession(createWorkbook());
  session.execute(set('one')); session.execute(set('two')); session.undo();
  const before = session.getWorkbook(), history = session.getHistoryState();
  for (const commands of [[], [set('one')], [set('temporary'), set('one')]]) {
    const result = session.batch(commands);
    assert.equal(result.ok, true); assert.equal(result.changed, false);
    assert.equal(session.getWorkbook(), before); assert.deepEqual(session.getHistoryState(), history);
  }
  const invalid = session.batch([set('partial'), { type: 'cells.set', sheetId: 'missing', values: { A1: 'invalid' } }]);
  assert.equal(invalid.ok, false); assert.equal(invalid.commandIndex, 1);
  assert.equal('results' in invalid, false); assert.equal(session.getWorkbook(), before);
  assert.deepEqual(session.getHistoryState(), history); assert.equal(session.redo(), true); assert.equal(value(session), 'two');
  session.undo(); session.execute(set('new branch'));
  assert.equal(session.redo(), false); assert.equal(value(session), 'new branch');
});

test('history uses a default cap of 50 and validates configurable zero, one and larger caps', () => {
  for (const limit of [0, 1, 3, 50]) {
    const session = createSpreadsheetSession(createWorkbook(), limit === 50 ? undefined : { historyLimit: limit });
    for (let number = 1; number <= 55; number++) session.execute(set(String(number)));
    assert.equal(session.getHistoryState().undoCount, limit);
    for (let number = 0; number < limit; number++) assert.equal(session.undo(), true);
    assert.equal(session.undo(), false); assert.equal(value(session), String(55 - limit));
    assert.equal(session.getHistoryState().redoCount, limit);
    for (let number = 0; number < limit; number++) assert.equal(session.redo(), true);
    assert.equal(session.redo(), false); assert.equal(value(session), '55');
  }
  for (const historyLimit of [-1, 0.5, 1001, Infinity, NaN, '50', null])
    assert.throws(() => createSpreadsheetSession(createWorkbook(), { historyLimit }));
});

test('feature policies are captured at creation and disabled Undo leaves normal editing available', () => {
  const options = { features: { rowColumnOperations: false, insertRows: true, undoRedo: false } };
  const session = createSpreadsheetSession(createWorkbook(), options);
  options.features.rowColumnOperations = true; options.features.undoRedo = true;
  assert.equal(session.execute({ type: 'rows.insert', sheetId: 'sheet-1', index: 0 }).code, 'FEATURE_DISABLED');
  assert.equal(session.execute(set('accepted')).ok, true);
  assert.equal(value(session), 'accepted'); assert.equal(session.undo(), false); assert.equal(session.redo(), false);
  assert.deepEqual(session.getHistoryState(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
  for (const options of [null, [], { unknown: true }, { features: null }, { features: { undoRedo: 'no' } }])
    assert.throws(() => createSpreadsheetSession(createWorkbook(), options));
});

test('mutable caller data is isolated and clear/replace never serialize or accidentally retain history', () => {
  const input = JSON.parse(serializeWorkbook(createWorkbook()));
  const session = createSpreadsheetSession(input);
  input.sheets[0].name = 'Mutated';
  assert.equal(session.getWorkbook().sheets[0].name, 'Sheet1');
  session.execute(set('before clear'));
  const before = session.getWorkbook(); session.clearHistory();
  assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  session.execute(set('after clear'));
  const valid = session.getWorkbook(), history = session.getHistoryState();
  for (const invalid of [undefined, null, {}, { sheets: [] }]) {
    assert.throws(() => session.replaceWorkbook(invalid));
    assert.equal(session.getWorkbook(), valid); assert.deepEqual(session.getHistoryState(), history);
    assert.throws(() => createSpreadsheetSession(invalid));
  }
  const replacement = JSON.parse(serializeWorkbook(createWorkbook()));
  session.replaceWorkbook(replacement); replacement.sheets[0].name = 'Changed again';
  assert.equal(session.getWorkbook().sheets[0].name, 'Sheet1'); assert.equal(value(session), undefined);
  assert.equal(session.undo(), false); assert.equal(session.redo(), false);
  assert.equal(JSON.stringify(session.getWorkbook()).includes('undoCount'), false);
});

test('malformed input and reentrant getters cannot publish a partial or nested transaction', () => {
  const session = createSpreadsheetSession(createWorkbook());
  for (const commands of [undefined, null, {}, [null], [set('partial'), { type: 'unknown' }]]) {
    const before = session.getWorkbook();
    assert.equal(session.batch(commands).ok, false); assert.equal(session.getWorkbook(), before);
  }
  let nested;
  const command = { type: 'cells.set', sheetId: 'sheet-1', get values() {
    nested = session.execute(set('nested'));
    assert.equal(session.undo(), false);
    return { A1: 'outer' };
  } };
  assert.equal(session.execute(command).ok, true); assert.equal(nested.code, 'BUSY');
  assert.equal(value(session), 'outer'); assert.equal(session.getHistoryState().undoCount, 1);
});

test('oversized command arrays fail before any element getter or structured clone can run', () => {
  const session = createSpreadsheetSession(createWorkbook()), before = session.getWorkbook();
  const commands = new Array(1_000_000);
  let reads = 0;
  Object.defineProperty(commands, '0', { enumerable: true, get() { reads++; throw new Error('must not read oversized input'); } });
  const result = session.batch(commands);
  assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal(result.commandIndex, undefined); assert.equal(reads, 0);
  assert.equal(session.getWorkbook(), before); assert.equal(session.getHistoryState().undoCount, 0);
});
