import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/api/use-spreadsheet-handle";', resolveDir: packageRoot, sourcefile: 'command-state-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetHandle } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 260, columnCount: 8, cells: { A1: { value: '2' } } },
  { id: 'two', name: 'Two', rowCount: 20, columnCount: 8, cells: {} }] });
const set = (value, address = 'A1', sheetId = 'one') => ({ type: 'cells.set', sheetId, values: { [address]: value } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function mount(t, options = {}) {
  let current, renderer, unmounted = false;
  const handleRef = createRef();
  let props = { initialWorkbook: book(), onSave: value => value, ...options };
  function Probe({ props }) {
    current = useSpreadsheet(props);
    useSpreadsheetHandle(handleRef, current);
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe, { props })); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return {
    get c() { return current; }, get api() { return handleRef.current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe, { props }))); },
    unmount,
  };
}

test('the imperative handle and its methods stay stable and getWorkbook reads synchronous committed changes', async t => {
  const ui = await mount(t);
  const handle = ui.api;
  const methods = [handle.execute, handle.batch, handle.getWorkbook];
  await act(async () => {
    assert.equal(handle.execute(set('5')).ok, true);
    assert.equal(handle.getWorkbook().sheets[0].cells.A1.value, '5');
    assert.equal(handle.execute(set('7', 'B1')).ok, true);
    assert.equal(handle.getWorkbook().sheets[0].cells.B1.value, '7');
  });
  assert.equal(ui.api, handle);
  assert.deepEqual([ui.api.execute, ui.api.batch, ui.api.getWorkbook], methods);
  assert.equal(Object.isFrozen(handle.getWorkbook()), true);
  assert.throws(() => { handle.getWorkbook().sheets[0].cells.A1.value = 'bypass'; }, TypeError);
});

test('a batch commits one snapshot, one notification and one undo entry without exposing its workbook in the result', async t => {
  const changes = [];
  const ui = await mount(t, { onChange: wb => changes.push(wb) });
  let result;
  await act(async () => { result = ui.api.batch([set('4'), set('6', 'B1'), { type: 'cells.format', sheetId: 'one', addresses: ['A1'], format: { bold: true } }]); });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.results.length, 3);
  assert.equal('workbook' in result, false);
  assert.equal(changes.length, 1);
  await act(async () => ui.c.undo());
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, '2');
  assert.equal(ui.api.getWorkbook().sheets[0].cells.B1, undefined);
  assert.equal(ui.c.canUndo, false);
});

test('a later invalid command rejects a complete batch and identifies the failing command', async t => {
  let notifications = 0;
  const ui = await mount(t, { onChange() { notifications++; } });
  const before = ui.api.getWorkbook();
  let result;
  await act(async () => { result = ui.api.batch([set('4'), set('6', 'A1', 'missing')]); });
  assert.equal(result.ok, false);
  assert.equal(result.commandIndex, 1);
  assert.equal(ui.api.getWorkbook(), before);
  assert.equal(ui.c.canUndo, false);
  assert.equal(notifications, 0);
  assert.equal(ui.c.error, null);
});

test('a no-op and a batch whose net effect is unchanged do not create history or notifications', async t => {
  let notifications = 0;
  const ui = await mount(t, { onChange() { notifications++; } });
  const before = ui.api.getWorkbook();
  let result;
  await act(async () => {
    assert.deepEqual(ui.api.execute(set('2')), { ok: true, changed: false, results: [{ type: 'cells.set', sheetId: 'one' }] });
    result = ui.api.batch([set('9'), set('2')]);
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(ui.api.getWorkbook(), before);
  assert.equal(ui.c.canUndo, false);
  assert.equal(notifications, 0);
});

test('same-tick unfinished cell editing blocks external commands until it is committed or cancelled', async t => {
  const ui = await mount(t);
  await act(async () => {
    ui.c.beginEdit({ row: 0, column: 0 }, 'draft');
    assert.equal(ui.api.execute(set('override')).code, 'PENDING_EDIT');
    assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, '2');
    ui.c.cancelEdit();
    assert.equal(ui.api.execute(set('accepted')).ok, true);
  });
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'accepted');
});

test('all pending object editor owners must finish, while GUI commands can commit their own editor', async t => {
  const ui = await mount(t);
  const first = {}, second = {};
  await act(async () => {
    ui.c.setPendingObjectEdit(true, first); ui.c.setPendingObjectEdit(true, second);
    assert.equal(ui.api.execute(set('blocked')).code, 'PENDING_EDIT');
    ui.c.setPendingObjectEdit(false, first);
    assert.equal(ui.api.execute(set('still blocked')).code, 'PENDING_EDIT');
    assert.equal(ui.c.executeCommand(set('GUI')).ok, true);
    ui.c.setPendingObjectEdit(false, second);
    assert.equal(ui.api.execute(set('external')).ok, true);
  });
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'external');
});

