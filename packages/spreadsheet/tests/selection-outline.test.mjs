import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './src/ui/grid/selection-outline-geometry';
export * from './src/state/use-spreadsheet'; export * from './src/state/selection'; export * from './src/ui/spreadsheet-grid';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'selection-outline-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { selectionOutlineEdges, selectionOutlinePath, createSelection, useSpreadsheet, SpreadsheetGrid } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const range = (top, left, bottom = top, right = left, kind) => ({ anchor: { row: top, column: left }, focus: { row: bottom, column: right }, ...(kind ? { kind } : {}) });
const selection = (...ranges) => createSelection('one', ranges);
const edgeKey = edge => [edge.x1, edge.y1, edge.x2, edge.y2].join(',');
const sortedEdges = edges => edges.map(edgeKey).sort();

test('single, reversed, adjacent, overlapping and disjoint selections have exact outer edges', () => {
  const rectangle = [{ x1: 1, y1: 2, x2: 5, y2: 2 }, { x1: 1, y1: 5, x2: 5, y2: 5 },
    { x1: 1, y1: 2, x2: 1, y2: 5 }, { x1: 5, y1: 2, x2: 5, y2: 5 }];
  for (const ranges of [[range(2, 1, 4, 4)], [range(4, 4, 2, 1)], [range(2, 1, 4, 2), range(2, 3, 4, 4)],
    [range(2, 1, 4, 3), range(2, 2, 4, 4)], [range(2, 1, 4, 4), range(3, 2)]]) {
    assert.deepEqual(sortedEdges(selectionOutlineEdges(selection(...ranges))), sortedEdges(rectangle));
  }
  const separate = selectionOutlineEdges(selection(range(0, 0), range(2, 2)));
  assert.equal(separate.length, 8);
  assert.equal(separate.some(edge => edge.x1 === 1 && edge.x2 === 2), false, 'the gap is not enclosed');
});

test('holes and arbitrary unions match their actual cell perimeter without duplicate interior lines', () => {
  const unitEdges = edges => {
    const result = [];
    for (const edge of edges) {
      if (edge.y1 === edge.y2) for (let x = edge.x1; x < edge.x2; x++) result.push(`${x},${edge.y1},${x + 1},${edge.y1}`);
      else for (let y = edge.y1; y < edge.y2; y++) result.push(`${edge.x1},${y},${edge.x1},${y + 1}`);
    }
    assert.equal(new Set(result).size, result.length, 'edges must not be duplicated');
    return result.sort();
  };
  let seed = 1429;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 8; };
  const cases = [[range(0, 0, 0, 4), range(4, 0, 4, 4), range(1, 0, 3, 0), range(1, 4, 3, 4)]];
  for (let index = 0; index < 100; index++) cases.push(Array.from({ length: 1 + random() }, () => range(random(), random(), random(), random())));
  for (const ranges of cases) {
    const cells = new Set();
    for (const { anchor, focus } of ranges) for (let y = Math.min(anchor.row, focus.row); y <= Math.max(anchor.row, focus.row); y++) {
      for (let x = Math.min(anchor.column, focus.column); x <= Math.max(anchor.column, focus.column); x++) cells.add(`${x},${y}`);
    }
    const expected = [];
    for (const cell of cells) {
      const [x, y] = cell.split(',').map(Number);
      if (!cells.has(`${x},${y - 1}`)) expected.push(`${x},${y},${x + 1},${y}`);
      if (!cells.has(`${x},${y + 1}`)) expected.push(`${x},${y + 1},${x + 1},${y + 1}`);
      if (!cells.has(`${x - 1},${y}`)) expected.push(`${x},${y},${x},${y + 1}`);
      if (!cells.has(`${x + 1},${y}`)) expected.push(`${x + 1},${y},${x + 1},${y + 1}`);
    }
    assert.deepEqual(unitEdges(selectionOutlineEdges(selection(...ranges))), expected.sort());
  }
});

