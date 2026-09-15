import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The decoder has independent archive/model tests. Control only its asynchronous
// boundary here to exercise edits, cancellation and permission races deterministically.
const decoderKey = '__likexXlsxLifecycleDecoder';
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'controlled-decoder', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/import\/import-xlsx$/ }, () => ({ path: 'decoder', namespace: 'test-decoder' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-decoder' }, () => ({ contents:
      `export const importSpreadsheetXlsx = (...args) => globalThis.${decoderKey}(...args);`, loader: 'js' }));
  } }],
});
const { Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (value, id = 'main') => ({ sheets: [{ id, name: id, rowCount: 10, columnCount: 5, cells: { A1: { value } } }] });
const set = value => ({ type: 'cells.set', sheetId: 'main', values: { A1: value } });
const input = () => new File(['test archive'], 'example.xlsx');
const decoded = (warnings = []) => ({ workbook: book('imported', 'imported-sheet'), warnings });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const imports = events => events.filter(event => event.type === 'import');
async function mount(t, overrides = {}) {
  globalThis[decoderKey] = async () => decoded();
  const ref = createRef(); let renderer, unmounted = false;
  let props = { ref, initialWorkbook: book('before'), onSave() {}, ...overrides };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}

test('import publishes one undoable draft edit through permission; save baseline advances only on save', async t => {
  const events = [], changes = [], dirty = [], permissions = []; let saves = 0;
  const ui = await mount(t, { onSave() { saves++; }, onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value),
    onEvent: event => events.push(event), onEditRequest: request => { permissions.push(request); return true; } });
  const before = ui.ref.current.getWorkbook(); let result;
  await act(async () => { result = await ui.ref.current.importExcel(input()); });
  assert.equal(result.workbook, ui.ref.current.getWorkbook()); assert.equal(result.workbook.sheets[0].cells.A1.value, 'imported');
  assert.equal(changes.length, 1); assert.equal(saves, 0); assert.deepEqual(dirty, [false, true]);
  assert.equal(permissions.length, 1); assert.equal(permissions[0].action, 'importExcel'); assert.equal(permissions[0].source, 'api');
  assert.deepEqual(imports(events).map(event => event.status), ['start', 'success']);
  assert.equal(imports(events)[0].requestId, imports(events)[1].requestId); assert.equal(imports(events)[0].fileName, 'example.xlsx');
  await act(async () => { assert.equal(await ui.ref.current.undo(), true); });
  assert.equal(ui.ref.current.getWorkbook(), before); assert.equal(await ui.ref.current.undo(), false);
  await act(async () => { assert.equal(await ui.ref.current.redo(), true); });
  await act(async () => { assert.equal(await ui.ref.current.save(), true); });
  assert.equal(saves, 1); assert.deepEqual(dirty, [false, true, false, true, false]);
});

test('dirty and pending edits require explicit consent; failed parsing retains both', async t => {
  const ui = await mount(t);
  await act(async () => {
    ui.ref.current.execute(set('local'));
    await assert.rejects(ui.ref.current.importExcel(input()), /未保存/);
  });
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'unfinished' } }));
  globalThis[decoderKey] = async () => { throw new Error('invalid archive'); };
  await act(async () => { await assert.rejects(ui.ref.current.importExcel(input(), { discardChanges: true }), /invalid archive/); });
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.equal(ui.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'unfinished');
  globalThis[decoderKey] = async () => decoded();
  await act(async () => { await ui.ref.current.importExcel(input(), { discardChanges: true }); });
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'imported');
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'A1の値' })[0]?.props.value, 'imported');
  await act(async () => ui.ref.current.undo());
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
});

test('review receives an immutable candidate once before permission; false cancels without changes', async t => {
  const events = []; let reads = 0, permissions = 0, reviews = 0;
  const ui = await mount(t, { onEditRequest: () => { permissions++; return true; }, onEvent: event => events.push(event) });
  const warning = { code: 'omitted', message: '図形を省略しました', count: 2 };
  globalThis[decoderKey] = async () => { reads++; return decoded([warning]); };
  const before = ui.ref.current.getWorkbook();
  await act(async () => { await assert.rejects(ui.ref.current.importExcel(input(), { onReview(result) {
    reviews++; assert.equal(permissions, 0); assert.equal(ui.ref.current.getWorkbook(), before);
    assert.deepEqual(result.warnings, [warning]); assert.ok(Object.isFrozen(result.workbook)); return false;
  } }), { name: 'AbortError' }); });
  assert.equal(reads, 1); assert.equal(reviews, 1); assert.equal(permissions, 0);
  assert.equal(ui.ref.current.getWorkbook(), before); assert.deepEqual(imports(events).map(e => e.status), ['start', 'cancelled']);
});

