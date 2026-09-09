import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: 'export { SpreadsheetFooter } from "./src/ui/spreadsheet-footer"; export { useSpreadsheet } from "./src/state/use-spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'sheet-reorder-ui.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetFooter, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function mount(t, overrides = {}) {
  let c, renderer;
  let props = { initialWorkbook: { sheets: ['one', 'two', 'three'].map(id => ({ id, name: id, rowCount: 5, columnCount: 5, cells: {} })) }, onSave() {}, ...overrides };
  function Probe() { c = useSpreadsheet(props); return createElement(SpreadsheetFooter, { controller: c }); }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const strip = { scrollLeft: 0, contains: () => false, getBoundingClientRect: () => ({ left: 0, right: 300 }),
    querySelectorAll: () => c.workbook.sheets.map((sheet, index) => ({ dataset: { lxsSheetId: sheet.id }, getBoundingClientRect: () => ({ left: index * 100, width: 100 }) })) };
  function event(clientX = 0) { return { clientX, currentTarget: strip, prevented: false, preventDefault() { this.prevented = true; },
    dataTransfer: { effectAllowed: '', dropEffect: '', setData() {} }, stopPropagation() {} }; }
  return { get c() { return c; }, get root() { return renderer.root; },
    order: () => c.workbook.sheets.map(sheet => sheet.id),
    tab: id => renderer.root.findByProps({ role: 'tab', 'data-lxs-sheet-id': id }),
    strip: () => renderer.root.findByProps({ role: 'tablist' }),
    async start(id) { const e = event(); await act(async () => this.tab(id).props.onDragStart(e)); return e; },
    async over(x) { const e = event(x); await act(async () => this.strip().props.onDragOver(e)); return e; },
    async drop(x) { const e = event(x); await act(async () => this.strip().props.onDrop(e)); return e; },
    async end(id) { await act(async () => this.tab(id).props.onDragEnd()); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async run(fn) { await act(async () => fn(c)); },
  };
}

test('drag moves a tab to the final position with one undo entry and preserves the active sheet', async t => {
  const ui = await mount(t);
  assert.equal(ui.root.findAllByType('select').length, 0, 'the obsolete sheet operations select is removed');
  await ui.run(c => c.switchSheet('two'));
  const selection = ui.c.selection;
  await ui.start('one');
  assert.equal((await ui.over(300)).prevented, true);
  assert.match(ui.tab('one').props.className, /lxs-sheet-tab-dragging/);
  assert.equal(ui.root.findAllByProps({ className: 'lxs-sheet-drop-end' }).length, 1);
  await ui.drop(300);
  assert.deepEqual(ui.order(), ['two', 'three', 'one']);
  assert.equal(ui.c.activeSheet.id, 'two');
  assert.deepEqual(ui.c.selection, selection);
  assert.equal(ui.c.dirty, true);
  await ui.end('one');
  await ui.run(c => c.undo());
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
  assert.equal(ui.c.canUndo, false);
  await ui.run(c => c.redo());
  assert.deepEqual(ui.order(), ['two', 'three', 'one']);
  await ui.start('one'); await ui.drop(0);
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
});

test('same-position drops, cancelled drags, and foreign drags do not request edits', async t => {
  let requests = 0;
  const ui = await mount(t, { onEditRequest() { requests++; return true; } });
  const initial = ui.c.workbook;
  assert.equal((await ui.drop(300)).prevented, false);
  await ui.start('one'); await ui.over(120); await ui.drop(120);
  assert.equal(ui.c.workbook, initial);
  await ui.start('three'); await ui.over(0); await ui.end('three'); await ui.drop(0);
  assert.equal(ui.c.workbook, initial);
  assert.equal(requests, 0);
  assert.equal(ui.c.canUndo, false);
});

test('a completed drag does not trigger rename, while a fresh pointer click still does', async t => {
  const ui = await mount(t);
  await ui.start('one'); await ui.drop(300); await ui.end('one');
  await act(async () => ui.tab('one').props.onClick({ detail: 1 }));
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'シート名' }).length, 0);
  await act(async () => ui.tab('one').props.onPointerDown());
  await act(async () => ui.tab('one').props.onClick({ detail: 1 }));
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'シート名' }).length, 1);
});

test('readonly, feature revocation, stale workbooks and pending editors reject dragging', async t => {
  const ui = await mount(t);
  const initial = ui.c.workbook;
  for (const patch of [{ readOnly: true }, { readOnly: false, features: { reorderSheets: false } }]) {
    await ui.update(patch);
    assert.equal(ui.tab('one').props.draggable, false);
    assert.equal((await ui.start('one')).prevented, true);
    await ui.drop(300);
    assert.equal(ui.c.workbook, initial);
  }
  await ui.update({ features: {} });
  await ui.start('one'); await ui.update({ features: { reorderSheets: false } }); await ui.drop(300);
  assert.equal(ui.c.workbook, initial);
  await ui.update({ features: {} });
  await ui.start('one');
  await ui.run(c => c.executeCommand({ type: 'cells.set', sheetId: 'one', values: { A1: 'new' } }));
  await ui.drop(300);
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
  await ui.run(c => c.beginEdit({ row: 0, column: 0 }, 'pending'));
  assert.equal(ui.tab('one').props.draggable, false);
  await ui.run(c => c.cancelEdit());
  await ui.run(c => c.setContextMenuLock({}));
  assert.equal(ui.tab('one').props.draggable, false);
});

test('permission refusal preserves order and keyboard reordering shares the command pipeline', async t => {
  const decisions = [];
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => decisions.push(resolve)) });
  await ui.start('one'); await ui.drop(300);
  assert.equal(ui.c.requesting, true);
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
  await act(async () => decisions.shift()(false));
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
  const key = { key: 'ArrowLeft', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} };
  await act(async () => ui.tab('three').props.onKeyDown(key));
  await act(async () => decisions.shift()(true));
  assert.deepEqual(ui.order(), ['one', 'three', 'two']);
  await ui.run(c => c.undo());
  assert.deepEqual(ui.order(), ['one', 'two', 'three']);
});
