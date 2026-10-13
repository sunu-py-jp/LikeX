import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: { contents: `export { SpreadsheetGrid } from './ui/spreadsheet-grid'; export { useSpreadsheet } from './state/use-spreadsheet';
    export { createBorderRowLookup } from './ui/grid/spreadsheet-grid-row'; export { createGridMergeCache } from './ui/grid/grid-merge-cache';`,
    resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetGrid, useSpreadsheet, createBorderRowLookup, createGridMergeCache } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function event(extra = {}) {
  return { button: 0, buttons: 1, pointerId: 1, detail: 1, nativeEvent: {}, shiftKey: false, ctrlKey: false, metaKey: false,
    altKey: false, preventDefault() {}, stopPropagation() {}, ...extra };
}

async function mount(t, { cells = {}, rowCount = 200, columnCount = 20, ...options } = {}) {
  let controller, renderer, props = options, taskId = 0;
  const tasks = new Map(), listeners = new Map();
  const host = { setTimeout: callback => { tasks.set(++taskId, callback); return taskId; }, clearTimeout: id => tasks.delete(id),
    addEventListener() {}, removeEventListener() {} };
  const document = { defaultView: host, activeElement: null, addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name) };
  const node = () => ({ ownerDocument: document, style: {}, scrollHeight: 18, scrollTop: 0, scrollLeft: 0, clientHeight: 224, clientWidth: 640,
    closest: () => null, addEventListener() {}, removeEventListener() {}, contains: target => target?.ownerDocument === document,
    focus() { document.activeElement = this; }, setSelectionRange() {}, select() {} });
  const scroller = node(), target = node();
  const initialWorkbook = { sheets: [{ id: 'sheet', name: 'Sheet', rowCount, columnCount, cells }] };
  function Probe() {
    controller = useSpreadsheet({ initialWorkbook, onSave() {}, ...props });
    return createElement(SpreadsheetGrid, { controller });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: element => element.props.className === 'lxs-grid-scroll' ? scroller : node() }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  while (tasks.size) {
    const [id, task] = tasks.entries().next().value; tasks.delete(id);
    await act(async () => task());
  }
  const cellsNow = () => renderer.root.findAllByProps({ role: 'gridcell' });
  const cell = (row, column) => cellsNow().find(item => item.props['data-lxs-row'] === row && item.props['data-lxs-column'] === column);
  return { get c() { return controller; }, cell,
    snapshot: () => new Map(cellsNow().map(item => [`${item.props['data-lxs-row']}:${item.props['data-lxs-column']}`, item.props])),
    async select(row, column, extend = false) { await act(async () => controller.select({ row, column }, extend)); },
    async key(key, extra = {}) { await act(async () => renderer.root.findByProps({ className: 'lxs-cell-input' }).props.onKeyDown(event({ key, ...extra }))); },
    async click(row, column, extra = {}) {
      await act(async () => cell(row, column).props.onPointerDown(event({ currentTarget: target, target, ...extra })));
      await act(async () => listeners.get('pointerup')?.(event({ buttons: 0 })));
    },
    async scroll(top, left = 0) {
      scroller.scrollTop = top; scroller.scrollLeft = left;
      await act(async () => renderer.root.findByProps({ className: 'lxs-grid-scroll' }).props.onScroll({ currentTarget: scroller }));
    },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
  };
}

function changedRows(before, after) {
  return [...new Set([...after].filter(([key, props]) => before.get(key) !== props).map(([key]) => Number(key.split(':')[0])))].sort((a, b) => a - b);
}

test('cursor moves update only affected rows after the entire sheet has been prepared', async t => {
  const ui = await mount(t);
  let previous = ui.snapshot();
  const features = ui.c.features;
  assert.equal(previous.size, 4000);
  await ui.select(80, 3);
  assert.strictEqual(ui.c.features, features, 'internal selection preserves feature configuration identity');
  assert.deepEqual(changedRows(previous, ui.snapshot()), [0, 80]);
  assert.equal(ui.cell(80, 3).props['aria-selected'], true);
  previous = ui.snapshot();
  await ui.key('ArrowDown');
  assert.deepEqual(changedRows(previous, ui.snapshot()), [80, 81]);
  assert.deepEqual(ui.c.selection.focus, { row: 81, column: 3 });
  previous = ui.snapshot();
  await ui.key('ArrowRight');
  assert.deepEqual(changedRows(previous, ui.snapshot()), [81]);
  assert.equal(ui.cell(81, 3).props['aria-selected'], false);
  assert.equal(ui.cell(81, 4).props['aria-selected'], true);
});

