import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { SpreadsheetFormatToolbar } from './src/ui/spreadsheet-format-toolbar';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'text-format-toolbar-test.ts' },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
  builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
    'import {createElement} from "react"; export const SpreadsheetDialog = ({children,actions,title}) => createElement("div",{role:"dialog","aria-label":title},children,actions);', loader: 'js' }));
} }] });
const { useSpreadsheet, SpreadsheetFormatToolbar } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function mount(t, format = {}, overrides = {}) {
  let c, renderer;
  let props = { initialWorkbook: { sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 10, columnCount: 10,
    cells: { A1: { value: 'Text wider than a cell', format: { bold: true, ...format } }, B1: { value: 'Neighbor' } },
  }] }, onSave: () => {}, ...overrides };
  function Probe() { c = useSpreadsheet(props); return createElement(SpreadsheetFormatToolbar, { controller: c }); }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return c; }, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async wrap() { await act(async () => renderer.root.findByProps({ 'aria-label': '折り返して全体を表示' }).props.onClick()); },
    async open() {
      await act(async () => renderer.root.findByProps({ 'aria-label': 'セルの書式設定' }).props.onClick());
      await act(async () => renderer.root.findByProps({ role: 'dialog' }).findAllByType('select')[0].props.onChange({ currentTarget: { value: 'alignment' } }));
    },
    async choose(value) { await act(async () => renderer.root.findByProps({ 'aria-label': '文字の表示' }).props.onChange({ currentTarget: { value } })); },
    async apply() { await act(async () => renderer.root.findByProps({ role: 'dialog' }).findAllByType('button').find(button => button.children.join('') === '適用').props.onClick()); },
    async cancel() { await act(async () => renderer.root.findByProps({ role: 'dialog' }).findAllByType('button').find(button => button.children.join('') === 'キャンセル').props.onClick()); },
  };
}

test('alignment format exposes standard overflow, wrapping, and shrink-to-fit modes', async t => {
  const ui = await mount(t);
  await ui.open();
  const choices = ui.root.findByProps({ 'aria-label': '文字の表示' });
  assert.equal(choices.props.value, 'standard');
  assert.deepEqual(choices.findAllByType('option').map(option => [option.props.value, option.children.join('')]), [
    ['standard', '標準（空白セルにはみ出す）'], ['wrap', '折り返して全体を表示'], ['shrink', '縮小して全体を表示'],
  ]);
  const before = ui.c.workbook;
  await ui.choose('shrink'); await ui.cancel();
  assert.equal(ui.c.workbook, before);
});

test('text modes apply to the selected range as one undoable format command', async t => {
  const ui = await mount(t, { wrap: true });
  await act(async () => ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const before = ui.c.workbook;
  await ui.open(); await ui.choose('shrink'); await ui.apply();
  assert.equal(ui.c.error, null);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
  for (const address of ['A1', 'B1']) {
    assert.equal(ui.c.activeSheet.cells[address].format.wrap, false);
    assert.equal(ui.c.activeSheet.cells[address].format.shrinkToFit, true);
  }
  assert.equal(ui.c.activeSheet.cells.A1.format.bold, true);
  assert.equal(ui.c.activeSheet.cells.B1.value, 'Neighbor');
  assert.equal(ui.c.dirty, true);
  await act(async () => ui.c.undo());
  assert.equal(ui.c.workbook, before);
  await act(async () => ui.c.redo());
  await ui.open(); await ui.choose('standard'); await ui.apply();
  for (const address of ['A1', 'B1']) {
    assert.equal(ui.c.activeSheet.cells[address].format.wrap, false);
    assert.equal(ui.c.activeSheet.cells[address].format.shrinkToFit, false);
  }
});

test('wrapping disables shrink-to-fit in both the dialog and ribbon shortcut', async t => {
  const ui = await mount(t, { shrinkToFit: true });
  await ui.open();
  assert.equal(ui.root.findByProps({ 'aria-label': '文字の表示' }).props.value, 'shrink');
  await ui.choose('wrap'); await ui.apply();
  assert.equal(ui.c.activeSheet.cells.A1.format.wrap, true);
  assert.equal(ui.c.activeSheet.cells.A1.format.shrinkToFit, false);
  assert.equal(ui.root.findByProps({ 'aria-label': '折り返して全体を表示' }).props['aria-pressed'], true);
  await ui.wrap();
  assert.equal(ui.c.activeSheet.cells.A1.format.wrap, false);
  assert.equal(ui.c.activeSheet.cells.A1.format.shrinkToFit, false);
  await act(async () => ui.c.undo());
  await act(async () => ui.c.undo());
  assert.equal(ui.c.activeSheet.cells.A1.format.shrinkToFit, true);
  await ui.wrap();
  assert.equal(ui.c.activeSheet.cells.A1.format.wrap, true);
  assert.equal(ui.c.activeSheet.cells.A1.format.shrinkToFit, false);
});

test('format controls obey feature, readonly, and edit permission settings', async t => {
  const ui = await mount(t, {}, { onEditRequest: () => false });
  const before = ui.c.workbook;
  await ui.wrap(); assert.equal(ui.c.workbook, before);
  await ui.open(); await ui.choose('shrink'); await ui.apply();
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.canUndo, false);
  await ui.cancel();
  for (const patch of [{ features: { formatting: false } }, { features: {}, readOnly: true }]) {
    await ui.update(patch);
    assert.equal(ui.root.findAllByProps({ 'aria-label': 'セルの書式設定' }).length, 0);
    assert.equal(ui.root.findAllByProps({ 'aria-label': '折り返して全体を表示' }).length, 0);
  }
});

test('cancelling pending text format permission prevents a late change', async t => {
  let resolve;
  const ui = await mount(t, {}, { onEditRequest: () => new Promise(done => { resolve = done; }) });
  const before = ui.c.workbook;
  await ui.open(); await ui.choose('shrink'); await ui.apply();
  assert.equal(ui.c.requesting, true);
  assert.equal(ui.root.findByProps({ 'aria-label': '文字の表示' }).props.disabled, true);
  assert.equal(ui.root.findByProps({ 'aria-label': '折り返して全体を表示' }).props.disabled, true);
  await ui.cancel();
  await act(async () => resolve(true));
  assert.equal(ui.c.workbook, before);
});
