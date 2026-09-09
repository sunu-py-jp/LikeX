import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { SpreadsheetMergeToolbar } from './src/ui/spreadsheet-merge-toolbar';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'merge-toolbar.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, SpreadsheetMergeToolbar } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, overrides = {}, cells = { A1: { value: 'Keep' } }) {
  let c, renderer;
  const changes = [], saves = [];
  function Probe() {
    c = useSpreadsheet({ initialWorkbook: { sheets: [{ id: 's', name: 'Data', rowCount: 20, columnCount: 8, cells }] },
      onChange: wb => changes.push(wb), onSave: wb => { saves.push(wb); }, ...overrides });
    return createElement(SpreadsheetMergeToolbar, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return c; }, get root() { return renderer.root; }, changes, saves,
    select: async () => act(async () => c.selectRange({ row: 0, column: 0 }, { row: 0, column: 2 })),
    click: async label => act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onClick()),
    confirm: async () => act(async () => renderer.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick()),
  };
}

test('merge/unmerge are undoable JSON draft changes with no confirmation for empty covered cells', async t => {
  const ui = await mount(t);
  await ui.select(); await ui.click('セルを結合');
  assert.deepEqual(ui.c.activeSheet.merges, [{ top: 0, left: 0, bottom: 0, right: 2 }]);
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.equal(ui.c.dirty, true);
  assert.equal(ui.changes.length, 1);
  await ui.click('結合を解除');
  assert.equal(ui.c.activeSheet.merges?.length ?? 0, 0);
  assert.equal(ui.c.activeSheet.cells.A1.value, 'Keep');
  await act(async () => ui.c.undo());
  assert.equal(ui.c.activeSheet.merges.length, 1);
  await act(async () => ui.c.save());
  assert.equal(JSON.parse(JSON.stringify(ui.saves[0])).sheets[0].merges[0].right, 2);
  assert.equal(ui.c.dirty, false);
});

test('conflicting content is not discarded until confirmation; Undo restores it', async t => {
  const ui = await mount(t, {}, { A1: { value: 'Keep' }, B1: { value: '=1+2', format: { bold: true } } });
  await ui.select(); const before = ui.c.workbook;
  await ui.click('セルを結合');
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 1);
  assert.equal(ui.c.workbook, before); assert.equal(ui.changes.length, 0);
  await ui.confirm();
  assert.equal(ui.c.activeSheet.cells.B1.value, '');
  assert.equal(ui.c.activeSheet.cells.B1.format.bold, true);
  assert.equal(ui.changes.length, 1);
  await act(async () => ui.c.undo());
  assert.equal(ui.c.activeSheet.cells.B1.value, '=1+2');
});

test('Escape and backdrop click cancel without altering the workbook', async t => {
  const ui = await mount(t, {}, { A1: { value: 'Keep' }, B1: { value: 'Keep too' } });
  await ui.select(); const before = ui.c.workbook;
  await ui.click('セルを結合');
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-backdrop' }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {}, stopPropagation() {} }));
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  await ui.click('セルを結合');
  const backdrop = {};
  await act(async () => ui.root.findByProps({ className: 'lxs-dialog-backdrop' }).props.onPointerDown({ target: backdrop, currentTarget: backdrop, stopPropagation() {} }));
  assert.equal(ui.c.workbook, before); assert.equal(ui.changes.length, 0);
});

test('confirmation checks the draft after committing the current cell edit', async t => {
  const ui = await mount(t);
  await ui.select(); await act(async () => ui.c.beginEdit({ row: 0, column: 1 }, 'new value'));
  await ui.click('セルを結合');
  assert.equal(ui.c.activeSheet.cells.B1.value, 'new value');
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 1);
  await ui.confirm();
  assert.equal(ui.c.activeSheet.cells.B1, undefined);
  assert.equal(ui.c.activeSheet.merges.length, 1);
});

test('a stale confirmation cannot discard a newer draft', async t => {
  const ui = await mount(t, {}, { A1: { value: 'Keep' }, B1: { value: 'Other' } });
  await ui.select(); await ui.click('セルを結合');
  await act(async () => ui.c.writeValues({ B1: 'Newer' }));
  const newer = ui.c.workbook;
  await ui.confirm();
  assert.equal(ui.c.workbook, newer); assert.match(ui.c.error, /確認中にブック/);
});

test('single-cell and disjoint selections cannot merge, while feature-off/readonly hide commands', async t => {
  const ui = await mount(t);
  assert.equal(ui.root.findByProps({ 'aria-label': 'セルを結合' }).props.disabled, true);
  await ui.select(); await act(async () => ui.c.select({ row: 5, column: 5 }, false, true));
  const before = ui.c.workbook;
  await ui.click('セルを結合'); assert.equal(ui.c.workbook, before);
  assert.equal(ui.root.findByProps({ 'aria-label': '結合を解除' }).props.disabled, true);
  for (const props of [{ features: { mergeCells: false } }, { onSave: undefined }]) {
    const hidden = await mount(t, props);
    assert.equal(hidden.root.findAllByProps({ 'aria-label': 'セルを結合' }).length, 0);
  }
});
