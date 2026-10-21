import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: 'export * from "./src/model-entry"; export * from "./src/model/format-ranges";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const range = (top, left, bottom, right) => ({ top, left, bottom, right });
const book = (ranges = [], cells = {}, dimensions = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet', rowCount: 100, columnCount: 40, cells, formatRanges: ranges, ...dimensions }] });
const fmt = (workbook, row, column) => m.getCellFormat(workbook.sheets[0], row, column);
const red = { background: '#ff0000', bold: true };
const command = (area, format) => ({ type: 'cells.formatRange', sheetId: 's', range: area, format });

test('SPON v2 retains finite and open ranges without expanding cells; v1 still loads', () => {
  const source = book([{ range: range(0, 8, 'end', 25), format: red }, { range: range(0, 26, 'end', 'end'), format: { color: '#123456' } }], { I1: { value: '42' } });
  const json = m.serializeWorkbook(source), file = JSON.parse(json);
  assert.equal(file.schemaVersion, 2); assert.equal(source.schemaVersion, 1);
  assert.equal(file.sheets[0].formatRanges.length, 2);
  assert.equal(Object.keys(source.sheets[0].cells).length, 1);
  assert.deepEqual(fmt(m.parseWorkbook(json), 90, 8), red);
  assert.equal(m.serializeWorkbook(m.parseWorkbook(json)), json);
  const legacy = JSON.parse(m.serializeWorkbook(book())); legacy.schemaVersion = 1;
  assert.equal(m.parseWorkbook(JSON.stringify(legacy)).schemaVersion, 1);
  legacy.sheets[0].formatRanges = [{ range: range(0, 0, 0, 0), format: red }];
  assert.throws(() => m.parseWorkbook(JSON.stringify(legacy)), /v1/);
});

test('shared format, full cell override and mutable-host lookup have deterministic precedence', () => {
  const source = book([{ range: range(0, 0, 9, 9), format: red }], { A1: { value: 'A', format: { italic: true } } });
  assert.deepEqual(fmt(source, 0, 0), { italic: true });
  assert.deepEqual(m.getFormattedCell(source.sheets[0], 1, 1), { value: '', format: red });
  assert.deepEqual(m.getCell(source, 's', 'B2'), undefined);
  const raw = { ...source.sheets[0], formatRanges: [{ range: range(0, 0, 1, 1), format: red }] };
  assert.deepEqual(m.getCellFormat(raw, 1, 1), red);
  raw.formatRanges[0].range.bottom = 0;
  assert.equal(m.getCellFormat(raw, 1, 1), undefined);
  const emptyOverride = { ...source.sheets[0], cells: { A1: { value: 'A', format: {} } } };
  assert.deepEqual(m.getCellFormat(emptyOverride, 0, 0), red);
  assert.deepEqual(fmt(m.normalizeWorkbook({ sheets: [emptyOverride] }), 0, 0), red);
  assert.deepEqual(fmt(book(source.sheets[0].formatRanges, { A1: { value: '', format: { numberFormat: 'general' } } }), 0, 0), { numberFormat: 'general' });
});

test('overlap, invalid range and invalid formats are rejected atomically', () => {
  assert.throws(() => book([{ range: range(0, 0, 3, 3), format: red }, { range: range(3, 3, 4, 4), format: red }]), /重複/);
  assert.throws(() => book([{ range: range(0, 0, 100, 3), format: red }]), /範囲/);
  assert.throws(() => book([{ range: range(0, 0, 1, 3), format: {} }]), /書式/);
  const source = book(); assert.throws(() => m.formatCellRange(source, 's', range(0, 0, 'end', 'end'), { fontSize: -1 }), /フォント/);
  assert.equal(Object.keys(source.sheets[0].cells).length, 0);
});

test('large format patches preserve heterogeneous formats and store no blank cell matrix', () => {
  const source = book([{ range: range(0, 8, 'end', 25), format: red }], { I1: { value: 'data', format: { italic: true } } }, { rowCount: 10000, columnCount: 1000 });
  const next = m.formatCellRange(source, 's', range(0, 0, 'end', 'end'), { align: 'center' });
  assert.equal(Object.keys(next.sheets[0].cells).length, 1);
  assert.deepEqual(fmt(next, 1, 8), { ...red, align: 'center' });
  assert.deepEqual(fmt(next, 1, 2), { align: 'center' });
  assert.deepEqual(fmt(next, 0, 8), { italic: true, align: 'center' });
  assert.ok(next.sheets[0].formatRanges.length <= 3);
  assert.equal(m.formatCellRange(next, 's', range(0, 0, 'end', 'end'), { align: 'center' }).sheets[0].formatRanges.length, next.sheets[0].formatRanges.length);
});

test('finite repeated formats compact and end border remains separate', () => {
  const source = book();
  const next = m.formatCells(source, 's', ['I1:Z10'], { background: '#eeeeee' });
  assert.equal(Object.keys(next.sheets[0].cells).length, 0);
  assert.equal(next.sheets[0].formatRanges.length, 1);
  const bordered = m.setCellBorders(next, 's', [range(0, 25, 9, 25)], 'right', { width: 2 });
  assert.equal(fmt(bordered, 3, 24).background, '#eeeeee');
  assert.equal(fmt(bordered, 3, 25).borders.right.width, 2);
  assert.equal(fmt(bordered, 3, 25).background, '#eeeeee');
});

test('clear removes just an area; clearing the last format does not re-inherit it', () => {
  const source = book([{ range: range(0, 0, 9, 9), format: { color: '#123456' } }], { B2: { value: 'kept' } });
  const cleared = m.clearCellRange(source, 's', range(1, 1, 2, 2), 'all');
  assert.equal(fmt(cleared, 1, 1), undefined); assert.equal(fmt(cleared, 0, 0).color, '#123456');
  const reset = m.formatCells(source, 's', ['B2'], { color: undefined });
  assert.equal(fmt(reset, 1, 1), undefined); assert.equal(reset.sheets[0].cells.B2.value, 'kept');
});

test('insert/delete rows and columns track finite boundaries and open ends', () => {
  const source = book([{ range: range(2, 2, 5, 5), format: red }, { range: range(10, 8, 'end', 'end'), format: { italic: true } }]);
  const inserted = m.insertRows(m.insertColumns(source, 's', 4, 2), 's', 3, 2);
  assert.deepEqual(inserted.sheets[0].formatRanges[0].range, range(2, 2, 7, 7));
  assert.deepEqual(inserted.sheets[0].formatRanges[1].range, range(12, 10, 'end', 'end'));
  const restored = m.deleteRows(m.deleteColumns(inserted, 's', 4, 2), 's', 3, 2);
  assert.equal(m.workbooksEqual(restored, source), true);
  const grown = m.insertRows(source, 's', 100, 2);
  assert.deepEqual(fmt(grown, 101, 8), { italic: true });
  assert.equal(fmt(grown, 101, 2), undefined);
});

test('a finite exception reaching the sheet edge remains finite after an open-ended patch', () => {
  const source = book([{ range: range(0, 8, 99, 8), format: red }]);
  const styled = m.formatCellRange(source, 's', range(0, 0, 'end', 'end'), { italic: true });
  assert.deepEqual(fmt(styled, 99, 8), { ...red, italic: true });
  const grown = m.insertRows(styled, 's', 100, 1);
  assert.equal(fmt(grown, 100, 8), undefined);
  assert.deepEqual(fmt(grown, 100, 9), { italic: true });
});

test('cut/paste moves base ranges and blanks override destination formatting', () => {
  const source = book([{ range: range(0, 0, 4, 4), format: red }, { range: range(10, 10, 14, 14), format: { italic: true } }]);
  const next = m.moveCells(source, { sheetId: 's', ...range(0, 0, 4, 5) }, { sheetId: 's', row: 10, column: 10 });
  assert.equal(fmt(next, 0, 0), undefined); assert.deepEqual(fmt(next, 10, 10), red); assert.equal(fmt(next, 10, 15), undefined);
  assert.equal(Object.keys(next.sheets[0].cells).length, 0);
});

test('copy/paste and fill resolve inherited formats; copying unformatted cells clears destination base', () => {
  const source = book([{ range: range(0, 0, 0, 1), format: red }, { range: range(2, 0, 2, 1), format: { italic: true } }], { A1: { value: '7' } });
  const copied = m.copySpreadsheetCells(source, 's', range(0, 0, 0, 1));
  const paste = m.applySpreadsheetCommands(source, [{ type: 'cells.paste', sheetId: 's', target: { row: 2, column: 0 }, payload: copied }]);
  assert.equal(paste.ok, true); assert.deepEqual(fmt(paste.workbook, 2, 0), red);
  const empty = m.copySpreadsheetCells(source, 's', range(5, 0, 5, 1));
  const cleared = m.applySpreadsheetCommands(source, [{ type: 'cells.paste', sheetId: 's', target: { row: 2, column: 0 }, payload: empty }]);
  assert.equal(cleared.ok, true); assert.equal(fmt(cleared.workbook, 2, 0), undefined);
  const filled = m.applySpreadsheetCommands(source, [{ type: 'cells.fill', sheetId: 's', source: range(0, 0, 0, 1), target: range(0, 0, 3, 1), mode: 'copy' }]);
  assert.equal(filled.ok, true); assert.deepEqual(fmt(filled.workbook, 3, 1), red);
});

test('cell shifts split ranges by lanes without applying formats to the other lanes', () => {
  const source = book([{ range: range(1, 1, 4, 4), format: red }]);
  const shifted = m.insertCellRange(source, 's', range(2, 2, 2, 3), 'down');
  assert.deepEqual(fmt(shifted, 5, 2), red); assert.equal(fmt(shifted, 5, 1), undefined);
  const restored = m.deleteCellRange(shifted, 's', range(2, 2, 2, 3), 'up');
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) assert.deepEqual(fmt(restored, r, c), fmt(source, r, c));
});

