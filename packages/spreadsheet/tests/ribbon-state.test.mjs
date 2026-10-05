import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet';
    export { useSpreadsheetHandle } from './src/api/use-spreadsheet-handle';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'ribbon-state-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetHandle } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, overrides = {}) {
  const ref = createRef(), modes = [], events = [], changes = [], dirty = [], unsaved = [];
  let current, renderer, active = true;
  let props = { initialWorkbook: { sheets: [{ id: 'main', name: 'Main', rowCount: 5, columnCount: 5, cells: { A1: { value: 'original' } } }] },
    onSave() {}, onRibbonDisplayModeChange: mode => modes.push(mode), onEvent: event => events.push(event),
    onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value),
    onUnsavedChangesChange: value => unsaved.push(value), ...overrides };
  function Probe() { current = useSpreadsheet(props); useSpreadsheetHandle(ref, current); return null; }
  const render = () => createElement(StrictMode, null, createElement(Probe));
  await act(async () => { renderer = create(render()); });
  const unmount = async () => { if (active) { active = false; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, modes, events, changes, dirty, unsaved, unmount,
    get state() { return current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
    async set(mode) { let result; await act(async () => { result = ref.current.setRibbonDisplayMode(mode); }); return result; },
  };
}

test('ribbon initial presentation defaults to expanded and is read only once without notifications', async t => {
  for (const [initial, expected] of [[undefined, 'expanded'], ['tabs', 'tabs'], ['autoHide', 'autoHide'], ['hidden', 'hidden'], ['invalid', 'expanded']]) {
    const ui = await mount(t, { initialRibbonDisplayMode: initial });
    assert.equal(ui.state.ribbonDisplayMode, expected);
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
    assert.equal(ui.state.ribbonDisplayModeLocked, false);
    assert.deepEqual(ui.modes, []);
    await ui.update({ initialRibbonDisplayMode: 'hidden' });
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
    assert.deepEqual(ui.modes, []);
    await ui.unmount();
  }
});

test('uncontrolled API requests update immediately across consecutive calls and reject invalid or unchanged modes', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await act(async () => {
    assert.equal(api.setRibbonDisplayMode('tabs'), true);
    assert.equal(api.getRibbonDisplayMode(), 'tabs');
    assert.equal(api.setRibbonDisplayMode('tabs'), false);
    assert.equal(api.setRibbonDisplayMode('autoHide'), true);
    assert.equal(api.getRibbonDisplayMode(), 'autoHide');
    assert.equal(api.setRibbonDisplayMode('hidden'), true);
    assert.equal(api.getRibbonDisplayMode(), 'hidden');
  });
  assert.equal(ui.ref.current, api);
  assert.equal(ui.state.ribbonDisplayMode, 'hidden');
  assert.deepEqual(ui.modes, ['tabs', 'autoHide', 'hidden']);
  for (const value of [null, undefined, false, 0, 'collapsed', '']) assert.equal(await ui.set(value), false);
  assert.deepEqual(ui.modes, ['tabs', 'autoHide', 'hidden']);
});

test('controlled requests notify the host and only controlled props determine the displayed mode', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'expanded', ribbonDisplayMode: 'tabs' }), api = ui.ref.current;
  assert.equal(api.getRibbonDisplayMode(), 'tabs');
  assert.equal(ui.state.ribbonDisplayModeLocked, false);
  assert.equal(await ui.set('hidden'), true);
  assert.deepEqual(ui.modes, ['hidden']);
  assert.equal(api.getRibbonDisplayMode(), 'tabs', 'a request is not host acceptance');
  assert.equal(ui.state.ribbonDisplayMode, 'tabs');
  await ui.update({ ribbonDisplayMode: 'autoHide' });
  assert.equal(ui.ref.current, api);
  assert.equal(api.getRibbonDisplayMode(), 'autoHide');
  assert.equal(ui.state.ribbonDisplayMode, 'autoHide');
  assert.deepEqual(ui.modes, ['hidden'], 'prop synchronization must not notify the host');
  assert.equal(await ui.set('autoHide'), false);
});

test('controlled mode without a callback is locked even for retained setters', async t => {
  const ui = await mount(t), staleSet = ui.state.setRibbonDisplayMode;
  await ui.update({ ribbonDisplayMode: 'hidden', onRibbonDisplayModeChange: undefined });
  assert.equal(ui.state.ribbonDisplayModeLocked, true);
  await act(async () => assert.equal(staleSet('expanded'), false));
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  const nextModes = [];
  await ui.update({ onRibbonDisplayModeChange: value => nextModes.push(value) });
  assert.equal(ui.state.ribbonDisplayModeLocked, false);
  await act(async () => assert.equal(staleSet('expanded'), true));
  assert.deepEqual(nextModes, ['expanded']);
  assert.deepEqual(ui.modes, []);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
});

test('releasing controlled ownership retains the last host mode and permits local changes', async t => {
  const ui = await mount(t, { ribbonDisplayMode: 'tabs' });
  await ui.update({ ribbonDisplayMode: 'hidden' });
  await ui.update({ ribbonDisplayMode: undefined });
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  assert.equal(ui.state.ribbonDisplayMode, 'hidden');
  assert.deepEqual(ui.modes, []);
  assert.equal(await ui.set('expanded'), true);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
});

test('host callback errors and rejected promises cannot undo view-only changes or escape requests', async t => {
  const ui = await mount(t, { onRibbonDisplayModeChange() { throw new Error('host observer failed'); } });
  assert.equal(await ui.set('tabs'), true);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  await ui.update({ onRibbonDisplayModeChange: async () => { throw new Error('async observer failed'); } });
  assert.equal(await ui.set('hidden'), true);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  await ui.update({ ribbonDisplayMode: 'tabs' });
  assert.equal(await ui.set('expanded'), true);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  assert.equal(ui.state.error, null);
});

test('read-only viewing with no save handler permits ribbon changes without editing, dirty state, or history', async t => {
  let editRequests = 0;
  const ui = await mount(t, { readOnly: true, onSave: undefined, onEditRequest() { editRequests++; return true; } });
  const api = ui.ref.current, workbook = api.getWorkbook(), history = api.getHistoryState();
  ui.events.length = 0; ui.changes.length = 0; ui.dirty.length = 0; ui.unsaved.length = 0;
  assert.equal(await ui.set('hidden'), true);
  assert.equal(api.getRibbonDisplayMode(), 'hidden');
  assert.equal(api.getWorkbook(), workbook);
  assert.deepEqual(api.getHistoryState(), history);
  assert.equal(api.getEditState().mode, 'view');
  assert.equal(editRequests, 0);
  assert.deepEqual(ui.events, []); assert.deepEqual(ui.changes, []);
  assert.deepEqual(ui.dirty, []); assert.deepEqual(ui.unsaved, []);
});

test('ribbon changes preserve pending cell edits and workbook Undo does not change the view mode', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await act(async () => ui.state.beginEdit({ row: 0, column: 0 }, 'unfinished'));
  const pending = ui.state.editing;
  assert.equal(await ui.set('hidden'), true);
  assert.equal(ui.state.editing, pending);
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'original');
  await act(async () => ui.state.cancelEdit());
  await act(async () => assert.equal(api.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'changed' } }).ok, true));
  await act(async () => assert.equal(await api.undo(), true));
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'original');
  assert.equal(api.getRibbonDisplayMode(), 'hidden');
});

test('a retained ribbon setter rejects requests after unmount', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await ui.unmount();
  assert.equal(api.setRibbonDisplayMode('tabs'), false);
  assert.deepEqual(ui.modes, []);
});
