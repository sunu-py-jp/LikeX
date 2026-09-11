import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: 'export * from "./src/ui/grid/grid-navigation"; export { normalizeWorkbook } from "./src/model";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'navigation-test.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, nextDataCellPosition, lastUsedCellPosition, pageRowPosition } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sheet = (cells, extra = {}) => normalizeWorkbook({ sheets: [{ id: 'one', name: 'One', rowCount: 12, columnCount: 12, cells, ...extra }] }).sheets[0];
const position = (row, column) => ({ row, column });

test('horizontal data jumps stop at contiguous edges, cross gaps, and finally reach boundaries in either direction', () => {
  const value = sheet({ A1: { value: 'a' }, B1: { value: 'b' }, C1: { value: 'c' }, F1: { value: 'f' }, G1: { value: 'g' } });
  let current = position(0, 0);
  for (const column of [2, 5, 6, 11]) {
    current = nextDataCellPosition(value, current, 0, 1); assert.deepEqual(current, position(0, column));
  }
  for (const column of [6, 5, 2, 0, 0]) {
    current = nextDataCellPosition(value, current, 0, -1); assert.deepEqual(current, position(0, column));
  }
  assert.deepEqual(nextDataCellPosition(value, position(0, 3), 0, 1), position(0, 5));
  assert.deepEqual(nextDataCellPosition(value, position(0, 3), 0, -1), position(0, 2));
});

test('vertical data jumps count zero, false, whitespace and empty-result formulas as data but ignore blank formatting', () => {
  const value = sheet({ A1: { value: '0' }, A2: { value: 'FALSE' }, A3: { value: '=""' }, A4: { value: ' ' },
    A5: { value: '', format: { bold: true } }, A7: { value: 'next' } });
  assert.deepEqual(nextDataCellPosition(value, position(0, 0), 1, 0), position(3, 0));
  assert.deepEqual(nextDataCellPosition(value, position(3, 0), 1, 0), position(6, 0));
  assert.deepEqual(nextDataCellPosition(value, position(6, 0), -1, 0), position(3, 0));
  assert.deepEqual(nextDataCellPosition(value, position(3, 0), -1, 0), position(0, 0));
  assert.deepEqual(nextDataCellPosition(value, position(11, 11), -1, 0), position(0, 11));
});

test('nonempty merged ranges occupy a whole navigation stop without getting stuck at covered coordinates', () => {
  const value = sheet({ A1: { value: 'title' }, D1: { value: 'd' }, E1: { value: 'e' }, A5: { value: 'lower' }, H1: { value: 'next' } },
    { merges: [{ top: 0, left: 0, bottom: 1, right: 2 }] });
  assert.deepEqual(nextDataCellPosition(value, position(0, 0), 0, 1), position(0, 4));
  assert.deepEqual(nextDataCellPosition(value, position(0, 4), 0, -1), position(0, 0));
  assert.deepEqual(nextDataCellPosition(value, position(1, 2), 1, 0), position(4, 0));
  assert.deepEqual(nextDataCellPosition(value, position(4, 0), -1, 0), position(0, 0));
  assert.deepEqual(nextDataCellPosition(value, position(0, 4), 0, 1), position(0, 7));
});

test('the used corner includes cell metadata and comments, and empty sheets resolve to A1', () => {
  assert.deepEqual(lastUsedCellPosition(sheet({})), position(0, 0));
  const value = sheet({ C3: { value: 'data' }, E5: { value: '', validation: { type: 'number' } }, F2: { value: '', format: { bold: true } } },
    { comments: { A8: { id: 'note', text: 'note' } } });
  assert.deepEqual(lastUsedCellPosition(value), position(7, 5));
  assert.deepEqual(lastUsedCellPosition(sheet({}, { merges: [{ top: 5, left: 5, bottom: 8, right: 8 }] })), position(5, 5));
});

test('navigation indexes follow the immutable sheet rather than reusing stale content', () => {
  const first = sheet({ A1: { value: 'first' }, B1: { value: 'second' } });
  const second = { ...first, cells: { ...first.cells, C1: { value: 'third' } } };
  assert.deepEqual(nextDataCellPosition(first, position(0, 0), 0, 1), position(0, 1));
  assert.deepEqual(nextDataCellPosition(second, position(0, 0), 0, 1), position(0, 2));
  assert.deepEqual(lastUsedCellPosition(second), position(0, 2));
});

test('page navigation uses actual row offsets and clamps to first and last rows', () => {
  const offsets = [28, 56, 112, 140, 168, 196];
  assert.equal(pageRowPosition(offsets, 0, 1, 84), 2);
  assert.equal(pageRowPosition(offsets, 4, -1, 84), 1);
  assert.equal(pageRowPosition(offsets, 0, -1, 480), 0);
  assert.equal(pageRowPosition(offsets, 4, 1, 480), 4);
  assert.equal(pageRowPosition(offsets, 1, 1, 1), 2);
});
