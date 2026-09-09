import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundled = await build({ stdin: { contents: 'export {SpreadsheetToolbar} from "./src/ui/spreadsheet-toolbar"; export {useSpreadsheet} from "./src/state/use-spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'insert-test.ts' },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { SpreadsheetToolbar, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const initialWorkbook = () => ({ sheets: ['one', 'two'].map(id => ({ id, name: id, cells: {}, rowCount: 10, columnCount: 5 })) });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function mount(t, overrides = {}) {
  let current, renderer, unmounted = false;
  let props = { initialWorkbook: initialWorkbook(), onSave: workbook => workbook, ...overrides };
  function Probe() {
    current = useSpreadsheet(props);
    return createElement(SpreadsheetToolbar, { controller: current, clipboard: { copy() {}, paste() {} } });
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { get current() { return current; }, get root() { return renderer.root; }, unmount,
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
  assert.deepEqual(tabs.map(tab => tab.children[0]), ['ホーム', '挿入']);
  await act(async () => tabs[1].props.onClick());
  assert.equal(hook.root.findAllByProps({ role: 'tab' })[1].props['aria-selected'], true);
  assert.equal(hook.root.findAllByProps({ className: 'lxs-save' }).length, 1);
  await act(async () => hook.current.select({ row: 3, column: 2 }));
  await act(async () => hook.root.findByProps({ 'aria-label': '図形を挿入' }).props.onChange({ target: { value: 'ellipse' } }));
  const drawing = hook.current.workbook.sheets[0].drawings[0];
  assert.equal(drawing.shape, 'ellipse');
  assert.deepEqual(drawing.anchor, { row: 3, column: 2, offsetX: 0, offsetY: 0 });
  assert.equal(hook.current.selectedDrawingId, drawing.id);
  assert.equal(hook.root.findByProps({ 'aria-label': '文字の配置' }).props.disabled, true);
  assert.equal(hook.root.findByProps({ 'aria-label': '行と列の操作' }).props.disabled, true);
});

test('insert controls disappear in readonly mode and respect individual feature switches', async t => {
  const hook = await mount(t, { features: { images: false, shapes: false, textBoxes: false, comments: false } });
  assert.equal(hook.root.findAllByProps({ role: 'tab' }).length, 1);
  await hook.update({ features: { images: false }, readOnly: false });
  assert.equal(hook.root.findAllByProps({ 'aria-label': '画像を挿入' }).length, 0);
  assert.equal(hook.root.findAllByProps({ 'aria-label': '図形を挿入' }).length, 1);
  await hook.update({ onSave: undefined });
  assert.equal(hook.root.findAllByProps({ role: 'tab' }).length, 1);
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
