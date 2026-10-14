import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/ui/grid/use-overflow-cell-borders.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^react$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { textCoveredColumnBoundaries, updateOverflowCellBorders, useOverflowCellBorders } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const left = 'data-lxs-overflow-hide-left', right = 'data-lxs-overflow-hide-right';

function row(offsets = [0, 10, 20, 30, 40, 50], scale = 1) {
  const origin = 47, rectangle = (start, end, top = 0, bottom = 12) => ({ left: origin + start * scale, right: origin + end * scale, width: (end - start) * scale,
    top: top * scale, bottom: bottom * scale, height: (bottom - top) * scale });
  const cells = offsets.slice(1).map((_, column) => {
    const attributes = new Set();
    return { dataset: { lxsColumn: String(column) }, attributes,
      style: { borderRight: '2px solid #000', borderTop: '1px solid #000', borderBottom: '1px solid #000', backgroundColor: column % 2 ? '#ffff00' : '#ffffff' },
      getBoundingClientRect: () => rectangle(offsets[column], offsets[column + 1]),
      toggleAttribute(name, enabled) { if (enabled) attributes.add(name); else attributes.delete(name); },
      removeAttribute(name) { attributes.delete(name); },
    };
  });
  let queries = 0, ranges = 0;
  const text = [], listeners = new Map();
  const root = { cells, text, rectangle, ownerDocument: { defaultView: {}, fonts: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) },
    createRange() { ranges++; let target; return { selectNodeContents(node) { target = node; }, getClientRects: () => target.lineRects }; },
  },
    querySelectorAll: selector => { queries++; return selector.includes('text-content') ? text : cells; }, get queries() { return queries; },
    addText(column, start, end, clipStart = 0, clipEnd = offsets.at(-1)) {
      const viewport = { getBoundingClientRect: () => rectangle(clipStart, clipEnd) };
      text.push({ textContent: '1234', viewport, getBoundingClientRect: () => rectangle(start, end), closest: selector => selector.includes('text-overflow') ? viewport : cells[column] });
    }, listeners, get ranges() { return ranges; },
  };
  return root;
}
const hidden = root => root.cells.map(cell => [...cell.attributes].sort());

test('only crossed internal boundaries disappear, never text endpoints or the sheet outer frame', () => {
  assert.deepEqual(textCoveredColumnBoundaries([0, 10, 20, 30, 40], 0, 40), [1, 2, 3]);
  assert.deepEqual(textCoveredColumnBoundaries([0, 10, 20, 30, 40], 10, 30), [2]);
  assert.deepEqual(textCoveredColumnBoundaries([0, 10, 20], 2, 8), []);
  assert.deepEqual(textCoveredColumnBoundaries([0, 10, 20], NaN, 20), []);
});