test('editing while parsing or reviewing cancels the stale import and retains newer edits', async t => {
  const ui = await mount(t); const read = deferred(); let outcome;
  globalThis[decoderKey] = () => read.promise;
  await act(async () => { outcome = ui.ref.current.importExcel(input()).catch(error => error); });
  await act(async () => ui.ref.current.execute(set('newer')));
  await act(async () => read.resolve(decoded()));
  assert.equal((await outcome).name, 'AbortError'); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'newer');
  const review = deferred(); globalThis[decoderKey] = async () => decoded();
  await act(async () => { outcome = ui.ref.current.importExcel(input(), { discardChanges: true, onReview: () => review.promise }).catch(error => error); await tick(); });
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'typed after review' } }));
  await act(async () => review.resolve(true));
  assert.equal((await outcome).name, 'AbortError');
  assert.equal(ui.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'typed after review');
});

test('cancellation terminates parsing promptly, blocks overlap and permits a subsequent import', async t => {
  const events = [], ui = await mount(t, { onEvent: event => events.push(event) });
  const read = deferred(), controller = new AbortController(); let signal, outcome;
  globalThis[decoderKey] = (_input, options) => { signal = options.signal; return read.promise; };
  await act(async () => { outcome = ui.ref.current.importExcel(input(), { signal: controller.signal }).catch(error => error); });
  await assert.rejects(ui.ref.current.importExcel(input()), /処理/);
  await assert.rejects(ui.ref.current.exportExcel(), /処理/); assert.equal(await ui.ref.current.save(), false);
  await act(async () => controller.abort());
  assert.equal((await outcome).name, 'AbortError'); assert.equal(signal.aborted, true);
  assert.deepEqual(imports(events).map(e => e.status), ['start', 'cancelled']);
  globalThis[decoderKey] = async () => decoded();
  await act(async () => { await ui.ref.current.importExcel(input()); });
  await act(async () => read.resolve(decoded()));
  assert.deepEqual(imports(events).map(e => e.status), ['start', 'cancelled', 'start', 'success']);
});

test('denied permission retains editors and cancellation aborts an import-owned permission request', async t => {
  const permission = deferred(), controller = new AbortController(), events = []; let context;
  const ui = await mount(t, { onEvent: event => events.push(event), onEditRequest: (_request, value) => { context = value; return permission.promise; } });
  let outcome;
  await act(async () => { outcome = ui.ref.current.importExcel(input(), { signal: controller.signal }).catch(error => error); await tick(); });
  assert.equal(ui.ref.current.getEditState().mode, 'requesting');
  await act(async () => controller.abort());
  assert.equal((await outcome).name, 'AbortError'); assert.equal(context.signal.aborted, true);
  await act(async () => permission.resolve(true));
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
  await ui.update({ onEditRequest: () => false });
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'pending denied' } }));
  await act(async () => { await assert.rejects(ui.ref.current.importExcel(input(), { discardChanges: true }), /変更できません/); });
  assert.equal(ui.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'pending denied');
  assert.deepEqual(imports(events).map(e => e.status), ['start', 'cancelled', 'start', 'error']);
});

test('readonly, feature changes, and unmount prevent application of a prepared import', async t => {
  const ui = await mount(t, { readOnly: true });
  await assert.rejects(ui.ref.current.importExcel(input()), /読み取り専用/);
  await ui.update({ readOnly: false, features: { importExcel: false } });
  await assert.rejects(ui.ref.current.importExcel(input()), /無効/);
  for (const patch of [{ readOnly: true }, { features: { importExcel: false } }]) {
    await ui.update({ readOnly: false, features: {} }); const review = deferred(); let outcome;
    await act(async () => { outcome = ui.ref.current.importExcel(input(), { onReview: () => review.promise }).catch(error => error); await tick(); });
    await ui.update(patch); assert.equal((await outcome).name, 'AbortError');
    await act(async () => review.resolve(true));
    assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
  }
  await ui.update({ readOnly: false, features: {} }); const review = deferred(); let outcome;
  const api = ui.ref.current;
  await act(async () => { outcome = api.importExcel(input(), { onReview: () => review.promise }).catch(error => error); await tick(); });
  await ui.unmount(); assert.equal((await outcome).name, 'AbortError');
  await assert.rejects(api.importExcel(input()), /表示/);
});

test('cancelling a read does not cancel another edit request started during parsing', async t => {
  const read = deferred(), permission = deferred(), controller = new AbortController(); let context, imported, edited;
  const ui = await mount(t, { onEditRequest: (_request, value) => { context = value; return permission.promise; } });
  globalThis[decoderKey] = () => read.promise;
  await act(async () => { imported = ui.ref.current.importExcel(input(), { signal: controller.signal }).catch(error => error); });
  await act(async () => { edited = ui.ref.current.executeAsync(set('other edit')); });
  await act(async () => controller.abort());
  assert.equal((await imported).name, 'AbortError'); assert.equal(context.signal.aborted, false);
  await act(async () => permission.resolve(true));
  assert.equal((await edited).ok, true); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'other edit');
  await act(async () => read.resolve(decoded()));
});

