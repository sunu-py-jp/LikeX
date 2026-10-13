import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: { contents: `export { useGridLayout } from './ui/grid/use-grid-layout';
    export * from './ui/grid/progressive-grid-rows'; export { createGridMergeCache } from './ui/grid/grid-merge-cache';
    export { SpreadsheetGrid } from './ui/spreadsheet-grid'; export { useSpreadsheet } from './state/use-spreadsheet';`,
  resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useGridLayout, gridBackgroundRowBudget, createGridRowProgress, retainGridRows, advanceGridRows, createGridMergeCache, SpreadsheetGrid, useSpreadsheet } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fakeWindow(idle) {
  let id = 0;
  const pending = new Map(), cancelled = [];
  const schedule = (callback, kind) => { pending.set(++id, { callback, kind }); return id; };
  const cancel = key => { if (pending.has(key)) cancelled.push(pending.get(key)); pending.delete(key); };
  const host = { setTimeout: callback => schedule(callback, 'timeout'), clearTimeout: cancel };
  if (idle) Object.assign(host, { requestIdleCallback: (callback, options) => {
    assert.equal(options.timeout, 250); return schedule(callback, 'idle');
  }, cancelIdleCallback: cancel });
  return { host, pending, cancelled, take() { const [key, job] = pending.entries().next().value; pending.delete(key); return job; } };
}

function sheet(patch = {}) {
  return { id: 'one', name: 'One', rowCount: 250, columnCount: 8, cells: {}, ...patch };
}

async function mount(t, { initialSheet = sheet(), idle = true, mode, focus = 0 } = {}) {
  let layout, renderer, mounted = true;
  let props = { sheet: initialSheet, mode, focus, revision: 0 };
  const tasks = fakeWindow(idle);
  const element = { ownerDocument: { defaultView: tasks.host }, scrollTop: 0, scrollLeft: 0, clientHeight: 224, clientWidth: 640 };
  function Probe(value) {
    layout = useGridLayout(value.sheet, value.focus, null, null, 100, value.mode);
    return createElement('div', { ref: layout.scroller });
  }
  const render = () => createElement(Probe, { ...props, key: props.revision });
  await act(async () => { renderer = create(render(), { createNodeMock: () => element }); });
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return {
    get layout() { return layout; }, tasks, element, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
    async tick() { const job = tasks.take(); await act(async () => job.callback({ didTimeout: false, timeRemaining: () => 5 })); return job; },
    async drain() { let count = 0; while (tasks.pending.size) { assert.ok(count++ < 1000); await this.tick(); } },
    async scroll(top, left = 0) { element.scrollTop = top; element.scrollLeft = left; await act(async () => layout.onScroll({ currentTarget: element })); },
  };
}

test('default mode prepares remaining rows in bounded idle batches and eventually renders the whole sheet', async t => {
  const ui = await mount(t);
  const initial = ui.layout.virtualRows.length;
  assert.ok(initial < 250);
  assert.equal(ui.tasks.pending.size, 1);
  assert.equal([...ui.tasks.pending.values()][0].kind, 'idle');
  const geometry = [ui.layout.widths, ui.layout.columnOffsets, ui.layout.rowOffsets];
  await ui.tick();
  assert.ok(ui.layout.virtualRows.length > initial);
  assert.ok(ui.layout.virtualRows.length - initial <= gridBackgroundRowBudget(8));
  assert.deepEqual([ui.layout.widths, ui.layout.columnOffsets, ui.layout.rowOffsets], geometry);
  assert.strictEqual(ui.layout.widths, geometry[0]);
  assert.strictEqual(ui.layout.columnOffsets, geometry[1]);
  assert.strictEqual(ui.layout.rowOffsets, geometry[2]);
  await ui.drain();
  assert.deepEqual(ui.layout.virtualRows, Array.from({ length: 250 }, (_, row) => row));
  assert.equal(ui.tasks.pending.size, 0);
});

test('wide and tall sheets make bounded progress without a silent row cap', () => {
  assert.equal(gridBackgroundRowBudget(1000), 1);
  assert.equal(gridBackgroundRowBudget(8), 32);
  const progress = createGridRowProgress(10000, 1000);
  retainGridRows(progress, [0, 9999]);
  let iterations = 0;
  while (advanceGridRows(progress)) {
    assert.ok(++iterations <= 10000);
    assert.equal(progress.loaded.size, iterations + 2);
  }
  assert.equal(progress.rows.length, 10000);
  assert.equal(progress.rows[9999], 9999);
});

test('viewport mode never queues background rows, but includes focused rows and visible merge anchors', async t => {
  const merge = { top: 2, bottom: 60, left: 0, right: 1 };
  const ui = await mount(t, { mode: 'viewport', focus: 200, initialSheet: sheet({ merges: [merge] }) });
  await ui.scroll(28 * 45, 123);
  assert.equal(ui.tasks.pending.size, 0);
  assert.ok(ui.layout.virtualRows.length < 30);
  assert.ok(ui.layout.virtualRows.includes(200));
  assert.ok(ui.layout.virtualRows.includes(2));
  assert.equal(ui.layout.viewport.left, 123);
  assert.equal(ui.layout.viewport.width, 640);
  assert.strictEqual(ui.layout.renderedMerges.get(45 * 8), merge);
});

test('scrolling prioritizes the new viewport immediately and progressive mode retains visited rows', async t => {
  const ui = await mount(t);
  const original = [...ui.layout.virtualRows];
  await ui.scroll(28 * 200);
  assert.ok(ui.layout.virtualRows.includes(200));
  for (const row of original) assert.ok(ui.layout.virtualRows.includes(row));
  await ui.scroll(0);
  assert.ok(ui.layout.virtualRows.includes(200), 'a previously visited row remains mounted');
  assert.equal(ui.tasks.pending.size, 1, 'only one next batch is queued');
});

