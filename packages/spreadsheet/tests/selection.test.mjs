import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/selection"; export * from "./src/state/use-spreadsheet"; export * from "./src/model";', resolveDir: packageRoot, sourcefile: 'selection-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { createSelection, selectionRanges, selectionBounds, selectedAddresses, selectionCellCount, isCellSelected,
  isRangeSelected, toggleRangeSelection, toggleSelectionCell, MAX_SELECTION_RANGES, useSpreadsheet,
  deleteRows, deleteColumns, setCellValue, formatCells } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const p = (row, column) => ({ row, column });
const range = (row, column, endRow = row, endColumn = column) => ({ anchor: p(row, column), focus: p(endRow, endColumn) });
const selection = (...ranges) => createSelection('one', ranges);
const book = () => ({ sheets: [
  { id: 'one', name: 'One', rowCount: 100, columnCount: 100, cells: { A1: { value: 'one' }, B1: { value: 'keep' }, C1: { value: 'three' } } },
  { id: 'two', name: 'Two', rowCount: 20, columnCount: 20, cells: {} },
] });
async function mount(t, options = {}) {
  let current, renderer;
  function Probe() { current = useSpreadsheet({ initialWorkbook: book(), onSave: value => value, ...options }); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; } };
}

test('legacy single selections retain active bounds and all-range helpers exclude gaps', () => {
  const legacy = { sheetId: 'one', ...range(2, 2, 0, 0) };
  assert.deepEqual(selectionBounds(legacy), { top: 0, bottom: 2, left: 0, right: 2 });
  assert.equal(selectionRanges(legacy).length, 1);
  const multiple = selection(range(0, 0), range(0, 2));
  assert.deepEqual(selectedAddresses(multiple), ['A1', 'C1']);
  assert.equal(isCellSelected(multiple, p(0, 1)), false);
  assert.deepEqual(selectionBounds(multiple), { top: 0, bottom: 0, left: 2, right: 2 });
});

test('overlapping and reversed ranges have exact deduplicated row-major addresses', () => {
  const multiple = selection(range(2, 2, 0, 0), range(1, 1, 3, 3), range(0, 0));
  assert.equal(selectionCellCount(multiple), 14);
  assert.deepEqual(selectedAddresses(multiple), ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'D2', 'A3', 'B3', 'C3', 'D3', 'B4', 'C4', 'D4']);
  assert.equal(isRangeSelected(multiple, range(1, 0, 2, 3)), true);
  assert.equal(isRangeSelected(multiple, range(0, 0, 3, 3)), false);
});

test('huge intersecting rows and columns are counted without enumerating cells and reject bulk writes', () => {
  const multiple = selection(range(0, 0, 9999, 0), range(0, 0, 0, 999));
  assert.equal(selectionCellCount(multiple), 10999);
  assert.throws(() => selectedAddresses(multiple), /10,000/);
  const repeated = selection(...Array.from({ length: MAX_SELECTION_RANGES }, () => range(0, 0, 9999, 999)));
  assert.equal(selectionCellCount(repeated), 10000000);
  assert.throws(() => selectedAddresses(repeated), /10,000/);
  const sameAllowedArea = selection(...Array.from({ length: MAX_SELECTION_RANGES }, () => range(0, 0, 99, 99)));
  assert.equal(selectedAddresses(sameAllowedArea).length, 10000);
});

test('removing an interior cell leaves a hole through every overlapping range and keeps the active cell valid', () => {
  const initial = selection(range(0, 0, 4, 4), range(1, 1, 3, 3));
  const next = toggleSelectionCell(initial, p(2, 2));
  assert.equal(selectionCellCount(next), 24);
  assert.equal(isCellSelected(next, p(2, 2)), false);
  assert.equal(isCellSelected(next, next.focus), true);
  assert.deepEqual(next.focus, p(3, 3));
  assert.equal(selectionCellCount(toggleSelectionCell(next, p(2, 2))), 25);
});

