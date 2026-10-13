import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: `export * from './model-entry'; export * from './state/use-spreadsheet'; export * from './ui/spreadsheet-drawings'; export * from './ui/drawings/drawing-viewport';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const geometry = { columnOffsets: Array.from({ length: 21 }, (_, i) => 48 + i * 100), rowOffsets: Array.from({ length: 101 }, (_, i) => 28 + i * 28) };
const grid = { columns: geometry.columnOffsets.map(x => x - 48), rows: geometry.rowOffsets.map(y => y - 28) };
const viewport = { left: 0, top: 0, width: 400, height: 200 };
const shape = (id, row, column = 0, patch = {}) => ({ id, type: 'shape', shape: 'rectangle', anchor: { row, column, offsetX: 0, offsetY: 0 }, width: 100, height: 60, fill: '#ffffff', stroke: '#000000', strokeWidth: 1, ...patch });
const sheet = drawings => ({ id: 's', name: 'Sheet', rowCount: 100, columnCount: 20, cells: {}, drawings });
const visible = (drawing, currentSheet = sheet([drawing]), box = viewport, overscan = 0) =>
  m.drawingBoundsIntersectViewport(m.drawingViewportBounds(drawing, currentSheet, geometry, grid), box, overscan);

test('viewport paint bounds include rotation, negative offsets, overscan, and horizontal scrolling', () => {
  assert.equal(visible(shape('near', 0)), true);
  assert.equal(visible(shape('far', 30)), false);
  assert.equal(visible(shape('right', 0, 8)), false);
  assert.equal(visible(shape('right', 0, 8), undefined, { ...viewport, left: 800 }), true);
  const rotated = shape('rotated', 0, 5, { width: 20, height: 400, rotation: 90, anchor: { row: 0, column: 5, offsetX: 0, offsetY: -100 } });
  assert.equal(visible(rotated), true, 'rotated height extends left into the viewport');
  assert.equal(visible({ ...rotated, rotation: 0 }), false);
  assert.equal(visible(shape('overscan', 10), undefined, viewport, 200), true);
  assert.equal(visible(shape('overscan', 10)), false);
  assert.equal(visible(shape('offset', 30, 0, { anchor: { row: 30, column: 0, offsetX: 0, offsetY: -840 } })), true);
});

test('unclipped text is retained only along axes where it can paint beyond its frame', () => {
  const overflow = shape('text', 0, 12, { text: 'a long label', textOverflow: 'overflow' });
  assert.equal(visible(overflow), true);
  assert.equal(visible({ ...overflow, text: '' }), false);
  assert.equal(visible({ ...overflow, anchor: { ...overflow.anchor, row: 30 } }), false, 'vertical clip remains effective');
  assert.equal(visible({ ...overflow, anchor: { ...overflow.anchor, row: 30 }, textVerticalOverflow: 'overflow' }), true);
  const quarterTurn = shape('quarter-turn', 30, 0, { text: 'vertical label', rotation: 90, textOverflow: 'overflow' });
  assert.equal(visible(quarterTurn), true, 'unbounded text direction rotates without Infinity * 0 becoming NaN');
  assert.equal(visible({ ...quarterTurn, anchor: { ...quarterTurn.anchor, column: 12 } }), false);
});

test('a connector crossing the viewport is kept even when its stored frame and both endpoints are outside', () => {
  const line = shape('line', 50, 15, { shape: 'line', line: {
    start: { anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 } },
    end: { anchor: { row: 0, column: 10, offsetX: 0, offsetY: 0 } },
  } });
  const middle = { left: 300, top: 0, width: 100, height: 100 };
  assert.equal(visible(line, undefined, middle), true);
  assert.equal(visible(line, undefined, { ...middle, top: 400 }), false);
});

test('automatic elbow routes resolve against offscreen targets and current target geometry', () => {
  const source = shape('source', 0, 0), target = shape('target', 0, 10);
  let wb = m.normalizeWorkbook({ sheets: [sheet([source, target])] });
  let result = m.applySpreadsheetCommands(wb, [{ type: 'lines.insert', sheetId: 's', routing: 'elbow',
    start: { x: 0, y: 0, binding: { targetId: 'source', port: 'right' } },
    end: { x: 0, y: 0, binding: { targetId: 'target', port: 'left' } } }]);
  assert.equal(result.ok, true);
  wb = result.workbook;
  const current = wb.sheets[0], line = current.drawings.at(-1);
  assert.equal(visible(line, current, { left: 500, top: 0, width: 100, height: 100 }), true);
  result = m.applySpreadsheetCommands(wb, [{ type: 'shapes.update', sheetId: 's', drawingId: 'source', patch: { anchor: { row: 40, column: 0, offsetX: 0, offsetY: 0 } } },
    { type: 'shapes.update', sheetId: 's', drawingId: 'target', patch: { anchor: { row: 40, column: 10, offsetX: 0, offsetY: 0 } } }]);
  assert.equal(result.ok, true);
  assert.equal(visible(line, result.workbook.sheets[0], { left: 500, top: 0, width: 100, height: 100 }), false);
  assert.equal(visible(line, result.workbook.sheets[0], { left: 500, top: 1120, width: 100, height: 100 }), true);
});

test('an automatic elbow detour remains visible outside the endpoint bounding rectangle', () => {
  const wb = m.normalizeWorkbook({ sheets: [sheet([shape('source', 10), shape('target', 10, 10)])] });
  const result = m.applySpreadsheetCommands(wb, [{ type: 'lines.insert', sheetId: 's', routing: 'elbow',
    start: { x: 0, y: 0, binding: { targetId: 'source', port: 'top' } },
    end: { x: 0, y: 0, binding: { targetId: 'target', port: 'top' } } }]);
  assert.equal(result.ok, true);
  const current = result.workbook.sheets[0], line = current.drawings.at(-1);
  const route = m.getSpreadsheetLineRoute(current, line.id, grid);
  const detour = Math.min(...route.points.map(point => point.y));
  const endpoints = m.getSpreadsheetLinePoints(current, line.id, grid);
  assert.ok(detour < Math.min(endpoints.start.y, endpoints.end.y) - 8);
  assert.equal(visible(line, current, { left: 500, top: detour + 28 - 1, width: 20, height: 2 }), true);
});

async function mount(t) {
  let c, renderer, mode = 'viewport', box = viewport;
  const initialWorkbook = { sheets: [sheet([shape('near-back', 0), shape('far', 50), shape('near-front', 1)])] };
  function Probe() {
    c = m.useSpreadsheet({ initialWorkbook, onSave() {} });
    return createElement(m.SpreadsheetDrawings, { controller: { ...c, renderingMode: mode }, geometry, viewport: box });
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return c; }, get root() { return renderer.root; },
    ids: () => renderer.root.findAll(node => !!node.props['data-lxs-drawing']).map(node => node.props['data-lxs-drawing']),
    async update(nextMode, nextBox = box) { mode = nextMode; box = nextBox; await act(async () => renderer.update(createElement(Probe))); } };
}

test('viewport mode culls only rendered objects, preserves stacking order and restores them when scrolling', async t => {
  const ui = await mount(t), before = ui.c.workbook;
  assert.deepEqual(ui.ids(), ['near-back', 'near-front']);
  await ui.update('viewport', { ...viewport, top: 1400 });
  assert.deepEqual(ui.ids(), ['far']);
  assert.equal(ui.c.workbook, before);
  await ui.update('progressive');
  assert.deepEqual(ui.ids(), ['near-back', 'far', 'near-front']);
  await ui.update('viewport', viewport);
  assert.deepEqual(ui.ids(), ['near-back', 'near-front']);
});

test('offscreen selected objects and their text editor remain mounted through scrolling and mode changes', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('far'));
  assert.deepEqual(ui.ids(), ['near-back', 'far', 'near-front']);
  await act(async () => ui.root.findByProps({ 'data-lxs-drawing': 'far' }).props.onDoubleClick());
  assert.equal(ui.root.findAllByType('textarea').length, 1);
  const editor = ui.root.findByType('textarea');
  await ui.update('progressive');
  assert.equal(ui.root.findByType('textarea'), editor);
  await ui.update('viewport', { ...viewport, left: 1400 });
  assert.equal(ui.root.findByType('textarea'), editor);
  assert.deepEqual(ui.ids(), ['far']);
});
