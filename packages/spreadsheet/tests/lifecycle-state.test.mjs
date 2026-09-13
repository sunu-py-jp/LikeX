import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Activity, act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/api/use-spreadsheet-handle";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'lifecycle-state-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetHandle } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (value = 'old') => ({ sheets: [{ id: 'one', name: 'One', rowCount: 20, columnCount: 8, cells: { A1: { value } } }] });
const set = (value, address = 'A1') => ({ type: 'cells.set', sheetId: 'one', values: { [address]: value } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
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

test('sync commands require explicit permission while no-ops and invalid commands do not acquire a lease', async t => {
  let requests = 0;
  const ui = await mount(t, { onEditRequest() { requests++; return true; } });
  assert.equal(ui.api.execute(set('old')).changed, false);
  assert.equal(ui.api.batch(null).code, 'INVALID_COMMAND');
  assert.equal(ui.api.batch(undefined).code, 'INVALID_COMMAND');
  assert.equal(ui.api.execute({ ...set('bad'), sheetId: 'missing' }).code, 'INVALID_TARGET');
  assert.equal(ui.api.execute(set('new')).code, 'EDIT_REQUIRED');
  assert.equal(requests, 0);
  await act(async () => { assert.equal(ui.api.requestEdit(), true); assert.equal(ui.api.execute(set('new')).ok, true); });
  assert.equal(requests, 1);
});

test('async command permission is single-flight and has one lease, transaction, and undo entry', async t => {
  const pending = deferred(), events = []; let context, requests = 0, changes = 0, operation;
  const ui = await mount(t, { onChange() { changes++; }, onEvent: event => events.push(event),
    onEditRequest(request, ctx) { requests++; context = ctx; assert.equal(request.source, 'api'); return pending.promise; } });
  await act(async () => {
    operation = ui.api.batchAsync([set('first'), set('second', 'B1')]);
    assert.equal(ui.api.execute(set('other')).code, 'EDIT_PENDING');
    assert.equal((await ui.api.executeAsync(set('other'))).code, 'EDIT_PENDING');
  });
  assert.equal(ui.c.requesting, true); assert.equal(context.signal.aborted, false);
  await act(async () => { pending.resolve(true); assert.equal((await operation).ok, true); });
  assert.equal(changes, 1); assert.equal(requests, 1); assert.equal(ui.c.requesting, false);
  assert.equal(ui.api.getEditState().mode, 'edit'); assert.equal(context.signal.aborted, false);
  assert.deepEqual(events.filter(e => e.type === 'edit-mode').map(e => e.reason), ['request', 'granted']);
  await act(async () => ui.c.undo());
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'old');
  assert.equal(ui.api.getWorkbook().sheets[0].cells.B1, undefined);
});

test('denied GUI edits preserve editor input and never change the committed draft', async t => {
  const ui = await mount(t, { onEditRequest: () => false });
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'typed'));
  await act(async () => assert.equal(await ui.c.commitEdit(), false));
  assert.equal(ui.c.editing.value, 'typed'); assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'old');
  assert.match(ui.c.error, /他のユーザー/); assert.equal(ui.c.hasUnsavedChanges, true); assert.equal(ui.c.dirty, false);
});

test('cancelling a pending editor cancels its permission and late approval cannot restore old text', async t => {
  const pending = deferred(); let context, operation;
  const ui = await mount(t, { onEditRequest(_request, ctx) { context = ctx; return pending.promise; } });
  await act(async () => { ui.c.beginEdit({ row: 0, column: 0 }, 'cancelled'); operation = ui.c.commitEdit(); });
  await act(async () => { ui.c.cancelEdit(); assert.equal(await operation, false); });
  assert.equal(context.signal.aborted, true); assert.equal(ui.c.editing, null);
  await act(async () => pending.resolve(true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'old'); assert.equal(ui.api.getEditState().mode, 'view');
});

test('a fresh baseline cancels stale GUI coordinates but async API targets the fresh workbook', async t => {
  const newer = book('server'); newer.sheets[0].cells.B1 = { value: 'remote' };
  const ui = await mount(t, { onEditRequest: () => ({ allowed: true, workbook: newer }) });
  await act(async () => { assert.equal((await ui.c.executeCommand(set('old GUI intent'))).code, 'STALE_TARGET'); });
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'server'); assert.equal(ui.c.dirty, false);
  await act(async () => ui.api.endEdit());
  await act(async () => { assert.equal((await ui.api.executeAsync(set('API intent'))).ok, true); });
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'API intent');
  assert.equal(ui.api.getWorkbook().sheets[0].cells.B1.value, 'remote');
});