test('complete row/column exclusion operates on the union and leaves at least the active cell', () => {
  const initial = selection(range(0, 0, 2, 1), range(0, 2, 2, 3));
  const withoutRow = toggleRangeSelection(initial, range(1, 0, 1, 3));
  assert.equal(selectionCellCount(withoutRow), 8);
  assert.equal(isCellSelected(withoutRow, p(1, 2)), false);
  const withoutColumn = toggleRangeSelection(withoutRow, range(0, 0, 0, 3));
  assert.equal(selectionCellCount(withoutColumn), 4);
  const final = toggleRangeSelection(withoutColumn, range(2, 0, 2, 3));
  assert.equal(selectionCellCount(final), 1);
  assert.equal(isCellSelected(final, final.focus), true);
  assert.equal(toggleSelectionCell(final, final.focus), final);
});

test('all four selection directions retain complete fragments when an interior cell is removed', () => {
  for (const [anchor, focus] of [[p(0, 0), p(2, 2)], [p(2, 2), p(0, 0)], [p(0, 2), p(2, 0)], [p(2, 0), p(0, 2)]]) {
    const initial = selection({ anchor, focus });
    const next = toggleSelectionCell(initial, p(1, 1));
    assert.equal(selectionCellCount(next), 8);
    assert.deepEqual(next.focus, focus);
    assert.deepEqual(selectedAddresses(next), ['A1', 'B1', 'C1', 'A2', 'C2', 'A3', 'B3', 'C3']);
  }
});

test('whole row and column subtraction retains the active header range at its complete width or height', () => {
  const rows = selection(range(0, 7, 0, 0), range(3, 7, 5, 0));
  const withoutMiddleRow = toggleRangeSelection(rows, range(4, 7, 4, 0));
  assert.equal(selectionCellCount(withoutMiddleRow), 24);
  assert.deepEqual(withoutMiddleRow.focus, p(5, 0));
  assert.equal(isRangeSelected(withoutMiddleRow, range(5, 0, 5, 7)), true);
  const columns = selection(range(7, 0, 0, 0), range(7, 3, 0, 5));
  const withoutMiddleColumn = toggleRangeSelection(columns, range(7, 4, 0, 4));
  assert.equal(selectionCellCount(withoutMiddleColumn), 24);
  assert.deepEqual(withoutMiddleColumn.focus, p(0, 5));
  assert.equal(isRangeSelected(withoutMiddleColumn, range(0, 5, 7, 5)), true);
});

test('union and toggle results agree with a small-grid oracle for deterministic varied overlaps', () => {
  let seed = 781;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % 8; };
  const cellsIn = item => {
    const result = new Set();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (isCellSelected(item, p(r, c))) result.add(`${r},${c}`);
    return result;
  };
  for (let trial = 0; trial < 100; trial++) {
    const initial = selection(...Array.from({ length: 7 }, () => range(random(), random(), random(), random())));
    const original = cellsIn(initial);
    assert.equal(selectionCellCount(initial), original.size);
    assert.equal(selectedAddresses(initial).length, original.size);
    const target = range(random(), random(), random(), random());
    const targetCells = cellsIn(selection(target));
    const whollySelected = [...targetCells].every(cell => original.has(cell));
    assert.equal(isRangeSelected(initial, target), whollySelected);
    const expected = new Set(original);
    for (const cell of targetCells) { if (whollySelected) expected.delete(cell); else expected.add(cell); }
    if (!expected.size) expected.add(`${initial.focus.row},${initial.focus.column}`);
    const next = toggleRangeSelection(initial, target);
    assert.deepEqual(cellsIn(next), expected);
    assert.equal(selectionCellCount(next), expected.size);
    assert.equal(isCellSelected(next, next.anchor), true);
    assert.equal(isCellSelected(next, next.focus), true);
  }
});

test('additive selection and extending the active range preserve previous areas, while normal selection resets', async t => {
  const hook = await mount(t);
  await act(async () => { hook.current.select(p(0, 0)); hook.current.select(p(2, 2), false, true); hook.current.select(p(3, 3), true); });
  assert.equal(hook.current.selection.ranges.length, 2);
  assert.equal(selectionCellCount(hook.current.selection), 5);
  assert.deepEqual(hook.current.selection.anchor, p(2, 2));
  await act(async () => hook.current.selectRange(p(5, 99), p(6, 0), false, true));
  assert.equal(hook.current.selection.ranges.length, 2);
  assert.equal(selectionCellCount(hook.current.selection), 201);
  assert.equal(isCellSelected(hook.current.selection, p(0, 0)), true);
  await act(async () => hook.current.select(p(4, 4)));
  assert.equal(hook.current.selection.ranges.length, 1);
  assert.equal(selectionCellCount(hook.current.selection), 1);
});

