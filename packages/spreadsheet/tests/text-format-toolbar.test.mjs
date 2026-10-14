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

test('alignment details open directly from the ribbon and expose every Excel placement option', async t => {
  const ui = await mount(t, { align: 'centerContinuous', verticalAlign: 'distributed', indent: 2 });
  await act(async () => ui.root.findByProps({ 'aria-label': '配置の詳細設定' }).props.onClick());
  const horizontal = ui.root.findByProps({ 'aria-label': '横位置' });
  const vertical = ui.root.findByProps({ 'aria-label': '縦位置' });
  assert.equal(horizontal.props.value, 'centerContinuous');
  assert.equal(vertical.props.value, 'distributed');
  assert.deepEqual(horizontal.findAllByType('option').map(option => option.props.value),
    ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed']);
  assert.deepEqual(vertical.findAllByType('option').map(option => option.props.value),
    ['top', 'middle', 'bottom', 'justify', 'distributed']);
  assert.equal(ui.root.findByProps({ 'aria-label': 'インデント' }).props.value, '2');
  assert.equal(ui.root.findByProps({ 'aria-label': 'インデント' }).props.disabled, true);
});

const setAlignment = async (ui, label, value) => {
  await act(async () => ui.root.findByProps({ 'aria-label': label }).props.onChange({ currentTarget: { value } }));
};

const mixedAlignmentWorkbook = { sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 10, columnCount: 10,
  cells: {
    A1: { value: 'Factory', format: { align: 'left', verticalAlign: 'top', indent: 1, wrap: true } },
    B1: { value: '1234', format: { align: 'right', verticalAlign: 'bottom', indent: 3, shrinkToFit: true } },
  },
}] };

test('horizontal, vertical, and indent changes apply as one undoable command while retaining each cell text mode', async t => {
  const ui = await mount(t, {}, { initialWorkbook: mixedAlignmentWorkbook });
  await act(async () => ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const before = ui.c.workbook;
  await ui.open();
  await setAlignment(ui, '横位置', 'distributed');
  await setAlignment(ui, '縦位置', 'justify');
  await setAlignment(ui, 'インデント', '2');
  await ui.apply();
  assert.equal(ui.c.error, null);
  for (const address of ['A1', 'B1']) {
    assert.equal(ui.c.activeSheet.cells[address].format.align, 'distributed');
    assert.equal(ui.c.activeSheet.cells[address].format.verticalAlign, 'justify');
    assert.equal(ui.c.activeSheet.cells[address].format.indent, 2);
  }
  assert.equal(ui.c.activeSheet.cells.A1.format.wrap, true);
  assert.equal(ui.c.activeSheet.cells.B1.format.shrinkToFit, true);
  assert.equal(ui.c.activeSheet.cells.A1.value, 'Factory');
  assert.equal(ui.c.activeSheet.cells.B1.value, '1234');
  await act(async () => ui.c.undo());
  assert.equal(ui.c.workbook, before);
  await act(async () => ui.c.redo());
  assert.equal(ui.c.activeSheet.cells.B1.format.align, 'distributed');
});

test('changing only text mode preserves mixed horizontal, vertical, and indent settings', async t => {
  const ui = await mount(t, {}, { initialWorkbook: mixedAlignmentWorkbook });
  await act(async () => ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  await ui.open(); await ui.choose('standard'); await ui.apply();
  for (const address of ['A1', 'B1']) {
    const original = mixedAlignmentWorkbook.sheets[0].cells[address].format;
    const actual = ui.c.activeSheet.cells[address].format;
    assert.equal(actual.align, original.align);
    assert.equal(actual.verticalAlign, original.verticalAlign);
    assert.equal(actual.indent, original.indent);
    assert.equal(actual.wrap, false);
    assert.equal(actual.shrinkToFit, false);
  }
});

test('applying unchanged alignment leaves a mixed selection and its undo history untouched', async t => {
  const ui = await mount(t, {}, { initialWorkbook: mixedAlignmentWorkbook });
  await act(async () => ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const before = ui.c.workbook;
  await ui.open(); await ui.apply();
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.canUndo, false);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('invalid indentation cannot be applied, and correcting it retains the edited placement', async t => {
  const ui = await mount(t, { align: 'left' });
  await ui.open();
  await setAlignment(ui, '横位置', 'right');
  const before = ui.c.workbook;
  for (const value of ['', '-1', '1.5', '251']) {
    await setAlignment(ui, 'インデント', value);
    const apply = ui.root.findByProps({ role: 'dialog' }).findAllByType('button').find(button => button.children.join('') === '適用');
    assert.equal(apply.props.disabled, true);
    assert.equal(ui.root.findByProps({ 'aria-label': 'インデント' }).props['aria-invalid'], true);
    await ui.apply();
    assert.equal(ui.c.workbook, before);
  }
  await setAlignment(ui, 'インデント', '250'); await ui.apply();
  assert.equal(ui.c.activeSheet.cells.A1.format.align, 'right');
  assert.equal(ui.c.activeSheet.cells.A1.format.indent, 250);
});

test('alignment changes respect late permission cancellation and stale workbook targets', async t => {
  let resolve;
  const ui = await mount(t, {}, { onEditRequest: () => new Promise(done => { resolve = done; }) });
  const before = ui.c.workbook;
  await ui.open(); await setAlignment(ui, '横位置', 'centerContinuous'); await ui.apply();
  assert.equal(ui.c.requesting, true);
  assert.equal(ui.root.findByProps({ 'aria-label': '横位置' }).props.disabled, true);
  assert.equal(ui.root.findByProps({ 'aria-label': '縦位置' }).props.disabled, true);
  await ui.cancel(); await act(async () => resolve(true));
  assert.equal(ui.c.workbook, before);
  await ui.update({ onEditRequest: () => true });
  await ui.open(); await setAlignment(ui, '縦位置', 'distributed');
  await act(async () => ui.c.executeCommand({ type: 'rows.insert', sheetId: 'sheet', index: 0 }));
  const changed = ui.c.workbook;
  assert.equal(ui.root.findByProps({ 'aria-label': '横位置' }).props.disabled, true);
  await ui.apply();
  assert.equal(ui.c.workbook, changed);
  assert.notEqual(ui.c.activeSheet.cells.A2.format?.verticalAlign, 'distributed');
});
