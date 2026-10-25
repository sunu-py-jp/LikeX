import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/api/use-spreadsheet-handle"; export { createSpreadsheetSession } from "./src/model-entry";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'lookup-session.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetHandle, createSpreadsheetSession } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const bounds = { top: 1, left: 1, bottom: 4, right: 4 };
const book = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 8, columnCount: 8, cells: {
  A1: { value: 'stable' }, B2: { value: 'Item' }, C2: { value: '10月' }, D2: { value: '11月' }, E2: { value: '12月' },
  B3: { value: 'A001' }, C3: { value: '10' }, D3: { value: '20' }, E3: { value: '30' },
  B4: { value: 'A002' }, C4: { value: '40' }, D4: { value: '50' }, E4: { value: '60' },
  B5: { value: 'A003' }, C5: { value: '70' }, D5: { value: '80' }, E5: { value: '90' },
} }], namedRanges: [{ id: 'monthly', name: 'Monthly', sheetId: 'one', range: bounds }] });
const rows = (extra = {}) => ({ type: 'cells.setByLookup', sheetId: 'one', range: { namedRange: 'Monthly' },
  lookup: { column: 0, value: 'A002' }, updates: [{ column: 2, value: '1200' }], ...extra });
const columns = (extra = {}) => ({ type: 'cells.setByLookup', sheetId: 'one', range: 'B2:E5',
  lookup: { axis: 'columns', row: 0, value: '11月' }, updates: [{ row: 1, value: '1500' }], ...extra });
const matrix = (extra = {}) => ({ type: 'cells.setByLookup', sheetId: 'one', range: bounds,
  lookup: { axis: 'both', row: { column: 0, value: 'A003' }, column: { row: 0, value: '12月' } }, value: '1800', ...extra });
const set = values => ({ type: 'cells.set', sheetId: 'one', values });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function mount(t, options = {}) {
  let current, renderer, unmounted = false;
  const handleRef = createRef();
  let props = { initialWorkbook: book(), onSave: value => value, ...options };
  function Probe({ props }) { current = useSpreadsheet(props); useSpreadsheetHandle(handleRef, current); return null; }
  await act(async () => { renderer = create(createElement(Probe, { props })); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { get c() { return current; }, get api() { return handleRef.current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe, { props }))); }, unmount };
}

test('headless row, column and matrix lookups publish resolved targets in one undoable batch', () => {
  const session = createSpreadsheetSession(book()), before = session.getMutationSnapshot();
  const result = session.batch([rows(), columns(), matrix()]);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.results.map(receipt => receipt.lookup), [
    { range: bounds, matchedRows: [3], matchedColumns: [], addresses: ['D4'] },
    { range: bounds, matchedRows: [], matchedColumns: [3], addresses: ['D3'] },
    { range: bounds, matchedRows: [4], matchedColumns: [4], addresses: ['E5'] },
  ]);
  for (const receipt of result.results) {
    assert.equal('placement' in receipt, false);
    assert.deepEqual(receipt.write, { changedCount: 1, skippedCount: 0, skippedAddresses: [] });
    assert.ok(Object.isFrozen(receipt.lookup)); assert.ok(Object.isFrozen(receipt.lookup.addresses));
  }
  assert.equal(session.sheet('one').getCell('D4').value, '1200');
  assert.equal(session.getCell('one', 'D3').value, '1500'); assert.equal(session.getCell('one', 'E5').value, '1800');
  assert.equal(session.getHistoryState().undoCount, 1);
  assert.equal(session.getMutationSnapshot().token.structureRevision, before.token.structureRevision);
  const after = session.getWorkbook();
  assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), before.workbook);
  assert.equal(session.redo(), true); assert.deepEqual(session.getWorkbook(), after);
});

