import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundled = await build({ stdin: { contents: `
  export { SpreadsheetToolbar, SpreadsheetFormulaBar } from "./src/ui/spreadsheet-toolbar";
  export { useSpreadsheet } from "./src/state/use-spreadsheet";
  export { useNamedRangeManager } from "./src/ui/named-ranges/use-named-range-manager";
  export { SUPPORTED_SPREADSHEET_FUNCTIONS } from "./src/model/function-definitions";`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'function-toolbar-test.ts' },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { SpreadsheetToolbar, SpreadsheetFormulaBar, useSpreadsheet, useNamedRangeManager, SUPPORTED_SPREADSHEET_FUNCTIONS } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

async function mount(t, overrides = {}) {
  let current, renderer;
  let props = { initialWorkbook: { sheets: [{ id: 'sheet', name: 'Sheet1', rowCount: 10, columnCount: 5,
    cells: { A1: { value: 'original' }, B2: { value: '200' } },
    drawings: [{ id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 2, offsetX: 0, offsetY: 0 },
      width: 100, height: 60, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }],
  }] }, onSave: workbook => workbook, ...overrides };
  const focus = [], ranges = [], roots = [];
  const input = { focus: options => focus.push(options), setSelectionRange: (start, end) => ranges.push([start, end]) };
  function Probe() {
    current = useSpreadsheet(props);
    const namedRangeManager = useNamedRangeManager(current);
    return createElement('section', { 'data-likex-spreadsheet': true },
      createElement(SpreadsheetToolbar, { controller: current, namedRangeManager, clipboard: { copy() {}, paste() {} } }),
      createElement(SpreadsheetFormulaBar, { controller: current }));
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock(element) {
    if (element.props['aria-label'] === '関数を挿入') return { closest(selector) {
      roots.push(selector);
      return { querySelector(selector) { assert.equal(selector, '[data-lxs-formula]'); return input; } };
    } };
    return null;
  } }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; }, get root() { return renderer.root; }, focus, ranges, roots,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async choose(name) { await act(async () => renderer.root.findByProps({ 'aria-label': '関数を挿入' }).props.onChange({ target: { value: name } })); },
    async key(key) { await act(async () => renderer.root.findByProps({ 'aria-label': 'セルの値・数式' }).props.onKeyDown({ key, nativeEvent: {}, preventDefault() {} })); },
  };
}

test('choosing a function starts an uncommitted edit and selects its arguments in this spreadsheet', async t => {
  const hook = await mount(t);
  const before = hook.current.workbook;
  await hook.choose('SUM');
  const example = SUPPORTED_SPREADSHEET_FUNCTIONS.find(item => item.name === 'SUM').example;
  assert.equal(hook.current.editing.value, example);
  assert.equal(hook.current.workbook, before);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.canUndo, false);
  assert.deepEqual(hook.focus, [{ preventScroll: true }]);
  assert.deepEqual(hook.ranges, [[example.indexOf('(') + 1, example.lastIndexOf(')')]]);
  assert.deepEqual(hook.roots, ['[data-likex-spreadsheet]']);
  await hook.key('Escape');
  assert.equal(hook.current.editing, null);
  assert.equal(hook.current.workbook, before);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'original');
});

test('function arguments remain editable, and Enter commits only the selected cell with normal undo', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.select({ row: 1, column: 1 }));
  await hook.choose('SUM');
  await act(async () => hook.root.findByProps({ 'aria-label': 'セルの値・数式' }).props.onChange({ target: { value: '=SUM(20,30)' } }));
  await hook.key('Enter');
  assert.equal(hook.current.editing, null);
  assert.equal(hook.current.workbook.sheets[0].cells.B2.value, '=SUM(20,30)');
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'original');
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.canUndo, true);
  await act(async () => hook.current.undo());
  assert.equal(hook.current.workbook.sheets[0].cells.B2.value, '200');
});

test('the menu comes from the supported function list and ignores unknown selections', async t => {
  const hook = await mount(t);
  const menu = hook.root.findByProps({ 'aria-label': '関数を挿入' });
  assert.deepEqual(menu.findAllByType('option').slice(1).map(option => option.props.value),
    SUPPORTED_SPREADSHEET_FUNCTIONS.map(item => item.name));
  await hook.choose('UNSUPPORTED');
  assert.equal(hook.current.editing, null);
  assert.equal(hook.focus.length, 0);
  for (const definition of SUPPORTED_SPREADSHEET_FUNCTIONS) {
    await hook.choose(definition.name);
    assert.equal(hook.current.editing.value, definition.example);
    assert.deepEqual(hook.ranges.at(-1), [definition.example.indexOf('(') + 1, definition.example.lastIndexOf(')')]);
  }
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'original');
  assert.equal(hook.current.dirty, false);
});

test('function insertion is hidden for disabled formulas and either form of readonly mode', async t => {
  const hook = await mount(t, { features: { formulas: false } });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '関数を挿入' }).length, 0);
  await hook.update({ features: {}, readOnly: true });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '関数を挿入' }).length, 0);
  await hook.update({ readOnly: false, onSave: undefined });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '関数を挿入' }).length, 0);
  await hook.update({ onSave: workbook => workbook });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '関数を挿入' }).length, 1);
});

test('saving and drawing selection block insertion, including direct event dispatch', async t => {
  let finishSave;
  const hook = await mount(t, { onSave: () => new Promise(resolve => { finishSave = resolve; }) });
  await act(async () => hook.current.selectDrawing('box'));
  assert.equal(hook.root.findByProps({ 'aria-label': '関数を挿入' }).props.disabled, true);
  await hook.choose('SUM');
  assert.equal(hook.current.editing, null);
  assert.equal(hook.current.selectedDrawingId, 'box');
  await act(async () => hook.current.select({ row: 1, column: 1 }));
  await act(async () => hook.current.writeValues({ B2: 'new value' }));
  await act(async () => { void hook.current.save(); });
  assert.equal(hook.root.findByProps({ 'aria-label': '関数を挿入' }).props.disabled, true);
  await hook.choose('SUM');
  assert.equal(hook.current.editing, null);
  await act(async () => finishSave());
  assert.equal(hook.root.findByProps({ 'aria-label': '関数を挿入' }).props.disabled, false);
});
