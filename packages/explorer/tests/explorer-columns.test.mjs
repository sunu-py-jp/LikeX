import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { ExplorerColumnResizer, useExplorerColumnResize } from './src/ui/explorer-column-resizer.tsx';
    export { EXPLORER_DETAILS_COLUMNS, EXPLORER_STANDARD_DETAILS_COLUMNS, clampColumnWidth, normalizeColumnWidths } from './src/model/column-size.ts';
  `, resolveDir: packageRoot, sourcefile: 'explorer-columns-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { ExplorerColumnResizer, useExplorerColumnResize, EXPLORER_DETAILS_COLUMNS, EXPLORER_STANDARD_DETAILS_COLUMNS, clampColumnWidth, normalizeColumnWidths } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-columns-test.mjs').toString('base64')}`);
const change = async action => { await act(async () => { await action(); }); };
const labels = { name: '名前', location: '場所', updatedAt: '更新日時', extension: '種類', size: 'サイズ' };
const defaultMeasurements = { name: 420, location: 240, updatedAt: 132, extension: 86, size: 100 };

async function mount(t, supplied = {}) {
  let enabled = supplied.enabled ?? true, initialWidths = supplied.initialWidths;
  let columns = supplied.columns ?? EXPLORER_STANDARD_DETAILS_COLUMNS;
  let resize, renderer, closed = false, measurements = { ...defaultMeasurements, ...supplied.measurements };
  let queries = 0;
  const captures = new Map(), nodes = new Map(), observers = new Set(), listeners = new Map(), frames = new Map();
  let frameId = 0;
  const ownerWindow = {
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const ownerDocument = { defaultView: ownerWindow };
  for (const column of EXPLORER_DETAILS_COLUMNS) {
    const captured = new Set(); captures.set(column, captured);
    nodes.set(column, {
      dataset: {}, ownerDocument, focused: false,
      focus() { this.focused = true; },
      setPointerCapture(id) { captured.add(id); },
      hasPointerCapture(id) { return captured.has(id); },
      releasePointerCapture(id) { captured.delete(id); },
    });
  }
  const measuredWidth = column => resize?.widths.name === undefined ? measurements[column] : resize.widths[column];
  const table = { ownerDocument,
    querySelector(selector) {
      assert.equal(selector, 'th[data-explorer-column="name"]');
      return { getBoundingClientRect: () => ({ width: measuredWidth('name') }) };
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'th[data-explorer-column]'); queries++;
      return columns.map(column => ({ dataset: { explorerColumn: column },
        getAttribute: name => name === 'data-explorer-column' ? column : null,
        getBoundingClientRect: () => ({ width: measuredWidth(column) }),
      }));
    },
  };
  function Probe() {
    resize = useExplorerColumnResize(enabled, initialWidths, columns);
    return h('table', { ref: resize.setTableElement }, h('thead', null, h('tr', null,
      ...columns.map(column => h('th', { key: column, 'data-explorer-column': column },
        h(ExplorerColumnResizer, { resize, column, label: labels[column] }))))));
  }
  const tree = () => h(StrictMode, null, h(Probe));
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  await change(() => { renderer = create(tree(), { createNodeMock: element => element.type === 'table' ? table : null }); });
  await change(() => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } });
  const event = (column, extra) => ({ currentTarget: nodes.get(column), button: 0, isPrimary: true, pointerId: 1, clientX: 200,
    key: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, defaultPrevented: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
  return {
    get value() { return resize; }, get queries() { return queries; }, captures, nodes, observers, listeners, unmount,
    grip: column => renderer.root.findByProps({ role: 'separator', 'aria-label': `${labels[column]}列の幅` }),
    grips: () => renderer.root.findAllByProps({ role: 'separator' }),
    async update(patch) {
      if (Object.hasOwn(patch, 'enabled')) enabled = patch.enabled;
      if (Object.hasOwn(patch, 'initialWidths')) initialWidths = patch.initialWidths;
      if (Object.hasOwn(patch, 'columns')) columns = patch.columns;
      await change(() => renderer.update(tree()));
    },
    async measure(next) {
      measurements = { ...measurements, ...next };
      await change(() => { for (const observer of observers) observer.callback(); });
    },
    async dispatch(column, handler, extra = {}) {
      const value = event(column, extra);
      await change(() => resize.getHandleProps(column)[handler](value));
      return value;
    },
  };
}

test('detail widths normalize finite numbers without filling unspecified columns or changing host input', () => {
  assert.deepEqual(EXPLORER_DETAILS_COLUMNS, ['name', 'location', 'updatedAt', 'extension', 'size']);
  assert.deepEqual(EXPLORER_STANDARD_DETAILS_COLUMNS, ['name', 'updatedAt', 'extension', 'size']);
  assert.deepEqual(normalizeColumnWidths(undefined), {});
  const widths = Object.freeze({ name: 234.6, updatedAt: -10, extension: Infinity, size: 4000 });
  assert.deepEqual(normalizeColumnWidths(widths), { name: 235, updatedAt: 64, size: 2000 });
  assert.deepEqual(normalizeColumnWidths({ name: NaN, updatedAt: 0, extension: '100', size: 96.4 }), { updatedAt: 64, size: 96 });
  assert.equal(widths.name, 234.6);
  assert.equal(clampColumnWidth('name', 0), 140);
  assert.equal(clampColumnWidth('location', 0), 140);
  assert.deepEqual(normalizeColumnWidths({ location: 280.7 }), { location: 281 });
  for (const column of ['updatedAt', 'extension', 'size']) assert.equal(clampColumnWidth(column, 0), 64);
  assert.equal(clampColumnWidth('name', 3000), 2000);
});

test('details initially leave the name flexible and expose one accessible handle per column', async t => {
  const view = await mount(t);
  assert.deepEqual(view.value.widths, { location: 240, updatedAt: 128, extension: 80, size: 96 });
  assert.equal(view.value.totalWidth, undefined);
  assert.equal(view.grips().length, 4);
  for (const column of EXPLORER_STANDARD_DETAILS_COLUMNS) {
    const grip = view.grip(column);
    assert.equal(grip.props['aria-orientation'], 'vertical'); assert.equal(grip.props.tabIndex, 0);
    assert.equal(grip.props['aria-valuemin'], column === 'name' ? 140 : 64);
    assert.equal(grip.props['aria-valuemax'], 2000);
    assert.ok(Number.isFinite(grip.props['aria-valuenow']));
    assert.match(grip.props.className, /touch-none/);
  }
  assert.equal(view.grip('updatedAt').props['aria-valuenow'], 128);
  assert.equal(view.grip('name').props['aria-valuenow'], 420);
  await view.measure({ name: 480 });
  assert.equal(view.grip('name').props['aria-valuenow'], 480);
  assert.equal(view.value.widths.name, undefined, 'accessibility measurement must not freeze the automatic column');
  const click = await view.dispatch('updatedAt', 'onClick');
  assert.equal(click.prevented, true); assert.equal(click.stopped, true, 'a resize handle must not bubble a sort click');
});

test('dragging measures the flexible table once, changes one column, and isolates pointer ownership', async t => {
  const view = await mount(t);
  for (const extra of [{ button: 2 }, { isPrimary: false }]) {
    assert.equal((await view.dispatch('name', 'onPointerDown', extra)).prevented, false);
    assert.equal(view.value.widths.name, undefined); assert.equal(view.captures.get('name').size, 0);
  }
  const down = await view.dispatch('name', 'onPointerDown');
  assert.equal(down.prevented, true); assert.equal(down.stopped, true);
  assert.equal(view.nodes.get('name').focused, true); assert.equal(view.captures.get('name').has(1), true);
  assert.deepEqual(view.value.widths, defaultMeasurements);
  assert.equal(view.value.totalWidth, 738);
  await view.dispatch('name', 'onPointerMove', { pointerId: 2, clientX: 290 });
  await view.dispatch('name', 'onPointerUp', { pointerId: 2 });
  assert.equal(view.value.widths.name, 420); assert.equal(view.captures.get('name').has(1), true);
  await view.dispatch('name', 'onPointerMove', { clientX: 290 });
  assert.deepEqual(view.value.widths, { ...defaultMeasurements, name: 510 });
  assert.equal(view.value.totalWidth, 828);
  await view.dispatch('name', 'onPointerUp');
  assert.equal(view.captures.get('name').size, 0); assert.equal(view.nodes.get('name').dataset.resizing, undefined);
  await view.dispatch('name', 'onPointerMove', { clientX: 800 }); assert.equal(view.value.widths.name, 510);
  await view.measure({ name: 999, updatedAt: 999, extension: 999, size: 999 });
  await view.dispatch('size', 'onPointerDown');
  await view.dispatch('size', 'onPointerMove', { clientX: 230 });
  assert.deepEqual(view.value.widths, { ...defaultMeasurements, name: 510, size: 130 }, 'subsequent interactions keep existing fixed widths');
  await view.dispatch('size', 'onPointerCancel'); assert.equal(view.captures.get('size').size, 0);
});

test('keyboard starts from measured width and preserves shortcuts and IME composition', async t => {
  const view = await mount(t);
  for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    assert.equal((await view.dispatch('name', 'onKeyDown', { key: 'ArrowRight', ...extra })).prevented, false);
    assert.equal(view.value.widths.name, undefined);
  }
  assert.equal((await view.dispatch('name', 'onKeyDown', { key: 'Tab' })).prevented, false);
  const right = await view.dispatch('name', 'onKeyDown', { key: 'ArrowRight' });
  assert.equal(right.prevented, true); assert.equal(right.stopped, true); assert.equal(view.value.widths.name, 430);
  await view.dispatch('name', 'onKeyDown', { key: 'ArrowLeft', shiftKey: true }); assert.equal(view.value.widths.name, 380);
  await view.dispatch('name', 'onKeyDown', { key: 'Home' }); assert.equal(view.value.widths.name, 140);
  await view.dispatch('name', 'onKeyDown', { key: 'ArrowLeft' }); assert.equal(view.value.widths.name, 140);
  await view.dispatch('extension', 'onKeyDown', { key: 'Home' }); assert.equal(view.value.widths.extension, 64);
  await view.dispatch('extension', 'onKeyDown', { key: 'End' }); assert.equal(view.value.widths.extension, 2000);
  await view.dispatch('extension', 'onKeyDown', { key: 'ArrowRight', shiftKey: true }); assert.equal(view.value.widths.extension, 2000);
  assert.equal(view.grip('extension').props['aria-valuenow'], 2000);
});

