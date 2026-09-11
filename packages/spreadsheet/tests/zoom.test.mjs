import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: `export { default as Spreadsheet } from './src';
    export { useSpreadsheetZoom } from './src/state/use-spreadsheet-zoom';
    export { useGridZoom } from './src/ui/grid/use-grid-zoom';
    export { SpreadsheetZoomControls } from './src/ui/spreadsheet-zoom-controls';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'zoom-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet, useSpreadsheetZoom, useGridZoom, SpreadsheetZoomControls } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mountZoom(t, initialProps = {}) {
  let current, renderer, props = initialProps, active = true;
  const events = [], listeners = new Map(), registrations = [];
  const grid = { clientHeight: 480,
    addEventListener(type, callback, options) { listeners.set(type, callback); registrations.push({ type, options }); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  const scroller = { current: grid };
  function Harness() {
    current = useSpreadsheetZoom(props, event => events.push(event));
    const controller = { ...current, features: { zoom: props.features?.zoom !== false } };
    useGridZoom(controller, scroller);
    return createElement(SpreadsheetZoomControls, { controller });
  }
  const render = () => createElement(StrictMode, null, createElement(Harness));
  await act(async () => { renderer = create(render()); });
  const unmount = async () => { if (active) { active = false; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { events, listeners, registrations, unmount,
    get state() { return current; }, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
    async set(value) { let accepted; await act(async () => { accepted = current.setZoom(value); }); return accepted; },
    async dispatch(type, properties = {}) {
      const event = { ctrlKey: false, altKey: false, metaKey: false, deltaY: 0, deltaMode: 0,
        prevented: false, preventDefault() { this.prevented = true; }, ...properties };
      await act(async () => listeners.get(type)?.(event));
      return event;
    },
  };
}

const initialWorkbook = { sheets: ['main', 'other'].map(id => ({ id, name: id,
  rowCount: 5, columnCount: 5, cells: { A1: { value: 'original' } } })) };
async function mountSpreadsheet(t, overrides = {}) {
  const ref = createRef(), events = [], changes = [], dirty = [];
  let renderer, props = { ref, initialWorkbook, onSave() {}, onEvent: event => events.push(event),
    onChange: workbook => changes.push(workbook), onDirtyChange: value => dirty.push(value), ...overrides };
  await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Spreadsheet, props))); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, events, changes, dirty, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(StrictMode, null, createElement(Spreadsheet, props)))); },
  };
}

test('initial zoom is normalized once and never emits a change event on mount', async t => {
  for (const [input, expected] of [[undefined, 100], [0, 25], [250, 200], [124.6, 125], [NaN, 100], [Infinity, 100]]) {
    const ui = await mountZoom(t, { initialZoom: input });
    assert.equal(ui.state.getZoom(), expected);
    assert.equal(ui.state.zoom, expected);
    assert.deepEqual(ui.events, []);
    await ui.update({ initialZoom: 75 });
    assert.equal(ui.state.getZoom(), expected, 'initialZoom is not a controlled prop');
    await ui.unmount();
  }
});

test('zoom updates use current values, clamp finite input and emit only real changes', async t => {
  const ui = await mountZoom(t);
  const set = ui.state.setZoom;
  await act(async () => { assert.equal(set(125), true); assert.equal(set(150), true); assert.equal(set(150), true); });
  assert.equal(ui.state.getZoom(), 150);
  assert.deepEqual(ui.events, [
    { type: 'zoom-change', zoom: 125, previousZoom: 100 },
    { type: 'zoom-change', zoom: 150, previousZoom: 125 },
  ]);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(await ui.set(value), false);
  assert.equal(ui.events.length, 2);
  assert.equal(await ui.set(-10), true); assert.equal(ui.state.getZoom(), 25);
  assert.equal(await ui.set(500), true); assert.equal(ui.state.getZoom(), 200);
  assert.equal(await ui.set(124.6), true); assert.equal(ui.state.getZoom(), 125);
});

test('disabling zoom hides controls and rejects stale setters while retaining the current view', async t => {
  const ui = await mountZoom(t, { initialZoom: 125 });
  const staleSet = ui.state.setZoom;
  await ui.update({ features: { zoom: false } });
  assert.equal(ui.root.findAllByProps({ 'aria-label': '表示倍率' }).length, 0);
  await act(async () => { assert.equal(staleSet(100), false); });
  assert.equal(ui.state.getZoom(), 125);
  assert.deepEqual(ui.events, []);
  await ui.update({ features: {} });
  await act(async () => { assert.equal(staleSet(100), true); });
  assert.equal(ui.state.getZoom(), 100);
});

test('footer slider has 100 percent at its midpoint and reset and limit controls work', async t => {
  const ui = await mountZoom(t);
  const slider = () => ui.root.findByType('input');
  assert.equal(slider().props.value, 50);
  assert.equal(slider().props['aria-valuetext'], '100%');
  await act(async () => slider().props.onChange({ target: { value: '0' } }));
  assert.equal(ui.state.getZoom(), 25);
  assert.equal(ui.root.findByProps({ 'aria-label': '縮小' }).props.disabled, true);
  await act(async () => slider().props.onChange({ target: { value: '100' } }));
  assert.equal(ui.state.getZoom(), 200);
  assert.equal(ui.root.findByProps({ 'aria-label': '拡大' }).props.disabled, true);
  await act(async () => ui.root.findByProps({ className: 'lxs-zoom-percent' }).props.onClick());
  assert.equal(ui.state.getZoom(), 100);
  assert.equal(slider().props.value, 50);
});

test('grid wheel listener only consumes supported Ctrl-wheel zoom and respects disabled features', async t => {
  const ui = await mountZoom(t);
  assert.ok(ui.registrations.every(entry => entry.options?.passive === false));
  assert.equal((await ui.dispatch('wheel', { deltaY: -50 })).prevented, false);
  for (const modifiers of [{ altKey: true }, { metaKey: true }]) {
    assert.equal((await ui.dispatch('wheel', { ctrlKey: true, deltaY: -50, ...modifiers })).prevented, false);
  }
  assert.equal(ui.state.getZoom(), 100);
  assert.equal((await ui.dispatch('wheel', { ctrlKey: true, deltaY: -30 })).prevented, true);
  const enlarged = ui.state.getZoom(); assert.ok(enlarged > 100);
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: 30 });
  assert.ok(ui.state.getZoom() < enlarged);
  await ui.update({ features: { zoom: false } });
  const retained = ui.state.getZoom();
  assert.equal((await ui.dispatch('wheel', { ctrlKey: true, deltaY: -50 })).prevented, false);
  assert.equal(ui.state.getZoom(), retained);
});

test('small trackpad wheel deltas accumulate and later wheel input starts from the latest API zoom', async t => {
  const ui = await mountZoom(t);
  for (let index = 0; index < 40; index++) await ui.dispatch('wheel', { ctrlKey: true, deltaY: -0.1 });
  assert.ok(ui.state.getZoom() > 100, 'rounding each individual delta must not discard a smooth gesture');
  await ui.set(175);
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: -10 });
  assert.ok(ui.state.getZoom() > 175, 'API changes must reset the wheel baseline');
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: -1000, deltaMode: 2 });
  assert.equal(ui.state.getZoom(), 200);
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: 1000, deltaMode: 1 });
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: 1000, deltaMode: 1 });
  assert.equal(ui.state.getZoom(), 25);
});

test('wheel events batched before rendering accumulate rather than restarting from a stale view', async t => {
  const ui = await mountZoom(t);
  await act(async () => {
    for (let index = 0; index < 3; index++) ui.listeners.get('wheel')({ ctrlKey: true, deltaY: -30, deltaMode: 0, preventDefault() {} });
  });
  assert.equal(ui.state.getZoom(), Math.round(100 * Math.exp(0.3)));
  assert.deepEqual(ui.events.map(event => event.zoom), [111, 122, 135]);
});

test('wheel and pinch begin from API changes made in the same rendering batch', async t => {
  const ui = await mountZoom(t);
  await act(async () => {
    ui.state.setZoom(175);
    ui.listeners.get('wheel')({ ctrlKey: true, deltaY: -30, deltaMode: 0, preventDefault() {} });
  });
  assert.equal(ui.state.getZoom(), Math.round(175 * Math.exp(0.1)));
  await act(async () => {
    ui.state.setZoom(150);
    ui.listeners.get('gesturestart')({ preventDefault() {} });
    ui.listeners.get('gesturechange')({ scale: 1.2, preventDefault() {} });
    ui.listeners.get('gestureend')({ preventDefault() {} });
  });
  assert.equal(ui.state.getZoom(), 180);
  await act(async () => {
    ui.listeners.get('wheel')({ ctrlKey: true, deltaY: 30, deltaMode: 0, preventDefault() {} });
    ui.listeners.get('gesturestart')({ preventDefault() {} });
    ui.listeners.get('gesturechange')({ scale: 0.5, preventDefault() {} });
    ui.listeners.get('gestureend')({ preventDefault() {} });
  });
  assert.equal(ui.state.getZoom(), Math.round(Math.round(180 * Math.exp(-0.1)) * 0.5));
});

test('Safari pinch uses its starting zoom, ignores duplicate wheel input and ends cleanly', async t => {
  const ui = await mountZoom(t, { initialZoom: 120 });
  assert.equal((await ui.dispatch('gesturestart')).prevented, true);
  await ui.dispatch('gesturechange', { scale: 1.5 }); assert.equal(ui.state.getZoom(), 180);
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: -50 }); assert.equal(ui.state.getZoom(), 180);
  await ui.dispatch('gesturechange', { scale: 0.5 }); assert.equal(ui.state.getZoom(), 60);
  await ui.dispatch('gesturechange', { scale: NaN }); assert.equal(ui.state.getZoom(), 60);
  assert.equal((await ui.dispatch('gestureend')).prevented, true);
  await ui.dispatch('wheel', { ctrlKey: true, deltaY: -30 }); assert.ok(ui.state.getZoom() > 60);
});

test('feature revocation during pinch stops changes and unmount removes grid listeners', async t => {
  const ui = await mountZoom(t);
  await ui.dispatch('gesturestart');
  await ui.dispatch('gesturechange', { scale: 1.5 });
  await ui.update({ features: { zoom: false } });
  assert.equal((await ui.dispatch('gesturechange', { scale: 2 })).prevented, false);
  assert.equal(ui.state.getZoom(), 150);
  await ui.dispatch('gestureend');
  assert.equal((await ui.dispatch('gesturestart')).prevented, false);
  assert.equal(ui.listeners.size, 4);
  await ui.unmount();
  assert.equal(ui.listeners.size, 0, 'StrictMode and unmount must leave no wheel or pinch listener attached');
});

test('public zoom handle stays stable and leaves workbook, history, dirty state and edit permission unchanged', async t => {
  let requests = 0;
  const ui = await mountSpreadsheet(t, { onEditRequest() { requests++; return true; } });
  const api = ui.ref.current, workbook = api.getWorkbook(), history = api.getHistoryState();
  ui.events.length = 0; ui.changes.length = 0; ui.dirty.length = 0;
  await act(async () => { assert.equal(api.setZoom(125), true); assert.equal(api.getZoom(), 125); });
  assert.equal(ui.ref.current, api);
  assert.equal(api.getWorkbook(), workbook);
  assert.deepEqual(api.getHistoryState(), history);
  assert.deepEqual(ui.changes, []); assert.deepEqual(ui.dirty, []); assert.equal(requests, 0);
  assert.deepEqual(ui.events, [{ type: 'zoom-change', zoom: 125, previousZoom: 100 }]);
  await act(async () => { assert.equal(api.setZoom(125), true); assert.equal(api.setZoom(NaN), false); });
  assert.equal(ui.events.length, 1);
  await act(async () => ui.root.findByProps({ 'data-lxs-sheet-id': 'other' }).props.onClick());
  assert.equal(api.getZoom(), 125, 'zoom is shared by all sheets');
});

test('readonly permits public zoom, initialZoom updates are ignored and disabled zoom retains rendering', async t => {
  const ui = await mountSpreadsheet(t, { initialZoom: 125, onSave: undefined, features: { zoom: false } });
  const api = ui.ref.current;
  assert.equal(api.getZoom(), 125);
  await act(async () => { assert.equal(api.setZoom(150), false); });
  assert.equal(ui.root.findAllByProps({ className: 'lxs-zoom-controls' }).length, 0);
  await ui.update({ initialZoom: 75, features: {} });
  assert.equal(ui.ref.current, api); assert.equal(api.getZoom(), 125);
  await act(async () => { assert.equal(api.setZoom(150), true); });
  assert.equal(api.getZoom(), 150);
  assert.equal(api.getEditState().mode, 'view');
});

test('zoom retains an existing unsaved edit and its history, and Undo does not reset the view zoom', async t => {
  const ui = await mountSpreadsheet(t);
  const api = ui.ref.current;
  await act(async () => { assert.equal(api.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'edited' } }).ok, true); });
  const workbook = api.getWorkbook(), history = api.getHistoryState();
  assert.equal(history.undoCount, 1);
  assert.equal(ui.dirty.at(-1), true);
  ui.events.length = 0; ui.changes.length = 0; ui.dirty.length = 0;
  await act(async () => { assert.equal(api.setZoom(150), true); });
  assert.equal(api.getWorkbook(), workbook);
  assert.deepEqual(api.getHistoryState(), history);
  assert.deepEqual(ui.changes, []); assert.deepEqual(ui.dirty, []);
  await act(async () => { assert.equal(await api.undo(), true); });
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'original');
  assert.equal(api.getZoom(), 150);
});
