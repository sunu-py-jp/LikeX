import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet'; export { useGridAutofill, autoFillTarget } from './src/ui/grid/use-grid-autofill';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'autofill-drag.tsx' }, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useGridAutofill, autoFillTarget } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
async function mount(t, overrides = {}) {
  const listeners = new Map(), frames = new Map(); let frameId = 0, current, renderer;
  const view = { addEventListener: (type, fn) => listeners.set(`window:${type}`, fn), removeEventListener: type => listeners.delete(`window:${type}`),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  const element = { scrollTop: 0, scrollLeft: 0, ownerDocument: {
    defaultView: view, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type),
  }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200 }) };
  const scroller = { current: element };
  const geometry = { columnOffsets: [48, 148, 248, 348, 448, 548], rowOffsets: Array.from({ length: 13 }, (_, i) => (i + 1) * 28) };
  function Probe() {
    const c = useSpreadsheet({ initialWorkbook: { sheets: [{ id: 'main', name: 'Main', rowCount: 12, columnCount: 5, cells: { A1: { value: '1' }, A2: { value: '2' } } }] }, onSave() {}, ...overrides });
    current = { c, fill: useGridAutofill(c, scroller, geometry) }; return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; }, element, frames,
    async start() { await act(async () => current.c.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 }));
      await act(async () => current.fill.handle.props.onPointerDown({ button: 0, pointerId: 5, clientX: 148, clientY: 84, preventDefault() {}, stopPropagation() {} })); },
    async dispatch(type, event = {}) { await act(async () => listeners.get(type)?.({ pointerId: 5, buttons: 1, clientX: 80, clientY: 130, preventDefault() {}, stopPropagation() {}, ...event })); },
    async tick() { const [id, callback] = frames.entries().next().value ?? []; if (callback) { frames.delete(id); await act(async () => callback()); } },
  };
}

test('drag previews a single axis and fills through a single undoable transaction on release', async t => {
  const hook = await mount(t); await hook.start(); await hook.dispatch('pointermove');
  assert.ok(hook.current.fill.preview); assert.equal(hook.current.c.workbook.sheets[0].cells.A3, undefined);
  await hook.dispatch('pointerup');
  assert.equal(hook.current.c.workbook.sheets[0].cells.A3.value, '3'); assert.equal(hook.current.c.workbook.sheets[0].cells.A4.value, '4');
  assert.equal(hook.current.fill.preview, null);
  await act(async () => hook.current.c.undo()); assert.equal(hook.current.c.workbook.sheets[0].cells.A3, undefined);
});

test('edge dragging scrolls and Escape cancels preview without committing', async t => {
  const hook = await mount(t); await hook.start(); await hook.dispatch('pointermove', { clientY: 240 }); await hook.tick();
  assert.ok(hook.element.scrollTop > 0);
  await hook.dispatch('keydown', { key: 'Escape' }); await hook.dispatch('pointerup');
  assert.equal(hook.current.fill.preview, null); assert.equal(hook.frames.size, 0);
  assert.equal(hook.current.c.workbook.sheets[0].cells.A3, undefined);
});

test('an intervening edit invalidates the drag and geometry never extends both axes at once', async t => {
  const hook = await mount(t); await hook.start(); await hook.dispatch('pointermove');
  await act(async () => hook.current.c.executeCommand({ type: 'cells.set', sheetId: 'main', values: { A1: '99' } }));
  await hook.dispatch('pointerup');
  assert.equal(hook.current.c.workbook.sheets[0].cells.A1.value, '99'); assert.equal(hook.current.c.workbook.sheets[0].cells.A3, undefined);
  assert.deepEqual(autoFillTarget({ top: 1, left: 1, bottom: 2, right: 2 }, 3, 6), { top: 1, left: 1, bottom: 2, right: 6 });
});
