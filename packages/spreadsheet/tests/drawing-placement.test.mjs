import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({ entryPoints: [fileURLToPath(new URL('../src/model/index.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { getDrawingBounds, getDrawingPlacement, normalizeWorkbook, insertRows, resizeColumn, SPREADSHEET_LIMITS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const drawing = (patch = {}) => ({ id: 'drawing-1', type: 'text', text: '', fontSize: 16, color: '#000', background: '#fff',
  anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 200, height: 56, ...patch });
const workbook = (sheet = {}, object = {}) => ({ sheets: [{ id: 'sheet-1', name: 'Sheet1', cells: {}, rowCount: 10, columnCount: 8,
  drawings: [drawing(object)], ...sheet }] });
const bounds = input => getDrawingBounds(input, 'sheet-1', 'drawing-1');
const placement = (input, options) => getDrawingPlacement(input, 'sheet-1', 'drawing-1', options);

test('default geometry uses the A1 origin without headers and no extra blank row or column', () => {
  assert.deepEqual(bounds(workbook()), { left: 0, top: 0, right: 200, bottom: 56, width: 200, height: 56 });
  assert.deepEqual(placement(workbook()), { bounds: bounds(workbook()), nextRow: 2, nextColumn: 2 });
});

test('images, shapes and text boxes use the same placement geometry, independent of image bytes', () => {
  for (const type of ['image', 'shape', 'text']) {
    const input = workbook({}, { type, anchor: { row: 2, column: 3, offsetX: 5, offsetY: 7 }, width: 105, height: 30 });
    assert.deepEqual(bounds(input), { left: 305, top: 63, right: 410, bottom: 93, width: 105, height: 30 });
    assert.equal(placement(input).nextRow, 4);
    assert.equal(placement(input).nextColumn, 5);
  }
});

test('custom row heights, column widths and anchor offsets determine separate lower/right candidates', () => {
  const input = workbook({ rowHeights: { 0: 40, 2: 50 }, columnWidths: { 0: 150, 1: 80, 2: 120 } },
    { anchor: { row: 1, column: 1, offsetX: 10, offsetY: 5 }, width: 90, height: 23 });
  assert.deepEqual(placement(input), {
    bounds: { left: 160, top: 45, right: 250, bottom: 68, width: 90, height: 23 }, nextRow: 2, nextColumn: 3,
  });
  assert.equal(placement(input, { gap: 1 }).nextRow, 3);
  assert.equal(placement(input, { gap: 1 }).nextColumn, 3);
});

test('fractional sizes and offsets retain their precision', () => {
  const input = workbook({ rowHeights: { 0: 30.5 }, columnWidths: { 0: 100.5 } },
    { anchor: { row: 0, column: 0, offsetX: 0.5, offsetY: 0.25 }, width: 100, height: 30.25 });
  assert.deepEqual(placement(input), {
    bounds: { left: 0.5, top: 0.25, right: 100.5, bottom: 30.5, width: 100, height: 30.25 }, nextRow: 1, nextColumn: 1,
  });
  assert.equal(placement(input, { gap: 0.001 }).nextRow, 2);
  assert.equal(placement(input, { gap: 0.001 }).nextColumn, 2);
});

test('decimal summation roundoff at cell edges does not create an extra row or column', () => {
  const sizes = { 0: 28.1, 1: 28.2 };
  const input = workbook({ rowHeights: sizes, columnWidths: sizes }, { width: 56.3, height: 56.3 });
  assert.equal(placement(input).nextRow, 2);
  assert.equal(placement(input).nextColumn, 2);
  const otherDirection = workbook({ rowHeights: { 0: 56.3 }, columnWidths: { 0: 56.3 } },
    { anchor: { row: 0, column: 0, offsetX: 28.1, offsetY: 28.1 }, width: 28.2, height: 28.2 });
  assert.equal(placement(otherDirection).nextRow, 1);
  assert.equal(placement(otherDirection).nextColumn, 1);
  assert.equal(placement(otherDirection, { gap: 1e-6 }).nextRow, 2);
});

test('positive subpixel drawings never produce the row or column holding their anchor', () => {
  for (const index of [0, 1]) {
    const input = workbook({}, { anchor: { row: index, column: index, offsetX: 0, offsetY: 0 },
      width: Number.MIN_VALUE, height: Number.MIN_VALUE });
    assert.equal(placement(input).nextRow, index + 1);
    assert.equal(placement(input).nextColumn, index + 1);
  }
});

test('gap changes placement but leaves drawing bounds unchanged', () => {
  const input = workbook();
  assert.deepEqual(placement(input, { gap: 12 }), { bounds: bounds(input), nextRow: 3, nextColumn: 3 });
  assert.deepEqual(placement(input, { gap: 0 }), placement(input));
});

test('implicit default sizes extend beyond the last sheet row and column without resizing the workbook', () => {
  const input = workbook({ rowCount: 1, columnCount: 1, rowHeights: { 0: 40 }, columnWidths: { 0: 150 } },
    { width: 350, height: 96 });
  assert.deepEqual(placement(input), { bounds: bounds(input), nextRow: 3, nextColumn: 3 });
  assert.equal(placement(input, { gap: 0.01 }).nextRow, 4);
  assert.equal(placement(input, { gap: 0.01 }).nextColumn, 4);
  assert.equal(input.sheets[0].rowCount, 1);
  assert.equal(input.sheets[0].columnCount, 1);
});

test('placement can exceed model limits and does not clamp to a writable position', () => {
  const input = workbook({ rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns },
    { anchor: { row: SPREADSHEET_LIMITS.rows - 1, column: SPREADSHEET_LIMITS.columns - 1, offsetX: 0, offsetY: 0 },
      width: 10_000, height: 10_000 });
  assert.equal(placement(input).nextRow, SPREADSHEET_LIMITS.rows - 1 + Math.ceil(10_000 / 28));
  assert.equal(placement(input).nextColumn, SPREADSHEET_LIMITS.columns - 1 + 100);
});

test('large gaps are calculated directly and do not iterate through implicit rows or columns', { timeout: 1000 }, () => {
  const gap = 1_000_000_000_000, result = placement(workbook(), { gap });
  assert.equal(result.nextRow, Math.ceil((56 + gap) / 28));
  assert.equal(result.nextColumn, Math.ceil((200 + gap) / 100));
  const hugeGap = Number.MAX_SAFE_INTEGER - 1000;
  assert.equal(placement(workbook(), { gap: hugeGap }).nextColumn, Math.ceil((200 + hugeGap) / 100));
});

test('bounds and placement are frozen values without changing or freezing mutable caller data', () => {
  const input = workbook(), before = structuredClone(input), result = placement(input);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.bounds)); assert.ok(Object.isFrozen(bounds(input)));
  assert.deepEqual(input, before); assert.equal(Object.isFrozen(input), false);
  assert.throws(() => { result.bounds.bottom = 0; }, TypeError);
  input.sheets[0].drawings[0].height = 84;
  assert.equal(result.nextRow, 2);
  assert.equal(placement(input).nextRow, 3, 'repeated calls read the current workbook without stale caches');
});

test('row insertions and column resizing are reflected when recalculating the same drawing ID', () => {
  const input = normalizeWorkbook(workbook({}, { anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 }, width: 100, height: 28 }));
  const moved = insertRows(input, 'sheet-1', 0, 2);
  assert.equal(placement(input).nextRow, 2);
  assert.equal(placement(moved).nextRow, 4);
  assert.equal(bounds(moved).top, 84);
  const resized = resizeColumn(moved, 'sheet-1', 0, 150);
  assert.equal(bounds(resized).left, 150);
  assert.equal(placement(resized).nextColumn, 2);
});

