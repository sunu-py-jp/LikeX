import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundled = await build({ stdin: { contents: 'export {SpreadsheetToolbar} from "./src/ui/spreadsheet-toolbar"; export {SpreadsheetNamedRangePanel,NamedRangeDialog} from "./src/ui/spreadsheet-named-ranges"; export {useSpreadsheet} from "./src/state/use-spreadsheet"; export {useNamedRangeManager} from "./src/ui/named-ranges/use-named-range-manager";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'insert-test.ts' },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  // The test renderer has no DOM region for portals. Keep the real form and
  // command handlers; render only the dialog shell inline for these tests.
  builder.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
  builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
    'import {createElement, Fragment} from "react"; export const SpreadsheetDialog = ({children,actions}) => createElement(Fragment,null,children,actions);', loader: 'js' }));
} }] });
const { SpreadsheetToolbar, SpreadsheetNamedRangePanel, NamedRangeDialog, useSpreadsheet, useNamedRangeManager } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const initialWorkbook = () => ({ sheets: ['one', 'two'].map(id => ({ id, name: id, cells: {}, rowCount: 10, columnCount: 5 })) });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function mount(t, overrides = {}) {
  let current, manager, renderer, unmounted = false;
  let props = { initialWorkbook: initialWorkbook(), onSave: workbook => workbook, ...overrides };
  function Probe() {
    current = useSpreadsheet(props);
    const namedRangeManager = useNamedRangeManager(current); manager = namedRangeManager;
    return createElement('section', { 'data-likex-spreadsheet': true },
      createElement(SpreadsheetToolbar, { controller: current, namedRangeManager, clipboard: { copy() {}, paste() {} } }),
      createElement(SpreadsheetNamedRangePanel, { controller: current, manager: namedRangeManager }),
      namedRangeManager.dialogTarget ? createElement(NamedRangeDialog, { controller: current, target: namedRangeManager.dialogTarget,
        key: JSON.stringify(namedRangeManager.dialogTarget), onClose: namedRangeManager.closeDialog }) : null);
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { get current() { return current; }, get manager() { return manager; }, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}
function decode(t) {
  const images = [], revoked = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  class MockImage {
    naturalWidth = 1; naturalHeight = 1;
    constructor() { images.push(this); }
    set src(value) { this.source = value; }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: MockImage });
  t.mock.method(URL, 'createObjectURL', () => `blob:image-${images.length}`);
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Image', descriptor); else delete globalThis.Image; });
  return { images, revoked };
}
async function upload(hook) {
  const input = hook.root.findByProps({ 'aria-label': '挿入する画像ファイル' });
  await act(async () => { input.props.onChange({ target: { files: [new File([png], 'tiny.png', { type: 'image/png' })], value: 'tiny.png' } }); await tick(); });
}

test('home and insert switch with one shared save action, and shapes anchor at the selected cell', async t => {
  const hook = await mount(t);
  const tabs = hook.root.findAllByProps({ role: 'tab' });
  assert.deepEqual(tabs.map(tab => tab.children[0]), ['ホーム', '挿入', 'データ']);
  await act(async () => tabs[1].props.onClick());
  assert.equal(hook.root.findAllByProps({ role: 'tab' })[1].props['aria-selected'], true);
  assert.equal(hook.root.findAllByProps({ className: 'lxs-save' }).length, 1);
  await act(async () => hook.current.select({ row: 3, column: 2 }));
  await act(async () => hook.root.findByProps({ 'aria-label': '図形を挿入' }).props.onChange({ target: { value: 'ellipse' } }));
  const drawing = hook.current.workbook.sheets[0].drawings[0];
  assert.equal(drawing.shape, 'ellipse');
  assert.deepEqual(drawing.anchor, { row: 3, column: 2, offsetX: 0, offsetY: 0 });
  assert.equal(hook.current.selectedDrawingId, drawing.id);
  for (const label of ['左揃え', '中央揃え', '右揃え', '上揃え', '上下中央', '下揃え'])
    assert.equal(hook.root.findByProps({ 'aria-label': label }).props.disabled, true);
  assert.equal(hook.root.findByProps({ 'aria-label': '行と列の操作' }).props.disabled, true);
});

test('insert controls disappear in readonly mode and respect individual feature switches', async t => {
  const hook = await mount(t, { features: { images: false, shapes: false, textBoxes: false, comments: false, tables: false } });
  assert.deepEqual(hook.root.findAllByProps({ role: 'tab' }).map(tab => tab.children[0]), ['ホーム', 'データ']);
  await hook.update({ features: { images: false }, readOnly: false });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '画像を挿入' }).length, 0);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '図形を挿入' }).length, 1);
  await hook.update({ onSave: undefined });
  assert.deepEqual(hook.root.findAllByProps({ role: 'tab' }).map(tab => tab.children[0]), ['ホーム', 'データ']);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '名前付き範囲を追加' }).length, 0);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '名前付き範囲を管理' }).length, 1);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '図形を挿入' }).length, 0);
});

