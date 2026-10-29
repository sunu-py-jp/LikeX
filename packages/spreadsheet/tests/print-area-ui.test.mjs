import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { useSpreadsheetHandle } from './src/api/use-spreadsheet-handle';
  export { SpreadsheetGrid } from './src/ui/spreadsheet-grid';
  export { SpreadsheetPrintToolbar, parsePrintAreaAddress } from './src/ui/spreadsheet-print-toolbar';
  export { adjustPrintArea, visiblePrintSegments } from './src/ui/grid/print-area-geometry';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useSpreadsheetHandle, SpreadsheetGrid, SpreadsheetPrintToolbar, parsePrintAreaAddress,
  adjustPrintArea, visiblePrintSegments } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const area = { top: 1, left: 1, bottom: 11, right: 4 };
const book = (settings = { area }) => ({ sheets: [{ id: 's', name: 'Report', rowCount: 120, columnCount: 12,
  columnWidths: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index, 80])), cells: { A1: { value: 'Report' } },
  ...(settings ? { printSettings: settings } : {}) }] });

async function mount(t, options = {}) {
  const ref = createRef(), changes = [], modes = []; let renderer, current, props = options;
  const document = { activeElement: null, addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = { ownerDocument: document, isConnected: true, style: {}, scrollTop: 0, scrollLeft: 0, scrollHeight: 3400, clientHeight: 900, clientWidth: 1400,
    closest() { return null; }, addEventListener() {}, removeEventListener() {}, contains(target) { return target?.ownerDocument === document; },
    getBoundingClientRect() { const scale = (current?.zoom ?? 100) / 100; return { left: 0, top: 0, right: 1400 * scale, bottom: 900 * scale, width: 1400 * scale, height: 900 * scale }; },
    focus() { document.activeElement = this; }, blur() {}, setSelectionRange() {}, querySelectorAll() { return []; }, setPointerCapture() {}, releasePointerCapture() {} };
  function Probe() {
    current = useSpreadsheet({ initialWorkbook: book(), onSave() {}, initialPrintAreaView: true,
      onChange: value => changes.push(value), onPrintAreaViewChange: value => modes.push(value), ...props });
    useSpreadsheetHandle(ref, current);
    return createElement('div', null, createElement(SpreadsheetPrintToolbar, { controller: current }), createElement(SpreadsheetGrid, { controller: current }));
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: () => node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, renderer, node, changes, modes, get c() { return current; },
    find(label) { return renderer.root.findAll(item => item.type === 'button' && item.props['aria-label'] === label)[0]; },
    async click(label) { const button = this.find(label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} is enabled`); await act(async () => button.props.onClick()); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
  };
}
const event = (ui, x, y, extra = {}) => ({ currentTarget: ui.node, pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, ...extra });

test('view mode is available read-only, not persisted, notified, and rejects invalid values or unmount', async t => {
  const ui = await mount(t, { onSave: undefined, initialPrintAreaView: false }), api = ui.ref.current, original = api.getWorkbook();
  assert.equal(api.getPrintAreaView(), false);
  await act(async () => assert.equal(api.setPrintAreaView(true), true));
  assert.equal(api.getPrintAreaView(), true); assert.deepEqual(ui.modes, [true]);
  assert.equal(api.setPrintAreaView(true), false); assert.equal(api.setPrintAreaView('yes'), false);
  assert.ok(ui.renderer.root.findByProps({ 'data-print-area': 'B2:E12' }));
  assert.equal(ui.find('印刷範囲の右辺を調整'), undefined);
  assert.equal(ui.renderer.root.findAll(item => item.props['data-print-edge'] !== undefined).length, 0);
  assert.equal(ui.find('印刷範囲を解除').props.disabled, true);
  assert.equal(api.getWorkbook(), original); assert.deepEqual(ui.changes, []); assert.equal(ui.c.canUndo, false);
  await act(async () => ui.renderer.unmount()); assert.equal(api.setPrintAreaView(false), false);
});

test('print range exposes only four draggable edges without corner, midpoint or move handles', async t => {
  const ui = await mount(t);
  const edges = ui.renderer.root.findAll(item => item.type === 'button' && item.props['data-print-edge'] !== undefined);
  assert.deepEqual(edges.map(edge => edge.props['data-print-edge']).sort(), ['bottom', 'left', 'right', 'top']);
  for (const label of ['印刷範囲の上辺を調整', '印刷範囲の右辺を調整', '印刷範囲の下辺を調整', '印刷範囲の左辺を調整'])
    assert.ok(edges.some(edge => edge.props['aria-label'] === label));
  for (const label of ['印刷範囲の左上を調整', '印刷範囲の右上を調整', '印刷範囲の右下を調整', '印刷範囲の左下を調整', '印刷範囲を移動'])
    assert.equal(ui.find(label), undefined);
  assert.equal(ui.renderer.root.findAll(item => typeof item.props.className === 'string' &&
    /(?:^|\s)lxs-print-area-(?:handle|move)(?:\s|$)/.test(item.props.className)).length, 0);
});

test('selected range, A1 adjustment and clear use shared commands, notifications and Undo/Redo', async t => {
  const ui = await mount(t, { initialWorkbook: book(null), initialPrintAreaView: false }), api = ui.ref.current;
  await act(async () => api.selectRange('s', { anchor: { row: 1, column: 1 }, focus: { row: 11, column: 4 } }));
  await ui.click('選択範囲を印刷範囲に設定');
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, area); assert.equal(api.getPrintAreaView(), true);
  const input = ui.renderer.root.findByProps({ 'aria-label': '印刷範囲のセル参照' });
  await act(async () => input.props.onChange({ currentTarget: { value: 'C3:H20' } }));
  await ui.click('印刷範囲を変更');
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, { top: 2, left: 2, bottom: 19, right: 7 });
  await act(async () => assert.equal(await api.undo(), true)); assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, area);
  await act(async () => assert.equal(await api.redo(), true));
  await ui.click('印刷範囲を解除'); assert.equal(api.getWorkbook().sheets[0].printSettings?.area, undefined);
  assert.equal(ui.changes.length, 5);
});

test('invalid range, disabled feature and rejected editing lease never change the workbook', async t => {
  const ui = await mount(t), api = ui.ref.current, original = api.getWorkbook();
  await act(async () => ui.renderer.root.findByProps({ 'aria-label': '印刷範囲のセル参照' }).props.onChange({ currentTarget: { value: 'A1:Z9999' } }));
  await ui.click('印刷範囲を変更'); assert.equal(api.getWorkbook(), original);
  assert.equal(ui.renderer.root.findByProps({ 'aria-label': '印刷範囲のセル参照' }).props['aria-invalid'], true);
  await ui.update({ features: { printArea: false } });
  assert.equal(ui.find('印刷範囲を解除'), undefined); assert.equal(ui.find('印刷範囲の右辺を調整'), undefined);
  assert.ok(ui.renderer.root.findByProps({ 'data-print-area': 'B2:E12' }), 'saved range still renders');
  await ui.update({ features: {}, onEditRequest: () => false });
  await ui.click('印刷範囲を解除'); assert.equal(api.getWorkbook(), original);
});

test('edge drags change only their own axis at multiple zoom levels and commit once on release', async t => {
  for (const zoom of [50, 100, 150]) {
    for (const { label, start, end, address, expected } of [
      { label: '印刷範囲の右辺を調整', start: [448, 200], end: [608, 256], address: 'B2:G12', expected: { ...area, right: 6 } },
      { label: '印刷範囲の下辺を調整', start: [250, 364], end: [410, 420], address: 'B2:E14', expected: { ...area, bottom: 13 } },
    ]) {
      const ui = await mount(t, { initialZoom: zoom }), api = ui.ref.current, original = api.getWorkbook(), scale = zoom / 100;
      await act(async () => ui.find(label).props.onPointerDown(event(ui, start[0] * scale, start[1] * scale)));
      await act(async () => ui.find(label).props.onPointerMove(event(ui, end[0] * scale, end[1] * scale)));
      assert.equal(api.getWorkbook(), original); assert.equal(ui.changes.length, 0);
      assert.ok(ui.renderer.root.findByProps({ 'data-print-area': address }));
      await act(async () => ui.find(label).props.onPointerUp(event(ui, end[0] * scale, end[1] * scale)));
      assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, expected);
      assert.equal(ui.changes.length, 1);
      await act(async () => api.undo()); assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, area);
    }
  }
});

test('Escape cancels preview; workbook changes during drag invalidate the gesture', async t => {
  const ui = await mount(t), api = ui.ref.current, original = api.getWorkbook(), label = '印刷範囲の右辺を調整';
  await act(async () => ui.find(label).props.onPointerDown(event(ui, 448, 200)));
  await act(async () => ui.find(label).props.onPointerMove(event(ui, 608, 256)));
  await act(async () => ui.find(label).props.onKeyDown(event(ui, 0, 0, { key: 'Escape' })));
  await act(async () => ui.find(label).props.onPointerUp(event(ui, 608, 256)));
  assert.equal(api.getWorkbook(), original);
  await act(async () => ui.find(label).props.onPointerDown(event(ui, 448, 200)));
  await act(async () => ui.find(label).props.onPointerMove(event(ui, 608, 256)));
  await act(async () => api.execute({ type: 'cells.set', sheetId: 's', values: { A2: 'newer' } }));
  await act(async () => ui.find(label).props.onPointerUp(event(ui, 608, 256)));
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, area); assert.equal(ui.changes.length, 1);
});

test('closing the page view or changing the sheet during editing permission cancels pending changes', async t => {
  let allow;
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => { allow = resolve; }) }), api = ui.ref.current, original = api.getWorkbook();
  await act(async () => ui.find('印刷範囲の右辺を調整').props.onKeyDown(event(ui, 0, 0, { key: 'ArrowRight' })));
  assert.equal(typeof allow, 'function');
  await act(async () => api.setPrintAreaView(false));
  await act(async () => { allow(true); await Promise.resolve(); });
  assert.equal(api.getWorkbook(), original); assert.equal(ui.changes.length, 0);

  let accept;
  const source = book(); source.sheets.push({ id: 'other', name: 'Other', rowCount: 20, columnCount: 12, cells: {} });
  const toolbar = await mount(t, { initialWorkbook: source, onEditRequest: () => new Promise(resolve => { accept = resolve; }) });
  const before = toolbar.ref.current.getWorkbook();
  await toolbar.click('印刷範囲を解除'); assert.equal(typeof accept, 'function');
  await act(async () => toolbar.ref.current.selectSheet('other'));
  await act(async () => { accept(true); await Promise.resolve(); });
  assert.equal(toolbar.ref.current.getWorkbook(), before); assert.equal(toolbar.changes.length, 0);
});

test('keyboard adjusts individual edges and manual page breaks; page divisions render independently', async t => {
  const ui = await mount(t, { initialWorkbook: book({ area, rowBreaks: [6] }) }), api = ui.ref.current;
  await act(async () => ui.find('印刷範囲の左辺を調整').props.onKeyDown(event(ui, 0, 0, { key: 'ArrowRight' })));
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, { ...area, left: 2 });
  await act(async () => ui.find('印刷範囲の下辺を調整').props.onKeyDown(event(ui, 0, 0, { key: 'ArrowDown' })));
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.area, { ...area, left: 2, bottom: 12 });
  await act(async () => ui.find('7行の前の改ページを移動').props.onKeyDown(event(ui, 0, 0, { key: 'ArrowDown' })));
  assert.deepEqual(api.getWorkbook().sheets[0].printSettings.rowBreaks, [7]);
  assert.ok(ui.renderer.root.findByProps({ 'data-print-break': 'row', 'data-print-break-index': 7 }));
  assert.equal(ui.renderer.root.findAllByProps({ className: 'lxs-print-page-number' }).length, 2);
});

test('A1 parsing, clamped resizing and viewport lookup do not require creating cells', () => {
  assert.deepEqual(parsePrintAreaAddress(' $D$4 : B2 '), { top: 1, left: 1, bottom: 3, right: 3 });
  for (const value of ['A0:C3', 'Sheet1!A1:C3', 'A1,B2', '', 'A1:']) assert.equal(parsePrintAreaAddress(value), null);
  assert.deepEqual(adjustPrintArea(area, 'top', { row: -100, column: 100 }, 120, 12), { ...area, top: 0 });
  assert.deepEqual(adjustPrintArea(area, 'left', { row: 100, column: 100 }, 120, 12), { ...area, left: 4 });
  assert.deepEqual(adjustPrintArea(area, 'bottom', { row: -100, column: 100 }, 120, 12), { ...area, bottom: 1 });
  assert.deepEqual(adjustPrintArea(area, 'right', { row: 100, column: 100 }, 120, 12), { ...area, right: 11 });
  const segments = Array.from({ length: 10000 }, (_, start) => ({ start, end: start })), offsets = Array.from({ length: 10001 }, (_, i) => i * 30);
  const visible = visiblePrintSegments(segments, offsets, 150000, 150090);
  assert.deepEqual(visible.map(item => item.index), [4999, 5000, 5001, 5002, 5003]);
});
