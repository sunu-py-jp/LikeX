import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/api/use-spreadsheet-handle"; export { createSpreadsheetSession } from "./src/model-entry";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'grid-grouping-session.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetHandle, createSpreadsheetSession } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 8, columnCount: 8,
  cells: { A1: { value: 'stable' }, D5: { value: 'existing' } } }] });
const grouped = (extra = {}) => ({ type: 'cells.writeGrid', sheetId: 'one', target: { row: 2, column: 1 },
  headers: ['担当者', '内容', '区分'], data: { type: 'rows', values: [['A', '方針を決める', '決定'], ['A', '準備する', 'TODO'], ['B', '確認する', 'TODO']] },
  rowGrouping: { byColumns: [0] }, insert: 'both', ...extra });
const table = (extra = {}) => ({ type: 'tables.insert', sheetId: 'one', name: 'Tasks', target: { row: 2, column: 1 },
  headers: ['内容', '区分'], data: { type: 'rows', values: [['準備する', 'TODO']] }, insert: 'columns', ...extra });
const set = value => ({ type: 'cells.set', sheetId: 'one', values: { A1: value } });
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

test('headless grouped insertion updates structural tokens, cell readers and one history entry', () => {
  const session = createSpreadsheetSession(book()), before = session.getMutationSnapshot(), reader = session.sheet('one');
  const result = session.execute(grouped({ insert: 'rows' }));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.results[0].range, { top: 2, left: 1, bottom: 5, right: 3 });
  assert.deepEqual(result.results[0].placement, { nextRow: 6, nextColumn: 4 });
  assert.equal(reader.getCell('D9').value, 'existing');
  assert.equal(reader.getCell('B4').value, 'A');
  assert.equal(reader.getCell('B5')?.value ?? '', '');
  assert.equal(reader.getCell('B6').value, 'B');
  assert.equal(session.getHistoryState().undoCount, 1);
  assert.ok(session.getMutationSnapshot().token.structureRevision > before.token.structureRevision);
  const conflict = session.execute(set('stale'), { expected: before });
  assert.equal(conflict.code, 'PRECONDITION_FAILED');
  assert.ok(conflict.editConflicts.some(item => item.path === 'token.structureRevision'));
  const after = session.getWorkbook();
  assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), before.workbook);
  assert.equal(session.undo(), false); assert.equal(session.redo(), true); assert.deepEqual(session.getWorkbook(), after);
});

test('headless structured table insertion shifts full columns and remains one transaction', () => {
  const session = createSpreadsheetSession(book()), before = session.getMutationSnapshot();
  const result = session.execute(table());
  assert.equal(result.ok, true, result.message);
  assert.equal(session.getCell('one', 'F5').value, 'existing');
  assert.equal(session.getWorkbook().sheets[0].columnCount, 10);
  assert.deepEqual(result.results[0].range, { top: 2, left: 1, bottom: 3, right: 2 });
  assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 3 });
  assert.equal(session.sheet('one').getTables().length, 1);
  assert.equal(session.execute(set('stale'), { expected: before }).code, 'PRECONDITION_FAILED');
  assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), before.workbook);
  assert.equal(session.getHistoryState().undoCount, 0);
});

test('group formatting without insertion does not invalidate unrelated positional edit tokens', () => {
  const session = createSpreadsheetSession(book()), expected = session.getMutationSnapshot();
  assert.equal(session.execute(grouped({ insert: 'none' })).ok, true);
  assert.equal(session.getMutationSnapshot().token.structureRevision, expected.token.structureRevision);
  assert.equal(session.execute(set('accepted'), { expected }).ok, true);
});

test('mounted grouped insertion captures input before permission and publishes a single undoable change', async t => {
  const permission = deferred(), changes = [], intents = [];
  const ui = await mount(t, { onEditRequest: request => { intents.push(request); return permission.promise; }, onChange: value => changes.push(value) });
  const command = grouped(), before = ui.api.getMutationSnapshot();
  let pending, result;
  await act(async () => { pending = ui.api.executeAsync(command); });
  assert.equal(ui.api.getWorkbook(), before.workbook); assert.equal(changes.length, 0);
  command.insert = 'none'; command.rowGrouping.byColumns[0] = 2; command.data.values[0][0] = 'changed';
  command.headers.push('later'); command.data.values.push(['later', 'later', 'later']);
  await act(async () => { permission.resolve(true); result = await pending; });
  assert.equal(result.ok, true, result.message); assert.equal(changes.length, 1); assert.equal(intents.length, 1);
  assert.equal(intents[0].action, 'cells.writeGrid');
  const after = ui.api.getWorkbook(), sheet = after.sheets[0];
  assert.equal(sheet.rowCount, 12); assert.equal(sheet.columnCount, 11);
  assert.equal(sheet.cells.G9.value, 'existing'); assert.equal(sheet.cells.B4.value, 'A');
  assert.equal(sheet.cells.B5?.value ?? '', '');
  assert.deepEqual(result.results[0].layout.dataRange, { top: 3, left: 1, bottom: 5, right: 3 });
  assert.deepEqual(result.results[0].placement, { nextRow: 6, nextColumn: 4 });
  assert.equal(ui.api.execute(set('stale'), { expected: before }).code, 'PRECONDITION_FAILED');
  await act(async () => { ui.c.select({ row: 11, column: 10 }); assert.equal(await ui.api.undo(), true); });
  assert.deepEqual(ui.api.getWorkbook(), before.workbook);
  assert.deepEqual(ui.c.selection.focus, { row: 7, column: 7 });
  assert.equal(ui.api.getHistoryState().undoCount, 0);
  await act(async () => assert.equal(await ui.api.redo(), true));
  assert.deepEqual(ui.api.getWorkbook(), after);
});

