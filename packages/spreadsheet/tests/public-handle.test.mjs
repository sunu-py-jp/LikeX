import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: Spreadsheet, prepareSpreadsheetImage, serializeWorkbook, parseWorkbook, workbooksEqual } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const initialWorkbook = () => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 20, columnCount: 8, cells: { A1: { value: 'before' } } }] });
const image = { name: 'sample.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };

async function mount(t, overrides = {}) {
  const ref = createRef();
  let renderer, unmounted = false;
  let props = { initialWorkbook: initialWorkbook(), onSave: () => {}, ...overrides, ref };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); } };
}

test('the public component ref batches explicit cell, row, image and shape operations into one change and one undo', async t => {
  const changes = [];
  let saves = 0;
  const view = await mount(t, { onChange: value => changes.push(value), onSave: () => { saves++; } });
  const api = view.ref.current;
  let result;
  await act(async () => {
    result = api.batch([
      { type: 'cells.set', sheetId: 'main', values: { A1: 'after', B2: '1200', C2: '=B2*2' } },
      { type: 'rows.insert', sheetId: 'main', index: 4, count: 2 },
      { type: 'images.insert', sheetId: 'main', resource: image, anchor: { row: 4, column: 1 }, width: 80, height: 40 },
      { type: 'shapes.insert', sheetId: 'main', shape: 'rectangle', anchor: { row: 8, column: 1 } },
    ]);
    assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'after', 'the snapshot is current before React rerenders');
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.results.length, 4);
  assert.ok(result.results[2].drawingId);
  assert.ok(result.results[2].resourceId);
  assert.ok(result.results[3].drawingId);
  assert.equal(changes.length, 1);
  assert.equal(saves, 0);
  assert.equal(view.root.findAllByProps({ 'aria-label': 'C2 2400' }).length, 1);
  assert.equal(api.getWorkbook().sheets[0].rowCount, 22);
  assert.deepEqual(api.getWorkbook().sheets[0].drawings[0].anchor, { row: 4, column: 1, offsetX: 0, offsetY: 0 });
  assert.equal(workbooksEqual(parseWorkbook(serializeWorkbook(api.getWorkbook())), api.getWorkbook()), true);
  await act(async () => view.root.findByProps({ 'aria-label': '元に戻す' }).props.onClick());
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'before');
  assert.equal(api.getWorkbook().sheets[0].rowCount, 20);
  assert.equal(api.getWorkbook().sheets[0].drawings?.length ?? 0, 0);
  assert.equal(changes.length, 2);
  assert.strictEqual(view.ref.current, api);
});

test('a retained public handle respects current props, pending GUI input and component lifetime', async t => {
  const view = await mount(t);
  const api = view.ref.current;
  await act(async () => {
    view.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'unfinished' } });
    assert.equal(api.execute({ type: 'cells.set', sheetId: 'main', values: { B1: 'blocked' } }).code, 'PENDING_EDIT');
  });
  assert.equal(api.getWorkbook().sheets[0].cells.B1, undefined);
  assert.equal(view.root.findByProps({ 'aria-label': 'A1の値' }).props.value, 'unfinished');
  await act(async () => view.root.findByProps({ 'aria-label': 'A1の値' }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {} }));
  await view.update({ readOnly: true });
  assert.equal(api.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'blocked' } }).code, 'READ_ONLY');
  await view.update({ readOnly: false, features: { shapes: false } });
  assert.equal(api.execute({ type: 'shapes.insert', sheetId: 'main', shape: 'rectangle', anchor: { row: 0, column: 0 } }).code, 'FEATURE_DISABLED');
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0, 'external rejections are returned to the host');
  assert.strictEqual(view.ref.current, api);
  await view.unmount();
  assert.equal(view.ref.current, null);
  assert.equal(api.execute({ type: 'cells.set', sheetId: 'main', values: { A1: 'blocked' } }).code, 'NOT_MOUNTED');
});

test('image preparation is available from the same public entry and rejects URLs without fetching', async () => {
  assert.equal(typeof prepareSpreadsheetImage, 'function');
  await assert.rejects(prepareSpreadsheetImage('https://example.invalid/image.png'), /File または Blob/);
});