test('text boxes inherit the host color and comments open at the selected cell', async t => {
  const hook = await mount(t, { colorMode: 'dark' });
  await act(async () => hook.current.select({ row: 2, column: 1 }));
  await act(async () => hook.root.findByProps({ 'aria-label': 'テキストボックスを挿入' }).props.onClick());
  const drawing = hook.current.workbook.sheets[0].drawings[0];
  assert.equal(drawing.type, 'text');
  assert.equal(drawing.color, 'currentColor');
  assert.deepEqual(drawing.anchor, { row: 2, column: 1, offsetX: 0, offsetY: 0 });
  await act(async () => hook.root.findByProps({ 'aria-label': 'コメントを挿入' }).props.onClick());
  assert.equal(hook.current.commentOpen, true);
  assert.equal(hook.current.selectedDrawingId, null);
  assert.deepEqual(hook.current.selection.focus, { row: 2, column: 1 });
});

test('successful image decode adds a JSON resource and selects the inserted drawing', async t => {
  const dom = decode(t), hook = await mount(t);
  await upload(hook);
  await act(async () => { dom.images[0].onload(); await tick(); });
  const drawing = hook.current.workbook.sheets[0].drawings[0];
  assert.equal(drawing.type, 'image');
  assert.equal(hook.current.selectedDrawingId, drawing.id);
  assert.equal(hook.current.workbook.resources.images[drawing.resourceId].dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(dom.revoked.length, 1);
});

for (const change of ['feature', 'readonly', 'sheet', 'selection', 'workbook', 'cell edit', 'object edit', 'save', 'unmount'])
  test(`an image finishing after ${change} changes cannot insert into the current workbook`, async t => {
    const dom = decode(t);
    let changes = 0, finishSave;
    const hook = await mount(t, { onChange() { changes++; }, onSave: () => new Promise(resolve => { finishSave = resolve; }) });
    if (change === 'save') await act(async () => hook.current.writeValues({ A1: 'save me' }));
    await upload(hook);
    const oldCompletion = dom.images[0].onload;
    if (change === 'feature') await hook.update({ features: { images: false } });
    if (change === 'readonly') await hook.update({ readOnly: true });
    if (change === 'sheet') await act(async () => hook.current.switchSheet('two'));
    if (change === 'selection') await act(async () => hook.current.select({ row: 1, column: 1 }));
    if (change === 'workbook') await act(async () => hook.current.writeValues({ A1: 'newer draft' }));
    if (change === 'cell edit') await act(async () => hook.current.beginEdit({ row: 0, column: 0 }, 'still typing'));
    if (change === 'object edit') await act(async () => hook.current.setPendingObjectEdit(true));
    if (change === 'save') await act(async () => { void hook.current.save(); });
    if (change === 'unmount') await hook.unmount();
    const before = changes;
    await act(async () => { oldCompletion(); await tick(); if (finishSave) { finishSave(); await tick(); } });
    assert.equal(changes, before);
    assert.equal(hook.current.workbook.resources, undefined);
    assert.ok(hook.current.workbook.sheets.every(sheet => !sheet.drawings?.length));
    if (change === 'cell edit') assert.equal(hook.current.editing.value, 'still typing');
    if (change === 'object edit') assert.equal(hook.current.pendingObjectEdit, true);
    assert.ok(dom.revoked.length >= 1);
  });

test('image insertion tracks the synchronous draft after committing the current cell editor', async t => {
  const dom = decode(t), hook = await mount(t);
  await act(async () => hook.current.beginEdit({ row: 0, column: 0 }, 'committed before upload'));
  await upload(hook);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'committed before upload');
  await act(async () => { dom.images[0].onload(); await tick(); });
  assert.equal(hook.current.workbook.sheets[0].drawings[0].type, 'image');
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'committed before upload');
});