test('missing, ambiguous or malformed sheet/drawing identities reject clearly', () => {
  for (const args of [[null, 'sheet-1', 'drawing-1'], [{ sheets: [] }, 'sheet-1', 'drawing-1'],
    [workbook(), '', 'drawing-1'], [workbook(), 'sheet-1', null], [workbook(), 'missing', 'drawing-1'],
    [workbook(), 'sheet-1', 'missing'], [workbook({ drawings: undefined }), 'sheet-1', 'drawing-1'],
    [workbook({ drawings: {} }), 'sheet-1', 'drawing-1'],
    [workbook({ drawings: [drawing(), drawing()] }), 'sheet-1', 'drawing-1']]) {
    assert.throws(() => getDrawingBounds(...args));
    assert.throws(() => getDrawingPlacement(...args));
  }
  const input = workbook(); input.sheets.push(input.sheets[0]);
  assert.throws(() => placement(input));
});

test('malformed dimensions, size overrides and drawing coordinates reject without full resource parsing', () => {
  for (const sheet of [{ rowCount: 0 }, { columnCount: 1.5 }, { rowCount: Infinity }, { rowCount: SPREADSHEET_LIMITS.rows + 1 },
    { rowHeights: { 0: 0 } }, { rowHeights: { 0: NaN } }, { rowHeights: { 0: 1001 } }, { rowHeights: { 10: 20 } },
    { columnWidths: { '-1': 24 } }, { columnWidths: { x: 100 } }, { columnWidths: { 0: 23 } },
    { rowHeights: [] }, { columnWidths: null }]) assert.throws(() => placement(workbook(sheet)));
  for (const patch of [{ width: 0 }, { height: -1 }, { width: Infinity }, { height: 10_001 },
    { anchor: null }, { anchor: { row: 10, column: 0, offsetX: 0, offsetY: 0 } },
    { anchor: { row: 0.5, column: 0, offsetX: 0, offsetY: 0 } },
    { anchor: { row: 0, column: 8, offsetX: 0, offsetY: 0 } },
    { anchor: { row: 0, column: 0, offsetX: -1, offsetY: 0 } },
    { anchor: { row: 0, column: 0, offsetX: 0, offsetY: NaN } }]) assert.throws(() => placement(workbook({}, patch)));
});

test('invalid or unsafe gaps reject instead of returning invalid coordinates', () => {
  for (const options of [null, [], 1, { gap: -1 }, { gap: NaN }, { gap: Infinity }, { gap: '12' },
    { gap: Number.MAX_SAFE_INTEGER }, { gap: Number.MAX_VALUE }]) assert.throws(() => placement(workbook(), options));
});