test('edits made in permission-granted observers survive import cancellation', async t => {
  const permission = deferred(); let api, outcome;
  const ui = await mount(t, { onEditRequest: () => permission.promise, onEvent(event) {
    if (event.type === 'edit-mode' && event.reason === 'granted') api.execute(set('observer edit'));
  } }); api = ui.ref.current;
  await act(async () => { outcome = api.importExcel(input()).catch(error => error); await tick(); });
  await act(async () => permission.resolve(true));
  assert.equal((await outcome).name, 'AbortError'); assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'observer edit');
});

test('an import already committed reports success if its change observer aborts the signal', async t => {
  const permission = deferred(), controller = new AbortController(), events = []; let outcome;
  const ui = await mount(t, { onEditRequest: () => permission.promise,
    onChange: () => controller.abort(), onEvent: event => events.push(event) });
  await act(async () => { outcome = ui.ref.current.importExcel(input(), { signal: controller.signal }); await tick(); });
  await act(async () => permission.resolve(true));
  assert.equal((await outcome).workbook.sheets[0].cells.A1.value, 'imported');
  assert.deepEqual(imports(events).map(event => event.status), ['start', 'success']);
});

test('File ribbon contains import/export, preserves quick save/history, and confirms dirty/warning input before applying once', async t => {
  const events = []; let reads = 0;
  const ui = await mount(t, { onEvent: event => events.push(event) });
  const tabs = ui.root.findByProps({ 'aria-label': 'リボンのタブ' }).findAllByProps({ role: 'tab' });
  assert.deepEqual(tabs.map(tab => tab.children[0]), ['ファイル', 'ホーム', '挿入', 'データ']);
  assert.equal(tabs.find(tab => tab.children[0] === 'ホーム').props['aria-selected'], true);
  await act(async () => tabs[0].props.onClick());
  const filePanel = ui.root.findAllByProps({ role: 'tabpanel' }).find(panel => panel.props['aria-labelledby'] === tabs[0].props.id);
  assert.equal(filePanel.props.hidden, false);
  assert.equal(filePanel.findAllByProps({ 'aria-label': 'Excelからインポート' }).length, 1);
  assert.equal(filePanel.findAllByProps({ 'aria-label': 'Excelにエクスポート' }).length, 1);
  assert.equal(ui.root.findAllByProps({ className: 'lxs-save' }).length, 1);
  assert.equal(filePanel.findAllByProps({ className: 'lxs-save' }).length, 0);
  await act(async () => ui.ref.current.execute(set('local')));
  globalThis[decoderKey] = async () => { reads++; return decoded([{ code: 'unsupported', message: 'グラフは取り込めません', sheetName: 'Main' }]); };
  const fileInput = ui.root.findByProps({ 'aria-label': '取り込むExcelファイル' }); assert.equal(fileInput.props.accept, '.xlsx');
  const target = { files: [input()], value: 'example.xlsx' };
  await act(async () => fileInput.props.onChange({ currentTarget: target }));
  assert.equal(target.value, ''); assert.equal(reads, 0);
  assert.match(ui.root.findByProps({ role: 'alertdialog' }).findByType('h2').children.join(''), /変更を破棄/);
  await act(async () => { ui.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick(); await tick(); });
  assert.equal(reads, 1); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.match(ui.root.findByProps({ role: 'alertdialog' }).findByType('h2').children.join(''), /取り込み内容/);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Excel取り込みをキャンセル' }).props.disabled, undefined);
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick());
  assert.equal(reads, 1); assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'imported');
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.equal(events.filter(event => event.type === 'change').at(-1).source, 'ui');
  await ui.update({ readOnly: true }); assert.equal(ui.root.findAllByProps({ 'aria-label': 'Excelからインポート' }).length, 0);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Excelにエクスポート' }).length, 1);
  await ui.update({ features: { exportExcel: false, importExcel: false } });
  assert.equal(ui.root.findByProps({ 'aria-label': 'リボンのタブ' }).findAllByProps({ role: 'tab' }).some(tab => tab.children[0] === 'ファイル'), false);
});

test('warning review can be cancelled after tab navigation without replacing the workbook or reparsing', async t => {
  const ui = await mount(t); let reads = 0;
  globalThis[decoderKey] = async () => { reads++; return decoded([{ code: 'omitted', message: 'グラフを省略しました' }]); };
  const tabs = ui.root.findByProps({ 'aria-label': 'リボンのタブ' }).findAllByProps({ role: 'tab' });
  await act(async () => tabs[0].props.onClick());
  await act(async () => {
    ui.root.findByProps({ 'aria-label': '取り込むExcelファイル' }).props.onChange({ currentTarget: { files: [input()], value: 'example.xlsx' } }); await tick();
  });
  assert.equal(reads, 1); assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 1);
  await act(async () => tabs.find(tab => tab.children[0] === 'ホーム').props.onClick());
  const dialog = ui.root.findByProps({ role: 'alertdialog' });
  for (let ancestor = dialog.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.props.hidden, true);
  await act(async () => dialog.findAllByType('button').find(button => button.children[0] === 'キャンセル').props.onClick());
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
  assert.equal(ui.ref.current.getHistoryState().canUndo, false); assert.equal(reads, 1);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Excel取り込みをキャンセル' }).length, 0);
});
