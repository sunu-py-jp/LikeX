import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({
  stdin: { contents: `export { gridDrawingFocusBounds } from './ui/grid/use-grid-focus'; export { getDrawingBounds } from './model/drawing-placement'; export { sheetDrawingGeometry } from './model/lines';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const anchor = (row, column, offsetX = 0, offsetY = 0) => ({ row, column, offsetX, offsetY });
const shape = (id, patch = {}) => ({ id, type: 'shape', shape: 'rectangle', anchor: anchor(25, 8, 0.25, 0.75), width: 123.5, height: 46.25,
  fill: '#ffffff', stroke: '#000000', strokeWidth: 1, ...patch });
const source = shape('source', { rotation: 25 }), target = shape('target', { anchor: anchor(50, 15), shape: 'roundedRectangle', rotation: 270 });
const drawings = [source, target, shape('quarter', { rotation: 90 }), shape('legacy', { shape: 'line', rotation: 35 }),
  shape('straight', { shape: 'line', line: { start: { anchor: anchor(10, 3, 0.5) }, end: { anchor: anchor(70, 20, 0.25) } } }),
  shape('elbow', { shape: 'line', routing: 'elbow', line: {
    start: { anchor: anchor(0, 0), binding: { targetId: 'source', port: 'right' } },
    end: { anchor: anchor(0, 0), binding: { targetId: 'target', port: 'top' } },
  } }),
  { id: 'text', type: 'text', anchor: anchor(13, 6), width: 112, height: 38, text: 'label', rotation: 270 },
];
const sheet = { id: 's', name: 'Sheet', rowCount: 10_000, columnCount: 1_000,
  rowHeights: { 0: 24.5, 13: 41.5, 24: 30 }, columnWidths: { 0: 78.5, 5: 62.25, 14: 99.5 }, cells: {}, drawings };
const workbook = { sheets: [sheet] };
const grid = m.sheetDrawingGeometry(sheet);
const geometry = { columnOffsets: grid.columns.map(value => value + 48), rowOffsets: grid.rows.map(value => value + 28) };

test('grid reveal bounds match public model bounds for rotation, fractional dimensions, and bound elbow routes', () => {
  for (const drawing of drawings) {
    const expected = m.getDrawingBounds(workbook, 's', drawing.id);
    const actual = m.gridDrawingFocusBounds(sheet, drawing.id, geometry);
    for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
      const translated = expected[key] + (['left', 'right'].includes(key) ? 48 : ['top', 'bottom'].includes(key) ? 28 : 0);
      assert.ok(Math.abs(actual[key] - translated) < 1e-7, `${drawing.id}: ${key} must preserve reveal position`);
    }
  }
});

test('revealing an object reads only its cached offsets instead of rescanning 10,000 row dimensions', () => {
  const dimensionTrap = new Proxy({}, { get() { throw new Error('row/column sizes must use the existing grid geometry'); }, ownKeys() { throw new Error('do not enumerate dimensions'); } });
  const prepared = { ...sheet, rowHeights: dimensionTrap, columnWidths: dimensionTrap };
  let offsetReads = 0;
  const track = offsets => new Proxy(offsets, { get(target, key, receiver) {
    if (/^\d+$/.test(String(key))) offsetReads++;
    return Reflect.get(target, key, receiver);
  } });
  const cached = { columnOffsets: track(geometry.columnOffsets), rowOffsets: track(geometry.rowOffsets) };
  for (const drawing of drawings) m.gridDrawingFocusBounds(prepared, drawing.id, cached);
  assert.ok(offsetReads < 50, `only selected anchors and connection targets are read, got ${offsetReads}`);
});

test('public model bounds still reject malformed dimensions and duplicate drawing IDs', () => {
  assert.throws(() => m.getDrawingBounds({ sheets: [{ ...sheet, rowHeights: { 0: -1 } }] }, 's', 'source'), /サイズ/);
  assert.throws(() => m.getDrawingBounds({ sheets: [{ ...sheet, drawings: [source, source] }] }, 's', 'source'), /同じ ID/);
});
