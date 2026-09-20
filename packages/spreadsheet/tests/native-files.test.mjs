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
const { Spreadsheet, normalizeWorkbook, parseWorkbook, serializeWorkbook, SPREADSHEET_FORMAT, SPREADSHEET_LIMITS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const namesOutput = await build({ entryPoints: [new URL('../src/export/download-workbook.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { workbookDownloadName, downloadWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(namesOutput.outputFiles[0].text).toString('base64')}`);
const book = value => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 5, cells: { A1: { value }, B1: { value: '=A1*2' } } }] });
const file = (value = 'imported', name = 'legacy.json') => new File([JSON.stringify(book(value))], name, { type: 'application/json' });
const set = value => ({ type: 'cells.set', sheetId: 'main', values: { A1: value } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function mount(t, overrides = {}) {
  const ref = createRef(); let renderer, unmounted = false;
  let props = { ref, initialWorkbook: book('before'), onSave() {}, ...overrides };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}

test('native snapshots identify their format, accept legacy JSON and reject another format/version', () => {
  for (const legacy of [book('legacy'), { ...book('legacy'), schemaVersion: 1 }]) {
    const restored = parseWorkbook(JSON.stringify(legacy));
    assert.equal(restored.format, SPREADSHEET_FORMAT); assert.equal(restored.schemaVersion, 1);
    assert.deepEqual(parseWorkbook(serializeWorkbook(restored)), restored);
  }
  for (const format of ['likex.slide', 'other', null, 1]) assert.throws(() => normalizeWorkbook({ ...book('bad'), format }), /形式/);
  assert.throws(() => parseWorkbook(JSON.stringify({ ...book('bad'), schemaVersion: 2 })), /未対応/);
  assert.throws(() => parseWorkbook('{broken'), /JSON/);
  assert.throws(() => parseWorkbook(' '.repeat(SPREADSHEET_LIMITS.serializedCharacters + 1)), /64 Mi/);
});

test('native import is one permission-checked undoable edit and events use spon, independent of filename', async t => {
  const events = [], permissions = []; let saves = 0;
  const ui = await mount(t, { onSave() { saves++; }, onEditRequest: request => { permissions.push(request); return true; }, onEvent: e => events.push(e) });
  const before = ui.ref.current.getWorkbook(); let result;
  await act(async () => { result = await ui.ref.current.importNative(file('after', 'renamed.data')); });
  assert.equal(result.workbook, ui.ref.current.getWorkbook()); assert.deepEqual(result.warnings, []);
  assert.equal(result.workbook.sheets[0].cells.A1.value, 'after'); assert.equal(saves, 0);
  assert.equal(permissions[0].action, 'importNative'); assert.equal(permissions[0].source, 'api');
  assert.deepEqual(events.filter(e => e.type === 'import').map(e => [e.format, e.status]), [['spon', 'start'], ['spon', 'success']]);
  await act(async () => assert.equal(await ui.ref.current.undo(), true)); assert.equal(ui.ref.current.getWorkbook(), before);
  await act(async () => assert.equal(await ui.ref.current.redo(), true));
  await act(async () => assert.equal(await ui.ref.current.save(), true)); assert.equal(saves, 1);
});

test('dirty and unfinished input require consent and rejected native files preserve both', async t => {
  const events = [], ui = await mount(t, { onEvent: e => events.push(e) });
  await act(async () => ui.ref.current.execute(set('local')));
  await assert.rejects(ui.ref.current.importNative(file()), /未保存/);
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'unfinished' } }));
  for (const json of ['{broken', JSON.stringify({ ...book('bad'), format: 'likex.slide' })]) {
    await act(async () => { await assert.rejects(ui.ref.current.importNative(new Blob([json]), { discardChanges: true })); });
    assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
    assert.equal(ui.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'unfinished');
  }
  await act(async () => { await ui.ref.current.importNative(file(), { discardChanges: true }); });
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'imported');
  assert.deepEqual(events.filter(e => e.type === 'import').map(e => e.status), ['start', 'error', 'start', 'error', 'start', 'success']);
});

