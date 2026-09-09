import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { CellDataControl } from './src/ui/grid/cell-data-control';
export { useSpreadsheet } from './src/state/use-spreadsheet';`, resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'data-validation-ui-entry.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { CellDataControl, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const initialWorkbook = () => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 10, cells: {
  A1: { value: 'FALSE', validation: { type: 'checkbox', allowBlank: false } },
  B1: { value: 'Draft', validation: { type: 'list', values: ['Draft', 'Complete', '=literal'] } },
} }] });
async function mount(t, options = {}, column = 0) {
  let current, renderer, props = { initialWorkbook: initialWorkbook(), onSave() {}, ...options };
  function Probe() {
    current = useSpreadsheet(props);
    const address = column === 0 ? 'A1' : 'B1';
    return createElement(CellDataControl, { controller: current, cell: current.activeSheet.cells[address], address,
      position: { row: 0, column }, focused: true, editing: !!current.editing });
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; }, get root() { return renderer.root; },
    control: () => renderer.root.findByType(column ? 'select' : 'input'),
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}

test('checkbox edits use the standard lifecycle, with undo/redo retaining the rule', async t => {
  const events = [], ui = await mount(t, { onEvent: event => events.push(event) });
  assert.equal(ui.control().props.checked, false);
  await act(async () => ui.control().props.onChange({ currentTarget: { checked: true } }));
  assert.equal(ui.current.activeSheet.cells.A1.value, 'TRUE'); assert.equal(ui.current.dirty, true);
  assert.equal(ui.control().props.checked, true);
  assert.ok(events.some(event => event.type === 'change'));
  await act(async () => ui.current.undo());
  assert.equal(ui.current.activeSheet.cells.A1.value, 'FALSE'); assert.equal(ui.current.dirty, false);
  assert.equal(ui.current.activeSheet.cells.A1.validation.type, 'checkbox');
  await act(async () => ui.current.redo()); assert.equal(ui.control().props.checked, true);
});

test('checkbox/list controls obey readonly, edit refusal, busy state and feature changes', async t => {
  const ui = await mount(t, { readOnly: true });
  assert.equal(ui.control().props.disabled, true);
  await act(async () => ui.control().props.onChange({ currentTarget: { checked: true } }));
  assert.equal(ui.current.activeSheet.cells.A1.value, 'FALSE');
  await ui.update({ readOnly: false, onEditRequest: () => false });
  await act(async () => ui.control().props.onChange({ currentTarget: { checked: true } }));
  assert.equal(ui.current.activeSheet.cells.A1.value, 'FALSE'); assert.equal(ui.current.dirty, false);
  await act(async () => ui.current.setContextMenuLock({})); assert.equal(ui.control().props.disabled, true);
  await act(async () => ui.current.setContextMenuLock(null));
  await ui.update({ features: { checkboxes: false } }); assert.equal(ui.root.findAllByType('input').length, 0);
  await ui.update({ features: { dataValidation: false } }); assert.equal(ui.root.findAllByType('input').length, 0);
  const result = ui.current.externalExecute({ type: 'cells.set', sheetId: 'main', values: { A1: 'bad' } });
  assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED');
});

test('list choices remain literal text and can be undone without dropping their validation', async t => {
  const ui = await mount(t, {}, 1);
  assert.equal(ui.control().props.value, 'Draft');
  await act(async () => ui.control().props.onChange({ currentTarget: { value: '=literal' } }));
  assert.equal(ui.current.activeSheet.cells.B1.value, "'=literal");
  assert.equal(ui.current.calculated.main.B1, '=literal');
  await act(async () => ui.current.undo()); assert.equal(ui.control().props.value, 'Draft');
  await ui.update({ readOnly: true }); assert.equal(ui.control().props.disabled, true);
  await ui.update({ readOnly: false, features: { dataValidation: false } }); assert.equal(ui.root.findAllByType('select').length, 0);
});

test('rule-only API edits participate in dirty state, history and save snapshots', async t => {
  let saved;
  const ui = await mount(t, { onSave: workbook => { saved = workbook; } });
  await act(async () => {
    const result = await ui.current.externalExecuteAsync({ type: 'cells.validation', sheetId: 'main', addresses: ['C1'], validation: { type: 'textLength', max: 5 } });
    assert.equal(result.ok, true); assert.equal(result.changed, true);
  });
  assert.equal(ui.current.dirty, true); assert.equal(ui.current.activeSheet.cells.C1.validation.type, 'textLength');
  await act(async () => ui.current.undo()); assert.equal(ui.current.activeSheet.cells.C1, undefined);
  await act(async () => ui.current.redo());
  await act(async () => ui.current.save());
  assert.equal(saved.sheets[0].cells.C1.validation.max, 5); assert.equal(ui.current.dirty, false);
});
