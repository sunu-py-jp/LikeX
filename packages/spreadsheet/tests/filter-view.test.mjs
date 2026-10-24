import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { useSpreadsheetHandle } from './src/api/use-spreadsheet-handle';
  export { SpreadsheetGrid } from './src/ui/spreadsheet-grid';
  export { createRowOffsets, visibleGridRows } from './src/ui/grid/grid-geometry';
  export { visibleRowPosition, pageRowPosition } from './src/ui/grid/grid-navigation';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useSpreadsheetHandle, SpreadsheetGrid, createRowOffsets, visibleGridRows, visibleRowPosition, pageRowPosition } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const range = { top: 0, left: 0, bottom: 5, right: 1 };
const filtered = { range, columns: [{ column: 0, values: ['keep'] }] };
const book = () => ({ sheets: [{ id: 's', name: 'Sales', rowCount: 8, columnCount: 3, cells: {
  A1: { value: 'Group' }, B1: { value: 'Sales' }, A2: { value: 'keep' }, B2: { value: '10' },
  A3: { value: 'drop' }, B3: { value: '20' }, A4: { value: 'keep' }, B4: { value: '30' },
  A5: { value: 'drop' }, B5: { value: '40' }, A6: { value: 'keep' }, B6: { value: '50' },
} }] });
async function mount(t, options = {}, grid = false) {
  const ref = createRef(), events = [], changes = []; let renderer, current, props = options;
  const document = { activeElement: null, addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = () => ({ ownerDocument: document, style: {}, scrollTop: 0, scrollLeft: 0, scrollHeight: 24, clientHeight: 280, clientWidth: 500,
    closest() { return null; }, addEventListener() {}, removeEventListener() {}, contains(target) { return target?.ownerDocument === document; },
    focus() { document.activeElement = this; }, setSelectionRange() {}, querySelectorAll() { return []; } });
  function Probe() { current = useSpreadsheet({ initialWorkbook: book(), onSave() {}, onEvent: event => events.push(event), onChange: value => changes.push(value), ...props });
    useSpreadsheetHandle(ref, current); return grid ? createElement(SpreadsheetGrid, { controller: current }) : null; }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, renderer, events, changes, get c() { return current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async key(key) { await act(async () => renderer.root.findByProps({ className: 'lxs-cell-input' }).props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, stopPropagation() {} })); } };
}

test('read-only GUI infers header data and filters temporarily without history, edits or dirty state', async t => {
  let permissions = 0;
  const ui = await mount(t, { onSave: undefined, onEditRequest() { permissions++; return true; } });
  const api = ui.ref.current, original = api.getWorkbook();
  await act(async () => api.selectRange('s', { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } }));
  await act(async () => ui.c.filters.toggle());
  assert.deepEqual(api.getFilterView('s').range, range);
  await act(async () => ui.c.filters.setValues(0, ['keep']));
  assert.deepEqual(api.getFilteredRows('s'), [2, 4]);
  assert.equal(api.getWorkbook(), original);
  assert.equal(ui.c.dirty, false); assert.equal(ui.c.canUndo, false); assert.equal(permissions, 0);
  assert.deepEqual(ui.changes, []);
  assert.equal(ui.events.filter(event => event.type === 'filter-view-change').length, 2);
  await act(async () => ui.c.filters.clear());
  assert.deepEqual(api.getFilteredRows('s'), []);
  await act(async () => ui.c.filters.toggle());
  assert.equal(api.getFilterView('s'), undefined);
});

test('editable GUI uses persisted commands, permissions and one-step Undo/Redo', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await act(async () => api.selectRange('s', { anchor: { row: 0, column: 0 }, focus: { row: 5, column: 1 } }));
  await act(async () => ui.c.filters.toggle());
  assert.deepEqual(api.getWorkbook().sheets[0].autoFilter, { range });
  await act(async () => ui.c.filters.setValues(0, ['keep']));
  assert.deepEqual(api.getFilteredRows('s'), [2, 4]);
  assert.equal(ui.c.dirty, true);
  await act(async () => assert.equal(await api.undo(), true));
  assert.deepEqual(api.getFilteredRows('s'), []);
  assert.deepEqual(api.getWorkbook().sheets[0].autoFilter, { range });
  await act(async () => assert.equal(await api.redo(), true));
  assert.deepEqual(api.getFilteredRows('s'), [2, 4]);
});