test('native export emits JSON and preserves dirty history without save or edit permission', async t => {
  const events = []; let saves = 0;
  const ui = await mount(t, { onSave() { saves++; }, onEvent: e => events.push(e) });
  await act(async () => ui.ref.current.execute(set('draft')));
  const before = ui.ref.current.getWorkbook(); let blob;
  await act(async () => { blob = await ui.ref.current.exportNative(); });
  assert.equal(blob.type, 'application/json'); assert.equal(serializeWorkbook(parseWorkbook(await blob.text())), serializeWorkbook(before));
  assert.equal(ui.ref.current.getWorkbook(), before); assert.equal(ui.ref.current.getHistoryState().canUndo, true); assert.equal(saves, 0);
  assert.deepEqual(events.filter(e => e.type === 'export').map(e => [e.format, e.status]), [['spon', 'start'], ['spon', 'success']]);
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'unfinished' } }));
  await assert.rejects(ui.ref.current.exportNative(), /確定/);
});

test('native read cancellation blocks overlapping native/Excel operations and stale reads never overwrite edits', async t => {
  const events = [], ui = await mount(t, { onEvent: e => events.push(e) });
  const read = deferred(), controller = new AbortController(); let outcome;
  const blob = new Blob(['delayed']); blob.text = () => read.promise;
  await act(async () => { outcome = ui.ref.current.importNative(blob, { signal: controller.signal }).catch(e => e); });
  await assert.rejects(ui.ref.current.importNative(file()), /処理/);
  await assert.rejects(ui.ref.current.importExcel(new Blob()), /処理/);
  await assert.rejects(ui.ref.current.exportNative(), /処理/); await assert.rejects(ui.ref.current.exportExcel(), /処理/);
  assert.equal(await ui.ref.current.save(), false);
  await act(async () => controller.abort()); assert.equal((await outcome).name, 'AbortError');
  await act(async () => ui.ref.current.execute(set('newer')));
  await act(async () => read.resolve(JSON.stringify(book('late'))));
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'newer');
  const otherRead = deferred(); blob.text = () => otherRead.promise;
  await act(async () => { outcome = ui.ref.current.importNative(blob, { discardChanges: true }).catch(e => e); });
  await act(async () => ui.ref.current.execute(set('newest')));
  await act(async () => otherRead.resolve(JSON.stringify(book('stale'))));
  assert.equal((await outcome).name, 'AbortError'); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'newest');
  assert.equal(events.filter(e => e.type === 'import' && e.status === 'success').length, 0);
});

test('native feature changes, readonly and unmount cancel waiting imports; readonly still exports', async t => {
  const ui = await mount(t, { readOnly: true });
  await assert.rejects(ui.ref.current.importNative(file()), /読み取り専用/);
  await act(async () => assert.ok(await ui.ref.current.exportNative() instanceof Blob));
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'SPONからインポート' }).length, 0);
  for (const patch of [{ features: { importNative: false } }, { readOnly: true }]) {
    await ui.update({ features: {}, readOnly: false }); const read = deferred(), blob = new Blob(); blob.text = () => read.promise; let outcome;
    await act(async () => { outcome = ui.ref.current.importNative(blob).catch(e => e); });
    await ui.update(patch); assert.equal((await outcome).name, 'AbortError');
    await act(async () => read.resolve(JSON.stringify(book('late'))));
  }
  await ui.update({ readOnly: false, features: { importNative: false, exportNative: false } });
  await assert.rejects(ui.ref.current.importNative(file()), /無効/); await assert.rejects(ui.ref.current.exportNative(), /無効/);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'SPONにエクスポート' }).length, 0);
  await ui.update({ features: {} }); const read = deferred(), blob = new Blob(); blob.text = () => read.promise; const api = ui.ref.current; let outcome;
  await act(async () => { outcome = api.importNative(blob).catch(e => e); });
  await ui.unmount(); assert.equal((await outcome).name, 'AbortError');
  await assert.rejects(api.importNative(file()), /表示/); await assert.rejects(api.exportNative(), /表示/);
});