test('double click restores only the requested initial/default column and prop updates do not reset live widths', async t => {
  const view = await mount(t, { initialWidths: { name: 320, size: 110 } });
  assert.deepEqual(view.value.widths, { name: 320, location: 240, updatedAt: 128, extension: 80, size: 110 });
  assert.equal(view.value.totalWidth, 638);
  await view.dispatch('name', 'onKeyDown', { key: 'ArrowRight' });
  await view.dispatch('updatedAt', 'onKeyDown', { key: 'ArrowRight' });
  await view.dispatch('size', 'onKeyDown', { key: 'ArrowRight' });
  await view.update({ initialWidths: { name: 500, updatedAt: 500, size: 500 } });
  assert.deepEqual(view.value.widths, { name: 330, location: 240, updatedAt: 138, extension: 80, size: 120 });
  const reset = await view.dispatch('name', 'onDoubleClick');
  assert.equal(reset.stopped, true);
  assert.deepEqual(view.value.widths, { name: 320, location: 240, updatedAt: 138, extension: 80, size: 120 });
  await view.dispatch('updatedAt', 'onDoubleClick'); assert.equal(view.value.widths.updatedAt, 128);
  await view.dispatch('size', 'onDoubleClick'); assert.equal(view.value.widths.size, 110);
  const automatic = await mount(t);
  await automatic.dispatch('name', 'onKeyDown', { key: 'End' });
  await automatic.dispatch('name', 'onDoubleClick');
  assert.equal(automatic.value.widths.name, 234);
});