test('switching to viewport releases background rows and ignores cancelled callbacks', async t => {
  const ui = await mount(t);
  await ui.tick(); await ui.tick();
  const lastLoaded = ui.layout.virtualRows.at(-1);
  assert.ok(lastLoaded > 50);
  const stale = [...ui.tasks.pending.values()][0];
  await ui.update({ mode: 'viewport' });
  const expected = [...ui.layout.virtualRows];
  assert.ok(!expected.includes(lastLoaded));
  assert.equal(ui.tasks.pending.size, 0);
  await act(async () => stale.callback());
  assert.deepEqual(ui.layout.virtualRows, expected);
  await ui.update({ mode: 'progressive' });
  assert.ok(!ui.layout.virtualRows.includes(lastLoaded), 'switching back starts a new background session');
  assert.equal(ui.tasks.pending.size, 1);
});

test('sheet, dimension and workbook-view changes discard old queued work and progress', async t => {
  const ui = await mount(t);
  await ui.drain();
  assert.equal(ui.layout.virtualRows.length, 250);
  await ui.update({ sheet: sheet({ id: 'two' }) });
  assert.ok(ui.layout.virtualRows.length < 50);
  const stale = [...ui.tasks.pending.values()][0];
  await ui.update({ sheet: sheet({ id: 'two', rowCount: 40, columnCount: 1000 }) });
  const before = [...ui.layout.virtualRows];
  await act(async () => stale.callback());
  assert.deepEqual(ui.layout.virtualRows, before);
  await ui.tick();
  assert.equal(ui.layout.virtualRows.length, before.length + 1, 'new column count controls the new task budget');
  await ui.drain();
  assert.equal(ui.layout.virtualRows.length, 40);
  await ui.update({ revision: 1 });
  assert.ok(ui.layout.virtualRows.length < 40, 'reopening a workbook with the same sheet ID starts fresh');
});

test('timeout fallback belongs to the scroller window and is cancelled on unmount', async t => {
  const ui = await mount(t, { idle: false });
  assert.equal([...ui.tasks.pending.values()][0].kind, 'timeout');
  await ui.tick();
  const stale = [...ui.tasks.pending.values()][0];
  await ui.unmount();
  assert.equal(ui.tasks.pending.size, 0);
  await act(async () => stale.callback());
  assert.equal(ui.tasks.pending.size, 0);
});

test('merge lookups expand only requested rows and keep their map stable as rows are added', () => {
  const tall = { top: 0, bottom: 9999, left: 0, right: 2 };
  const short = { top: 20, bottom: 30, left: 5, right: 8 };
  const cache = createGridMergeCache([short, tall], 1000);
  const cells = cache.include([0]);
  assert.equal(cells.size, 3, 'whole-sheet merges are not eagerly expanded');
  assert.strictEqual(cache.include([0, 25]), cells);
  assert.equal(cells.size, 10);
  assert.strictEqual(cells.get(25005), short);
  assert.strictEqual(cells.get(25002), tall);
  assert.equal(cells.get(25004), undefined);
  cache.include([10, 45]);
  assert.equal(cells.get(10005), undefined);
  assert.equal(cells.get(45005), undefined);
  assert.strictEqual(cells.get(45000), tall);
});

test('the full grid prepares the last row and viewport switching keeps the same active editor and its draft', async t => {
  let controller, renderer;
  const tasks = fakeWindow(true);
  Object.assign(tasks.host, { addEventListener() {}, removeEventListener() {} });
  const document = { defaultView: tasks.host, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const inputs = new Map();
  const initialWorkbook = { sheets: [sheet({ rowCount: 96, columnCount: 4, cells: { A1: { value: 'saved' }, D96: { value: 'last' } } })] };
  function node(element) {
    const label = element?.props?.['aria-label'];
    if (element?.type === 'textarea' && inputs.has(label)) return inputs.get(label);
    const value = { ownerDocument: document, style: {}, scrollHeight: 18, scrollTop: 0, scrollLeft: 0, clientHeight: 224, clientWidth: 640,
      closest: () => null, addEventListener() {}, removeEventListener() {}, contains: target => target?.ownerDocument === document,
      focus() { document.activeElement = this; }, setSelectionRange() {}, select() {} };
    if (element?.type === 'textarea') inputs.set(label, value);
    return value;
  }
  function Probe({ mode }) {
    controller = useSpreadsheet({ initialWorkbook, onSave() {}, renderingMode: mode });
    return createElement(SpreadsheetGrid, { controller });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const cell = label => renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['aria-label'].split(' ')[0] === label);
  const input = () => renderer.root.findByProps({ className: 'lxs-cell-input' });
  assert.equal(cell('D96'), undefined);
  await act(async () => controller.beginEdit({ row: 0, column: 0 }, 'still typing'));
  const editor = input();
  assert.equal(editor.props.value, 'still typing');
  let batches = 0;
  while (tasks.pending.size) {
    assert.ok(batches++ < 10);
    await act(async () => tasks.take().callback());
    assert.strictEqual(input(), editor, 'background rows must not remount the active textarea');
  }
  assert.match(cell('D96').props['aria-label'], /last/);
  await act(async () => renderer.update(createElement(Probe, { mode: 'viewport' })));
  assert.equal(cell('D96'), undefined);
  assert.equal(tasks.pending.size, 0);
  assert.strictEqual(input(), editor);
  assert.equal(input().props.value, 'still typing');
  assert.equal(controller.activeSheet.cells.A1.value, 'saved', 'view mode changes do not commit a draft');
});
