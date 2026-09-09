import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const workbook = value => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 5, cells: { A1: { value } } }] });
const key = name => ({ key: name, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function mount(t, overrides = {}) {
  let renderer;
  const ref = createRef(), listeners = new Map();
  const view = { addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); } };
  let props = { ref, initialWorkbook: workbook('before'), onSave() {}, ...overrides };
  await act(async () => { renderer = create(createElement(Spreadsheet, props), {
    createNodeMock: element => element.type === 'section' ? { ownerDocument: { defaultView: view } } : null,
  }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, listeners, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}

test('GUI cell commits await permission, retain denied input, and navigate only after an accepted commit', async t => {
  const requests = [], events = [], changes = [], unsaved = [];
  const ui = await mount(t, { onEvent: event => events.push(event), onChange: value => changes.push(value),
    onUnsavedChangesChange: value => unsaved.push(value),
    onEditRequest(request, context) { const wait = deferred(); requests.push({ request, context, ...wait }); return wait.promise; } });
  assert.equal(ui.listeners.has('beforeunload'), false);
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'edited' } }));
  assert.equal(requests.length, 0, 'opening or typing into an uncommitted editor does not acquire a lock');
  assert.equal(ui.listeners.has('beforeunload'), true, 'changed input is protected before it reaches the workbook');
  assert.deepEqual(unsaved, [false, true], 'the parent can guard SPA navigation before a cell is committed');
  assert.ok(events.some(event => event.type === 'unsaved-changes' && !event.dirty && event.pending && event.hasUnsavedChanges));
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onKeyDown(key('Enter')));
  assert.equal(requests.length, 1);
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'before');
  assert.equal(changes.length, 0);
  await act(async () => requests[0].resolve(false));
  assert.equal(ui.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'edited');
  assert.equal(requests[0].context.signal.aborted, true);
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onKeyDown(key('Enter')));
  assert.equal(requests.length, 2);
  await act(async () => requests[1].resolve(true));
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'edited');
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'A2の値' }).length, 1);
  assert.equal(changes.length, 1);
  assert.deepEqual(unsaved, [false, true], 'committing an already unsaved editor does not duplicate the same flag');
  assert.equal(requests[1].context.signal.aborted, false);
  assert.ok(events.some(event => event.type === 'edit-mode' && event.reason === 'denied'));
  assert.ok(events.some(event => event.type === 'edit-mode' && event.reason === 'granted'));
});

test('refresh is injected, confirms changes in the view, retains a failed draft, and clears it only on success', async t => {
  let calls = 0;
  const ui = await mount(t);
  assert.equal(ui.root.findAllByProps({ 'aria-label': '再読み込み' }).length, 0);
  await ui.update({ onRefresh() { calls++; throw new Error('network failed'); } });
  await act(async () => ui.ref.current.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'local' } }));
  await act(async () => ui.root.findByProps({ 'aria-label': '再読み込み' }).props.onClick());
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 1);
  assert.equal(calls, 0);
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-backdrop' }).props.onKeyDown(key('Escape')));
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  await act(async () => ui.root.findByProps({ 'aria-label': '再読み込み' }).props.onClick());
  const backdrop = ui.root.findByProps({ className: 'lxs-dialog-backdrop' });
  const element = {};
  await act(async () => backdrop.props.onPointerDown({ target: element, currentTarget: element, stopPropagation() {} }));
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  await act(async () => ui.root.findByProps({ 'aria-label': '再読み込み' }).props.onClick());
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick());
  assert.equal(calls, 1);
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'local');
  assert.equal(ui.listeners.has('beforeunload'), true);
  await ui.update({ onRefresh() { calls++; return workbook('server'); } });
  await act(async () => ui.root.findByProps({ 'aria-label': '再読み込み' }).props.onClick());
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick());
  assert.equal(calls, 2);
  assert.equal(ui.ref.current.getWorkbook().sheets[0].cells.A1.value, 'server');
  assert.equal(ui.listeners.has('beforeunload'), false);
});

test('save preflight can cancel without releasing a lock; success reports events and releases it', async t => {
  const events = [];
  let saves = 0, editContext;
  const ui = await mount(t, { onEditRequest(_request, context) { editContext = context; return true; },
    onBeforeSave: () => false, onSave() { saves++; }, onEvent: event => events.push(event) });
  await act(async () => ui.ref.current.executeAsync({ type: 'cells.set', sheetId: 'main', values: { A1: 'local' } }));
  await act(async () => ui.root.findByProps({ className: 'lxs-save' }).props.onClick());
  assert.equal(saves, 0);
  assert.equal(editContext.signal.aborted, false);
  assert.ok(events.some(event => event.type === 'save' && event.status === 'cancelled'));
  assert.equal(ui.root.findByProps({ className: 'lxs-save' }).props.disabled, false);
  await ui.update({ onBeforeSave: () => true });
  await act(async () => ui.root.findByProps({ className: 'lxs-save' }).props.onClick());
  assert.equal(saves, 1);
  assert.equal(editContext.signal.aborted, true);
  assert.ok(events.some(event => event.type === 'save' && event.status === 'success'));
  assert.equal(ui.root.findByProps({ className: 'lxs-save' }).props.disabled, true);
  assert.equal(ui.listeners.has('beforeunload'), false);
});
