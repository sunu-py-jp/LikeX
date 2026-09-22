import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { useSpreadsheetHandle } from './src/api/use-spreadsheet-handle';
  export { SpreadsheetGrid } from './src/ui/spreadsheet-grid';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useSpreadsheetHandle, SpreadsheetGrid } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t) {
  const ref = createRef(); let renderer, controller, scroller, focusCalls = 0;
  const outside = { id: 'host-input' };
  const document = { activeElement: outside, addEventListener() {}, removeEventListener() {},
    defaultView: { addEventListener() {}, removeEventListener() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} } };
  const sheet = id => ({ id, name: id, rowCount: 120, columnCount: 12, cells: {}, drawings: [{
    id: 'drawing', type: 'shape', shape: 'rectangle', anchor: { row: 90, column: 8, offsetX: 0, offsetY: 0 },
    width: 160, height: 80, fill: '#fff', stroke: '#000', strokeWidth: 1,
  }] });
  const initialWorkbook = { sheets: [sheet('a'), sheet('b')] };
  function Probe() {
    controller = useSpreadsheet({ initialWorkbook, onSave() {} });
    useSpreadsheetHandle(ref, controller);
    return createElement(SpreadsheetGrid, { controller });
  }
  const createNodeMock = element => {
    const node = { ownerDocument: document, style: {}, scrollTop: 0, scrollLeft: 0, scrollHeight: 28,
      clientHeight: 240, clientWidth: 350, addEventListener() {}, removeEventListener() {},
      focus() { document.activeElement = this; focusCalls++; }, setSelectionRange() {},
      closest() { return null; }, contains(value) { return value?.ownerDocument === document; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { top: 0, left: 0, right: 350, bottom: 240 }; } };
    if (element.props.className === 'lxs-grid-scroll') scroller = node;
    return node;
  };
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock }); });
  t.after(async () => act(() => renderer.unmount()));
  return { ref, get controller() { return controller; }, get scroller() { return scroller; }, document, outside,
    get focusCalls() { return focusCalls; } };
}

test('ref selection preserves scrolling/focus until reveal is explicitly requested', async t => {
  const view = await mount(t), api = view.ref.current;
  view.scroller.scrollTop = 120; view.scroller.scrollLeft = 60;
  const focusCount = view.focusCalls;
  await act(async () => assert.equal(api.selectCell('a', { row: 80, column: 9 }), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  assert.equal(view.focusCalls, focusCount); assert.strictEqual(view.document.activeElement, view.outside);
  await act(async () => assert.equal(api.revealSelection(), true));
  assert.ok(view.scroller.scrollTop > 120); assert.ok(view.scroller.scrollLeft > 60);
  assert.equal(view.focusCalls, focusCount);
  view.scroller.scrollTop = 120; view.scroller.scrollLeft = 60;
  await act(async () => assert.equal(api.selectRange('a', { anchor: { row: 0, column: 0 }, focus: { row: 119, column: 11 } }), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  await act(async () => assert.equal(api.selectColumns('a', 0, 11), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  await act(async () => assert.equal(api.selectRows('a', 0, 119), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  await act(async () => assert.equal(api.selectSheet('b'), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  await act(async () => assert.equal(api.selectDrawing('b', 'drawing'), true));
  assert.equal(view.scroller.scrollTop, 120); assert.equal(view.scroller.scrollLeft, 60);
  assert.equal(view.focusCalls, focusCount);
  await act(async () => assert.equal(api.selectDrawing('b', 'drawing', { reveal: true }), true));
  assert.ok(view.scroller.scrollTop > 120); assert.ok(view.scroller.scrollLeft > 60);
  assert.equal(view.focusCalls, focusCount, 'revealing an object also preserves host focus');
  const position = [view.scroller.scrollTop, view.scroller.scrollLeft];
  await act(async () => assert.equal(api.clearSelection(), true));
  assert.deepEqual([view.scroller.scrollTop, view.scroller.scrollLeft], position);
});

test('GUI selection still reveals and explicit grid focus continues after a silent ref selection', async t => {
  const view = await mount(t), api = view.ref.current;
  await act(async () => api.selectCell('a', { row: 80, column: 9 }));
  assert.equal(view.scroller.scrollTop, 0);
  await act(async () => view.controller.requestGridFocus());
  assert.ok(view.scroller.scrollTop > 0);
  assert.ok(view.focusCalls > 0);
  await act(async () => view.controller.select({ row: 0, column: 0 }));
  assert.equal(view.scroller.scrollTop, 0); assert.equal(view.scroller.scrollLeft, 0);
});
