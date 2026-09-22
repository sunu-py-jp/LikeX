import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, useRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet'; export { useGridSelection } from './src/ui/grid/use-grid-selection'; export { useSheetTabReorder } from './src/ui/sheets/use-sheet-tab-reorder';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'drag-scroll-ui.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useGridSelection, useSheetTabReorder } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function eventTarget() {
  const handlers = new Map();
  return { addEventListener(type, fn) { const list = handlers.get(type) ?? new Set(); list.add(fn); handlers.set(type, list); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    dispatch(type, event) { for (const fn of [...handlers.get(type) ?? []]) fn(event); },
    get listenerCount() { return [...handlers.values()].reduce((n, list) => n + list.size, 0); } };
}
async function mount(t, overrides = {}) {
  let current, renderer, id = 0, time = 0;
  const frames = new Map(), timers = new Map(), previews = [];
  const view = { ...eventTarget(), requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const root = { appendChild(node) { previews.push(node); } };
  const document = { ...eventTarget(), defaultView: view, body: root, createElement() { return { style: {}, setAttribute() {}, remove() { this.removed = true; } }; } };
  const scroller = { ownerDocument: document, scrollLeft: 0, scrollTop: 0, focus() {},
    getBoundingClientRect() { const scale = current.c.zoom / 100; return { left: 0, top: 0, right: 300 * scale, bottom: 200 * scale }; } };
  let tabScroll = 0;
  const strip = { ownerDocument: document, offsetWidth: 240, closest: () => root,
    get scrollLeft() { return tabScroll; }, set scrollLeft(value) { tabScroll = Math.max(0, Math.min(560, value)); },
    getBoundingClientRect: () => ({ left: 0, top: 400, right: 240, bottom: 432, width: 240 }),
    querySelectorAll: () => current.c.workbook.sheets.map((sheet, index) => ({ dataset: { lxsSheetId: sheet.id }, getBoundingClientRect: () => ({ left: index * 100 - tabScroll, width: 100 }) })) };
  let props = { initialWorkbook: { sheets: Array.from({ length: 8 }, (_, i) => ({ id: `sheet${i}`, name: i ? `Sheet ${i}` : '<b>Sheet', rowCount: 40, columnCount: 15, cells: {} })) }, onSave() {}, ...overrides };
  function Probe() {
    const c = useSpreadsheet(props), scrollerRef = useRef(scroller), activeInputRef = useRef(null), focusIntentRef = useRef(false);
    const geometry = { columnOffsets: Array.from({ length: 16 }, (_, i) => 48 + i * 100), rowOffsets: Array.from({ length: 41 }, (_, i) => 28 + i * 28) };
    current = { c, selection: useGridSelection(c, { scrollerRef, activeInputRef, focusIntentRef }, geometry), tabs: useSheetTabReorder(c, false) };
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  const event = patch => ({ pointerId: 7, button: 0, buttons: 1, clientX: 80, clientY: 80, preventDefault() {}, stopPropagation() {}, currentTarget: { ownerDocument: document, closest: () => null }, ...patch });
  return { get current() { return current; }, scroller, strip, frames, previews, timers, document, view,
    async start(kind = 'cell') { await act(async () => current.selection.startSelection(event(), { row: 1, column: 1 }, kind)); },
    async dispatch(type, patch = {}) { await act(async () => document.dispatch(type, event(patch))); },
    async tick(count = 1) { for (let i = 0; i < count; i++) { const callbacks = [...frames]; frames.clear(); time += 16; await act(async () => { for (const [, fn] of callbacks) fn(time); }); } },
    async run(fn) { await act(async () => fn(current.c)); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async unmount() { await act(async () => renderer.unmount()); renderer = null; },
    async startTab() { let captured; await act(async () => current.tabs.onDragStart(event({ clientX: 30, clientY: 416, currentTarget: { closest: () => strip },
      dataTransfer: { setData() {}, setDragImage(node, x, y) { captured = { node, x, y }; } } }), 'sheet0')); return captured; },
    async overTab(x, y = 416) { await this.dispatch('dragover', { clientX: x, clientY: y }); await act(async () => current.tabs.onDragOver(event({ clientX: x, clientY: y, currentTarget: strip, dataTransfer: {} }))); },
    async dropTab(x) { await act(async () => current.tabs.onDrop(event({ clientX: x, currentTarget: strip }))); },
  };
}

test('sheet drag uses a small text-only image and recomputes the insertion line while the pointer stays outside', async t => {
  const ui = await mount(t); const original = ui.current.c.workbook;
  const image = await ui.startTab();
  assert.equal(image.node.className, 'lxs-sheet-drag-preview'); assert.equal(image.node.textContent, '<b>Sheet');
  assert.deepEqual([image.x, image.y], [12, 12]);
  await ui.overTab(270); const initial = ui.current.tabs.dropPosition.index;
  await ui.tick(30);
  assert.ok(ui.strip.scrollLeft > 250); assert.ok(ui.current.tabs.dropPosition.index > initial);
  assert.equal(ui.current.c.workbook, original, 'preview and scrolling do not edit');
  const destination = ui.current.tabs.dropPosition.index;
  await ui.dropTab(270);
  assert.equal(ui.current.c.workbook.sheets[destination].id, 'sheet0');
  assert.equal(ui.frames.size, 0); assert.equal(image.node.removed, true); assert.equal(ui.timers.size, 0);
  await ui.run(c => c.undo()); assert.equal(ui.current.c.workbook, original);
});

test('sheet scrolling reverses direction and pauses away from the tab strip', async t => {
  const ui = await mount(t); await ui.startTab(); await ui.overTab(270); await ui.tick(15);
  const right = ui.strip.scrollLeft;
  await ui.overTab(-20); await ui.tick(5); assert.ok(ui.strip.scrollLeft < right);
  const left = ui.strip.scrollLeft;
  await ui.overTab(270, 200); await ui.tick(5); assert.equal(ui.strip.scrollLeft, left);
  await ui.dispatch('keydown', { key: 'Escape' }); assert.equal(ui.frames.size, 0); assert.equal(ui.current.tabs.draggingId, null);
});

for (const reason of ['feature', 'workbook', 'blur', 'unmount']) test(`sheet scrolling cleans up after ${reason}`, async t => {
  const ui = await mount(t); await ui.startTab(); await ui.overTab(270);
  if (reason === 'feature') await ui.update({ features: { reorderSheets: false } });
  if (reason === 'workbook') await ui.run(c => c.executeCommand({ type: 'cells.set', sheetId: 'sheet0', values: { A1: 'changed' } }));
  if (reason === 'blur') await act(async () => ui.view.dispatch('blur', {}));
  if (reason === 'unmount') await ui.unmount();
  assert.equal(ui.frames.size, 0); assert.equal(ui.previews[0].removed, true);
  const scroll = ui.strip.scrollLeft; await ui.dispatch('dragover', { clientX: 270, clientY: 416 }); await ui.tick(3);
  assert.equal(ui.strip.scrollLeft, scroll);
});

for (const zoom of [50, 100, 200]) test(`selection keeps scrolling under a stationary outside pointer at ${zoom}%`, async t => {
  const ui = await mount(t, { initialZoom: zoom, readOnly: true }); await ui.start();
  await ui.dispatch('pointermove', { clientX: 400 * zoom / 100, clientY: 260 * zoom / 100 });
  const initialFocus = ui.current.c.selection.focus; await ui.tick(12);
  assert.ok(ui.scroller.scrollLeft > 0); assert.ok(ui.scroller.scrollTop > 0);
  assert.ok(ui.current.c.selection.focus.row > initialFocus.row); assert.ok(ui.current.c.selection.focus.column >= initialFocus.column);
  assert.equal(ui.current.c.dirty, false, 'readonly selection remains available without editing');
  assert.ok(Math.abs(ui.scroller.scrollTop * zoom / 100 - 138.24) < 0.01, 'scroll speed is measured in client pixels');
  await ui.dispatch('pointerup'); assert.equal(ui.frames.size, 0);
});

for (const kind of ['row', 'column']) test(`${kind} header drag scrolls only its axis`, async t => {
  const ui = await mount(t); await ui.start(kind); await ui.dispatch('pointermove', { clientX: 400, clientY: 260 }); await ui.tick(5);
  assert.equal(kind === 'row' ? ui.scroller.scrollLeft : ui.scroller.scrollTop, 0);
  assert.ok(kind === 'row' ? ui.scroller.scrollTop > 0 : ui.scroller.scrollLeft > 0);
});

for (const reason of ['Escape', 'pointercancel', 'blur', 'zoom', 'workbook', 'sheet', 'unmount']) test(`selection scroll ends on ${reason}`, async t => {
  const ui = await mount(t); await ui.start(); await ui.dispatch('pointermove', { clientX: 400, clientY: 260 }); await ui.tick();
  if (reason === 'Escape') await ui.dispatch('keydown', { key: 'Escape' });
  if (reason === 'pointercancel') await ui.dispatch('pointercancel');
  if (reason === 'blur') await act(async () => ui.view.dispatch('blur', {}));
  if (reason === 'zoom') await ui.run(c => c.setZoom(200));
  if (reason === 'workbook') await ui.run(c => c.executeCommand({ type: 'cells.set', sheetId: 'sheet0', values: { A1: 'changed' } }));
  if (reason === 'sheet') await ui.run(c => c.switchSheet('sheet1'));
  if (reason === 'unmount') await ui.unmount();
  assert.equal(ui.frames.size, 0);
  const scroll = ui.scroller.scrollTop; await ui.dispatch('pointermove', { clientX: 400, clientY: 260 }); await ui.tick(); assert.equal(ui.scroller.scrollTop, scroll);
});

test('committing an existing editor still starts a new selection drag against the committed workbook', async t => {
  const ui = await mount(t); await ui.run(c => c.beginEdit({ row: 0, column: 0 }, 'committed'));
  await ui.start(); await ui.dispatch('pointermove', { clientX: 400, clientY: 260 }); await ui.tick(3);
  assert.equal(ui.current.c.workbook.sheets[0].cells.A1.value, 'committed');
  assert.ok(ui.scroller.scrollTop > 0); assert.ok(ui.current.c.selection.focus.row > 1);
});