test('cancel, disable and unmount release pointer capture while retaining the resized preference', async t => {
  const view = await mount(t);
  await view.dispatch('size', 'onPointerDown', { pointerType: 'touch' });
  await view.dispatch('size', 'onPointerMove', { pointerType: 'touch', clientX: -1000 });
  assert.equal(view.value.widths.size, 64);
  await view.dispatch('size', 'onPointerCancel'); assert.equal(view.captures.get('size').size, 0);
  assert.equal(view.value.widths.size, 64);
  await view.dispatch('size', 'onPointerDown');
  await view.dispatch('size', 'onPointerMove', { clientX: 9999 }); assert.equal(view.value.widths.size, 2000);
  await view.update({ enabled: false });
  assert.equal(view.grips().length, 0); assert.equal(view.captures.get('size').size, 0);
  await view.dispatch('size', 'onKeyDown', { key: 'Home' });
  await view.dispatch('size', 'onPointerDown');
  assert.equal(view.value.widths.size, 2000); assert.equal(view.captures.get('size').size, 0);
  await view.update({ enabled: true }); assert.equal(view.grips().length, 4); assert.equal(view.value.widths.size, 2000);
  await view.dispatch('size', 'onPointerDown'); await view.dispatch('size', 'onLostPointerCapture');
  assert.equal(view.captures.get('size').size, 0);
  await view.dispatch('name', 'onPointerDown'); assert.equal(view.captures.get('name').size, 1);
  await view.unmount(); assert.equal(view.captures.get('name').size, 0);
  assert.equal(view.observers.size, 0); assert.equal(view.listeners.size, 0);
});

