import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export { useSpreadsheet } from "./src/state/use-spreadsheet"; export { useDrawingInteractions } from "./src/ui/drawings/use-drawing-interactions";', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'drawing-drag-scroll.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'source-core-and-shared-react', setup(builder) {
    builder.onResolve({ filter: /^@likex\/core(?:\/.*)?$/ }, ({ path }) => ({ path: new URL(`../../core/src/${path === '@likex/core' ? 'index' : path.slice('@likex/core/'.length)}.ts`, import.meta.url).pathname }));
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useDrawingInteractions } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const geometry = { columnOffsets: Array.from({ length: 51 }, (_, i) => 48 + i * 100), rowOffsets: Array.from({ length: 101 }, (_, i) => 28 + i * 28) };
const shape = { id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 2, offsetX: 10, offsetY: 10 }, width: 100, height: 60, fill: '#ffffff', stroke: '#217346', strokeWidth: 2 };
const initialRectangle = { left: 258, top: 150, width: 100, height: 60 };
const initialWorkbook = () => ({ sheets: [
  { id: 'one', name: 'One', rowCount: 100, columnCount: 50, cells: {}, drawings: [shape] },
  { id: 'two', name: 'Two', rowCount: 100, columnCount: 50, cells: {}, drawings: [] },
] });

