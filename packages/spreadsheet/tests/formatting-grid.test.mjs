import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: 'export { SpreadsheetGrid } from "./src/ui/spreadsheet-grid"; export { SpreadsheetFormatToolbar } from "./src/ui/spreadsheet-format-toolbar"; export { useSpreadsheet } from "./src/state/use-spreadsheet";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { SpreadsheetGrid, SpreadsheetFormatToolbar, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const event = (extra = {}) => ({ nativeEvent: {}, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, button: 0, buttons: 1, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...extra });
async function mount(t, props = {}) {
  let c, renderer, input;
  const listeners = new Map();
  const doc = { activeElement: null, addEventListener(name, handler) { const values = listeners.get(name) ?? new Set(); values.add(handler); listeners.set(name, values); }, removeEventListener(name, handler) { listeners.get(name)?.delete(handler); }, createElement() { return { getContext() { return { font: '', measureText(text) { return { width: text.length * 10 }; } }; } }; }, defaultView: { addEventListener() {}, removeEventListener() {}, cancelAnimationFrame() {}, requestAnimationFrame() { return 1; } } };
  const node = element => {
    if (element.type === 'textarea' && input) return input;
    const value = { ownerDocument: doc, style: {}, scrollHeight: 18, clientHeight: 480, clientWidth: 1000, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0,
      focus() { doc.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }, closest() { return null; }, contains(target) { return target?.ownerDocument === doc; }, setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect() { return { top: 0, left: 0, right: 1000, bottom: 480 }; },
      get value() { return c.editing?.value ?? element.props.value ?? ''; } };
    if (element.type === 'textarea') input = value;
    return value;
  };
  function Probe() { c = useSpreadsheet({ initialWorkbook: { sheets: [{ id: 's', name: 'Sheet1', rowCount: 8, columnCount: 30, cells: { A1: { value: 'alpha' }, B1: { value: 'one\ntwo', format: { wrap: true, fontSize: 20 } }, C1: { value: '-123', format: { numberFormat: 'number', decimalPlaces: 2, negativeFormat: 'red', verticalAlign: 'bottom', borders: { top: { width: 2, color: '#f00' } } } } } }] }, onSave() {}, ...props }); return createElement("div", null, createElement(SpreadsheetGrid, { controller: c }), createElement(SpreadsheetFormatToolbar, { controller: c })); }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => act(() => renderer.unmount()));
  const editor = () => renderer.root.findByProps({ className: 'lxs-cell-input' });
  return { get c() { return c; }, get input() { return input; }, renderer, editor, doc,
    async key(key, extra = {}) { await act(async () => editor().props.onKeyDown(event({ currentTarget: input, key, ...extra }))); },
    async resize(label, kind, extra = {}) { const separator = renderer.root.findByProps({ 'aria-label': label }); const target = node({ props: {} }); await act(async () => separator.props[kind](event({ currentTarget: target, ...extra }))); } };
}

test('Alt+Enter adds and commits a newline without moving, including columns beyond Z', async t => {
  const ui = await mount(t);
  assert.equal(ui.editor().type, 'textarea');
  await ui.key('Alt'); await ui.key('Enter', { altKey: true });
  assert.equal(ui.c.editing.value, 'alpha\n'); assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
  ui.input.selectionStart = 2; ui.input.selectionEnd = 4;
  await ui.key('Enter', { altKey: true }); assert.equal(ui.c.editing.value, 'al\na\n');
  await ui.key('Enter'); assert.equal(ui.c.activeSheet.cells.A1.value, 'al\na\n');
  await act(async () => { ui.c.select({ row: 0, column: 26 }); ui.c.beginEdit({ row: 0, column: 26 }, 'AA value'); });
  await ui.key('Enter'); await act(async () => ui.c.select({ row: 0, column: 26 }));
  await ui.key('Enter', { altKey: true }); assert.equal(ui.c.editing.value, 'AA value\n');
});

