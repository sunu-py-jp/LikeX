import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: {
  contents: 'export { useSpreadsheet } from "./src/state/use-spreadsheet"; export { SpreadsheetDimensionDialog } from "./src/ui/spreadsheet-dimension-dialog";',
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useSpreadsheet, SpreadsheetDimensionDialog } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t) {
  let controller, renderer, permission, resolvePermission;
  let visible = true, features = {};
  const initialWorkbook = { sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8, cells: {} }] };
  const target = { axis: 'row', sheetId: 'one', revision: 0, selection: {
    sheetId: 'one', anchor: { row: 0, column: 0 }, focus: { row: 0, column: 7 },
    ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 7 } }],
  } };
  function Probe() {
    controller = useSpreadsheet({ initialWorkbook, onSave() {}, features,
      onEditRequest(_request, operation) {
        permission = operation;
        return new Promise(resolve => { resolvePermission = resolve; });
      } });
    return visible && controller.features.resize ? createElement(SpreadsheetDimensionDialog, { controller, target, onClose() {} }) : null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const dialog = () => renderer.root.find(instance => typeof instance.type === 'function' && instance.type.name === 'SpreadsheetDialog');
  return {
    get c() { return controller; }, get permission() { return permission; },
    async apply() {
      const input = () => dialog().props.children[0].props.children.find(child => child?.type === 'input');
      await act(async () => input().props.onChange({ target: { value: '60' } }));
      await act(async () => dialog().props.actions.props.children[1].props.onClick());
    },
    async disableResize() { features = { resize: false }; await act(async () => renderer.update(createElement(Probe))); },
    async hide() { visible = false; await act(async () => renderer.update(createElement(Probe))); },
    async grant() { await act(async () => { resolvePermission(true); }); },
  };
}

test('disabling dimensions during permission cancels the form request and prevents a stranded editing lease', async t => {
  const ui = await mount(t);
  const before = ui.c.getWorkbook();
  await ui.apply();
  assert.equal(ui.c.requesting, true);
  assert.equal(ui.permission.signal.aborted, false);
  await ui.disableResize();
  assert.equal(ui.permission.signal.aborted, true);
  assert.equal(ui.c.editMode, 'view');
  await ui.grant();
  assert.equal(ui.c.getWorkbook(), before);
  assert.equal(ui.c.editMode, 'view');
  assert.equal(ui.c.canUndo, false);
});

test('removing an idle dimension form does not cancel another edit permission request', async t => {
  const ui = await mount(t);
  let pending;
  await act(async () => { pending = ui.c.requestEdit({ action: 'external-operation', source: 'api' }); });
  await ui.hide();
  assert.equal(ui.permission.signal.aborted, false);
  assert.equal(ui.c.requesting, true);
  await ui.grant();
  assert.equal(await pending, true);
  assert.equal(ui.c.editMode, 'edit');
});