test('range commands respect disabled formatting and formula policy', () => {
  const source = book([{ range: range(0, 0, 0, 0), format: { numberFormat: 'text' } }], { A1: { value: '=1+1' } });
  assert.equal(m.applySpreadsheetCommands(source, [command(range(0, 0, 1, 1), { bold: true })], { features: { formatting: false } }).ok, false);
  assert.equal(m.applySpreadsheetCommands(source, [command(range(0, 0, 0, 0), { numberFormat: 'general' })], { features: { formulas: false } }).ok, false);
  const renamed = m.renameSheet(source, 's', 'New'); assert.equal(renamed.sheets[0].cells.A1.value, '=1+1');
  const moved = m.applySpreadsheetCommands(source, [{ type: 'cells.move', sheetId: 's', source: { sheetId: 's', ...range(0, 0, 0, 0) }, target: { row: 2, column: 2 } }], { features: { formulas: false } });
  assert.equal(moved.ok, true); assert.equal(moved.workbook.sheets[0].cells.C3.value, '=1+1');
  assert.equal(fmt(moved.workbook, 2, 2).numberFormat, 'text');
  const formulas = book([], { A1: { value: '=1+1' } });
  assert.equal(m.applySpreadsheetCommands(formulas, [{ type: 'cells.move', sheetId: 's', source: { sheetId: 's', ...range(0, 0, 0, 0) }, target: { row: 2, column: 2 } }], { features: { formulas: false } }).ok, false);
});