test('selection callback always supplies all ranges and deep copies every position', async t => {
  let observed;
  const hook = await mount(t, { onSelectionChange(value) {
    observed = structuredClone(value);
    value.anchor.row = 999;
    value.focus.column = 999;
    value.ranges[0].anchor.row = 888;
    value.ranges[0].focus.column = 888;
    value.ranges.push(range(777, 777));
  } });
  const position = p(1, 1);
  await act(async () => hook.current.select(position, false, true));
  position.row = 600;
  assert.equal(observed.ranges.length, 2);
  assert.deepEqual(observed.focus, observed.ranges.at(-1).focus);
  assert.deepEqual(hook.current.selection.ranges[0], range(0, 0));
  assert.deepEqual(hook.current.selection.focus, p(1, 1));
});

test('clearing and formatting disjoint areas preserve gaps and form one undo entry', async t => {
  const hook = await mount(t);
  await act(async () => { hook.current.select(p(0, 0)); hook.current.select(p(0, 2), false, true); });
  await act(async () => hook.current.clearCells());
  assert.equal(hook.current.activeSheet.cells.A1, undefined);
  assert.equal(hook.current.activeSheet.cells.C1, undefined);
  assert.equal(hook.current.activeSheet.cells.B1.value, 'keep');
  await act(async () => hook.current.undo());
  assert.equal(hook.current.activeSheet.cells.A1.value, 'one');
  assert.equal(hook.current.activeSheet.cells.C1.value, 'three');
  assert.equal(hook.current.selection.ranges.length, 1);
  await act(async () => { hook.current.select(p(0, 0)); hook.current.select(p(0, 2), false, true); });
  await act(async () => hook.current.apply(wb => formatCells(wb, 'one', selectedAddresses(hook.current.selection), { bold: true })));
  assert.equal(hook.current.activeSheet.cells.A1.format.bold, true);
  assert.equal(hook.current.activeSheet.cells.C1.format.bold, true);
  assert.equal(hook.current.activeSheet.cells.B1.format, undefined);
});

test('range limits reject the entire added selection without losing previous areas', async t => {
  const hook = await mount(t);
  await act(async () => {
    for (let index = 1; index < MAX_SELECTION_RANGES; index++) hook.current.select(p(Math.floor(index / 100), index % 100), false, true);
  });
  assert.equal(hook.current.selection.ranges.length, MAX_SELECTION_RANGES);
  const before = hook.current.selection;
  await act(async () => hook.current.select(p(99, 99), false, true));
  assert.equal(hook.current.selection, before);
  assert.match(hook.current.error, /128/);
  assert.equal(isCellSelected(hook.current.selection, p(99, 99)), false);
});

test('a subtraction that exceeds the range limit is rejected atomically', async t => {
  const hook = await mount(t);
  await act(async () => {
    hook.current.selectRange(p(0, 0), p(2, 2));
    for (let index = 1; index < MAX_SELECTION_RANGES; index++) hook.current.select(p(99, index % 100), false, true);
  });
  const before = hook.current.selection;
  await act(async () => hook.current.toggleSelection(p(1, 1)));
  assert.equal(hook.current.selection, before);
  assert.equal(isCellSelected(hook.current.selection, p(1, 1)), true);
  assert.match(hook.current.error, /128/);
});

test('clamping covers all ranges after structural changes, and sheet switch and save reset selection', async t => {
  const hook = await mount(t);
  await act(async () => { hook.current.selectRange(p(98, 98), p(99, 99)); hook.current.select(p(1, 1), false, true); });
  await act(async () => hook.current.apply(wb => deleteColumns(deleteRows(wb, 'one', 10, 90), 'one', 10, 90)));
  assert.deepEqual(hook.current.selection.ranges[0], range(9, 9));
  assert.deepEqual(hook.current.selection.focus, p(1, 1));
  await act(async () => hook.current.switchSheet('two'));
  assert.equal(hook.current.selection.sheetId, 'two');
  assert.deepEqual(hook.current.selection.ranges, [range(0, 0)]);
  await act(async () => { hook.current.select(p(4, 4), false, true); hook.current.apply(wb => setCellValue(wb, 'two', 'A1', 'saved')); });
  await act(async () => hook.current.save());
  assert.deepEqual(hook.current.selection.ranges, [range(0, 0)]);
});
