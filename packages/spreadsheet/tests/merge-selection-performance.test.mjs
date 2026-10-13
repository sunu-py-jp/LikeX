import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: 'export * from "./model/merges"; export * from "./model/merge-index"; export { selectionForSheet } from "./state/selection";',
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeMerges, expandRangeForMerges, indexMerges, visitIndexedMerges, selectionForSheet } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const rect = (top, left, bottom, right) => ({ top, left, bottom, right });
const sheet = ranges => ({ id: 'sheet', rowCount: 10000, columnCount: 1000, cells: {},
  merges: normalizeMerges(ranges, { rowCount: 10000, columnCount: 1000 }) });
const linearExpansion = (ranges, range) => {
  let result = { ...range }, changed;
  do {
    changed = false;
    for (const merge of ranges) {
      if (merge.top > result.bottom || merge.bottom < result.top || merge.left > result.right || merge.right < result.left) continue;
      const next = rect(Math.min(result.top, merge.top), Math.min(result.left, merge.left), Math.max(result.bottom, merge.bottom), Math.max(result.right, merge.right));
      if (Object.keys(next).some(key => next[key] !== result[key])) { result = next; changed = true; }
    }
  } while (changed);
  return result;
};

test('single-cell selection in a 10,000-merge sheet preserves the merge extent and editable anchor', () => {
  const data = sheet(Array.from({ length: 10000 }, (_, row) => rect(row, 0, row, 1)));
  for (const row of [0, 1, 4999, 5000, 9999]) {
    const position = { row, column: 1 };
    const selected = selectionForSheet(data, [{ anchor: position, focus: position }]);
    assert.deepEqual(selected.ranges, [{ anchor: { row, column: 0 }, focus: { row, column: 1 } }]);
    assert.deepEqual(selected.focus, { row, column: 0 });
    assert.deepEqual(expandRangeForMerges(data, rect(row, 2, row, 2)), rect(row, 2, row, 2));
  }
});

test('indexed range expansion reaches the same fixed point through chained horizontal and vertical merges', () => {
  const data = sheet([
    rect(0, 0, 1, 1), rect(2, 2, 3, 3), rect(3, 1, 5, 1), rect(5, 2, 6, 5), rect(0, 5, 4, 7),
    ...Array.from({ length: 300 }, (_, row) => rect(row + 10, 10 + row % 20, row + 10, 11 + row % 20)),
  ]);
  for (let top = 0; top < 330; top += 3) for (let left = 0; left < 36; left += 3) {
    const range = rect(top, left, top + top % 7, left + 1 + left % 5);
    assert.deepEqual(expandRangeForMerges(data, range), linearExpansion(data.merges, range));
  }
  assert.deepEqual(expandRangeForMerges(data, rect(1, 1, 2, 2)), rect(0, 0, 6, 7));
});

test('unvalidated overlapping and mutable merge input keeps transitive expansion without stale indexes', () => {
  const first = rect(0, 0, 1, 1), second = rect(1, 1, 2, 2);
  const data = { merges: Object.freeze([first, second]) };
  assert.deepEqual(expandRangeForMerges(data, rect(0, 0, 0, 0)), rect(0, 0, 2, 2));
  first.top = 4; first.bottom = 5;
  assert.deepEqual(expandRangeForMerges(data, rect(0, 0, 0, 0)), rect(0, 0, 0, 0));
  assert.deepEqual(expandRangeForMerges(data, rect(4, 0, 4, 0)), rect(4, 0, 5, 1));
});

test('local range queries inspect a logarithmic path instead of every distant merge or column', () => {
  for (const layout of ['rows', 'columns']) {
    let reads = 0;
    const ranges = Array.from({ length: 10000 }, (_, index) =>
      layout === 'rows' ? rect(index * 2, 0, index * 2, 1) : rect(0, index * 2, 1, index * 2))
      .map(range => new Proxy(range, { get(target, property) { reads++; return target[property]; } }));
    const index = indexMerges(ranges);
    reads = 0;
    const result = [];
    visitIndexedMerges(index, layout === 'rows' ? rect(10000, 0, 10000, 1) : rect(0, 10000, 1, 10000), merge => result.push(merge));
    assert.equal(result.length, 1);
    assert.ok(reads < 200, `${layout}: a local query read ${reads} properties from 10,000 ranges`);
  }
});