test('selection APIs expose cells, disjoint ranges, axes, sheets and drawings without workbook/history changes', async t => {
  const changes = [], selections = [], events = [];
  const initial = initialWorkbook();
  initial.sheets[0].merges = [{ top: 1, left: 1, bottom: 2, right: 2 }];
  initial.sheets.push({ id: 'other', name: 'Other', rowCount: 10, columnCount: 6, cells: {}, drawings: [{
    id: 'drawing', type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 2, offsetX: 0, offsetY: 0 },
    width: 100, height: 60, fill: '#fff', stroke: '#000', strokeWidth: 1,
  }] });
  const view = await mount(t, { initialWorkbook: initial, onChange: value => changes.push(value),
    onSelectionChange: value => selections.push(value), onEvent: event => events.push(event), readOnly: true });
  const api = view.ref.current, workbook = api.getWorkbook(), history = api.getHistoryState();
  await act(async () => {
    assert.equal(api.selectCell('main', { row: 2, column: 2 }), true);
    assert.deepEqual(api.getSelection().focus, { row: 1, column: 1 });
    assert.deepEqual(api.getSelection().ranges, [{ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } }]);
  });
  const ranges = [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } },
    { anchor: { row: 7, column: 4 }, focus: { row: 6, column: 3 } }];
  await act(async () => assert.equal(api.selectRanges('main', ranges), true));
  ranges[0].anchor.row = 19;
  const snapshot = api.getSelection(); snapshot.ranges[0].anchor.row = 18;
  assert.equal(api.getSelection().ranges[0].anchor.row, 0);
  await act(async () => assert.equal(api.selectRows('main', 2, 3), true));
  assert.equal(api.getSelection().ranges[0].kind, 'row');
  assert.deepEqual(api.getSelection().ranges[0].anchor, { row: 2, column: 7 });
  await act(async () => assert.equal(api.selectColumns('main', 2, 2), true));
  assert.equal(api.getSelection().ranges[0].kind, 'column');
  assert.equal(api.getSelection().focus.column, 2, 'header selection does not expand into the merge anchor outside this column');
  await act(async () => assert.equal(api.selectSheet('other'), true));
  await act(async () => assert.equal(api.selectDrawing('other', 'drawing'), true));
  assert.deepEqual(api.getSelectedDrawing(), { sheetId: 'other', drawingId: 'drawing' });
  await act(async () => assert.equal(api.clearSelection(), true));
  assert.equal(api.getSelectedDrawing(), null);
  assert.equal(api.getSelection().ranges.length, 1);
  assert.strictEqual(api.getWorkbook(), workbook);
  assert.deepEqual(api.getHistoryState(), history);
  assert.equal(changes.length, 0);
  assert.equal(events.filter(event => event.type === 'change').length, 0);
  assert.ok(selections.length > 1);
});

test('selection APIs reject invalid/disabled targets and preserve unfinished cell/object input', async t => {
  const view = await mount(t), api = view.ref.current;
  const before = api.getSelection();
  for (const action of [() => api.selectSheet('missing'), () => api.selectCell('main', { row: -1, column: 0 }),
    () => api.selectCell('main', { row: NaN, column: 0 }), () => api.selectCell('main', { row: 0, column: 8 }),
    () => api.selectRanges('main', []), () => api.selectRows('main', 0, 20),
    () => api.selectRange('main', { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } }, { reveal: 'yes' }),
    () => api.selectDrawing('main', 'missing')]) assert.equal(action(), false);
  assert.deepEqual(api.getSelection(), before);
  await act(async () => view.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'unfinished' } }));
  assert.equal(api.selectCell('main', { row: 1, column: 1 }), false);
  assert.equal(api.clearSelection(), false);
  assert.equal(api.revealSelection(), false);
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'before');
  assert.equal(api.getHistoryState().undoCount, 0);
  await act(async () => view.root.findByProps({ 'aria-label': 'A1の値' }).props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} }));
  assert.equal(api.getWorkbook().sheets[0].cells.A1.value, 'unfinished', 'GUI navigation still commits before using the shared selection path');
  assert.equal(api.getSelection().focus.row, 1);
  let drawingId;
  await act(async () => { drawingId = api.execute({ type: 'shapes.insert', sheetId: 'main', shape: 'rectangle', anchor: { row: 3, column: 3 } }).results[0].drawingId; });
  await act(async () => assert.equal(api.selectDrawing('main', drawingId), true));
  await act(async () => view.root.findByProps({ 'aria-label': '幅' }).props.onChange({ target: { value: '240' } }));
  assert.equal(api.selectSheet('main'), false);
  assert.equal(api.clearSelection(), false);
  await act(async () => view.root.findByProps({ 'aria-label': '幅' }).props.onBlur());
  await act(async () => assert.equal(api.selectCell('main', { row: 0, column: 0 }), true));
  await view.update({ features: { shapes: false } });
  assert.equal(api.selectDrawing('main', drawingId), false);
  await view.unmount();
  assert.equal(api.selectCell('main', { row: 1, column: 1 }), false);
  assert.equal(api.revealSelection(), false);
});

test('selection sheet switching obeys the current sheets feature before React rerenders', async t => {
  const initial = initialWorkbook();
  initial.sheets.push({ id: 'other', name: 'Other', rowCount: 8, columnCount: 4, cells: {} });
  const view = await mount(t, { initialWorkbook: initial, features: { sheets: false } }), api = view.ref.current;
  assert.equal(api.selectSheet('other'), false);
  assert.equal(api.selectCell('other', { row: 0, column: 0 }), false);
  await view.update({ features: { sheets: true } });
  await act(async () => {
    assert.equal(api.selectSheet('other'), true);
    assert.equal(api.selectRows('other', 2), true);
    assert.equal(api.getSelection().sheetId, 'other');
    assert.equal(api.getSelection().focus.row, 2);
  });
});