test('grid and table insertion respect readonly, formatting, structure and per-axis feature gates', async t => {
  for (const [command, options, expected] of [
    [grouped(), { readOnly: true }, 'READ_ONLY'],
    [grouped(), { onSave: undefined }, 'READ_ONLY'],
    [grouped(), { features: { formatting: false } }, 'FEATURE_DISABLED'],
    [grouped(), { features: { rowColumnOperations: false } }, 'FEATURE_DISABLED'],
    [grouped(), { features: { insertRows: false } }, 'FEATURE_DISABLED'],
    [grouped(), { features: { insertColumns: false } }, 'FEATURE_DISABLED'],
    [table(), { features: { tables: false } }, 'FEATURE_DISABLED'],
    [table(), { features: { insertColumns: false } }, 'FEATURE_DISABLED'],
  ]) {
    let requests = 0, changes = 0;
    const ui = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => changes++, ...options });
    const before = ui.api.getWorkbook(); let result;
    await act(async () => { result = await ui.api.executeAsync(command); });
    assert.equal(result.code, expected); assert.equal(ui.api.getWorkbook(), before);
    assert.equal(ui.api.getHistoryState().undoCount, 0); assert.equal(requests, 0); assert.equal(changes, 0);
  }
});

test('invalid grouping and a later failed batch command cannot leave inserted axes or request permission', async t => {
  let requests = 0, changes = 0;
  const ui = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => changes++ });
  const before = ui.api.getWorkbook();
  for (const commands of [
    [grouped({ rowGrouping: { byColumns: [3] } })],
    [grouped(), { type: 'cells.set', sheetId: 'missing', values: { A1: 'invalid' } }],
    [table(), { type: 'cells.set', sheetId: 'missing', values: { A1: 'invalid' } }],
  ]) {
    let result;
    await act(async () => { result = await ui.api.batchAsync(commands); });
    assert.equal(result.ok, false); assert.equal(ui.api.getWorkbook(), before);
    assert.equal(ui.api.getHistoryState().undoCount, 0);
  }
  assert.equal(requests, 0); assert.equal(changes, 0);
});

test('grid insertion obeys active editor and busy publication guards', async t => {
  let api, nested, changes = 0;
  const ui = await mount(t, { onChange: () => { changes++; nested = api.execute(grouped()); } });
  api = ui.api;
  const before = api.getWorkbook();
  await act(async () => {
    ui.c.beginEdit({ row: 0, column: 0 }, 'unfinished');
    assert.equal(api.execute(grouped()).code, 'PENDING_EDIT');
    assert.equal(api.getWorkbook(), before);
    ui.c.cancelEdit();
    assert.equal(api.execute(grouped()).ok, true);
  });
  assert.equal(nested.code, 'BUSY'); assert.equal(changes, 1);
  assert.equal(api.getWorkbook().sheets[0].rowCount, 12);
  assert.equal(api.getHistoryState().undoCount, 1);
});

test('pending grouped insertion cannot apply after denial, abort, unmount or permission/feature changes', async t => {
  for (const mode of ['denied', 'abort', 'unmount', 'readonly', 'feature']) {
    const permission = deferred(), abort = new AbortController(), changes = [];
    const ui = await mount(t, { onEditRequest: () => permission.promise, onChange: value => changes.push(value) });
    const api = ui.api, before = api.getWorkbook(); let pending, result;
    await act(async () => { pending = api.executeAsync(grouped(), { signal: abort.signal }); });
    if (mode === 'abort') await act(async () => abort.abort());
    if (mode === 'unmount') await ui.unmount();
    if (mode === 'readonly') await ui.update({ readOnly: true });
    if (mode === 'feature') await ui.update({ features: { insertColumns: false } });
    await act(async () => { permission.resolve(mode !== 'denied'); result = await pending; });
    assert.equal(result.ok, false, mode); assert.equal(api.getWorkbook(), before, mode);
    assert.equal(changes.length, 0, mode); assert.equal(api.getHistoryState().undoCount, 0, mode);
  }
});