test('scrolling and opening unrelated menus reuse all prepared cell subtrees and preserve an edit', async t => {
  const ui = await mount(t, { cells: { A1: { value: 'saved' } } });
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'draft'));
  const before = ui.snapshot();
  await ui.scroll(3000, 400);
  assert.deepEqual(changedRows(before, ui.snapshot()), []);
  await act(async () => ui.c.setCommentOpen(true));
  assert.deepEqual(changedRows(before, ui.snapshot()), []);
  assert.equal(ui.c.editing.value, 'draft');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'saved');
});

test('cached cells and headers use the latest selection anchor and edit state', async t => {
  const ui = await mount(t);
  const distant = ui.cell(180, 7).props;
  await ui.select(40, 3);
  await ui.key('ArrowDown');
  assert.strictEqual(ui.cell(180, 7).props, distant, 'the destination row has not rerendered');
  await ui.click(180, 7, { shiftKey: true });
  assert.deepEqual(ui.c.selection.anchor, { row: 41, column: 3 });
  assert.deepEqual(ui.c.selection.focus, { row: 180, column: 7 });
  assert.equal(ui.cell(100, 5).props['aria-selected'], true);
  await ui.key('ArrowUp');
  assert.deepEqual(ui.c.selection.focus, { row: 179, column: 7 });
  assert.equal(ui.cell(100, 5).props['aria-selected'], false);
});

test('data controls in cached rows use updated host callbacks and reflect read-only changes', async t => {
  const actions = [], replacements = [];
  const ui = await mount(t, { cells: { B151: { value: 'FALSE', validation: { type: 'checkbox' } } },
    onEditRequest: request => { actions.push(request); return true; } });
  const before = ui.cell(150, 1).props;
  await ui.update({ onEditRequest: request => { replacements.push(request); return true; } });
  assert.strictEqual(ui.cell(150, 1).props, before);
  const control = () => ui.cell(150, 1).findByProps({ type: 'checkbox' });
  await act(async () => control().props.onChange({ currentTarget: { checked: true } }));
  assert.equal(ui.c.activeSheet.cells.B151.value, 'TRUE');
  assert.equal(actions.length, 0);
  assert.ok(replacements.length > 0);
  await ui.update({ readOnly: true });
  assert.equal(control().props.disabled, true);
  await act(async () => control().props.onChange({ currentTarget: { checked: false } }));
  assert.equal(ui.c.activeSheet.cells.B151.value, 'TRUE');
  await ui.update({ features: { checkboxes: false } });
  assert.equal(ui.c.features.checkboxes, false);
  assert.equal(ui.cell(150, 1).findAllByProps({ type: 'checkbox' }).length, 0, 'host feature changes still update cached rows');
});

test('border and viewport merge lookups avoid unrelated ranges and do not retain offscreen cells', () => {
  let reads = 0;
  const merges = Array.from({ length: 10000 }, (_, row) => ({
    get top() { reads++; return row; }, get bottom() { reads++; return row; }, left: 0, right: 1,
  }));
  const borders = createBorderRowLookup(merges), cache = createGridMergeCache(merges, 10);
  reads = 0;
  assert.deepEqual(borders(9000), [8999, 9000]);
  assert.ok(reads < 100, `one row must not rescan all 10,000 ranges (${reads} reads)`);
  reads = 0;
  const visible = cache.visible([9000, 9001]);
  assert.equal(visible.size, 4);
  assert.equal(visible.get(90000), merges[9000]);
  assert.ok(reads < 100, `visible merge lookup must use the row index (${reads} reads)`);
  assert.equal(cache.cells.size, 0, 'viewport lookups never expand the progressive retention cache');
  assert.equal(cache.visible([10]).has(90000), false);

  const tall = createBorderRowLookup([{ top: 1, bottom: 8, left: 2, right: 3 }, { top: 0, bottom: 4, left: 0, right: 1 }]);
  assert.deepEqual(new Set(tall(1)), new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), 'all side-border owners of a tall merge remain observable');
});