test('save validation cancellation retains changes and the editing lease', async t => {
  const events = []; let writes = 0, editContext, saveContext;
  const ui = await mount(t, { onEvent: event => events.push(event), onEditRequest(_request, context) { editContext = context; return true; },
    onBeforeSave(_snapshot, context) { saveContext = context; return false; }, onSave() { writes++; } });
  await act(async () => ui.api.executeAsync(set('dirty')));
  await act(async () => assert.equal(await ui.api.save(), false));
  assert.equal(writes, 0); assert.equal(ui.c.dirty, true); assert.equal(ui.api.getEditState().mode, 'edit');
  assert.equal(editContext.signal.aborted, false); assert.equal(saveContext.signal.aborted, true);
  assert.deepEqual(events.filter(e => e.type === 'save').map(e => e.status), ['start', 'cancelled']);
});

test('save failures keep dirty data; success updates baseline before releasing the editing lease', async t => {
  const events = []; let context, fail = true;
  const ui = await mount(t, { onEvent: event => events.push(event), onEditRequest(_request, ctx) { context = ctx; return true; },
    onSave() { if (fail) throw new Error('storage failure'); return book('accepted'); } });
  await act(async () => ui.api.executeAsync(set('local')));
  await act(async () => assert.equal(await ui.api.save(), false));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'local'); assert.equal(ui.c.dirty, true);
  assert.equal(ui.api.getHistoryState().undoCount, 1);
  assert.equal(context.signal.aborted, false); assert.equal(ui.api.getEditState().mode, 'edit');
  fail = false;
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'accepted'); assert.equal(ui.c.dirty, false);
  assert.equal(context.signal.aborted, true); assert.equal(ui.api.getEditState().mode, 'view');
  const success = events.findIndex(e => e.type === 'save' && e.status === 'success');
  assert.equal(events[success + 1].reason, 'saved');
  assert.equal(ui.api.getHistoryState().undoCount, 1, 'saving does not record or remove an operation');
  await act(async () => assert.equal(await ui.api.undo(), true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'old'); assert.equal(ui.c.dirty, true);
  await act(async () => assert.equal(await ui.api.redo(), true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'accepted'); assert.equal(ui.c.dirty, false);
});

test('saving in the middle of history keeps both stacks and dirty state follows the latest save', async t => {
  const dirty = []; let writes = 0;
  const ui = await mount(t, { onSave() { writes++; }, onDirtyChange: value => dirty.push(value) });
  await act(async () => { ui.api.execute(set('first')); ui.api.execute(set('second')); });
  await act(async () => assert.equal(await ui.api.undo(), true));
  const history = ui.api.getHistoryState();
  assert.deepEqual(history, { canUndo: true, canRedo: true, undoCount: 1, redoCount: 1 });
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.deepEqual(ui.api.getHistoryState(), history); assert.equal(ui.c.hasUnsavedChanges, false);
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.equal(writes, 1, 'saving unchanged data does not write or erase Redo');
  assert.deepEqual(ui.api.getHistoryState(), history);
  await act(async () => assert.equal(await ui.api.redo(), true));
  assert.equal(ui.api.getCell('one', 'A1').value, 'second'); assert.equal(ui.c.hasUnsavedChanges, true);
  await act(async () => assert.equal(await ui.api.undo(), true));
  assert.equal(ui.api.getCell('one', 'A1').value, 'first'); assert.equal(ui.c.hasUnsavedChanges, false);
  await act(async () => assert.equal(await ui.api.undo(), true));
  assert.equal(ui.api.getCell('one', 'A1').value, 'old'); assert.equal(ui.c.hasUnsavedChanges, true);
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.equal(ui.c.hasUnsavedChanges, false); assert.equal(ui.api.getHistoryState().redoCount, 2);
  await act(async () => { assert.equal(await ui.api.redo(), true); assert.equal(await ui.api.redo(), true); });
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.equal(ui.api.getHistoryState().undoCount, 2); assert.equal(ui.c.hasUnsavedChanges, false);
  await act(async () => { assert.equal(await ui.api.undo(), true); ui.api.execute(set('branch')); });
  assert.equal(ui.api.getHistoryState().redoCount, 0, 'a new change still invalidates the future branch');
  assert.equal(writes, 3);
  assert.deepEqual(dirty.slice(0, 5), [false, true, false, true, false]);
});