test('each Explorer retains its own column preferences and table measurement', async t => {
  const first = await mount(t), second = await mount(t, { measurements: { name: 280, size: 120 } });
  await first.dispatch('name', 'onKeyDown', { key: 'ArrowRight' });
  assert.equal(first.value.widths.name, 430); assert.equal(second.value.widths.name, undefined);
  await second.dispatch('name', 'onKeyDown', { key: 'ArrowLeft' });
  assert.equal(second.value.widths.name, 270); assert.equal(second.value.widths.size, 120);
  assert.equal(first.value.widths.name, 430); assert.equal(first.value.widths.size, 100);
});

test('search location column preserves its width across listing switches and only visible columns contribute to total width', async t => {
  const automatic = await mount(t, { initialWidths: { location: 355 } });
  await automatic.dispatch('name', 'onKeyDown', { key: 'ArrowRight' });
  assert.equal(automatic.value.widths.location, 355, 'measuring the ordinary listing must not overwrite a hidden location preference');
  assert.equal(automatic.value.totalWidth, 748);
  const view = await mount(t, { initialWidths: { name: 320, location: 360 } });
  assert.equal(view.value.widths.location, 360); assert.equal(view.value.totalWidth, 624);
  assert.equal(view.grips().length, 4);
  await view.update({ columns: EXPLORER_DETAILS_COLUMNS });
  assert.equal(view.grips().length, 5); assert.equal(view.value.totalWidth, 984);
  assert.equal(view.grip('location').props['aria-valuemin'], 140);
  assert.equal(view.grip('location').props['aria-valuenow'], 360);
  await view.dispatch('location', 'onKeyDown', { key: 'ArrowRight', shiftKey: true });
  assert.equal(view.value.widths.location, 410); assert.equal(view.value.totalWidth, 1034);
  const widths = { ...view.value.widths };
  await view.update({ columns: EXPLORER_STANDARD_DETAILS_COLUMNS });
  assert.deepEqual(view.value.widths, widths); assert.equal(view.value.totalWidth, 624);
  await view.dispatch('name', 'onKeyDown', { key: 'ArrowRight' });
  assert.equal(view.value.widths.location, 410); assert.equal(view.value.totalWidth, 634);
  await view.update({ columns: EXPLORER_DETAILS_COLUMNS });
  assert.equal(view.value.totalWidth, 1044); assert.equal(view.grip('location').props['aria-valuenow'], 410);
  await view.dispatch('location', 'onDoubleClick');
  assert.equal(view.value.widths.location, 360); assert.equal(view.value.widths.name, 330);
  assert.equal(view.value.totalWidth, 994);
});

test('switching visible columns cancels an in-flight drag without resetting any stored column width', async t => {
  const view = await mount(t, { initialWidths: { location: 355 }, columns: EXPLORER_DETAILS_COLUMNS });
  await view.dispatch('location', 'onPointerDown');
  await view.dispatch('location', 'onPointerMove', { clientX: 255 });
  assert.equal(view.captures.get('location').has(1), true);
  const widths = { ...view.value.widths };
  await view.update({ columns: EXPLORER_STANDARD_DETAILS_COLUMNS });
  assert.equal(view.captures.get('location').size, 0);
  assert.equal(view.nodes.get('location').dataset.resizing, undefined);
  await view.dispatch('location', 'onPointerMove', { clientX: 900 });
  assert.deepEqual(view.value.widths, widths);
  await view.dispatch('name', 'onPointerDown');
  await view.update({ columns: EXPLORER_DETAILS_COLUMNS });
  assert.equal(view.captures.get('name').size, 0, 'a column switch also cancels a drag whose column remains visible');
  assert.deepEqual(view.value.widths, widths);
  assert.equal(view.value.totalWidth, Object.values(widths).reduce((sum, width) => sum + width, 0));
});
