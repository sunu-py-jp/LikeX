import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: {
  contents: 'export { findHistoryTarget, captureHistorySelection } from "./src/state/history-target"; export { cellAddress } from "./src/model/address"; export { selectedAddresses } from "./src/state/selection";',
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false });
const { findHistoryTarget, captureHistorySelection, cellAddress, selectedAddresses } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const p = (row, column) => ({ row, column });
const range = (top, left, bottom = top, right = left) => ({ anchor: p(top, left), focus: p(bottom, right) });
const sheet = (id = 'one', cells = {}, extra = {}) => ({ id, name: id, rowCount: 300, columnCount: 20, cells, ...extra });
const book = (...sheets) => ({ schemaVersion: 1, sheets });
const addresses = target => selectedAddresses({ sheetId: target.sheetId, ranges: target.ranges,
  anchor: target.ranges.at(-1).anchor, focus: target.focus });

test('captured history selection owns immutable copies of all ranges and its independent active cell', () => {
  const ranges = [range(1, 1, 4, 4), { ...range(299, 6, 0, 6), kind: 'column' }];
  const selection = { sheetId: 'one', anchor: ranges[1].anchor, focus: p(7, 6), ranges };
  const target = captureHistorySelection(selection);
  assert.deepEqual(target, { sheetId: 'one', focus: p(7, 6), ranges });
  assert.notEqual(target.ranges, ranges);
  selection.focus.row = 20; ranges[0].anchor.column = 5; ranges[1].kind = 'row';
  assert.equal(target.focus.row, 7); assert.equal(target.ranges[0].anchor.column, 1); assert.equal(target.ranges[1].kind, 'column');
  for (const value of [target, target.focus, target.ranges, ...target.ranges, ...target.ranges.flatMap(range => [range.anchor, range.focus])]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('cell history selects the changed value and ignores unchanged dependent formulas', () => {
  const before = book(sheet('one', { C4: { value: 'first' }, D4: { value: '=C4' } }));
  const next = book(sheet('one', { C4: { value: 'second' }, D4: { value: '=C4' } }));
  for (const [from, to] of [[before, next], [next, before]]) {
    assert.deepEqual(findHistoryTarget(from, to, 'one'), { sheetId: 'one', focus: p(3, 2), ranges: [range(3, 2)] });
  }
});

test('value creation/deletion, format, validation and comment changes all contribute their actual cells', () => {
  const before = book(sheet('one', { A1: { value: 'remove' }, B1: { value: 'format' }, C1: { value: 'validate' }, D1: { value: 'keep' } },
    { comments: { E1: { id: 'comment', text: 'before' }, G1: { id: 'delete-comment', text: 'remove' } } }));
  const next = book(sheet('one', { B1: { value: 'format', format: { bold: true } },
    C1: { value: 'validate', validation: { type: 'checkbox', checkedValue: 'yes', uncheckedValue: 'no' } }, D1: { value: 'keep' }, F1: { value: 'new' } },
    { comments: { E1: { id: 'comment', text: 'after' } } }));
  const target = findHistoryTarget(before, next, 'one');
  assert.deepEqual(addresses(target), ['A1', 'B1', 'C1', 'E1', 'F1', 'G1']);
  assert.deepEqual(target.focus, p(0, 0));
  assert.deepEqual(target.ranges.at(-1), range(0, 0, 0, 2));
});

test('equivalent empty/default values and unchanged JSON with different key ordering do not create targets', () => {
  const before = book(sheet('one', { A1: { value: '' }, B1: { value: 'keep', format: { bold: false, numberFormat: 'general' } } },
    { comments: { C1: { id: 'comment', text: 'same', author: 'author' } } }));
  const next = book(sheet('one', { B1: { value: 'keep' } },
    { comments: { C1: { author: 'author', text: 'same', id: 'comment' } } }));
  assert.equal(findHistoryTarget(before, before, 'one'), null);
  assert.equal(findHistoryTarget(before, next, 'one'), null);
  assert.equal(findHistoryTarget(next, before, 'one'), null);
});

test('adjacent runs combine into exact rectangles and keep holes between disjoint edits', () => {
  const cells = {};
  for (let row = 0; row < 3; row++) for (const column of [0, 1, 4, 5]) cells[cellAddress(row, column)] = { value: 'changed' };
  const target = findHistoryTarget(book(sheet()), book(sheet('one', cells)), 'one');
  assert.deepEqual(target.ranges, [range(0, 4, 2, 5), range(0, 0, 2, 1)]);
  assert.deepEqual(target.focus, p(0, 0));
  assert.equal(addresses(target).length, 12);
  assert.equal(addresses(target).includes('C2'), false);
});

test('large continuous edits remain compact while sparse edits above 128 ranges use one bounding rectangle', () => {
  const continuous = {};
  for (let row = 0; row < 200; row++) for (const column of [2, 3]) continuous[cellAddress(row, column)] = { value: 'changed' };
  assert.deepEqual(findHistoryTarget(book(sheet()), book(sheet('one', continuous)), 'one').ranges, [range(0, 2, 199, 3)]);
  const sparse = {};
  for (let index = 0; index < 128; index++) sparse[cellAddress(index * 2, index % 2 ? 4 : 2)] = { value: 'changed' };
  assert.equal(findHistoryTarget(book(sheet()), book(sheet('one', sparse)), 'one').ranges.length, 128);
  sparse.C257 = { value: 'changed' };
  const overflow = findHistoryTarget(book(sheet()), book(sheet('one', sparse)), 'one');
  assert.deepEqual(overflow.ranges, [range(0, 2, 256, 4)]);
  assert.deepEqual(overflow.focus, p(0, 2));
});

test('multi-sheet batches prefer the current changed sheet, then the first changed sheet in workbook order', () => {
  const before = book(sheet('one'), sheet('two'), sheet('three'));
  const next = book(sheet('one', { B2: { value: 'first' } }), sheet('two', { D4: { value: 'second' } }), sheet('three'));
  assert.equal(findHistoryTarget(before, next, 'two').sheetId, 'two');
  assert.deepEqual(findHistoryTarget(before, next, 'two').focus, p(3, 3));
  assert.equal(findHistoryTarget(before, next, 'three').sheetId, 'one');
  assert.equal(findHistoryTarget(before, next, 'missing').sheetId, 'one');
});

test('sheet and coordinate structure edits do not treat shifted cells or rewritten references as separate edits', () => {
  const first = sheet('one', { A1: { value: 'one' } }), second = sheet('two', { B2: { value: '=one!A1' } });
  const before = book(first, second);
  for (const changed of [
    book({ ...first, rowCount: 301, cells: { A2: { value: 'one' } } }, { ...second, cells: { B2: { value: '=one!A2' } } }),
    book({ ...first, columnCount: 21, cells: { B1: { value: 'one' } } }, second),
    book({ ...first, merges: [{ top: 0, left: 0, bottom: 1, right: 1 }] }, second),
    book({ ...first, name: 'renamed' }, { ...second, cells: { B2: { value: '=renamed!A1' } } }),
    book(second, first), book(first), book(first, second, sheet('three')),
  ]) assert.equal(findHistoryTarget(before, changed, 'two'), null);
});

test('dimension-only or other metadata-only changes do not create a cell target', () => {
  const before = book(sheet());
  assert.equal(findHistoryTarget(before, book(sheet('one', {}, { rowHeights: { 0: 80 }, columnWidths: { 0: 150 } })), 'one'), null);
  assert.equal(findHistoryTarget(before, { ...before, namedRanges: [{ id: 'name', name: 'area', sheetId: 'one', range: { top: 0, left: 0, bottom: 1, right: 1 } }] }, 'one'), null);
});

const drawing = (id, extra = {}) => ({ id, type: 'shape', shape: 'rectangle', anchor: { row: 4, column: 3, offsetX: 0, offsetY: 0 },
  width: 120, height: 60, fill: '#ffffff', stroke: '#217346', strokeWidth: 2, ...extra });

test('drawing-only changes target the surviving changed object and deletion targets its former anchor', () => {
  const original = drawing('box'), unchanged = drawing('other', { anchor: { row: 8, column: 8, offsetX: 0, offsetY: 0 } });
  const before = book(sheet('one', {}, { drawings: [unchanged, original] }));
  const changed = book(sheet('one', {}, { drawings: [unchanged, { ...original, width: 200 }] }));
  assert.deepEqual(findHistoryTarget(before, changed, 'one'), { sheetId: 'one', drawingId: 'box', focus: p(4, 3) });
  const removed = book(sheet('one', {}, { drawings: [unchanged] }));
  assert.deepEqual(findHistoryTarget(before, removed, 'one'), { sheetId: 'one', focus: p(4, 3), ranges: [range(4, 3)] });
  assert.deepEqual(findHistoryTarget(removed, before, 'one'), { sheetId: 'one', drawingId: 'box', focus: p(4, 3) });
  assert.equal(findHistoryTarget(before, structuredClone(before), 'one'), null);
});

test('current-sheet drawing changes precede other sheets, while cell edits win within the same sheet', () => {
  const first = sheet('one'), second = sheet('two', {}, { drawings: [drawing('box')] });
  const before = book(first, second);
  const next = book(sheet('one', { A1: { value: 'changed' } }), { ...second, drawings: [drawing('box', { width: 200 })] });
  assert.equal(findHistoryTarget(before, next, 'two').drawingId, 'box');
  const both = book(first, { ...next.sheets[1], cells: { C2: { value: 'changed' } } });
  assert.deepEqual(findHistoryTarget(before, both, 'two'), { sheetId: 'two', focus: p(1, 2), ranges: [range(1, 2)] });
});

test('replacing image resource data locates the drawing even when its record did not change', () => {
  const image = { id: 'image', type: 'image', resourceId: 'resource', anchor: { row: 1, column: 2, offsetX: 0, offsetY: 0 }, width: 100, height: 100, alt: '' };
  const before = { ...book(sheet('one', {}, { drawings: [image] })), resources: { images: { resource: {
    name: 'image.png', mimeType: 'image/png', width: 1, height: 1, dataUrl: 'data:image/png;base64,first',
  } } } };
  const next = { ...before, resources: { images: { resource: { ...before.resources.images.resource, dataUrl: 'data:image/png;base64,second' } } } };
  assert.deepEqual(findHistoryTarget(before, next, 'one'), { sheetId: 'one', drawingId: 'image', focus: p(1, 2) });
});

test('intact merged cells expand changed targets without exceeding 128 ranges or retaining a hidden cursor', () => {
  const merges = Array.from({ length: 128 }, (_, index) => ({ top: index * 2, bottom: index * 2, left: 1, right: 2 }));
  const before = book(sheet('one', {}, { merges }));
  const cells = Object.fromEntries(merges.map(merge => [cellAddress(merge.top, 2), { value: '', format: { bold: true } }]));
  const next = book(sheet('one', cells, { merges }));
  const target = findHistoryTarget(before, next, 'one');
  assert.equal(target.ranges.length, 128);
  assert.deepEqual(target.focus, p(0, 1));
  assert.deepEqual(target.ranges.at(-1), range(0, 1, 0, 2));
  assert.equal(addresses(target).length, 256);
});

test('inferring a target never mutates either history snapshot', () => {
  const before = book(sheet('one', { A1: { value: 'before', format: { bold: true } } }));
  const next = book(sheet('one', { A1: { value: 'after', format: { bold: false } }, C3: { value: 'more' } }));
  const expected = structuredClone([before, next]);
  findHistoryTarget(before, next, 'one');
  assert.deepEqual([before, next], expected);
});
