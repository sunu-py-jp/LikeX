import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = value => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 5, cells: { A1: { value } } }] });
const set = value => ({ type: 'cells.set', sheetId: 'main', values: { A1: value } });
async function mount(t, overrides = {}) {
  const ref = createRef(); let renderer, unmounted = false;
  let props = { ref, initialWorkbook: book('before'), onSave() {}, ...overrides };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}

test('export returns the current draft as XLSX without saving, requesting a lease, or clearing dirty history', async t => {
  const events = []; let saves = 0, edits = 0;
  const ui = await mount(t, { onSave: () => { saves++; }, onEditRequest: () => { edits++; return true; }, onEvent: e => events.push(e) });
  await act(async () => { assert.equal((await ui.ref.current.executeAsync(set('unsaved draft'))).ok, true); });
  const before = ui.ref.current.getWorkbook(), beforeEdit = edits;
  let blob;
  await act(async () => { blob = await ui.ref.current.exportExcel(); });
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(await blob.text(), /unsaved draft/);
  assert.equal(ui.ref.current.getWorkbook(), before); assert.equal(edits, beforeEdit); assert.equal(saves, 0);
  assert.equal(ui.root.findByProps({ className: 'lxs-save' }).props.disabled, false);
  const exports = events.filter(e => e.type === 'export');
  assert.deepEqual(exports.map(e => e.status), ['start', 'success']);
  assert.equal(exports[0].requestId, exports[1].requestId); assert.equal(exports[1].size, blob.size);
  assert.equal(exports[0].workbook, before);
});

test('read-only exports are allowed while feature false hides the button and rejects the handle', async t => {
  const ui = await mount(t, { onSave: undefined });
  assert.equal(ui.root.findByProps({ 'aria-label': 'Excelにエクスポート' }).props.disabled, false);
  await act(async () => assert.ok(await ui.ref.current.exportExcel() instanceof Blob));
  await ui.update({ features: { exportExcel: false } });
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Excelにエクスポート' }).length, 0);
  await assert.rejects(ui.ref.current.exportExcel(), /無効/);
});

test('export handle refuses unfinished input instead of exporting a stale cell value', async t => {
  const ui = await mount(t);
  const cell = ui.root.findByProps({ 'aria-label': 'A1 before' });
  await act(async () => cell.props.onDoubleClick());
  const input = ui.root.findByProps({ 'aria-label': 'A1の値' });
  await act(async () => input.props.onChange({ target: { value: 'unfinished' } }));
  await assert.rejects(ui.ref.current.exportExcel(), /確定/);
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
});

test('export captures one snapshot even when the host edits in the start notification', async t => {
  let api, changed = false; const events = [];
  const ui = await mount(t, { onEvent(e) {
    events.push(e);
    if (e.type === 'export' && e.status === 'start' && !changed) { changed = true; api.execute(set('newer draft')); }
  } }); api = ui.ref.current;
  let blob;
  await act(async () => { blob = await api.exportExcel(); });
  const text = await blob.text(); assert.match(text, /before/); assert.doesNotMatch(text, /newer draft/);
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'newer draft');
  assert.deepEqual(events.filter(e => e.type === 'export').map(e => e.status), ['start', 'success']);
});

test('cancellation and failed conversion emit distinct outcomes and do not prevent a later export', async t => {
  const controller = new AbortController(), events = []; let cancel = true;
  const ui = await mount(t, { onEvent(e) { events.push(e); if (cancel && e.type === 'export' && e.status === 'start') controller.abort(); } });
  await act(async () => { await assert.rejects(ui.ref.current.exportExcel({ signal: controller.signal }), { name: 'AbortError' }); });
  cancel = false;
  await act(async () => assert.ok(await ui.ref.current.exportExcel() instanceof Blob));
  await act(async () => ui.ref.current.execute(set('=WEBSERVICE("https://example.invalid")')));
  await act(async () => { await assert.rejects(ui.ref.current.exportExcel()); });
  assert.deepEqual(events.filter(e => e.type === 'export').map(e => e.status), ['start', 'cancelled', 'start', 'success', 'start', 'error']);
});

test('concurrent requests reject and a captured handle stops after unmount', async t => {
  const ui = await mount(t); const api = ui.ref.current;
  await act(async () => {
    const first = api.exportExcel();
    await assert.rejects(api.exportExcel(), /処理/);
    await first;
  });
  await ui.unmount(); await assert.rejects(api.exportExcel(), /表示/);
});

test('a synchronous export from a save-start observer respects the live operation guard', async t => {
  let api, rejected; const events = [];
  const ui = await mount(t, { onEvent(e) {
    events.push(e);
    if (e.type === 'save' && e.status === 'start') rejected = api.exportExcel().catch(error => error);
  } }); api = ui.ref.current;
  await act(async () => { api.execute(set('save draft')); await api.save(); });
  assert.match((await rejected).message, /処理/);
  assert.equal(events.filter(e => e.type === 'export').length, 0);
});

test('unmount aborts an export already started and never reports a late success', async t => {
  const events = [];
  const ui = await mount(t, { onEvent: event => events.push(event) });
  let outcome;
  await act(async () => {
    outcome = ui.ref.current.exportExcel().then(() => 'success', error => error.name);
    await ui.unmount();
  });
  assert.equal(await outcome, 'AbortError');
  assert.equal(events.filter(e => e.type === 'export' && e.status === 'success').length, 0);
});
