import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { useNamedRangeManager } from "./src/ui/named-ranges/use-named-range-manager";
  export { SpreadsheetToolbar } from './src/ui/spreadsheet-toolbar';
  export { SpreadsheetFooter } from './src/ui/spreadsheet-footer';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'selection-actions.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useNamedRangeManager, SpreadsheetToolbar, SpreadsheetFooter } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, options = {}) {
  let current, renderer;
  const calls = [];
  const props = { initialWorkbook: { sheets: [{ id: 'sheet', name: 'Data', rowCount: 20, columnCount: 10,
    cells: { A1: { value: '1' }, B1: { value: '2' }, A2: { value: '3' }, B2: { value: '4' },
      C2: { value: '5' }, B3: { value: '6' }, C3: { value: '7' }, C1: { value: 'KEEP' } },
  }] }, onSave: wb => wb, ...options };
  function Probe() {
    current = useSpreadsheet(props);
    const namedRangeManager = useNamedRangeManager(current);
    return createElement('section', null,
      createElement(SpreadsheetToolbar, { controller: current, namedRangeManager, clipboard: { copy: () => calls.push('copy'), paste: () => calls.push('paste') } }),
      createElement(SpreadsheetFooter, { controller: current }));
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; }, get root() { return renderer.root; }, calls };
}
const pos = (row, column) => ({ row, column });

test('formatting and value clearing affect the selected union without filling gaps, and undo is atomic', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.selectRange(pos(0, 0), pos(1, 1)));
  await act(async () => hook.current.selectRange(pos(1, 1), pos(2, 2), true));
  const selected = ['A1', 'B1', 'A2', 'B2', 'C2', 'B3', 'C3'];
  await act(async () => hook.root.findByProps({ 'aria-label': '太字' }).props.onClick());
  for (const address of selected) assert.equal(hook.current.activeSheet.cells[address].format.bold, true, address);
  assert.equal(hook.current.activeSheet.cells.C1.value, 'KEEP');
  assert.equal(hook.current.activeSheet.cells.C1.format, undefined);
  assert.equal(hook.current.activeSheet.cells.A3, undefined);
  await act(async () => hook.current.clearCells());
  for (const address of selected) assert.equal(hook.current.activeSheet.cells[address].value, '', address);
  assert.equal(hook.current.activeSheet.cells.C1.value, 'KEEP');
  await act(async () => hook.current.undo());
  for (const address of selected) assert.notEqual(hook.current.activeSheet.cells[address].value, '', address);
  assert.equal(hook.current.activeSheet.cells.B2.value, '4');
});

test('the footer counts overlapping ranges once and excludes gap cells from statistics', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.selectRange(pos(0, 0), pos(1, 1)));
  await act(async () => hook.current.selectRange(pos(1, 1), pos(2, 2), true));
  const text = hook.root.findByProps({ className: 'lxs-selection-stats' }).children.join('');
  assert.match(text, /平均: 4/);
  assert.match(text, /データ数: 7/);
  assert.match(text, /合計: 28/);
});

test('multi-range structural and clipboard commands stay disabled and cannot act on the active range alone', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.select(pos(2, 2), false, true));
  const before = hook.current.workbook;
  for (const label of ['コピー', '切り取り', '貼り付け']) {
    const command = hook.root.findByProps({ 'aria-label': label });
    assert.equal(command.props.disabled, true, label);
    assert.match(command.props.title, /1つの連続/);
    await act(async () => command.props.onClick());
  }
  assert.deepEqual(hook.calls, []);
  const structural = hook.root.findByProps({ 'aria-label': '行と列の操作' });
  assert.equal(structural.props.disabled, true);
  for (const value of ['insert-row', 'insert-column', 'delete-row', 'delete-column']) {
    await act(async () => structural.props.onChange({ target: { value } }));
    assert.equal(hook.current.workbook, before, value);
    assert.match(hook.current.error, /1つの連続/);
  }
  await act(async () => hook.current.select(pos(0, 0)));
  assert.equal(hook.root.findByProps({ 'aria-label': 'コピー' }).props.disabled, false);
  assert.equal(hook.root.findByProps({ 'aria-label': '行と列の操作' }).props.disabled, false);
});

test('readonly viewers can select multiple ranges and see statistics without editing controls', async t => {
  const hook = await mount(t, { onSave: undefined });
  await act(async () => hook.current.select(pos(2, 2), false, true));
  const before = hook.current.workbook;
  assert.match(hook.root.findByProps({ className: 'lxs-selection-stats' }).children.join(''), /合計: 8/);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '太字' }).length, 0);
  await act(async () => hook.current.clearCells());
  assert.equal(hook.current.workbook, before);
});
