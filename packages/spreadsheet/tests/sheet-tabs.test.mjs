import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: 'export { SpreadsheetFooter } from "./src/ui/spreadsheet-footer"; export { useSpreadsheet } from "./src/state/use-spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'sheet-tabs-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetFooter, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const key = name => ({ key: name, nativeEvent: {}, preventDefault() {} });
async function mount(t, overrides = {}) {
  let current, renderer;
  let props = { initialWorkbook: { sheets: ['main', 'other'].map(id => ({ id, name: id, rowCount: 10, columnCount: 5,
    cells: { A1: { value: 'before' } } })) }, onSave() {}, ...overrides };
  function Probe() {
    current = useSpreadsheet(props);
    return createElement(SpreadsheetFooter, { controller: current });
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; }, get root() { return renderer.root; },
    tab: name => renderer.root.findAllByProps({ role: 'tab' }).find(tab => tab.children[0] === name),
    editor: () => renderer.root.findByProps({ 'aria-label': 'シート名' }),
    hasEditor: () => renderer.root.findAllByProps({ 'aria-label': 'シート名' }).length > 0,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}

test('the first click activates a sheet and a later click renames it, with Enter and Escape preserving pending state', async t => {
  const ui = await mount(t);
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.current.activeSheet.id, 'other');
  assert.equal(ui.hasEditor(), false);
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.editor().props.value, 'other');
  assert.equal(ui.current.pendingObjectEdit, false);
  await act(async () => ui.editor().props.onChange({ target: { value: 'cancelled' } }));
  assert.equal(ui.current.pendingObjectEdit, true);
  await act(async () => ui.editor().props.onKeyDown(key('Escape')));
  assert.equal(ui.hasEditor(), false);
  assert.equal(ui.current.pendingObjectEdit, false);
  assert.equal(ui.current.activeSheet.name, 'other');
  assert.equal(ui.current.dirty, false);
  await act(async () => ui.tab('other').props.onClick());
  await act(async () => ui.editor().props.onChange({ target: { value: 'Renamed' } }));
  await act(async () => ui.editor().props.onKeyDown(key('Enter')));
  assert.equal(ui.current.activeSheet.name, 'Renamed');
  assert.equal(ui.tab('Renamed').props['aria-selected'], true);
  assert.equal(ui.hasEditor(), false);
  assert.equal(ui.current.pendingObjectEdit, false);
  assert.equal(ui.current.dirty, true);
});

test('active tab clicks respect readonly, feature settings, and disabled editing while other sheets remain selectable', async t => {
  const ui = await mount(t, { readOnly: true });
  await act(async () => ui.tab('main').props.onClick());
  assert.equal(ui.hasEditor(), false);
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.current.activeSheet.id, 'other');
  await ui.update({ readOnly: false, features: { renameSheet: false } });
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.hasEditor(), false);
  await ui.update({ features: {} });
  await act(async () => ui.current.setContextMenuLock({}));
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.hasEditor(), false);
  await act(async () => ui.current.setContextMenuLock(null));
  await act(async () => ui.tab('other').props.onClick());
  assert.equal(ui.hasEditor(), true);
});

test('renaming an active sheet waits for its edited cell to commit and preserves a denied cell draft', async t => {
  const decisions = [];
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => decisions.push(resolve)) });
  await act(async () => ui.current.beginEdit({ row: 0, column: 0 }, 'edited'));
  await act(async () => ui.tab('main').props.onClick());
  assert.equal(decisions.length, 1);
  assert.equal(ui.current.requesting, true);
  assert.equal(ui.hasEditor(), false);
  await act(async () => ui.tab('main').props.onClick());
  assert.equal(decisions.length, 1, 'a second click while permission is pending does not start another operation');
  await act(async () => decisions[0](false));
  assert.equal(ui.current.editing.value, 'edited');
  assert.equal(ui.hasEditor(), false);
  assert.equal(ui.current.activeSheet.cells.A1.value, 'before');
  await act(async () => ui.tab('main').props.onClick());
  await act(async () => decisions[1](true));
  assert.equal(ui.current.editing, null);
  assert.equal(ui.current.activeSheet.cells.A1.value, 'edited');
  assert.equal(ui.editor().props.value, 'main');
  await act(async () => ui.editor().props.onChange({ target: { value: 'Renamed after commit' } }));
  await act(async () => ui.editor().props.onBlur());
  assert.equal(ui.current.activeSheet.name, 'Renamed after commit');
  assert.equal(ui.current.pendingObjectEdit, false);
});