test('native permission cancellation aborts its request without changing workbook', async t => {
  const permission = deferred(), controller = new AbortController(); let context, outcome;
  const ui = await mount(t, { onEditRequest: (_request, current) => { context = current; return permission.promise; } });
  await act(async () => { outcome = ui.ref.current.importNative(file(), { signal: controller.signal }).catch(e => e); await tick(); });
  assert.equal(ui.ref.current.getEditState().mode, 'requesting');
  await act(async () => controller.abort()); assert.equal((await outcome).name, 'AbortError'); assert.equal(context.signal.aborted, true);
  await act(async () => permission.resolve(true)); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
});

test('native export supports abort and rejects concurrent Excel export', async t => {
  const events = [], controller = new AbortController(); let cancel = true;
  const ui = await mount(t, { onEvent(e) { events.push(e); if (cancel && e.type === 'export' && e.status === 'start') controller.abort(); } });
  await act(async () => { await assert.rejects(ui.ref.current.exportNative({ signal: controller.signal }), { name: 'AbortError' }); });
  cancel = false;
  await act(async () => { const first = ui.ref.current.exportNative(); await assert.rejects(ui.ref.current.exportExcel(), /処理/); await first; });
  assert.deepEqual(events.filter(e => e.type === 'export').map(e => e.status), ['start', 'cancelled', 'start', 'success']);
});

test('native file controls accept legacy JSON, confirm dirty input and publish through UI source', async t => {
  const events = [], ui = await mount(t, { onEvent: e => events.push(e) });
  const native = ui.root.findByProps({ 'aria-label': '取り込むSPONファイル' });
  assert.equal(native.props.accept, '.spon,.json,application/json');
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Excelからインポート' }).length, 1);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'SPONにエクスポート' }).length, 1);
  await act(async () => ui.ref.current.execute(set('local')));
  const target = { files: [file()], value: 'legacy.json' };
  await act(async () => native.props.onChange({ currentTarget: target }));
  assert.equal(target.value, ''); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.match(ui.root.findByProps({ role: 'alertdialog' }).findByType('h2').children.join(''), /SPON/);
  await act(async () => { ui.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick(); await tick(); });
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'imported');
  assert.equal(events.filter(e => e.type === 'change').at(-1).source, 'ui');
});

test('native download names replace existing extensions and trigger the owner document download', () => {
  for (const value of ['sales.xlsx', 'sales.spon', 'sales.json', 'sales']) assert.equal(workbookDownloadName(value, 'spon'), 'sales.spon');
  assert.equal(workbookDownloadName('sales.spon', 'xlsx'), 'sales.xlsx');
  assert.equal(workbookDownloadName('', 'spon'), 'spreadsheet.spon');
  let clicked = false, removed = false; const anchor = { click() { clicked = true; }, remove() { removed = true; } };
  downloadWorkbook(new Blob(['{}']), 'sales.xlsx', 'spon', { defaultView: { setTimeout() {} }, createElement: () => anchor, body: { append() {} } });
  assert.equal(anchor.download, 'sales.spon'); assert.equal(clicked, true); assert.equal(removed, true); URL.revokeObjectURL(anchor.href);
});

test('disabling Excel import leaves an active native UI import running', async t => {
  const events = [], ui = await mount(t, { onEvent: e => events.push(e) });
  const read = deferred(), pending = file(); pending.text = () => read.promise;
  await act(async () => ui.root.findByProps({ 'aria-label': '取り込むSPONファイル' }).props.onChange({ currentTarget: { files: [pending], value: 'legacy.json' } }));
  await ui.update({ features: { importExcel: false } });
  assert.equal(events.filter(e => e.type === 'import' && e.status === 'cancelled').length, 0);
  await act(async () => { read.resolve(JSON.stringify(book('native after flag change'))); await tick(); });
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'native after flag change');
});