test('omitted onSave, explicit readonly, and updated feature flags are enforced through a retained handle', async t => {
  const ui = await mount(t, { onSave: undefined });
  const handle = ui.api;
  assert.equal(handle.execute(set('3')).code, 'READ_ONLY');
  await ui.update({ onSave: value => value, readOnly: true });
  assert.equal(handle.execute(set('3')).code, 'READ_ONLY');
  await ui.update({ readOnly: false, features: { formulas: false } });
  await act(async () => { assert.equal(handle.execute(set('=1+1')).code, 'FEATURE_DISABLED'); });
  assert.equal(ui.c.error, null);
  await act(async () => { assert.equal(handle.execute(set('plain')).ok, true); });
  assert.equal(handle.getWorkbook().sheets[0].cells.A1.value, 'plain');
});

test('save immediately excludes external commands and history until its response is accepted', async t => {
  const pending = deferred();
  const saved = [];
  const ui = await mount(t, { onSave: wb => { saved.push(wb); return pending.promise; } });
  let saving;
  await act(async () => {
    ui.api.execute(set('8'));
    saving = ui.c.save();
    assert.equal(ui.api.execute(set('99')).code, 'SAVING');
    ui.c.undo();
    assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, '8');
  });
  assert.equal(saved.length, 1);
  await act(async () => { pending.resolve(); await saving; });
  assert.equal(ui.c.dirty, false);
  await act(async () => { assert.equal(ui.api.execute(set('10')).ok, true); });
});

test('onChange sees the committed snapshot but cannot reenter commands, undo or save', async t => {
  let ui, nestedResult, seen, changes = 0, saves = 0;
  ui = await mount(t, { onSave() { saves++; }, onChange(wb) {
    changes++; seen = ui.api.getWorkbook();
    assert.equal(seen, wb);
    nestedResult = ui.api.execute(set('reentrant'));
    ui.c.undo(); void ui.c.save();
  } });
  await act(async () => { assert.equal(ui.api.execute(set('accepted')).ok, true); });
  assert.equal(nestedResult.code, 'BUSY');
  assert.equal(seen.sheets[0].cells.A1.value, 'accepted');
  assert.equal(ui.api.getWorkbook(), seen);
  assert.equal(changes, 1);
  assert.equal(saves, 0);
});

test('save can commit its own editor while rejecting recursive save and external commands from notifications', async t => {
  let ui, duringCommit, duringSave, changes = 0, saves = 0;
  ui = await mount(t, { onChange() {
    changes++; duringCommit = ui.api.execute(set('reentrant'));
    void ui.c.save();
  }, onSave(wb) {
    saves++; duringSave = ui.api.execute(set('reentrant'));
    return wb;
  } });
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'editor'));
  await act(async () => ui.c.save());
  assert.equal(duringCommit.code, 'BUSY');
  assert.equal(duringSave.code, 'SAVING');
  assert.equal(changes, 1);
  assert.equal(saves, 1);
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'editor');
  assert.equal(ui.c.dirty, false);
});

test('selection preflight failure rolls back workbook, history, receipts and notifications atomically', async t => {
  let changes = 0;
  const ui = await mount(t, { onChange() { changes++; } });
  await act(async () => { for (let index = 1; index < 128; index++) ui.c.select({ row: index * 2, column: 0 }, false, true); });
  assert.equal(ui.c.selection.ranges.length, 128);
  const before = ui.api.getWorkbook(), selection = ui.c.selection;
  let result;
  await act(async () => { result = ui.api.execute({ type: 'cells.merge', sheetId: 'one', range: { top: 0, left: 0, bottom: 0, right: 1 } }); });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.equal('results' in result, false);
  assert.equal(ui.api.getWorkbook(), before);
  assert.equal(ui.c.selection, selection);
  assert.equal(ui.c.canUndo, false);
  assert.equal(changes, 0);
  assert.equal(ui.c.error, null);
});

test('explicit command targets are independent of the currently selected sheet', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.switchSheet('two'));
  await act(async () => { assert.equal(ui.api.execute(set('one changed')).ok, true); });
  assert.equal(ui.c.selection.sheetId, 'two');
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'one changed');
  assert.equal(ui.api.getWorkbook().sheets[1].cells.A1, undefined);
});

test('external failures remain return values while GUI failures retain visible error reporting', async t => {
  const ui = await mount(t);
  await act(async () => { assert.equal(ui.api.execute(set('bad', 'A1', 'missing')).ok, false); });
  assert.equal(ui.c.error, null);
  await act(async () => { assert.equal(ui.c.executeCommand(set('bad', 'A1', 'missing')).ok, false); });
  assert.ok(ui.c.error);
});

test('a retained handle refuses mutations after unmount and still exposes only the last immutable snapshot', async t => {
  let changes = 0;
  const ui = await mount(t, { onChange() { changes++; } });
  const handle = ui.api, before = handle.getWorkbook();
  await ui.unmount();
  assert.equal(ui.api, null);
  assert.equal(handle.execute(set('after unmount')).code, 'NOT_MOUNTED');
  assert.equal(handle.batch([set('after unmount')]).code, 'NOT_MOUNTED');
  assert.equal(handle.getWorkbook(), before);
  assert.equal(changes, 0);
});