test('geometry uses resized logical offsets and stays bounded by range count for very tall selections', () => {
  const edges = selectionOutlineEdges(selection(range(1, 1, 2, 2)));
  assert.equal(selectionOutlinePath(edges, [48, 148, 218, 358], [28, 56, 100, 132]),
    'M148,56H358V56 M148,132H358V132 M148,56H148V132 M358,56H358V132');
  const separatedColumns = Array.from({ length: 128 }, (_, index) => range(0, index * 2, 999999, index * 2, 'column'));
  assert.equal(selectionOutlineEdges(selection(...separatedColumns)).length, 512);
});

async function mount(t, overrides = {}) {
  let c, renderer;
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = () => ({ ownerDocument: doc, addEventListener() {}, removeEventListener() {}, style: {}, scrollHeight: 18,
    scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000, focus() { doc.activeElement = this; },
    select() {}, setSelectionRange() {}, contains: () => false, closest: () => null, querySelectorAll: () => [] });
  function Probe() {
    c = useSpreadsheet({ onSave() {}, initialWorkbook: { sheets: [{ id: 'one', name: 'One', rowCount: 300, columnCount: 8, cells: {}, ...overrides }] } });
    return createElement(SpreadsheetGrid, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return c; }, get root() { return renderer.root; },
    async run(fn) { await act(async () => fn(c)); },
    outline() { return renderer.root.findByProps({ className: 'lxs-selection-outline' }); },
    path() { return this.outline().findByType('path').props.d; },
  };
}

test('grid outlines complete merged selections and exact column selections across merged titles', async t => {
  const ui = await mount(t, { merges: [{ top: 0, left: 0, bottom: 1, right: 7 }] });
  await ui.run(c => c.select({ row: 0, column: 0 }));
  assert.equal(ui.path(), 'M48,28H848V28 M48,84H848V84 M48,28H48V84 M848,28H848V84');
  await ui.run(c => c.selectAxisRange('column', 2, 2));
  assert.equal(ui.path(), 'M248,28H348V28 M248,8428H348V8428 M248,28H248V8428 M348,28H348V8428');
  assert.equal(ui.outline().props['aria-hidden'], 'true');
  assert.equal(ui.outline().props.focusable, 'false');
  assert.equal(ui.outline().parent.parent.props.className, 'lxs-grid-canvas');
});

test('virtual scrolling and zoom preserve the full logical outline while separate ranges retain their gaps', async t => {
  const ui = await mount(t);
  await ui.run(c => c.selectRange({ row: 0, column: 1 }, { row: 299, column: 2 }));
  const path = ui.path();
  assert.ok(path.includes('8428'));
  const initialRows = ui.root.findAllByProps({ role: 'row' }).length;
  await act(async () => ui.root.findByProps({ className: 'lxs-grid-scroll' }).props.onScroll({ currentTarget: { scrollTop: 4000, clientHeight: 300 } }));
  assert.equal(ui.path(), path);
  assert.ok(initialRows < 50);
  assert.ok(ui.root.findAllByProps({ role: 'row' }).length < 50);
  await ui.run(c => c.setZoom(200));
  assert.equal(ui.path(), path);
  await ui.run(c => c.selectRange({ row: 0, column: 0 }, { row: 1, column: 1 }));
  await ui.run(c => c.selectRange({ row: 4, column: 4 }, { row: 5, column: 5 }, true));
  assert.equal(ui.path().split('M').length - 1, 8);
});

test('selecting a drawing hides the cell outline and returning to a cell restores it', async t => {
  const ui = await mount(t, { drawings: [{ id: 'shape', type: 'shape', shape: 'rectangle', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 },
    width: 80, height: 40, fill: '#ffffff', stroke: '#217346', strokeWidth: 1 }] });
  await ui.run(c => c.selectDrawing('shape'));
  assert.equal(ui.root.findAllByProps({ className: 'lxs-selection-outline' }).length, 0);
  await ui.run(c => c.select({ row: 1, column: 1 }));
  assert.ok(ui.outline());
});