test('view API is synchronous, detached, resettable, feature guarded and rejects pending input/unmount', async t => {
  const ui = await mount(t), api = ui.ref.current;
  const input = structuredClone(filtered);
  await act(async () => {
    assert.equal(api.setFilterView('s', input), true);
    assert.deepEqual(api.getFilteredRows('s'), [2, 4]);
    assert.equal(api.setFilterView('s', input), false);
  });
  input.columns[0].values.push('drop');
  assert.deepEqual(api.getFilteredRows('s'), [2, 4]);
  assert.equal(api.setFilterView('s', { range: { ...range, bottom: 200 } }), false);
  assert.equal(api.setFilterView('missing', filtered), false);
  await ui.update({ features: { filters: false } });
  assert.equal(api.resetFilterView('s'), false);
  assert.equal(api.setFilterView('s', null), false);
  assert.deepEqual(api.getFilteredRows('s'), [2, 4], 'controls off does not discard applied filters');
  await ui.update({ features: {} });
  await act(async () => assert.equal(api.resetFilterView('s'), true));
  assert.equal(api.getFilterView('s'), undefined);
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'pending'));
  assert.equal(api.setFilterView('s', filtered), false);
  await act(async () => rendererUnmount(ui));
  assert.equal(api.setFilterView('s', filtered), false);
});
function rendererUnmount(ui) { ui.renderer.unmount(); }

test('temporary filters do not survive workbook edits or baseline replacement', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await act(async () => api.setFilterView('s', filtered));
  await act(async () => assert.equal(api.execute({ type: 'cells.set', sheetId: 's', values: { B2: '100' } }).ok, true));
  assert.equal(api.getFilterView('s'), undefined);
  assert.deepEqual(api.getFilteredRows('s'), []);
  await act(async () => api.undo());
  assert.equal(api.getFilterView('s'), undefined, 'undo must not resurrect a temporary view overlay');
});

test('grid collapses filtered rows in both modes and arrows/Enter skip hidden original row indices', async t => {
  for (const renderingMode of ['viewport', 'progressive']) {
    const ui = await mount(t, { initialWorkbook: { sheets: [{ ...book().sheets[0], autoFilter: filtered }] }, renderingMode }, true);
    const grid = ui.renderer.root.findByProps({ role: 'grid' });
    const rows = grid.findAllByProps({ role: 'row' }).map(row => row.props['aria-rowindex']);
    assert.ok(!rows.includes(4) && !rows.includes(6));
    assert.equal(grid.props.style.height, 28 * 7);
    await ui.key('ArrowDown'); assert.equal(ui.c.selection.focus.row, 1);
    await ui.key('ArrowDown'); assert.equal(ui.c.selection.focus.row, 3);
    await ui.key('ArrowUp'); assert.equal(ui.c.selection.focus.row, 1);
    await ui.key('Enter'); assert.equal(ui.c.selection.focus.row, 3);
    await act(async () => ui.c.filters.clear());
    assert.equal(ui.renderer.root.findByProps({ role: 'grid' }).props.style.height, 28 * 9);
  }
});

test('filtered geometry retains original heights and viewport/page navigation omit zero-height rows', () => {
  const offsets = createRowOffsets({ rowCount: 6, rowHeights: { 3: 40 } }, new Set([1, 2, 4]));
  assert.deepEqual(offsets, [28, 56, 56, 56, 96, 96, 124]);
  assert.deepEqual(visibleGridRows({ rowCount: 6 }, offsets, { top: 0, height: 100 }, 1), [0, 3, 5]);
  assert.equal(visibleRowPosition(offsets, 1, 1, 0), 3);
  assert.equal(visibleRowPosition(offsets, 2, -1, 3), 0);
  assert.equal(pageRowPosition(offsets, 0, 1, 28), 3);
});
