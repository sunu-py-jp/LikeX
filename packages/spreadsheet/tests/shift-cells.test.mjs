import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export { insertCellRange, deleteCellRange } from './workbook/shift-cells';
  export { normalizeWorkbook } from './workbook/normalize';
  export { calculateWorkbook } from './formula';
`, resolveDir: new URL('../src/model', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { insertCellRange: insert, deleteCellRange: remove, normalizeWorkbook, calculateWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const rect = (top, left, bottom, right) => ({ top, left, bottom, right });
const cells = entries => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { value }]));
const values = sheet => Object.fromEntries(Object.entries(sheet.cells).map(([key, cell]) => [key, cell.value]));
const other = (entries = {}) => ({ id: 'other', name: 'Other', rowCount: 8, columnCount: 8, cells: cells(entries) });
const book = (sheet = {}, extra = {}, sheets = []) => normalizeWorkbook({ sheets: [
  { id: 'data', name: "Data's", rowCount: 8, columnCount: 8, cells: {}, ...sheet }, ...sheets,
], ...extra });
const bar = ranges => ({ id: 'bar', type: 'dataBar', color: '#123456', ranges });
const shape = (row, column) => ({ id: 'shape', type: 'shape', shape: 'rectangle',
  anchor: { row, column, offsetX: 3, offsetY: 5 }, width: 100, height: 30, fill: '#fff', stroke: '#000', strokeWidth: 1 });
const table = (range = rect(2, 1, 5, 2)) => ({ id: 'table', name: 'Items', range,
  columns: [{ id: 'name', name: 'Name' }, { id: 'price', name: 'Price' }] });
const tableBook = () => book({ cells: cells({ B3: 'Name', C3: 'Price', B4: 'one', C4: '1', B6: 'two', C6: '2' }), tables: [table()] });
const unchangedAfterFailure = (source, operation, message) => {
  const before = JSON.stringify(source);
  assert.throws(operation, message);
  assert.equal(JSON.stringify(source), before);
};

test('insert down shifts only selected columns and preserves sparse cells, formats, rules and comment identities', () => {
  const source = book({ rowCount: 6, cells: {
    ...cells({ A6: 'outside', B2: 'above', B3: '3', C3: '=B3+$B$6+E3+LEN("B3")', B6: '6', D6: 'end', E3: '5' }),
    D3: { value: '', format: { bold: true }, validation: { type: 'number', min: 0, allowBlank: true } },
  }, comments: { B3: { id: 'moved', text: 'comment' }, A6: { id: 'fixed', text: 'same' } },
  rowHeights: { 2: 48, 5: 32 }, columnWidths: { 1: 150 } }, {}, [other()]);
  const before = JSON.stringify(source), result = insert(source, 'data', 'B3:D4', 'down'), sheet = result.sheets[0];
  assert.deepEqual(values(sheet), { A6: 'outside', B2: 'above', B5: '3', C5: '=B5+$B$8+E3+LEN("B3")', B8: '6', D8: 'end', E3: '5', D5: '' });
  assert.equal(sheet.cells.D5, source.sheets[0].cells.D3);
  assert.equal(sheet.comments.B5, source.sheets[0].comments.B3);
  assert.equal(sheet.comments.A6, source.sheets[0].comments.A6);
  assert.equal(sheet.rowCount, 8); assert.equal(sheet.columnCount, 8);
  assert.equal(sheet.rowHeights, source.sheets[0].rowHeights); assert.equal(sheet.columnWidths, source.sheets[0].columnWidths);
  assert.equal(result.sheets[1], source.sheets[1]);
  for (const item of [result, result.sheets, sheet, sheet.cells, sheet.comments]) assert.ok(Object.isFrozen(item));
  assert.equal(JSON.stringify(source), before);
});

test('insert right shifts only selected rows by the selection width and grows minimally', () => {
  const source = book({ columnCount: 6, cells: cells({ A3: 'left', B3: 'start', F3: 'end', C4: '=B3+$F$3+B2', B2: 'above', F5: 'below' }),
    comments: { B4: { id: 'note', text: 'comment' } }, rowHeights: { 2: 45 }, columnWidths: { 1: 140 } });
  const result = insert(source, 'data', rect(2, 1, 3, 3), 'right'), sheet = result.sheets[0];
  assert.deepEqual(values(sheet), { A3: 'left', E3: 'start', I3: 'end', F4: '=E3+$I$3+B2', B2: 'above', F5: 'below' });
  assert.equal(sheet.comments.E4.id, 'note');
  assert.equal(sheet.columnCount, 9); assert.equal(sheet.rowCount, 8);
  assert.equal(sheet.rowHeights, source.sheets[0].rowHeights); assert.equal(sheet.columnWidths, source.sheets[0].columnWidths);
});

test('delete up removes values, formats, validation and comments in the selected rectangle only', () => {
  const source = book({ cells: { ...cells({ A3: 'outside', B2: 'above', B3: 'delete', C4: 'delete', B5: 'keep', D8: 'last', E4: '=B3+B5+D8' }),
    D3: { value: '', format: { bold: true }, validation: { type: 'number', min: 0, allowBlank: true } } },
    comments: { C4: { id: 'delete', text: 'gone' }, B5: { id: 'keep', text: 'keep' } } });
  const result = remove(source, 'data', 'B3:D4', 'up'), sheet = result.sheets[0];
  assert.deepEqual(values(sheet), { A3: 'outside', B2: 'above', B3: 'keep', D6: 'last', E4: '=#REF!+B3+D6' });
  assert.deepEqual(Object.keys(sheet.comments), ['B3']); assert.equal(sheet.comments.B3.id, 'keep');
  assert.equal(sheet.rowCount, 8); assert.equal(sheet.columnCount, 8);
  assert.equal(source.sheets[0].cells.B3.value, 'delete');
});

test('delete left closes selected rows and keeps dimensions and other rows unchanged', () => {
  const source = book({ cells: cells({ A3: 'left', B3: 'delete', D4: 'delete', E3: 'keep', H4: '=E3+B3+B2', B2: 'above', H5: 'below' }),
    comments: { H4: { id: 'note', text: 'kept' } } });
  const sheet = remove(source, 'data', 'B3:D4', 'left').sheets[0];
  assert.deepEqual(values(sheet), { A3: 'left', B3: 'keep', E4: '=B3+#REF!+B2', B2: 'above', H5: 'below' });
  assert.equal(sheet.comments.E4.id, 'note'); assert.equal(sheet.columnCount, 8); assert.equal(sheet.rowCount, 8);
});

test('cross-sheet formulas follow moved cells, preserve absolute marks, escaped names and literal text', () => {
  const source = book({ cells: { ...cells({ B3: '1', B6: '2' }),
    E1: { value: '=B3', format: { numberFormat: 'text' } }, E2: { value: "'=B3" } } }, {}, [other({
      A1: `='Data''s'!$B$3+'data''s'!B$6+LEN("'Data''s'!B3")+B3`,
      A2: `=SUM('Data''s'!$B$2:D6)`, A3: `=SUM('Data''s'!D6:$B$2)`,
    })]);
  const result = insert(source, 'data', 'B3:D4', 'down');
  assert.equal(result.sheets[1].cells.A1.value, `='Data''s'!$B$5+'data''s'!B$8+LEN("'Data''s'!B3")+B3`);
  assert.equal(result.sheets[1].cells.A2.value, `=SUM('Data''s'!$B$2:D8)`);
  assert.equal(result.sheets[1].cells.A3.value, `=SUM('Data''s'!D8:$B$2)`);
  assert.equal(result.sheets[0].cells.E1.value, '=B3'); assert.equal(result.sheets[0].cells.E2.value, "'=B3");
});

test('deletion contracts ranges and replaces fully deleted references with #REF!', () => {
  const source = book({}, {}, [other({ A1: `=SUM('Data''s'!B2:D6)`, A2: `=SUM('Data''s'!B3:D4)`, A3: `='Data''s'!$C$4` })]);
  const result = remove(source, 'data', 'B3:D4', 'up');
  assert.deepEqual(values(result.sheets[1]), { A1: `=SUM('Data''s'!B2:D4)`, A2: '=SUM(#REF!)', A3: '=#REF!' });
  assert.equal(calculateWorkbook(result).other.A3, '#REF!');
});

test('safe rectangular remainder is retained when deletion removes all referenced cells in edge lanes', () => {
  const source = book({}, { namedRanges: [{ id: 'area', name: 'Area', sheetId: 'data', range: rect(2, 0, 3, 3) }] },
    [other({ A1: `=SUM('Data''s'!A3:D4)` })]);
  const result = remove(source, 'data', 'B3:D4', 'up');
  assert.deepEqual(result.namedRanges[0].range, rect(2, 0, 3, 0));
  assert.equal(result.sheets[1].cells.A1.value, `=SUM('Data''s'!A3:A4)`);
});

test('blank insertion retains spare capacity and succeeds at the physical row and column limits', () => {
  const source = book({ rowCount: 10_000, columnCount: 1_000 });
  for (const [range, direction] of [['B9999:D10000', 'down'], ['ALK3:ALL4', 'right']]) {
    const result = insert(source, 'data', range, direction);
    assert.equal(result.sheets[0].rowCount, 10_000); assert.equal(result.sheets[0].columnCount, 1_000);
    assert.deepEqual(values(result.sheets[0]), {});
  }
  assert.equal(insert(book(), 'data', 'B3:D4', 'down').sheets[0].rowCount, 8);
});

test('only occupied affected cells or metadata grow capacity, including blank formatted and rule cells', () => {
  for (const entry of [{ value: '', format: { bold: true } }, { value: '', validation: { type: 'number', min: 0, allowBlank: true } }]) {
    const source = book({ rowCount: 5, cells: { B5: entry, H5: { value: 'outside' } } });
    const sheet = insert(source, 'data', 'B3:C4', 'down').sheets[0];
    assert.equal(sheet.rowCount, 7); assert.deepEqual(sheet.cells.B7, source.sheets[0].cells.B5);
  }
  const unaffected = book({ cells: cells({ H8: 'outside', B2: 'before' }) });
  assert.equal(insert(unaffected, 'data', 'B3:D4', 'down').sheets[0].rowCount, 8);
  for (const metadata of [
    { comments: { B8: { id: 'comment', text: 'blank cell comment' } } },
    { drawings: [shape(7, 1)] }, { conditionalFormats: [bar([rect(5, 1, 7, 3)])] },
    { merges: [rect(6, 1, 7, 3)] },
  ]) assert.equal(insert(book(metadata), 'data', 'B3:D4', 'down').sheets[0].rowCount, 10);
  const named = book({}, { namedRanges: [{ id: 'last', name: 'Last', sheetId: 'data', range: rect(7, 1, 7, 1) }] });
  assert.equal(insert(named, 'data', 'B3:D4', 'down').sheets[0].rowCount, 10);
});

test('valid blank formula targets also retain capacity, including formulas evaluated after the target sheet', () => {
  const source = book({}, {}, [other({ A1: `='Data''s'!B8` })]);
  const result = insert(source, 'data', 'B3:D4', 'down');
  assert.equal(result.sheets[0].rowCount, 10); assert.equal(result.sheets[1].cells.A1.value, `='Data''s'!B10`);
  assert.equal(calculateWorkbook(result).other.A1, 0);
  const invalid = book({}, {}, [other({ A1: `='Data''s'!B20` })]);
  assert.equal(insert(invalid, 'data', 'B3:D4', 'down').sheets[0].rowCount, 8);
});

test('named ranges and conditional formats expand, contract and disappear with their tracked cells', () => {
  const source = book({ conditionalFormats: [bar([rect(1, 1, 5, 3), rect(0, 5, 1, 5)])] },
    { namedRanges: [{ id: 'area', name: 'Area', sheetId: 'data', range: rect(1, 1, 5, 3) }] });
  const added = insert(source, 'data', 'B3:D4', 'down');
  assert.deepEqual(added.namedRanges[0].range, rect(1, 1, 7, 3));
  assert.deepEqual(added.sheets[0].conditionalFormats[0].ranges, [rect(1, 1, 7, 3), rect(0, 5, 1, 5)]);
  assert.deepEqual(remove(added, 'data', 'B3:D4', 'up').namedRanges, source.namedRanges);
  const gone = remove(source, 'data', 'B2:D6', 'up');
  assert.equal(gone.namedRanges, undefined);
  assert.deepEqual(gone.sheets[0].conditionalFormats[0].ranges, [rect(0, 5, 1, 5)]);
});

test('drawings follow lane anchors, retain offsets, and clamp deleted anchors to the start of the gap', () => {
  const source = book({ drawings: [shape(3, 2), { ...shape(6, 2), id: 'below' }, { ...shape(3, 6), id: 'outside' }] });
  const added = insert(source, 'data', 'B3:D4', 'down');
  assert.deepEqual(added.sheets[0].drawings.map(item => item.anchor.row), [5, 8, 3]);
  assert.equal(added.sheets[0].rowCount, 9);
  const deleted = remove(source, 'data', 'B3:D4', 'up');
  assert.deepEqual(deleted.sheets[0].drawings.map(item => item.anchor.row), [2, 4, 3]);
  assert.equal(deleted.sheets[0].drawings[0].anchor.offsetX, 3); assert.equal(deleted.sheets[0].drawings[0].anchor.offsetY, 5);
  assert.equal(deleted.sheets[0].drawings[2], source.sheets[0].drawings[2]);
});

test('intact merges move with their contents and comments and can be wholly deleted', () => {
  const source = book({ cells: cells({ B5: 'merged', E5: 'outside' }), merges: [rect(4, 1, 5, 3)],
    comments: { B5: { id: 'merged-note', text: 'note' } } });
  const added = insert(source, 'data', 'B3:D4', 'down');
  assert.deepEqual(added.sheets[0].merges, [rect(6, 1, 7, 3)]);
  assert.equal(added.sheets[0].cells.B7.value, 'merged'); assert.equal(added.sheets[0].comments.B7.id, 'merged-note');
  const deleted = remove(source, 'data', 'B5:D6', 'up');
  assert.equal(deleted.sheets[0].merges, undefined); assert.equal(deleted.sheets[0].cells.B5, undefined);
});

test('inserting through merges and deleting only part of merges reject atomically in both directions', () => {
  const source = book({ cells: cells({ B2: 'merged' }), merges: [rect(1, 1, 4, 4)] });
  for (const [operation, direction] of [[insert, 'down'], [insert, 'right'], [remove, 'up'], [remove, 'left']])
    unchangedAfterFailure(source, () => operation(source, 'data', 'B3:E4', direction), /結合/);
  unchangedAfterFailure(source, () => insert(source, 'data', 'C1:D1', 'down'), /結合/);
});

test('table identities and columns survive whole-table translation and body row changes', () => {
  const source = tableBook();
  const down = insert(source, 'data', 'B1:C2', 'down');
  assert.deepEqual(down.sheets[0].tables[0].range, rect(4, 1, 7, 2));
  assert.equal(down.sheets[0].tables[0].id, 'table'); assert.equal(down.sheets[0].cells.B5.value, 'Name');
  const right = insert(source, 'data', 'A3:B6', 'right');
  assert.deepEqual(right.sheets[0].tables[0].range, rect(2, 3, 5, 4)); assert.equal(right.sheets[0].cells.D3.value, 'Name');
  const body = insert(source, 'data', 'B4:C4', 'down');
  assert.deepEqual(body.sheets[0].tables[0].range, rect(2, 1, 6, 2));
  assert.deepEqual(remove(body, 'data', 'B4:C4', 'up').sheets[0].tables, source.sheets[0].tables);
  assert.equal(remove(source, 'data', 'B3:C6', 'up').sheets[0].tables, undefined);
});

test('table splits, header-only deletion and changes to its column structure reject atomically', () => {
  const source = tableBook();
  for (const [operation, range, direction] of [
    [insert, 'B2:B2', 'down'], [remove, 'B3:B6', 'up'], [remove, 'B3:C3', 'up'],
    [insert, 'C3:C6', 'right'], [remove, 'C3:C6', 'left'],
  ]) unchangedAfterFailure(source, () => operation(source, 'data', range, direction), /テーブル/);
});

test('nonrectangular formulas and metadata reject the entire immutable transaction', () => {
  const cases = [
    [book({}, {}, [other({ A1: `=SUM('Data''s'!A1:D6)` })]), /数式/],
    [book({}, { namedRanges: [{ id: 'area', name: 'Area', sheetId: 'data', range: rect(0, 0, 5, 3) }] }), /名前付き/],
    [book({ conditionalFormats: [bar([rect(0, 0, 5, 3)])] }), /条件付き/],
  ];
  for (const [source, message] of cases) for (const [operation, direction] of [[insert, 'down'], [remove, 'up']])
    unchangedAfterFailure(source, () => operation(source, 'data', 'B3:D4', direction), message);
  const horizontal = book({}, {}, [other({ A1: `=SUM('Data''s'!A1:F4)` })]);
  for (const [operation, direction] of [[insert, 'right'], [remove, 'left']])
    unchangedAfterFailure(horizontal, () => operation(horizontal, 'data', 'B3:D4', direction), /数式/);
});

test('ranges in unaffected lanes or above the insertion are preserved, including original whitespace', () => {
  const source = book({}, {}, [other({ A1: `=SUM('Data''s'!E2 : H8) + SUM('Data''s'!A1 : D2)` })]);
  const result = insert(source, 'data', 'B3:D4', 'down');
  assert.equal(result.sheets[1], source.sheets[1]);
});

test('physical overflow of values, metadata and valid formula targets fails without data loss', () => {
  for (const sheet of [
    { cells: cells({ B10000: 'last' }) }, { comments: { B10000: { id: 'last', text: 'last' } } },
    { drawings: [shape(9999, 1)] }, { conditionalFormats: [bar([rect(9998, 1, 9999, 2)])] },
  ]) {
    const source = book({ rowCount: 10_000, ...sheet });
    unchangedAfterFailure(source, () => insert(source, 'data', 'B3:D4', 'down'), /上限/);
  }
  const formula = book({ rowCount: 10_000 }, {}, [other({ A1: `='Data''s'!B10000` })]);
  unchangedAfterFailure(formula, () => insert(formula, 'data', 'B3:D4', 'down'), /上限/);
  const horizontal = book({ columnCount: 1_000, cells: cells({ ALL3: 'last' }) });
  unchangedAfterFailure(horizontal, () => insert(horizontal, 'data', 'B3:D4', 'right'), /上限/);
});

test('invalid sheets, rectangles, oversized selections and directions reject without modifying the source', () => {
  const source = book();
  for (const range of ['A0', 'B3:A1', 'Other!B2', 'A1:I1', null, {}, rect(0, 0, 1.5, 1)])
    unchangedAfterFailure(source, () => insert(source, 'data', range, 'down'));
  for (const [operation, direction] of [[insert, 'up'], [insert, undefined], [remove, 'down'], [remove, 'right']])
    unchangedAfterFailure(source, () => operation(source, 'data', 'A1', direction), /方向/);
  unchangedAfterFailure(source, () => insert(source, 'missing', 'A1', 'down'), /シート/);
  const large = book({ rowCount: 200, columnCount: 200 });
  unchangedAfterFailure(large, () => remove(large, 'data', rect(0, 0, 100, 100), 'up'), /10,000/);
});

test('deleting the entire grid keeps its logical size, and discarded formulas cannot block the deletion', () => {
  const source = book({ rowCount: 2, columnCount: 2, cells: cells({ A1: 'one', B1: '=unsupported[bad]', A2: 'two' }) });
  const result = remove(source, 'data', 'A1:B2', 'left');
  assert.deepEqual(values(result.sheets[0]), {}); assert.equal(result.sheets[0].rowCount, 2); assert.equal(result.sheets[0].columnCount, 2);
});

test('unsupported formulas reject safely, and completed formula validation remains atomic', () => {
  const invalid = book({ cells: cells({ H8: '=unsupported[bad]', B3: 'original' }) });
  unchangedAfterFailure(invalid, () => insert(invalid, 'data', 'B3:D4', 'down'), /安全に解析/);
  const validated = book({ cells: { B3: { value: '1' }, H1: { value: '=B3', validation: { type: 'number', min: 1, max: 1 } } } });
  const added = insert(validated, 'data', 'B3:D4', 'down');
  assert.equal(added.sheets[0].cells.H1.value, '=B5'); assert.equal(calculateWorkbook(added).data.H1, 1);
  unchangedAfterFailure(validated, () => remove(validated, 'data', 'B3:D4', 'up'), /入力規則/);
});