test('an image completing beside a same-tick draft change cannot overwrite the newer context', async t => {
  const dom = decode(t), hook = await mount(t);
  await upload(hook);
  await act(async () => {
    dom.images[0].onload();
    hook.current.writeValues({ A1: 'newer synchronous draft' });
    await tick();
  });
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, 'newer synchronous draft');
  assert.equal(hook.current.workbook.resources, undefined);
  assert.equal(hook.current.workbook.sheets[0].drawings, undefined);
});

function textButton(root, text) {
  return root.findAllByType('button').find(button => button.children.join('') === text);
}
test('named range dialog calls commands and definition-only deletion preserves cells', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({A1:'value'}));
  await act(async () => hook.root.findAllByType('button').find(button => button.props['aria-label'] === '名前付き範囲を追加').props.onClick());
  await act(async () => hook.root.findByProps({placeholder:'売上明細'}).props.onChange({target:{value:'DataRange'}}));
  await act(async () => hook.root.findByProps({placeholder:'A1:C10'}).props.onChange({target:{value:'A1:B2'}}));
  await act(async () => textButton(hook.root,'追加').props.onClick());
  const definition = hook.current.workbook.namedRanges[0];
  assert.equal(definition.name,'DataRange'); assert.deepEqual(definition.range,{top:0,left:0,bottom:1,right:1});
  await act(async () => hook.root.findAllByType('button').find(button => button.props['aria-label'] === '名前付き範囲を管理').props.onClick());
  await act(async () => hook.root.findAllByType('button').find(button => button.props['aria-label'] === 'DataRangeを編集').props.onClick());
  await act(async () => textButton(hook.root,'削除').props.onClick());
  assert.equal(hook.current.workbook.namedRanges,undefined); assert.equal(hook.current.workbook.sheets[0].cells.A1.value,'value');
  await act(async () => hook.current.undo()); assert.equal(hook.current.workbook.namedRanges[0].id,definition.id);
});
test('table dialog creates metadata from selected cells and bordered action uses ordinary cells', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({A1:'商品',B1:'数量',A2:'test',B2:'2'}));
  await act(async () => hook.current.selectRange({row:0,column:0},{row:1,column:1}));
  await act(async () => hook.root.findByProps({'aria-label':'テーブルを挿入'}).props.onClick());
  await act(async () => textButton(hook.root,'作成').props.onClick());
  const table=hook.current.workbook.sheets[0].tables[0]; assert.equal(table.name,'Table1');
  assert.deepEqual(table.columns.map(column=>column.name),['商品','数量']);
  await act(async () => hook.current.undo()); assert.equal(hook.current.workbook.sheets[0].tables,undefined);
  await act(async () => hook.current.selectRange({row:0,column:0},{row:1,column:1}));
  await act(async () => hook.root.findByProps({'aria-label':'罫線付きの表を作成'}).props.onClick());
  assert.equal(hook.current.workbook.sheets[0].tables,undefined); assert.equal(hook.current.workbook.sheets[0].cells.A1.format.borders.bottom.width,1);
});
test('named range dialog rejects a target captured before a newer edit', async t => {
  const hook = await mount(t);
  await act(async () => hook.root.findAllByType('button').find(button => button.props['aria-label'] === '名前付き範囲を追加').props.onClick());
  await act(async () => hook.root.findByProps({placeholder:'売上明細'}).props.onChange({target:{value:'StaleRange'}}));
  await act(async () => hook.current.writeValues({A1:'newer'}));
  await act(async () => textButton(hook.root,'追加').props.onClick());
  assert.equal(hook.current.workbook.namedRanges,undefined); assert.equal(hook.current.workbook.sheets[0].cells.A1.value,'newer');
  assert.match(hook.root.findByProps({role:'alert'}).children.join(''),/状態が変わりました/);
});
test('range/table feature switches hide only the corresponding new controls', async t => {
  const hook=await mount(t,{features:{namedRanges:false,tables:false}});
  assert.equal(hook.root.findAllByProps({'aria-label':'名前付き範囲を追加'}).length,0);
  assert.equal(hook.root.findAllByProps({'aria-label':'テーブルを挿入'}).length,0);
  assert.equal(hook.root.findAllByProps({'aria-label':'セルをクリア'}).length,1);
});