test('row resize previews on drag, commits once, supports undo and cancels stale work', async t => {
  const ui = await mount(t);
  await ui.resize('1行の高さ', 'onPointerDown', { clientY: 20 });
  await ui.resize('1行の高さ', 'onPointerMove', { clientY: 50 });
  assert.equal(ui.c.activeSheet.rowHeights, undefined);
  assert.equal(ui.renderer.root.findByProps({ 'aria-label': '1行の高さ' }).props['aria-valuenow'], 58);
  await ui.resize('1行の高さ', 'onPointerUp', { clientY: 50 });
  assert.equal(ui.c.activeSheet.rowHeights[0], 58);
  await act(async () => ui.c.undo()); assert.equal(ui.c.activeSheet.rowHeights, undefined);
  await ui.resize('1行の高さ', 'onPointerDown', { clientY: 20 });
  await ui.resize('1行の高さ', 'onPointerMove', { clientY: 90 });
  await act(async () => ui.c.executeCommand({ type: 'cells.set', sheetId: 's', values: { A2: 'changed' } }));
  await ui.resize('1行の高さ', 'onPointerUp', { clientY: 90 });
  assert.equal(ui.c.activeSheet.rowHeights, undefined);
});

test('row/column separator double click auto-fits text and multiline font metrics', async t => {
  const ui = await mount(t);
  await ui.resize('1行の高さ', 'onDoubleClick'); assert.equal(ui.c.activeSheet.rowHeights[0], 62);
  await ui.resize('A列の幅', 'onDoubleClick'); assert.equal(ui.c.activeSheet.columnWidths[0], 66);
});

test('format styling is rendered independently of editing permissions', async t => {
  const ui = await mount(t, { readOnly: true, features: { formatting: false, resize: false } });
  const cell = ui.renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['data-lxs-column'] === 2 && item.props['data-lxs-row'] === 0);
  assert.equal(cell.props.style.color, '#dc2626'); assert.equal(cell.props.style.borderTop, '2px solid #f00'); assert.equal(cell.props.style.justifyContent, 'flex-end');
  assert.equal(ui.renderer.root.findAllByProps({ role: 'separator' }).length, 0);
  await ui.key('Enter', { altKey: true }); assert.equal(ui.c.editing, null);
});


for (const [label, title, commitLabel] of [['罫線と数値の書式', 'セルの書式', '適用'], ['条件付き書式', '条件付き書式', 'ルールを追加']]) {
  const dialog = ui => ui.renderer.root.find(instance => typeof instance.type === 'function' && instance.type.name === 'SpreadsheetDialog' && instance.props.title === title);
  const button = ui => dialog(ui).props.actions.props.children.find(element => element.props.children === commitLabel);
  test(`${title}: cancelling a pending permission prevents late changes`, async t => {
    let resolvePermission;
    const ui = await mount(t, { onEditRequest: () => new Promise(resolve => { resolvePermission = resolve; }) });
    await act(async () => ui.renderer.root.findByProps({ 'aria-label': label }).props.onClick());
    await act(async () => button(ui).props.onClick());
    assert.equal(ui.c.requesting, true);
    await act(async () => dialog(ui).props.onClose());
    await act(async () => resolvePermission(true));
    assert.equal(ui.c.activeSheet.cells.A1.format, undefined);
    assert.equal(ui.c.activeSheet.conditionalFormats, undefined);
  });
  test(`${title}: an external structural edit invalidates the captured target`, async t => {
    const ui = await mount(t);
    await act(async () => ui.renderer.root.findByProps({ 'aria-label': label }).props.onClick());
    await act(async () => ui.c.executeCommand({ type: 'rows.insert', sheetId: 's', index: 0 }));
    assert.equal(button(ui).props.disabled, true);
    await act(async () => button(ui).props.onClick());
    assert.equal(ui.c.activeSheet.cells.A2.format, undefined);
    assert.equal(ui.c.activeSheet.conditionalFormats, undefined);
  });
}