test('post-save Undo waits for a new edit lease and denial preserves history', async t => {
  const requests = []; let response = true;
  const ui = await mount(t, { onEditRequest: request => { requests.push(request.action); return response; } });
  await act(async () => ui.api.executeAsync(set('saved')));
  await act(async () => assert.equal(await ui.api.save(), true));
  response = false;
  await act(async () => assert.equal(await ui.api.undo(), false));
  assert.equal(ui.api.getCell('one', 'A1').value, 'saved'); assert.equal(ui.c.dirty, false);
  assert.equal(ui.api.getHistoryState().undoCount, 1);
  const pending = deferred(); response = pending.promise;
  let undo;
  await act(async () => { undo = ui.api.undo(); });
  assert.equal(ui.api.getHistoryState().undoCount, 1); assert.equal(ui.c.requesting, true);
  await act(async () => { pending.resolve({ allowed: true, workbook: book('saved') }); assert.equal(await undo, true); });
  assert.equal(ui.api.getCell('one', 'A1').value, 'old'); assert.equal(ui.c.dirty, true);
  assert.deepEqual(requests, ['cells.set', 'undo', 'undo']);
});

test('saved history ends on explicit reload, discard, authoritative replacement or remount', async t => {
  for (const boundary of ['refresh', 'discard', 'replace', 'remount']) {
    const ui = await mount(t, { onRefresh: () => book('loaded') });
    await act(async () => ui.api.execute(set('saved')));
    await act(async () => assert.equal(await ui.api.save(), true));
    const saved = ui.api.getWorkbook();
    await ui.update({ initialWorkbook: saved });
    assert.equal(ui.api.getHistoryState().undoCount, 1, 'a parent echo does not reset the session');
    if (boundary === 'refresh') await act(async () => assert.equal(await ui.api.refresh(), true));
    else if (boundary === 'discard') {
      await act(async () => assert.equal(await ui.api.undo(), true));
      await act(async () => assert.equal(ui.api.discard({ discardChanges: true }), true));
      assert.equal(ui.api.getCell('one', 'A1').value, 'saved');
    } else if (boundary === 'replace') {
      await ui.update({ onEditRequest: () => ({ allowed: true, workbook: book('remote') }) });
      await act(async () => assert.equal(await ui.api.undo(), false));
      assert.equal(ui.api.getCell('one', 'A1').value, 'remote');
    } else {
      await ui.unmount();
      const reopened = await mount(t, { initialWorkbook: saved });
      assert.equal(reopened.api.getHistoryState().undoCount, 0);
      assert.equal(reopened.api.getCell('one', 'A1').value, 'saved');
      continue;
    }
    assert.deepEqual(ui.api.getHistoryState(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
    assert.equal(ui.c.dirty, false);
  }
});

test('saving after readonly releases a lease reacquires permission before persistence', async t => {
  const actions = []; let writes = 0;
  const ui = await mount(t, { onEditRequest(request) { actions.push(request.action); return true; }, onSave() { writes++; } });
  await act(async () => ui.api.executeAsync(set('dirty')));
  await ui.update({ readOnly: true }); assert.equal(ui.api.getEditState().mode, 'view');
  await ui.update({ readOnly: false });
  await act(async () => assert.equal(await ui.api.save(), true));
  assert.deepEqual(actions, ['cells.set', 'save']); assert.equal(writes, 1);
});

test('a policy change during beforeSave prevents a new host write', async t => {
  const validation = deferred(); let writes = 0, saving;
  const ui = await mount(t, { onBeforeSave: () => validation.promise, onSave() { writes++; } });
  await act(async () => { ui.api.execute(set('dirty')); saving = ui.api.save(); });
  await ui.update({ readOnly: true });
  await act(async () => { validation.resolve(true); assert.equal(await saving, false); });
  assert.equal(writes, 0); assert.equal(ui.c.dirty, true); assert.equal(ui.c.saving, false);
});

test('refresh requires explicit discard consent and is available in a readonly view', async t => {
  let reads = 0;
  const ui = await mount(t, { onRefresh() { reads++; return book('loaded'); } });
  await act(async () => ui.api.execute(set('dirty')));
  await act(async () => assert.equal(await ui.api.refresh(), false));
  assert.equal(reads, 0);
  await act(async () => assert.equal(await ui.api.refresh({ discardChanges: true }), true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'loaded'); assert.equal(ui.c.dirty, false);
  await ui.update({ onSave: undefined });
  await act(async () => assert.equal(await ui.api.refresh(), true));
  assert.equal(reads, 2);
});

test('refresh failure keeps draft and lease; save and refresh mutually exclude each other', async t => {
  const wait = deferred(); let operation;
  const ui = await mount(t, { onRefresh: () => wait.promise });
  await act(async () => { ui.api.execute(set('dirty')); operation = ui.api.refresh({ discardChanges: true }); });
  assert.equal(ui.c.refreshing, true); assert.equal(ui.api.execute(set('blocked')).code, 'REFRESHING');
  await act(async () => assert.equal(await ui.api.save(), false));
  await act(async () => { wait.reject(new Error('read failed')); assert.equal(await operation, false); });
  assert.equal(ui.c.refreshing, false); assert.equal(ui.c.dirty, true); assert.equal(ui.api.getEditState().mode, 'edit');
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'dirty');
});

test('discard clears the draft only with explicit consent and ends the edit lease', async t => {
  let context;
  const ui = await mount(t, { onEditRequest(_r, ctx) { context = ctx; return true; } });
  await act(async () => ui.api.executeAsync(set('dirty')));
  await act(async () => assert.equal(ui.api.discard(), false));
  await act(async () => assert.equal(ui.api.discard({ discardChanges: true }), true));
  assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'old'); assert.equal(ui.c.dirty, false);
  assert.equal(context.signal.aborted, true); assert.equal(ui.api.getEditState().mode, 'view');
});

test('unmount aborts editing and persistence contexts and ignores late storage responses', async t => {
  const wait = deferred(); let editContext, saveContext, saving;
  const ui = await mount(t, { onEditRequest(_r, ctx) { editContext = ctx; return true; },
    onSave(_wb, ctx) { saveContext = ctx; return wait.promise; } });
  const handle = ui.api;
  await act(async () => { await handle.executeAsync(set('local')); saving = handle.save(); });
  await ui.unmount();
  assert.equal(editContext.signal.aborted, true); assert.equal(saveContext.signal.aborted, true);
  wait.resolve(book('late')); assert.equal(await saving, false);
  assert.equal(handle.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.equal((await handle.executeAsync(set('late write'))).code, 'NOT_MOUNTED');
});

test('disabled save and refresh stop programmatic callbacks', async t => {
  let writes = 0, reads = 0;
  const ui = await mount(t, { features: { save: false, refresh: false }, onSave() { writes++; }, onRefresh() { reads++; return book(); } });
  await act(async () => ui.api.execute(set('dirty')));
  await act(async () => { assert.equal(await ui.api.save(), false); assert.equal(await ui.api.refresh({ discardChanges: true }), false); });
  assert.equal(writes, 0); assert.equal(reads, 0); assert.equal(ui.c.canRefresh, false);
});

test('an invalid host save response does not silently accept the local draft', async t => {
  const ui = await mount(t, { onSave: () => null });
  await act(async () => ui.api.execute(set('local')));
  await act(async () => assert.equal(await ui.api.save(), false));
  assert.equal(ui.c.dirty, true); assert.equal(ui.api.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.equal(ui.api.getEditState().mode, 'edit'); assert.ok(ui.c.error);
});

test('observer exceptions cannot turn committed changes or successful saves into errors', async t => {
  const ui = await mount(t, { onEvent() { throw new Error('observer failure'); }, onChange() { return Promise.reject(new Error('observer failure')); } });
  await act(async () => { assert.equal(ui.api.execute(set('local')).ok, true); assert.equal(await ui.api.save(), true); });
  assert.equal(ui.c.error, null); assert.equal(ui.c.dirty, false);
});

test('a previous effect lifetime cannot accept a save response or clear a newer in-flight save', async t => {
  const oldResponse = deferred(), newResponse = deferred();
  let current, renderer, calls = 0, oldSave, newSave;
  const handleRef = createRef();
  const props = { initialWorkbook: book(), onSave: () => (++calls === 1 ? oldResponse.promise : newResponse.promise) };
  function Probe() { current = useSpreadsheet(props); useSpreadsheetHandle(handleRef, current); return null; }
  const tree = mode => createElement(Activity, { mode }, createElement(Probe));
  await act(async () => { renderer = create(tree('visible')); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const retained = handleRef.current;
  await act(async () => { retained.execute(set('first')); oldSave = retained.save(); });
  await act(async () => renderer.update(tree('hidden')));
  assert.equal(retained.execute(set('hidden')).code, 'NOT_MOUNTED');
  await act(async () => renderer.update(tree('visible')));
  assert.equal(current.saving, false);
  await act(async () => { assert.equal(retained.execute(set('second')).ok, true); newSave = retained.save(); });
  await act(async () => { oldResponse.resolve(book('stale response')); assert.equal(await oldSave, false); });
  assert.equal(current.saving, true); assert.equal(retained.getWorkbook().sheets[0].cells.A1.value, 'second');
  await act(async () => { newResponse.resolve(book('accepted response')); assert.equal(await newSave, true); });
  assert.equal(current.saving, false); assert.equal(current.dirty, false);
  assert.equal(retained.getWorkbook().sheets[0].cells.A1.value, 'accepted response');
});