async function mount(t, scale = 1, options = {}) {
  let current, renderer, frameId = 0, time = 0, scrollLeft = 120, scrollTop = 84, ended = false;
  const frames = new Map(), listeners = new Map(), captures = new Set();
  const add = prefix => (type, callback) => listeners.set(`${prefix}:${type}`, callback);
  const remove = prefix => (type, callback) => { if (listeners.get(`${prefix}:${type}`) === callback) listeners.delete(`${prefix}:${type}`); };
  const view = { addEventListener: add('window'), removeEventListener: remove('window'),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  const document = { defaultView: view, addEventListener: add('document'), removeEventListener: remove('document') };
  const scroller = {
    ownerDocument: document, clientLeft: 0, clientTop: 0, clientWidth: 300, clientHeight: 200,
    get scrollLeft() { return scrollLeft; }, set scrollLeft(value) { scrollLeft = Math.max(0, Math.min(geometry.columnOffsets.at(-1) - this.clientWidth, value)); },
    get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Math.max(0, Math.min(geometry.rowOffsets.at(-1) - this.clientHeight, value)); },
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 10 + 300 * scale, bottom: 20 + 200 * scale, width: 300 * scale, height: 200 * scale }),
    addEventListener: add('scroller'), removeEventListener: remove('scroller'),
  };
  const layer = { ownerDocument: document, closest: selector => selector === '.lxs-grid-scroll' ? scroller : null,
    getBoundingClientRect: () => ({ left: 10 - scrollLeft * scale, top: 20 - scrollTop * scale, width: geometry.columnOffsets.at(-1) * scale, height: geometry.rowOffsets.at(-1) * scale }) };
  const target = { ownerDocument: document, closest: () => null, focus() {},
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  let props = { initialWorkbook: initialWorkbook(), initialZoom: scale * 100, onSave() {}, ...options };
  function Probe() {
    const c = useSpreadsheet(props), drawing = useDrawingInteractions(c, geometry);
    current = { c, drawing }; return createElement('div', { ref: drawing.layer });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: () => layer }); });
  const unmount = async () => { if (!ended) { ended = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  const event = (x, y, overrides = {}) => ({ button: 0, buttons: 1, pointerId: 5, shiftKey: false, clientX: x, clientY: y,
    currentTarget: target, target, nativeEvent: {}, preventDefault() {}, stopPropagation() {}, ...overrides });
  const client = (x, y) => ({ x: 10 + (x - scrollLeft) * scale, y: 20 + (y - scrollTop) * scale });
  return {
    get current() { return current; }, scroller, frames, captures, listeners, event, client, unmount,
    async start(kind = 'move', corner = 'se') {
      await act(async () => current.c.selectDrawing('shape'));
      const start = kind === 'resize' ? client(initialRectangle.left + initialRectangle.width, initialRectangle.top + initialRectangle.height) : client(initialRectangle.left + 50, initialRectangle.top + 30);
      await act(async () => current.drawing.start(event(start.x, start.y), current.c.activeSheet.drawings[0], kind, corner));
      return start;
    },
    async move(point) { await act(async () => current.drawing.move(event(point.x, point.y))); },
    async finish(point) { await act(async () => current.drawing.finish(event(point.x, point.y))); },
    async tick() {
      const callbacks = [...frames.entries()]; frames.clear(); time += 16;
      await act(async () => { for (const [, callback] of callbacks) callback(time); });
    },
    async dispatch(name, payload = {}) { await act(async () => listeners.get(name)?.(event(0, 0, payload))); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
  };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} should equal ${expected}`);
const rectangle = drawing => ({ left: geometry.columnOffsets[drawing.anchor.column] + drawing.anchor.offsetX,
  top: geometry.rowOffsets[drawing.anchor.row] + drawing.anchor.offsetY, width: drawing.width, height: drawing.height });

for (const scale of [0.5, 2]) test(`moving at ${scale * 100}% keeps the stationary pointer aligned while RAF scrolls and commits once`, async t => {
  const ui = await mount(t, scale); await ui.start();
  const before = ui.current.c.workbook, bounds = ui.scroller.getBoundingClientRect();
  const pointer = { x: bounds.right - 2, y: bounds.bottom - 2 };
  await ui.move(pointer);
  const first = { ...ui.current.drawing.preview.preview }, left = ui.scroller.scrollLeft, top = ui.scroller.scrollTop;
  await ui.tick(); await ui.tick();
  assert.ok(ui.scroller.scrollLeft > left); assert.ok(ui.scroller.scrollTop > top);
  close(ui.current.drawing.preview.preview.left - first.left, ui.scroller.scrollLeft - left);
  close(ui.current.drawing.preview.preview.top - first.top, ui.scroller.scrollTop - top);
  assert.equal(ui.current.c.workbook, before, 'auto-scroll changes only the live spatial preview');
  const finalPreview = ui.current.drawing.preview.preview;
  await ui.finish(pointer);
  const committed = ui.current.c.workbook, final = rectangle(ui.current.c.activeSheet.drawings[0]);
  assert.ok(Math.abs(final.left - finalPreview.left) <= 0.01); assert.ok(Math.abs(final.top - finalPreview.top) <= 0.01);
  assert.equal(ui.current.drawing.preview, null); assert.equal(ui.frames.size, 0); assert.equal(ui.captures.size, 0);
  await act(async () => ui.current.c.undo());
  assert.equal(ui.current.c.workbook, before); assert.equal(ui.current.c.canUndo, false);
  await act(async () => ui.current.c.redo()); assert.equal(ui.current.c.workbook, committed);
});

test('resizing outside the viewport scrolls continuously and includes scroll in the release coordinates', async t => {
  const ui = await mount(t, 2); await ui.start('resize');
  const before = ui.current.c.workbook, bounds = ui.scroller.getBoundingClientRect();
  const pointer = { x: bounds.right + 80, y: bounds.bottom + 100 };
  await ui.move(pointer);
  const first = { ...ui.current.drawing.preview.preview }, left = ui.scroller.scrollLeft, top = ui.scroller.scrollTop;
  await ui.tick(); await ui.tick(); await ui.tick();
  close(ui.current.drawing.preview.preview.width - first.width, ui.scroller.scrollLeft - left);
  close(ui.current.drawing.preview.preview.height - first.height, ui.scroller.scrollTop - top);
  assert.equal(ui.current.c.workbook, before);
  const finalPreview = ui.current.drawing.preview.preview;
  await ui.dispatch('document:pointerup', { clientX: pointer.x, clientY: pointer.y });
  assert.equal(ui.current.c.activeSheet.drawings[0].width, finalPreview.width);
  assert.equal(ui.current.c.activeSheet.drawings[0].height, finalPreview.height);
  assert.equal(ui.frames.size, 0); assert.equal(ui.current.drawing.preview, null);
  await act(async () => ui.current.c.undo()); assert.equal(ui.current.c.workbook, before);
});

test('left/top header boundaries scroll backward, and returning to the center stops movement', async t => {
  const ui = await mount(t); await ui.start();
  await ui.move({ x: 10 + 48, y: 20 + 28 });
  const left = ui.scroller.scrollLeft, top = ui.scroller.scrollTop;
  await ui.tick(); assert.ok(ui.scroller.scrollLeft < left); assert.ok(ui.scroller.scrollTop < top);
  await ui.move({ x: 10 + 175, y: 20 + 110 });
  const middle = { x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop };
  await ui.tick(); await ui.tick();
  assert.deepEqual({ x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop }, middle);
});

test('scrolling manually during a drag refreshes its world coordinates without an extra pointermove', async t => {
  const ui = await mount(t, 0.5); await ui.start();
  const first = { ...ui.current.drawing.preview.preview };
  ui.scroller.scrollLeft += 40; ui.scroller.scrollTop += 50;
  await ui.dispatch('scroller:scroll');
  close(ui.current.drawing.preview.preview.left, first.left + 40);
  close(ui.current.drawing.preview.preview.top, first.top + 50);
});

for (const reason of ['pointercancel', 'escape', 'blur', 'capture', 'unmount']) test(`${reason} stops auto-scroll and discards the preview`, async t => {
  const ui = await mount(t); await ui.start();
  const before = ui.current.c.workbook;
  await ui.move({ x: 400, y: 300 }); await ui.tick();
  if (reason === 'pointercancel') await ui.dispatch('document:pointercancel');
  if (reason === 'escape') await ui.dispatch('document:keydown', { key: 'Escape' });
  if (reason === 'blur') await ui.dispatch('window:blur');
  if (reason === 'capture') await act(async () => ui.current.drawing.lostPointerCapture('shape'));
  if (reason === 'unmount') await ui.unmount();
  const after = { x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop };
  assert.equal(ui.frames.size, 0); assert.equal(ui.captures.size, 0); assert.equal(ui.listeners.size, 0);
  await ui.tick(); assert.deepEqual({ x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop }, after);
  assert.equal(ui.current.c.workbook, before);
  if (reason !== 'unmount') {
    await ui.finish({ x: 400, y: 300 }); assert.equal(ui.current.c.workbook, before); assert.equal(ui.current.drawing.preview, null);
  }
});

for (const reason of ['readonly', 'shapes', 'resize', 'workbook', 'sheet', 'drawing', 'selection', 'zoom']) test(`${reason} invalidates the gesture before another frame or pointer event`, async t => {
  const ui = await mount(t); await ui.start(reason === 'resize' ? 'resize' : 'move');
  await ui.move({ x: 400, y: 300 }); await ui.tick();
  if (reason === 'readonly') await ui.update({ readOnly: true });
  if (reason === 'shapes') await ui.update({ features: { shapes: false } });
  if (reason === 'resize') await ui.update({ features: { resize: false } });
  if (reason === 'workbook') await act(async () => ui.current.c.externalExecute({ type: 'cells.set', sheetId: 'one', values: { A1: 'changed' } }));
  if (reason === 'sheet') await act(async () => ui.current.c.selectionApi.selectSheet('two'));
  if (reason === 'drawing') await act(async () => ui.current.c.externalExecute({ type: 'drawings.delete', sheetId: 'one', drawingId: 'shape' }));
  if (reason === 'selection') await act(async () => ui.current.c.selectDrawing(null));
  if (reason === 'zoom') await act(async () => ui.current.c.setZoom(200));
  const before = ui.current.c.workbook, scroll = { x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop };
  assert.equal(ui.current.drawing.preview, null); assert.equal(ui.frames.size, 0); assert.equal(ui.captures.size, 0);
  await ui.tick(); await ui.finish({ x: 400, y: 300 });
  assert.equal(ui.current.c.workbook, before); assert.deepEqual({ x: ui.scroller.scrollLeft, y: ui.scroller.scrollTop }, scroll);
});

test('an unmoved press and rotation do not start boundary auto-scroll; foreign pointers cannot finish it', async t => {
  const ui = await mount(t); await ui.start();
  assert.equal(ui.frames.size, 0);
  await ui.dispatch('document:pointerup', { pointerId: 9 }); assert.ok(ui.current.drawing.preview);
  await act(async () => ui.current.drawing.cancelGesture());
  await ui.start('rotate'); await ui.move({ x: 400, y: 300 });
  assert.equal(ui.frames.size, 0);
  await ui.dispatch('window:blur'); assert.equal(ui.current.drawing.preview, null);
});