test('conditional lookup writes guard source keys, named ranges and external formula dependencies', () => {
  const cases = [
    { prepare: () => {}, edit: set({ B4: 'moved' }), command: rows() },
    { prepare: () => {}, edit: { type: 'namedRanges.update', sheetId: 'one', namedRangeId: 'monthly', range: 'B2:E4' }, command: rows() },
    { prepare: session => session.execute(set({ G1: 'A002', B4: '=G1' })), edit: set({ G1: 'other' }), command: rows() },
  ];
  for (const { prepare, edit, command } of cases) {
    const session = createSpreadsheetSession(book()); prepare(session);
    const expected = session.getMutationSnapshot();
    const changed = session.execute(edit); assert.equal(changed.ok, true, changed.message);
    const before = session.getWorkbook(), history = session.getHistoryState();
    const result = session.execute(command, { expected });
    assert.equal(result.code, 'PRECONDITION_FAILED'); assert.ok(result.editConflicts.length > 0);
    assert.equal(session.getWorkbook(), before); assert.deepEqual(session.getHistoryState(), history);
    assert.equal(session.getCell('one', 'D4').value, '50');
  }
});

test('headless lookup batches use preceding writes but discard all changes when a later lookup fails', () => {
  const session = createSpreadsheetSession(book());
  const rename = rows({ updates: [{ column: 0, value: 'A004' }] });
  const follow = rows({ lookup: { column: 0, value: 'A004' } });
  const result = session.batch([rename, follow]);
  assert.equal(result.ok, true, result.message); assert.equal(session.getCell('one', 'D4').value, '1200');
  assert.equal(session.getHistoryState().undoCount, 1); session.undo();
  const before = session.getWorkbook();
  const failed = session.batch([rename, rows()]);
  assert.equal(failed.ok, false); assert.equal(failed.commandIndex, 1);
  assert.equal(session.getWorkbook(), before); assert.equal(session.getHistoryState().undoCount, 0);
});

test('mounted lookup captures nested input before permission and publishes one undoable change', async t => {
  const permission = deferred(), changes = [], intents = [];
  const ui = await mount(t, { onEditRequest: request => { intents.push(request); return permission.promise; }, onChange: value => changes.push(value) });
  const command = rows(), before = ui.api.getWorkbook(); let pending, result;
  await act(async () => { pending = ui.api.executeAsync(command); });
  assert.equal(ui.api.getWorkbook(), before); assert.equal(changes.length, 0);
  command.lookup.value = 'A003'; command.updates[0].value = 'changed'; command.updates.push({ column: 3, value: 'later' });
  command.range.namedRange = 'missing';
  await act(async () => { permission.resolve(true); result = await pending; });
  assert.equal(result.ok, true, result.message); assert.equal(changes.length, 1); assert.equal(intents.length, 1);
  assert.equal(intents[0].action, 'cells.setByLookup');
  assert.equal(ui.api.getCell('one', 'D4').value, '1200'); assert.equal(ui.api.getCell('one', 'D5').value, '80');
  assert.deepEqual(result.results[0].lookup.addresses, ['D4']); assert.equal(ui.api.getHistoryState().undoCount, 1);
  const after = ui.api.getWorkbook();
  await act(async () => assert.equal(await ui.api.undo(), true)); assert.deepEqual(ui.api.getWorkbook(), before);
  await act(async () => assert.equal(await ui.api.redo(), true)); assert.deepEqual(ui.api.getWorkbook(), after);
});

test('lookup uses ordinary value-write permissions and does not require search or named-range editing', async t => {
  const ui = await mount(t, { features: { search: false, replace: false, namedRanges: false, formatting: false } });
  let result;
  await act(async () => { result = await ui.api.executeAsync(rows()); });
  assert.equal(result.ok, true, result.message); assert.equal(ui.api.getCell('one', 'D4').value, '1200');
  for (const [options, expected] of [
    [{ readOnly: true }, 'READ_ONLY'], [{ onSave: undefined }, 'READ_ONLY'],
    [{ features: { formulas: false } }, 'FEATURE_DISABLED'],
  ]) {
    let requests = 0, changes = 0;
    const blocked = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => changes++, ...options });
    const before = blocked.api.getWorkbook();
    await act(async () => { result = await blocked.api.executeAsync(rows({ updates: [{ column: 2, value: '=1+1' }] })); });
    assert.equal(result.code, expected); assert.equal(blocked.api.getWorkbook(), before);
    assert.equal(blocked.api.getHistoryState().undoCount, 0); assert.equal(requests, 0); assert.equal(changes, 0);
  }
});

