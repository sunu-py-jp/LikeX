import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export { default as Spreadsheet } from "./src/spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'clipboard-focus.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
function clipboardEvent(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { target: null, preventDefault() {}, clipboardData: {
    getData: type => data.get(type) ?? '', setData: (type, value) => data.set(type, value), get types() { return [...data.keys()]; },
  } };
}
async function mount(t, sheet, additionalSheets = []) {
  let renderer, input, scroller;
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } };
  const nodes = new WeakMap();
  const node = element => {
    if (nodes.has(element.props)) return nodes.get(element.props);
    const result = { ownerDocument: doc, addEventListener() {}, removeEventListener() {}, style: {}, scrollHeight: 18, scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000,
      classList: { contains: name => name === element.props.className }, label: element.props['aria-label'],
      focus() { doc.activeElement = this; }, select() {}, setSelectionRange() {}, contains: target => target === doc.activeElement,
      closest: () => null, querySelector: selector => selector === '.lxs-cell-input' ? input : null, querySelectorAll: () => [],
    };
    if (element.props.className === 'lxs-cell-input') input = result;
    if (element.props.className === 'lxs-grid-scroll') scroller = result;
    nodes.set(element.props, result); return result;
  };
  await act(async () => { renderer = create(createElement(Spreadsheet, {
    initialWorkbook: { sheets: [{ id: 'one', name: 'One', cells: {}, ...sheet }, ...additionalSheets] }, onSave() {},
  }), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const controller = () => renderer.root.findAll(instance => instance.props.controller?.selectRangeInSheet)[0].props.controller;
  return { get c() { return controller(); }, get scroller() { return scroller; },
    async select(start, end = start, focus = start, kind) {
      await act(async () => { controller().selectRangeInSheet(controller().activeSheet.id, start, end, focus, kind); controller().requestGridFocus(); });
    },
    async copy(cut = false) {
      const event = clipboardEvent(); await act(async () => renderer.root.findByType('section').props[cut ? 'onCut' : 'onCopy'](event)); return event;
    },
    async paste(event) { await act(async () => renderer.root.findByType('section').props.onPaste(event)); },
    assertFocus(row, column) {
      assert.deepEqual(controller().selection.focus, { row, column });
      assert.equal(doc.activeElement, input, 'the active cursor must retain actual input focus');
      assert.equal(input.label, renderer.root.findAllByType('textarea').find(item => item.props.className === 'lxs-cell-input').props['aria-label']);
    },
  };
}
const bounds = selection => {
  const range = selection.ranges.at(-1);
  return { top: Math.min(range.anchor.row, range.focus.row), left: Math.min(range.anchor.column, range.focus.column),
    bottom: Math.max(range.anchor.row, range.focus.row), right: Math.max(range.anchor.column, range.focus.column) };
};

test('GUI paste beyond the last cell grows the sheet and selects the complete pasted range', async t => {
  const ui = await mount(t, { rowCount: 2, columnCount: 2 });
  await ui.select({ row: 1, column: 1 });
  await ui.paste(clipboardEvent({ 'text/plain': 'a\tb\nc\td' }));
  assert.equal(ui.c.error, null); ui.assertFocus(1, 1);
  assert.equal(ui.c.activeSheet.rowCount, 3); assert.equal(ui.c.activeSheet.columnCount, 3);
  assert.equal(ui.c.activeSheet.cells.C3.value, 'd');
  assert.deepEqual(bounds(ui.c.selection), { top: 1, left: 1, bottom: 2, right: 2 });
});

test('whole-column copy/paste retains a visible middle cell and vertical scroll instead of selecting the final row', async t => {
  const ui = await mount(t, { rowCount: 300, columnCount: 12, cells: { C1: { value: 'first' }, C76: { value: 'middle' }, C300: { value: 'last' } } });
  await ui.select({ row: 0, column: 2 }, { row: 299, column: 2 }, { row: 75, column: 2 }, 'column');
  const copied = await ui.copy();
  await ui.select({ row: 0, column: 4 }, { row: 299, column: 4 }, { row: 75, column: 4 }, 'column');
  ui.scroller.scrollTop = 2100; ui.scroller.scrollLeft = 0;
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(75, 4);
  assert.deepEqual(bounds(ui.c.selection), { top: 0, bottom: 299, left: 4, right: 4 });
  assert.equal(ui.scroller.scrollTop, 2100); assert.equal(ui.scroller.scrollLeft, 0);
  assert.equal(ui.c.activeSheet.cells.E1.value, 'first'); assert.equal(ui.c.activeSheet.cells.E76.value, 'middle'); assert.equal(ui.c.activeSheet.cells.E300.value, 'last');
});

test('whole-row copy/paste retains a visible middle cell and horizontal scroll instead of selecting the final column', async t => {
  const ui = await mount(t, { rowCount: 12, columnCount: 200, cells: { A3: { value: 'first' }, CD3: { value: 'middle' }, GR3: { value: 'last' } } });
  await ui.select({ row: 2, column: 0 }, { row: 2, column: 199 }, { row: 2, column: 81 }, 'row');
  const copied = await ui.copy();
  await ui.select({ row: 4, column: 0 }, { row: 4, column: 199 }, { row: 4, column: 81 }, 'row');
  ui.scroller.scrollTop = 0; ui.scroller.scrollLeft = 8050;
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(4, 81);
  assert.deepEqual(bounds(ui.c.selection), { top: 4, bottom: 4, left: 0, right: 199 });
  assert.equal(ui.scroller.scrollTop, 0); assert.equal(ui.scroller.scrollLeft, 8050);
  assert.equal(ui.c.activeSheet.cells.A5.value, 'first'); assert.equal(ui.c.activeSheet.cells.CD5.value, 'middle'); assert.equal(ui.c.activeSheet.cells.GR5.value, 'last');
});

test('external rectangular paste selects all inserted cells and keeps the active cell at the destination corner', async t => {
  const ui = await mount(t, { rowCount: 30, columnCount: 20 });
  await ui.select({ row: 3, column: 2 });
  await ui.paste(clipboardEvent({ 'text/plain': 'a\tb\tc\nd\te\tf' }));
  assert.equal(ui.c.error, null); ui.assertFocus(3, 2);
  assert.deepEqual(bounds(ui.c.selection), { top: 3, bottom: 4, left: 2, right: 4 });
  assert.equal(ui.c.activeSheet.cells.E5.value, 'f');
});

test('a smaller paste falls back to its top-left cell when the previously active cell is outside the new range', async t => {
  const ui = await mount(t, { rowCount: 30, columnCount: 20 });
  await ui.select({ row: 3, column: 2 }, { row: 8, column: 7 }, { row: 8, column: 7 });
  await ui.paste(clipboardEvent({ 'text/plain': 'a\tb\nc\td' }));
  assert.equal(ui.c.error, null); ui.assertFocus(3, 2);
  assert.deepEqual(bounds(ui.c.selection), { top: 3, bottom: 4, left: 2, right: 3 });
});

test('cut/paste keeps the destination cursor near the starting cell and still moves the complete range', async t => {
  const ui = await mount(t, { rowCount: 30, columnCount: 20, cells: { A1: { value: 'a' }, B2: { value: 'b' } } });
  await ui.select({ row: 0, column: 0 }, { row: 1, column: 1 });
  const copied = await ui.copy(true);
  await ui.select({ row: 3, column: 2 });
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(3, 2);
  assert.deepEqual(bounds(ui.c.selection), { top: 3, bottom: 4, left: 2, right: 3 });
  assert.equal(ui.c.activeSheet.cells.A1, undefined); assert.equal(ui.c.activeSheet.cells.B2, undefined);
  assert.equal(ui.c.activeSheet.cells.C4.value, 'a'); assert.equal(ui.c.activeSheet.cells.D5.value, 'b');
});

test('column copy and paste skip a crossing merged title while retaining the exact column and its active cell', async t => {
  const ui = await mount(t, { rowCount: 40, columnCount: 8, cells: { A1: { value: 'protected title' }, C2: { value: 'first' }, C40: { value: 'last' } },
    merges: [{ top: 0, bottom: 0, left: 0, right: 7 }] });
  await ui.select({ row: 0, column: 2 }, { row: 39, column: 2 }, { row: 1, column: 2 }, 'column');
  assert.deepEqual(bounds(ui.c.selection), { top: 0, bottom: 39, left: 2, right: 2 });
  const copied = await ui.copy();
  assert.equal(ui.c.error, null);
  assert.equal(copied.clipboardData.getData('text/plain').includes('protected title'), false);
  await ui.select({ row: 0, column: 3 }, { row: 39, column: 3 }, { row: 1, column: 3 }, 'column');
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(1, 3);
  assert.deepEqual(bounds(ui.c.selection), { top: 0, bottom: 39, left: 3, right: 3 });
  assert.equal(ui.c.selection.ranges.at(-1).kind, 'column');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'protected title');
  assert.equal(ui.c.activeSheet.cells.D2.value, 'first'); assert.equal(ui.c.activeSheet.cells.D40.value, 'last');
  assert.deepEqual(ui.c.activeSheet.merges, [{ top: 0, bottom: 0, left: 0, right: 7 }]);
});

test('cutting a column that crosses a merged title is rejected instead of clearing part of the title', async t => {
  const ui = await mount(t, { rowCount: 40, columnCount: 8, cells: { A1: { value: 'protected title' }, C2: { value: 'source' } },
    merges: [{ top: 0, bottom: 0, left: 0, right: 7 }] });
  await ui.select({ row: 0, column: 2 }, { row: 39, column: 2 }, { row: 1, column: 2 }, 'column');
  const before = ui.c.workbook;
  const cut = await ui.copy(true);
  assert.ok(ui.c.error); assert.equal(cut.clipboardData.getData('text/plain'), '');
  assert.equal(ui.c.workbook, before); assert.equal(ui.c.activeSheet.cells.A1.value, 'protected title');
});

for (const axis of ['row', 'column']) test(`a copied whole ${axis} pasted into a visible middle cell aligns to the axis origin without scrolling`, async t => {
  const column = axis === 'column';
  const ui = await mount(t, { rowCount: column ? 300 : 12, columnCount: column ? 12 : 200,
    cells: column ? { C1: { value: 'first' }, C300: { value: 'last' } } : { A3: { value: 'first' }, GR3: { value: 'last' } } });
  const start = column ? { row: 0, column: 2 } : { row: 2, column: 0 };
  const end = column ? { row: 299, column: 2 } : { row: 2, column: 199 };
  const focus = column ? { row: 75, column: 4 } : { row: 4, column: 81 };
  await ui.select(start, end, start, axis);
  const copied = await ui.copy();
  await ui.select(focus);
  const scrollTop = column ? 2100 : 0, scrollLeft = column ? 0 : 8050;
  ui.scroller.scrollTop = scrollTop; ui.scroller.scrollLeft = scrollLeft;
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(focus.row, focus.column);
  assert.deepEqual(bounds(ui.c.selection), column ? { top: 0, bottom: 299, left: 4, right: 4 } : { top: 4, bottom: 4, left: 0, right: 199 });
  assert.equal(ui.scroller.scrollTop, scrollTop); assert.equal(ui.scroller.scrollLeft, scrollLeft);
  assert.equal(ui.c.activeSheet.cells[column ? 'E1' : 'A5'].value, 'first');
  assert.equal(ui.c.activeSheet.cells[column ? 'E300' : 'GR5'].value, 'last');
});


for (const axis of ['row', 'column']) test(`a copied ${axis} fragment retains its destination instead of being treated as a whole axis`, async t => {
  const column = axis === 'column';
  const ui = await mount(t, { rowCount: 12, columnCount: 12,
    cells: column ? { C3: { value: 'first' }, C5: { value: 'last' } } : { C3: { value: 'first' }, E3: { value: 'last' } } });
  const start = { row: 2, column: 2 }, end = column ? { row: 4, column: 2 } : { row: 2, column: 4 };
  await ui.select(start, end, start, axis);
  const copied = await ui.copy();
  await ui.select({ row: 5, column: 5 });
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(5, 5);
  assert.deepEqual(bounds(ui.c.selection), column ? { top: 5, bottom: 7, left: 5, right: 5 } : { top: 5, bottom: 5, left: 5, right: 7 });
  assert.equal(ui.c.activeSheet.cells.F6.value, 'first');
  assert.equal(ui.c.activeSheet.cells[column ? 'F8' : 'H6'].value, 'last');
  assert.equal(ui.c.selection.ranges.at(-1).kind, axis, 'header provenance still protects crossing merges');
});

test('recopying a column pasted into a taller sheet preserves partial-column positioning and merge protection', async t => {
  const ui = await mount(t, { rowCount: 3, columnCount: 8, cells: { C1: { value: 'first' }, C3: { value: 'last' } } }, [
    { id: 'two', name: 'Two', rowCount: 8, columnCount: 8, cells: { A1: { value: 'title' } }, merges: [{ top: 0, bottom: 0, left: 0, right: 7 }] },
  ]);
  await ui.select({ row: 0, column: 2 }, { row: 2, column: 2 }, { row: 0, column: 2 }, 'column');
  const copied = await ui.copy();
  await act(async () => ui.c.selectCellInSheet('two', { row: 1, column: 4 }));
  await ui.select({ row: 1, column: 4 });
  await ui.paste(copied);
  assert.equal(ui.c.error, null); ui.assertFocus(1, 4);
  assert.deepEqual(bounds(ui.c.selection), { top: 0, bottom: 2, left: 4, right: 4 });
  assert.equal(ui.c.selection.ranges.at(-1).kind, 'column');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'title'); assert.equal(ui.c.activeSheet.cells.E3.value, 'last');
  const partial = await ui.copy();
  await ui.select({ row: 4, column: 6 });
  await ui.paste(partial);
  assert.equal(ui.c.error, null); ui.assertFocus(4, 6);
  assert.deepEqual(bounds(ui.c.selection), { top: 4, bottom: 6, left: 6, right: 6 });
  assert.equal(ui.c.activeSheet.cells.G7.value, 'last');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'title');
});
