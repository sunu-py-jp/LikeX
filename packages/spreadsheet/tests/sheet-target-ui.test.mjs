import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export {useSpreadsheet} from './src/state/use-spreadsheet'; export {useSpreadsheetHandle} from './src/api/use-spreadsheet-handle'; export {serializeWorkbook} from './src/model/serialization'; export {exportSpreadsheetXlsx} from './src/export/model-export';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'shared-react', setup(b) {
    b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { useSpreadsheet, useSpreadsheetHandle, serializeWorkbook, exportSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=sheet-target-ui-tests.mjs').toString('base64')}`);
const book = () => ({ sheets: ['one', 'two'].map((id, index) => ({ id, name: index ? 'Second' : 'First', rowCount: 5, columnCount: 5, cells: { A1: { value: id } } })) });
async function mount(t, overrides = {}) {
  let controller, renderer, props = { initialWorkbook: book(), onSave() {}, ...overrides }; const ref = createRef(), rendered = [];
  function Probe() { controller = useSpreadsheet(props); rendered.push(controller.activeSheet.id); useSpreadsheetHandle(ref, controller); return null; }
  await act(() => { renderer = create(h(Probe)); });
  t.after(() => act(() => renderer.unmount()));
  return { ref, rendered, get c() { return controller; }, async update(patch) { props = { ...props, ...patch }; await act(() => renderer.update(h(Probe))); } };
}

test('initial ID/name selectors apply on the first render, are read once, and preserve read-only history and dirty state', async t => {
  for (const selectors of [{ initialSheetId: 'two' }, { initialSheetName: 'Second' }, { initialSheetId: 'two', initialSheetName: 'Second' }]) {
    const changes = [], app = await mount(t, { ...selectors, readOnly: true, onSave: undefined, onChange: value => changes.push(value) });
    assert.equal(app.rendered[0], 'two'); assert.equal(app.ref.current.getSelection().sheetId, 'two');
    assert.equal(app.c.error, null); assert.equal(app.c.dirty, false); assert.equal(app.ref.current.getHistoryState().canUndo, false);
    await app.update({ initialSheetId: 'one', initialSheetName: 'First' });
    assert.equal(app.ref.current.getSelection().sheetId, 'two'); assert.equal(changes.length, 0);
  }
});

test('invalid initial targets display the first sheet and report through the existing notice', async t => {
  for (const selectors of [{ initialSheetId: '' }, { initialSheetId: 'missing' }, { initialSheetName: '' },
    { initialSheetName: 'second' }, { initialSheetId: 'one', initialSheetName: 'Second' }]) {
    const app = await mount(t, selectors);
    assert.equal(app.rendered[0], 'one'); assert.equal(app.ref.current.getSelection().sheetId, 'one');
    assert.match(app.c.error, /シート|ID/); assert.equal(app.c.dirty, false); assert.equal(app.c.canUndo, false);
  }
});

test('the existing selectSheet API accepts IDs or exact-name objects and keeps its view-only guards', async t => {
  const app = await mount(t, { readOnly: true, onSave: undefined }), api = app.ref.current;
  await act(() => assert.equal(api.selectSheet({ sheetName: 'Second' }), true));
  assert.equal(api.getSelection().sheetId, 'two');
  await act(() => assert.equal(api.selectSheet({ sheetId: 'one', sheetName: 'First' }), true));
  assert.equal(api.getSelection().sheetId, 'one');
  for (const target of ['', 'missing', {}, null, { sheetName: 'second' }, { sheetId: 'one', sheetName: 'Second' }])
    await act(() => assert.equal(api.selectSheet(target), false));
  assert.equal(api.getSelection().sheetId, 'one'); assert.equal(app.c.dirty, false); assert.equal(app.c.canUndo, false);
  await app.update({ features: { sheets: false } });
  await act(() => assert.equal(api.selectSheet({ sheetName: 'Second' }), false));
  await app.update({ features: {}, readOnly: false, onSave() {} });
  await act(() => app.c.beginEdit({ row: 0, column: 0 }, 'pending'));
  await act(() => assert.equal(api.selectSheet({ sheetName: 'Second' }), false));
  await act(() => app.c.cancelEdit());
  await act(() => api.execute({ type: 'sheets.rename', sheetId: 'two', name: 'Renamed' }));
  await act(() => assert.equal(api.selectSheet({ sheetName: 'Second' }), false));
  await act(() => assert.equal(api.selectSheet({ sheetId: 'two', sheetName: 'Renamed' }), true));
});

test('native import selects the requested view atomically and invalid selectors preserve draft, selection and history', async t => {
  const changeSelections = []; let app;
  app = await mount(t, { initialSheetId: 'two', onChange: () => changeSelections.push(app.ref.current.getSelection().sheetId) });
  const imported = book(); imported.sheets[1].cells.A1.value = 'imported';
  const file = new Blob([serializeWorkbook(imported)]), before = app.ref.current.getWorkbook();
  for (const options of [{ sheetName: 'missing' }, { sheetId: 'one', sheetName: 'Second' }, { sheetId: '' }]) {
    await act(async () => assert.rejects(app.ref.current.importNative(file, options), /シート|ID/));
    assert.equal(app.ref.current.getWorkbook(), before); assert.equal(app.ref.current.getSelection().sheetId, 'two'); assert.equal(app.c.canUndo, false);
  }
  await act(async () => app.ref.current.importNative(file, { sheetId: 'one', sheetName: 'First' }));
  assert.equal(app.ref.current.getSelection().sheetId, 'one'); assert.equal(app.ref.current.getHistoryState().undoCount, 1);
  assert.deepEqual(changeSelections, ['one'], 'Host change callbacks already observe the imported target');
  await act(async () => assert.equal(await app.ref.current.undo(), true));
  assert.equal(app.ref.current.getWorkbook(), before); assert.equal(app.ref.current.getSelection().sheetId, 'two');
  await act(async () => app.ref.current.importNative(new Blob([serializeWorkbook(before)]), { sheetName: 'First' }));
  assert.equal(app.ref.current.getSelection().sheetId, 'one'); assert.equal(app.c.canUndo, false, 'Same-data import target is only view state');
});

test('real Excel import resolves exact names before publishing and snapshots selector options across awaits', async t => {
  const app = await mount(t), imported = book(); imported.sheets[1].cells.A1.value = 'Excel target';
  const file = await exportSpreadsheetXlsx(imported), before = app.ref.current.getWorkbook();
  await act(async () => assert.rejects(app.ref.current.importExcel(file, { sheetName: 'missing' }), /シート/));
  assert.equal(app.ref.current.getWorkbook(), before); assert.equal(app.c.canUndo, false);
  let release; const review = new Promise(resolve => { release = resolve; }); let pending;
  const options = { sheetName: 'Second', onReview: () => review };
  await act(() => { pending = app.ref.current.importExcel(file, options); });
  options.sheetName = 'First';
  await act(async () => { release(true); await pending; });
  const selected = app.ref.current.getWorkbook().sheets.find(sheet => sheet.id === app.ref.current.getSelection().sheetId);
  assert.equal(selected.name, 'Second'); assert.equal(selected.cells.A1.value, 'Excel target');
});