const ribbonGroups = root => root.findAll(node => node.type === 'section' && node.props.role === 'group');
test('ribbon groups keep related actions together with visible labels on every tab', async t => {
  const hook = await mount(t);
  const home = hook.root.findByProps({ 'aria-label': 'シートの編集' });
  assert.deepEqual(ribbonGroups(home).map(group => group.props['aria-label']), ['クリップボード', 'フォント', '配置', '表示形式', 'スタイル', 'セル', '編集']);
  for (const [label, controls] of [
    ['クリップボード', ['コピー', '切り取り', '貼り付け', '形式を選択して貼り付け']],
    ['フォント', ['フォント', 'フォントサイズ（px）', '太字', '文字色', '背景色']],
    ['配置', ['上揃え', '上下中央', '下揃え', '左揃え', '中央揃え', '右揃え', 'セルを結合', '折り返して全体を表示']],
    ['セル', ['行と列の操作', '行列サイズの自動調整']],
    ['編集', ['検索', '置換', '関数を挿入', 'セルをクリア']],
  ]) {
    const group = ribbonGroups(home).find(group => group.props['aria-label'] === label);
    assert.equal(group.findByProps({ className: 'lxs-ribbon-group-label' }).children.join(''), label);
    for (const control of controls) assert.ok(group.findAll(node => ['button', 'input', 'select'].includes(node.type) && node.props['aria-label'] === control).length, `${control} belongs to ${label}`);
  }
  assert.deepEqual(ribbonGroups(hook.root.findByProps({ 'aria-label': 'シートへの挿入' })).map(group => group.props['aria-label']), ['テーブル', '図', 'コメント']);
  assert.deepEqual(ribbonGroups(hook.root.findByProps({ 'aria-label': 'データの操作' })).map(group => group.props['aria-label']), ['名前付き範囲', '入力規則']);
  assert.equal(home.findAllByProps({ 'aria-label': '元に戻す' }).length, 0, 'history stays in the quick access header');
});

test('group visibility follows feature flags and readonly without orphaned labels', async t => {
  const hook = await mount(t, { features: { formatting: false, copy: false, cut: false, paste: false, pasteSpecial: false,
    resize: false, insertRows: false, deleteRows: false, insertColumns: false, deleteColumns: false } });
  const labels = () => ribbonGroups(hook.root.findByProps({ 'aria-label': 'シートの編集' })).map(group => group.props['aria-label']);
  assert.deepEqual(labels(), ['配置', '編集']);
  assert.ok(hook.root.findByProps({ 'aria-label': 'セルを結合' }));
  assert.equal(hook.root.findAllByProps({ 'aria-label': '上揃え' }).length, 0);
  await hook.update({ features: { mergeCells: false, conditionalFormatting: false } });
  assert.equal(hook.root.findAllByProps({ 'aria-label': 'セルを結合' }).length, 0);
  assert.equal(labels().includes('スタイル'), false);
  assert.ok(labels().includes('フォント'));
  await hook.update({ readOnly: true, features: {} });
  assert.deepEqual(labels(), ['クリップボード', '編集']);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '切り取り' }).length, 0);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '置換' }).length, 0);
  await hook.update({ features: { copy: false, search: false } });
  assert.deepEqual(labels(), []);
});

test('alignment icon buttons format the full selected range through commands and retain Undo selection', async t => {
  const changes = [];
  const hook = await mount(t, { onChange: (_, event) => changes.push(event) });
  await act(async () => hook.current.selectRange({ row: 1, column: 1 }, { row: 2, column: 2 }));
  const selection = structuredClone(hook.current.selection);
  for (const [label, key, value] of [['上揃え', 'verticalAlign', 'top'], ['上下中央', 'verticalAlign', 'middle'], ['下揃え', 'verticalAlign', 'bottom'],
    ['中央揃え', 'align', 'center'], ['右揃え', 'align', 'right'], ['左揃え', 'align', 'left']]) {
    const before = hook.current.getWorkbook();
    const button = hook.root.findByProps({ 'aria-label': label });
    assert.equal(button.findAllByType('svg').length, 1);
    assert.equal(button.props.title, label);
    await act(async () => button.props.onClick());
    for (const address of ['B2', 'C2', 'B3', 'C3']) assert.equal(hook.current.activeSheet.cells[address].format[key], value);
    assert.equal(hook.current.activeSheet.cells.A1, undefined);
    assert.equal(hook.root.findByProps({ 'aria-label': label }).props['aria-pressed'], true);
    await act(async () => hook.current.select({ row: 5, column: 4 }));
    await act(async () => hook.current.undo());
    assert.deepEqual(hook.current.getWorkbook(), before);
    assert.deepEqual(hook.current.selection, selection);
    await act(async () => hook.current.redo());
    assert.deepEqual(hook.current.selection, selection);
  }
  assert.equal(changes.length, 18);
});