test('range equality observes content and 10000 independent formats do not consume cell budget', () => {
  const ranges = Array.from({ length: 10000 }, (_, row) => ({ range: range(row, row % 2, row, row % 2), format: row % 2 ? red : { italic: true } }));
  const source = book(ranges, {}, { rowCount: 10000 });
  assert.equal(Object.keys(source.sheets[0].cells).length, 0);
  assert.equal(m.workbooksEqual(source, m.parseWorkbook(m.serializeWorkbook(source))), true);
  assert.equal(m.workbooksEqual(source, book([], {}, { rowCount: 10000 })), false);
  for (let row = 0; row < 10000; row += 100) assert.deepEqual(fmt(source, row, row % 2), { italic: true });
  const base = [{ range: range(0, 0, 9, 9), format: red }];
  assert.equal(m.workbooksEqual(book(base), book(base, { A1: { value: '', format: { bold: false } } })), false);
});

test('axis insertion checks formula policy against the inherited format after the structural change', () => {
  for (const axis of ['rows', 'columns']) {
    const source = book([{ range: axis === 'rows' ? range(0, 0, 'end', 0) : range(0, 0, 0, 'end'), format: { numberFormat: 'text' } }]);
    const command = { type: `${axis}.insert`, sheetId: 's', index: 5, values: [['=1+1']] };
    const inserted = m.applySpreadsheetCommands(source, [command], { features: { formulas: false } });
    assert.equal(inserted.ok, true);
    const address = axis === 'rows' ? 'A6' : 'F1';
    assert.equal(inserted.workbook.sheets[0].cells[address].value, '=1+1');
    assert.equal(fmt(inserted.workbook, axis === 'rows' ? 5 : 0, axis === 'rows' ? 0 : 5).numberFormat, 'text');
    const rejected = m.applySpreadsheetCommands(book(), [command], { features: { formulas: false } });
    assert.equal(rejected.ok, false); assert.equal(rejected.code, 'FEATURE_DISABLED');
    assert.equal(Object.keys(source.sheets[0].cells).length, 0);
  }
});
