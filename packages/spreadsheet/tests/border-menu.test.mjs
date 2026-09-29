import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundled = await build({ stdin: { contents: `
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { SpreadsheetFormatToolbar } from './src/ui/spreadsheet-format-toolbar';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'border-menu-test.ts' },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
  builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
    'import {createElement} from "react"; export const SpreadsheetDialog = ({children,actions,title}) => createElement("div",{role:"dialog","aria-label":title},children,actions);', loader: 'js' }));
} }] });
const { useSpreadsheet, SpreadsheetFormatToolbar } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const initialWorkbook = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 12, columnCount: 8,
  cells: { A1: { value: 'keep', format: { bold: true, background: '#abcdef' } }, B2: { value: '=1+2' } },
  drawings: [{ id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 5, column: 4, offsetX: 0, offsetY: 0 },
    width: 100, height: 60, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }],
}, { id: 'two', name: 'Two', rowCount: 12, columnCount: 8, cells: {} }] });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function mount(t, overrides = {}) {
  let c, renderer, unmounted = false;
  const events = [];
  let props = { initialWorkbook: initialWorkbook(), onSave: () => {}, onEvent: event => events.push(event), ...overrides };
  function Probe() { c = useSpreadsheet(props); return createElement(SpreadsheetFormatToolbar, { controller: c }); }
  await act(async () => { renderer = create(createElement(Probe)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { get c() { return c; }, get root() { return renderer.root; }, events, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async choose(value) { await act(async () => renderer.root.findByProps({ 'aria-label': '罫線' }).props.onChange({ currentTarget: { value } })); },
    async select() { await act(async () => c.selectRange({ row: 0, column: 0 }, { row: 1, column: 1 })); },
  };
}

test('home font controls expose every border preset and a direct details entry', async t => {
  const ui = await mount(t);
  const group = ui.root.findByProps({ role: 'group', 'aria-label': 'フォント' });
  const menu = group.findByProps({ 'aria-label': '罫線' });
  assert.equal(menu.type, 'select');
  assert.deepEqual(menu.findAllByType('option').map(option => option.props.value), ['', 'all', 'outside', 'inside', 'top', 'bottom', 'left', 'right', 'none', 'details']);
  assert.equal(group.findByProps({ className: 'lxs-border-menu' }).findAllByType('svg').length, 1);
  const before = ui.c.workbook;
  await ui.choose('unexpected');
  assert.equal(ui.c.workbook, before);
  await ui.choose('details');
  const dialog = ui.root.findByProps({ role: 'dialog' });
  const field = dialog.findAllByType('select').find(select => select.findAllByProps({ value: 'border' }).length);
  assert.equal(field.props.value, 'border');
  assert.ok(dialog.findAllByType('input').some(input => input.props.type === 'color'));
  assert.equal(ui.c.workbook, before);
});

test('grid borders preserve content and formatting and are one undoable command', async t => {
  const ui = await mount(t);
  await ui.select();
  const before = ui.c.workbook, selection = ui.c.selection;
  await ui.choose('all');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'keep');
  assert.equal(ui.c.activeSheet.cells.A1.format.bold, true);
  assert.equal(ui.c.activeSheet.cells.A1.format.background, '#abcdef');
  assert.equal(ui.c.activeSheet.cells.B2.value, '=1+2');
  for (const address of ['A1', 'B1', 'A2', 'B2']) {
    for (const edge of ['top', 'right', 'bottom', 'left']) assert.equal(ui.c.activeSheet.cells[address].format.borders[edge].style, 'solid');
  }
  assert.equal(ui.c.activeSheet.tables, undefined);
  assert.equal(ui.c.dirty, true);
  assert.equal(ui.c.gridFocusRequest, 1);
  assert.deepEqual(ui.events.filter(event => event.type === 'change').map(event => event.commands), [['cells.borders']]);
  await act(async () => ui.c.undo());
  assert.equal(ui.c.workbook, before);
  assert.deepEqual(ui.c.selection, selection);
  await act(async () => ui.c.redo());
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.bottom.style, 'solid');
});

test('outside and inside presets use selection edges, and none keeps the cell data', async t => {
  const ui = await mount(t);
  await ui.select(); await ui.choose('outside');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.top.style, 'solid');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.right, undefined);
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.bottom, undefined);
  await ui.choose('inside');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.right.style, 'solid');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.bottom.style, 'solid');
  await ui.choose('none');
  assert.equal(ui.c.activeSheet.cells.A1.value, 'keep');
  assert.equal(ui.c.activeSheet.cells.A1.format.bold, true);
  assert.ok(Object.values(ui.c.activeSheet.cells.A1.format.borders ?? {}).every(edge => edge.style === 'none'));
});

test('noncontiguous ranges are formatted together without changing cells between them', async t => {
  const ui = await mount(t);
  await ui.select();
  await act(async () => ui.c.select({ row: 4, column: 4 }, false, true));
  await ui.choose('bottom');
  assert.equal(ui.c.activeSheet.cells.A2.format.borders.bottom.style, 'solid');
  assert.equal(ui.c.activeSheet.cells.B2.format.borders.bottom.style, 'solid');
  assert.equal(ui.c.activeSheet.cells.E5.format.borders.bottom.style, 'solid');
  assert.equal(ui.c.activeSheet.cells.C3, undefined);
  assert.equal(ui.events.filter(event => event.type === 'change').length, 1);
});

test('borders commit the in-progress cell value before formatting', async t => {
  const ui = await mount(t);
  await ui.select();
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'new input'));
  await ui.choose('all');
  assert.equal(ui.c.editing, null);
  assert.equal(ui.c.activeSheet.cells.A1.value, 'new input');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders.top.style, 'solid');
  await act(async () => ui.c.undo());
  assert.equal(ui.c.activeSheet.cells.A1.value, 'new input');
  assert.equal(ui.c.activeSheet.cells.A1.format.borders, undefined);
});

test('formatting off and readonly hide the menu; drawing and pending object edit disable it', async t => {
  const ui = await mount(t, { features: { formatting: false } });
  assert.equal(ui.root.findAllByProps({ 'aria-label': '罫線' }).length, 0);
  await ui.update({ features: {}, readOnly: true });
  assert.equal(ui.root.findAllByProps({ 'aria-label': '罫線' }).length, 0);
  await ui.update({ readOnly: false, onSave: undefined });
  assert.equal(ui.root.findAllByProps({ 'aria-label': '罫線' }).length, 0);
  await ui.update({ onSave: () => {} });
  await act(async () => ui.c.selectDrawing('shape'));
  const before = ui.c.workbook;
  assert.equal(ui.root.findByProps({ 'aria-label': '罫線' }).props.disabled, true);
  await ui.choose('all'); assert.equal(ui.c.workbook, before);
  await act(async () => { ui.c.select({ row: 0, column: 0 }); ui.c.setPendingObjectEdit(true); });
  assert.equal(ui.root.findByProps({ 'aria-label': '罫線' }).props.disabled, true);
  await ui.choose('details'); assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('denied editing permission leaves borders and history unchanged', async t => {
  const ui = await mount(t, { onEditRequest: () => false });
  const before = ui.c.workbook;
  await ui.choose('all');
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.canUndo, false);
});

for (const change of ['selection', 'sheet', 'readonly', 'feature', 'unmount']) test(`pending borders do not apply after ${change} changes`, async t => {
  const permission = deferred();
  const ui = await mount(t, { onEditRequest: () => permission.promise });
  const before = ui.c.workbook;
  await ui.choose('all');
  assert.equal(ui.c.requesting, true);
  assert.equal(ui.root.findByProps({ 'aria-label': '罫線' }).props.disabled, true);
  if (change === 'selection') await act(async () => ui.c.select({ row: 3, column: 2 }));
  if (change === 'sheet') await act(async () => ui.c.switchSheet('two'));
  if (change === 'readonly') await ui.update({ readOnly: true });
  if (change === 'feature') { await ui.update({ features: { formatting: false } }); await ui.update({ features: {} }); }
  if (change === 'unmount') await ui.unmount();
  await act(async () => permission.resolve(true));
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.events.filter(event => event.type === 'change').length, 0);
});