test('a 1234 spill hides internal vertical rules but keeps the unused empty cells and all horizontal borders', () => {
  const root = row(), original = root.cells.map(cell => ({ ...cell.style }));
  root.addText(0, 2, 28, 2, 48);
  updateOverflowCellBorders(root, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(hidden(root), [[right], [left, right], [left], [], []]);
  assert.deepEqual(root.cells.map(cell => cell.style), original, 'border widths, colors, horizontal rules and fill remain stored untouched');
});

test('right and centered text are measured at their own origin and clipped by occupied neighbors', () => {
  const rightAligned = row(); rightAligned.addText(3, 8, 38, 12, 38);
  updateOverflowCellBorders(rightAligned, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(hidden(rightAligned), [[], [right], [left, right], [left], []], 'left blocker clips before the 10px boundary');
  const centered = row(); centered.addText(2, 8, 42, 12, 38);
  updateOverflowCellBorders(centered, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(hidden(centered), [[], [right], [left, right], [left], []]);
});

test('fractional widths, sheet zoom and scrolling preserve the same covered boundaries', () => {
  const offsets = [0, 32 / 3, 64 / 3, 32, 128 / 3];
  for (const scale of [.5, 1, 1.5, 2]) {
    const root = row(offsets, scale); root.addText(0, 2, 26, 2, 40);
    updateOverflowCellBorders(root, offsets);
    assert.deepEqual(hidden(root), [[right], [left, right], [left], []]);
  }
});

test('typing a blocker, shortening or clearing text restores only previously masked borders', () => {
  const root = row(), offsets = [0, 10, 20, 30, 40, 50]; root.addText(0, 2, 28, 2, 48);
  let covered = updateOverflowCellBorders(root, offsets);
  root.text.length = 0; root.addText(0, 2, 8, 2, 8);
  covered = updateOverflowCellBorders(root, offsets, covered);
  assert.deepEqual(hidden(root), [[], [], [], [], []]);
  root.text.length = 0; root.addText(0, 2, 28);
  covered = updateOverflowCellBorders(root, offsets, covered);
  root.text.length = 0;
  updateOverflowCellBorders(root, offsets, covered);
  assert.deepEqual(hidden(root), [[], [], [], [], []]);
});

test('manual line breaks mask only visible lines, excluding a long line hidden by the vertical clip', () => {
  const root = row(), offsets = [0, 10, 20, 30, 40, 50]; root.addText(0, 2, 38, 2, 48);
  const text = root.text[0];
  text.textContent = '1\n123456789';
  text.getBoundingClientRect = () => root.rectangle(2, 38, 0, 24);
  text.lineRects = [root.rectangle(2, 8, 0, 12), root.rectangle(2, 38, 12, 24)];
  let covered = updateOverflowCellBorders(root, offsets);
  assert.deepEqual(hidden(root), [[], [], [], [], []], 'the invisible long second line must not suppress borders');
  assert.equal(root.ranges, 1);
  text.viewport.getBoundingClientRect = () => root.rectangle(2, 48, 0, 24);
  covered = updateOverflowCellBorders(root, offsets, covered);
  assert.deepEqual(hidden(root), [[right], [left, right], [left, right], [left], []], 'the same long line masks edges once visible');
  text.lineRects = [root.rectangle(2, 38, 0, 12), root.rectangle(2, 8, 12, 24)];
  text.viewport.getBoundingClientRect = () => root.rectangle(2, 48, 12, 24);
  updateOverflowCellBorders(root, offsets, covered);
  assert.deepEqual(hidden(root), [[], [], [], [], []], 'a long line clipped above the visible line is also ignored');
  const single = row(); single.addText(0, 2, 28);
  updateOverflowCellBorders(single, offsets);
  assert.equal(single.ranges, 0, 'ordinary single-line text never allocates a Range');
});

test('row hook avoids selection-only remeasurement and restores borders on disable/unmount', async t => {
  const root = row(), offsets = [0, 10, 20, 30, 40, 50], sheet = {}, calculated = {}, formatting = {};
  root.addText(0, 2, 28);
  let renderer;
  function Probe({ editingColumn, selection }) {
    const ref = useOverflowCellBorders(sheet, calculated, offsets, formatting, editingColumn, true);
    return createElement('div', { ref, 'data-selection': selection });
  }
  await act(async () => { renderer = create(createElement(Probe, { selection: 0 }), { createNodeMock: () => root }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.deepEqual(hidden(root), [[right], [left, right], [left], [], []]);
  const queries = root.queries;
  await act(async () => renderer.update(createElement(Probe, { selection: 1 })));
  assert.equal(root.queries, queries);
  root.text.length = 0;
  await act(async () => renderer.update(createElement(Probe, { selection: 1, editingColumn: 0 })));
  assert.deepEqual(hidden(root), [[], [], [], [], []]);
  root.addText(0, 2, 28);
  await act(async () => renderer.update(createElement(Probe, { selection: 1 })));
  await act(async () => renderer.unmount());
  assert.deepEqual(hidden(root), [[], [], [], [], []]);
});

test('mount reuses measured text sizes for the first ResizeObserver notification and skips resolved fonts.ready', async t => {
  const root = row(), offsets = [0, 10, 20, 30, 40, 50]; root.addText(0, 2, 28);
  let notify, fontSubscriptions = 0, renderer;
  const observed = [];
  root.ownerDocument.defaultView.ResizeObserver = class {
    constructor(callback) { notify = callback; }
    observe(target) { observed.push(target); }
    disconnect() {}
  };
  Object.assign(root.ownerDocument.fonts, { status: 'loaded', ready: { then() { fontSubscriptions++; } } });
  function Probe() { const ref = useOverflowCellBorders({}, {}, offsets, {}, undefined, true); return createElement('div', { ref }); }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: () => root }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.deepEqual(observed, root.text, 'fixed row dimensions are handled by grid dependencies, not another resize probe');
  assert.equal(fontSubscriptions, 0);
  let queries = root.queries;
  notify([{ target: root.text[0], contentRect: { width: 26, height: 12 } }]);
  assert.equal(root.queries, queries, 'initial observer delivery must not repeat the layout pass');
  root.text[0].getBoundingClientRect = () => root.rectangle(2, 38);
  notify([{ target: root.text[0], contentRect: { width: 36, height: 12 } }]);
  assert.ok(root.queries > queries);
  assert.deepEqual(hidden(root), [[right], [left, right], [left, right], [left], []]);
  queries = root.queries;
  notify([{ target: root.text[0], contentRect: { width: 36, height: 12 } }]);
  assert.equal(root.queries, queries);
});