test('invalid lookup and later failed batch cannot publish writes or request permission', async t => {
  let requests = 0, changes = 0;
  const ui = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => changes++ });
  const before = ui.api.getWorkbook();
  for (const commands of [
    [rows({ updates: [{ row: 1, value: 'wrong axis' }] })],
    [rows(), matrix({ lookup: { axis: 'both', row: { column: 0, value: 'missing' }, column: { row: 0, value: '12月' } } })],
    [rows(), set({ X9999: 'outside' })],
  ]) {
    let result; await act(async () => { result = await ui.api.batchAsync(commands); });
    assert.equal(result.ok, false); assert.equal(ui.api.getWorkbook(), before); assert.equal(ui.api.getHistoryState().undoCount, 0);
  }
  assert.equal(requests, 0); assert.equal(changes, 0);
});

test('no-match skip creates no change, history or permission request', async t => {
  let requests = 0, changes = 0;
  const ui = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => changes++ });
  const before = ui.api.getWorkbook(); let result;
  await act(async () => { result = await ui.api.executeAsync(rows({ lookup: { column: 0, value: 'missing' }, onNotFound: 'skip' })); });
  assert.equal(result.ok, true, result.message); assert.equal(result.changed, false);
  assert.deepEqual(result.results[0].lookup, { range: bounds, matchedRows: [], matchedColumns: [], addresses: [] });
  assert.equal(ui.api.getWorkbook(), before); assert.equal(ui.api.getHistoryState().undoCount, 0);
  assert.equal(requests, 0); assert.equal(changes, 0);
});

test('lookup obeys active editor and busy publication guards', async t => {
  let api, nested, changes = 0;
  const ui = await mount(t, { onChange: () => { changes++; nested = api.execute(columns()); } }); api = ui.api;
  const before = api.getWorkbook();
  await act(async () => {
    ui.c.beginEdit({ row: 0, column: 0 }, 'unfinished');
    assert.equal(api.execute(rows()).code, 'PENDING_EDIT'); assert.equal(api.getWorkbook(), before);
    ui.c.cancelEdit(); assert.equal(api.execute(rows()).ok, true);
  });
  assert.equal(nested.code, 'BUSY'); assert.equal(changes, 1); assert.equal(api.getHistoryState().undoCount, 1);
});

test('pending lookup cannot apply after denial, abort, unmount or revoked edit permissions', async t => {
  for (const mode of ['denied', 'abort', 'unmount', 'readonly', 'feature']) {
    const permission = deferred(), abort = new AbortController(), changes = [];
    const ui = await mount(t, { onEditRequest: () => permission.promise, onChange: value => changes.push(value) });
    const api = ui.api, before = api.getWorkbook(); let pending, result;
    await act(async () => { pending = api.executeAsync(rows({ updates: [{ column: 2, value: '=1+1' }] }), { signal: abort.signal }); });
    if (mode === 'abort') await act(async () => abort.abort());
    if (mode === 'unmount') await ui.unmount();
    if (mode === 'readonly') await ui.update({ readOnly: true });
    if (mode === 'feature') await ui.update({ features: { formulas: false } });
    await act(async () => { permission.resolve(mode !== 'denied'); result = await pending; });
    assert.equal(result.ok, false, mode); assert.equal(api.getWorkbook(), before, mode);
    assert.equal(changes.length, 0, mode); assert.equal(api.getHistoryState().undoCount, 0, mode);
  }
});
