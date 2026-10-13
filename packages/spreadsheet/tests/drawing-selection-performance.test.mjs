import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: `export { SpreadsheetDrawings } from './ui/spreadsheet-drawings';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { SpreadsheetDrawings } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const initialGeometry = { columnOffsets: [48, 148, 248, 348], rowOffsets: [28, 56, 84, 112] };
const anchor = (column, row = 0) => ({ column, row, offsetX: 0, offsetY: 0 });
const label = index => ({ id: `text-${index}`, type: 'text', anchor: anchor(0), width: 100, height: 30,
  text: 'long imported label', fontSize: 16, textAutoFit: 'shrink', textWrap: 'none', textInsets: { left: 0, right: 0, top: 0, bottom: 0 } });
const line = index => ({ id: `line-${index}`, type: 'shape', shape: 'line', anchor: anchor(0), width: 200, height: 28,
  fill: 'transparent', stroke: '#000000', strokeWidth: 1, routing: 'elbow', line: { start: { anchor: anchor(0) }, end: { anchor: anchor(2, 1) } } });

async function mount(t, items, renderingMode = 'progressive') {
  let styleReads = 0, drawingScans = 0, renderer, geometry = initialGeometry;
  const trackDrawings = drawings => new Proxy(drawings, { get(target, key, receiver) {
    if (key === 'find') return predicate => { drawingScans++; return target.find(predicate); };
    return Reflect.get(target, key, receiver);
  } });
  let sheet = { id: 's', name: 'Sheet', rowCount: 3, columnCount: 3, cells: {}, drawings: trackDrawings(items) };
  let workbook = { sheets: [sheet] };
  let controller = { activeSheet: sheet, workbook, getWorkbook: () => workbook,
    selectedDrawingId: null, selectionFocus: false, disabled: false, requesting: false, readOnly: false, zoom: 100,
    renderingMode, features: { textBoxes: true, shapes: true, images: true, resize: true },
    selectDrawing() {}, selection: { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } } };
  let viewport = { left: 0, top: 0, width: 400, height: 200 };
  const doc = { activeElement: null, defaultView: { getComputedStyle(node) {
    styleReads++;
    return node.text ? { width: `${parseFloat(node.style.fontSize) * 20}px`, height: '20px' }
      : { width: '100px', height: '30px', boxSizing: 'border-box', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' };
  } } };
  const render = () => createElement(SpreadsheetDrawings, { controller, geometry, viewport });
  await act(async () => { renderer = create(render(), { createNodeMock: node => ({ text: node.type === 'span', style: { fontSize: '', width: '' }, ownerDocument: doc }) }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    get root() { return renderer.root; }, get styleReads() { return styleReads; }, get drawingScans() { return drawingScans; },
    resetCounts() { styleReads = 0; drawingScans = 0; },
    async update(patch) { controller = { ...controller, ...patch }; await act(async () => renderer.update(render())); },
    async scroll(top) { viewport = { ...viewport, top }; await act(async () => renderer.update(render())); },
    async replaceDrawing(id, patch) {
      sheet = { ...sheet, drawings: trackDrawings(sheet.drawings.map(item => item.id === id ? { ...item, ...patch } : item)) };
      workbook = { ...workbook, sheets: [sheet] };
      await this.update({ workbook, activeSheet: sheet });
    },
    async resizeColumns() { geometry = { ...geometry, columnOffsets: [48, 168, 288, 408] }; await act(async () => renderer.update(render())); },
  };
}

test('selecting cells or objects does not remeasure unchanged imported shrink-to-fit text', async t => {
  const ui = await mount(t, Array.from({ length: 100 }, (_, index) => label(index)));
  assert.ok(ui.styleReads >= 1_300, 'fixture exercises binary-search text fitting, not just ordinary text');
  ui.resetCounts();
  for (let index = 0; index < 5; index++) await ui.update({ selection: { anchor: { row: 0, column: index % 3 }, focus: { row: 0, column: index % 3 } } });
  await ui.update({ selectedDrawingId: 'text-4' });
  assert.match(ui.root.findByProps({ 'data-lxs-drawing': 'text-4' }).props.className, /lxs-drawing-selected/);
  await ui.update({ requesting: true });
  assert.equal(ui.styleReads, 0, 'selection and menu/permission state must not force text layouts');
  await ui.replaceDrawing('text-4', { text: 'changed imported label' });
  assert.ok(ui.styleReads > 0, 'a real text edit still recalculates its fit');
  assert.ok(ui.styleReads < 30, 'other text boxes retain their measured layout');
});

test('selection and viewport scrolling reuse connector routes without scanning every drawing again', async t => {
  const ui = await mount(t, [...Array.from({ length: 100 }, (_, index) => line(index)), label(0)], 'viewport');
  assert.ok(ui.drawingScans >= 200, 'initial rendering resolves routes from the drawing model');
  const path = () => ui.root.findByProps({ 'data-lxs-drawing': 'line-0' }).findAllByType('polyline')[0].props.points;
  const before = path();
  ui.resetCounts();
  await ui.update({ selectedDrawingId: 'line-0' });
  await ui.scroll(20);
  await ui.update({ requesting: true });
  assert.equal(ui.drawingScans, 0, 'no unchanged connector route/endpoint is recomputed');
  assert.equal(ui.styleReads, 0, 'scrolling keeps the text fit too');
  assert.equal(path(), before);
  await ui.resizeColumns();
  assert.ok(ui.drawingScans > 0);
  assert.notEqual(path(), before, 'column resizing still repositions cell-anchored connectors');
});
