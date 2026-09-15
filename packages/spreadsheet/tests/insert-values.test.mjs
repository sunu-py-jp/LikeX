import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, createSpreadsheetSession, serializeWorkbook, calculateWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sales';
const book = (sheet = {}, extra = {}) => normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Sales',
  rowCount: 8, columnCount: 6, cells: {}, ...sheet }], ...extra });
const insert = (type, index, values, extra = {}) => ({ type, sheetId, index, ...(values === undefined ? {} : { values }), ...extra });
const success = result => { assert.equal(result.ok, true, result.message); return result; };
const values = sheet => Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address, cell.value]));

test('row insertion uses one outer array per row and shifts existing data without overwriting it', () => {
  const source = book({ cells: { A1: { value: 'header' }, A3: { value: 'existing' }, C3: { value: '=B3*2' } } });
  const command = insert('rows.insert', 2, [['りんご', 100, '=B3*3'], ['みかん', 200, '=B4*2']]);
  const before = serializeWorkbook(source);
  const result = success(apply(source, [command]));
  assert.deepEqual(values(result.workbook.sheets[0]), {
    A1: 'header', A3: 'りんご', B3: '100', C3: '=B3*3', A4: 'みかん', B4: '200', C4: '=B4*2', A5: 'existing', C5: '=B5*2',
  });
  assert.equal(result.workbook.sheets[0].rowCount, 10);
  assert.equal(result.workbook.sheets[0].columnCount, 6);
  assert.deepEqual(result.results[0].placement, { nextRow: 4 });
  assert.equal(result.results.length, 1);
  assert.equal(serializeWorkbook(source), before);
  command.values[0][0] = 'later mutation';
  assert.equal(result.workbook.sheets[0].cells.A3.value, 'りんご');
});

test('column insertion uses column-major arrays starting from row one', () => {
  const source = book({ cells: { A1: { value: 'keep' }, C1: { value: 'shift' }, D2: { value: '=C1' } } });
  const result = success(apply(source, [insert('columns.insert', 2, [['りんご', 'みかん'], [100, 200]])]));
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: 'keep', C1: 'りんご', C2: 'みかん', D1: '100', D2: '200', E1: 'shift', F2: '=E1' });
  assert.equal(result.workbook.sheets[0].columnCount, 8);
  assert.equal(result.workbook.sheets[0].rowCount, 8);
  assert.deepEqual(result.results[0].placement, { nextColumn: 4 });
});

test('numbers, booleans and null normalize into the existing string-based JSON representation', () => {
  const source = book({ columnCount: 9 });
  const result = success(apply(source, [insert('rows.insert', 0, [[0, -12.5, true, false, null, '', '00123', "'=A1", '=ROW()']])]));
  const cells = result.workbook.sheets[0].cells;
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '0', B1: '-12.5', C1: 'TRUE', D1: 'FALSE', G1: '00123', H1: "'=A1", I1: '=ROW()' });
  for (const cell of Object.values(cells)) assert.equal(typeof cell.value, 'string');
  assert.equal(calculateWorkbook(result.workbook)[sheetId].I1, 1);
});

test('empty inner arrays and ragged input still insert every requested row or column', () => {
  for (const type of ['rows.insert', 'columns.insert']) {
    const result = success(apply(book(), [insert(type, 1, [[], ['item', 12], [false]], { count: 3 })]));
    assert.deepEqual(values(result.workbook.sheets[0]), type === 'rows.insert'
      ? { A3: 'item', B3: '12', A4: 'FALSE' } : { C1: 'item', C2: '12', D1: 'FALSE' });
    assert.deepEqual(result.results[0].placement, type === 'rows.insert' ? { nextRow: 4 } : { nextColumn: 4 });
  }
});

test('omitting values preserves the original blank insertion and count default', () => {
  for (const [type, size, axis] of [['rows.insert', 'rowCount', 'nextRow'], ['columns.insert', 'columnCount', 'nextColumn']]) {
    const source = book();
    for (const count of [undefined, 2]) {
      const result = success(apply(source, [insert(type, 1, undefined, count === undefined ? {} : { count })]));
      assert.equal(result.workbook.sheets[0][size], source.sheets[0][size] + (count ?? 1));
      assert.deepEqual(result.results[0].placement, { [axis]: 1 + (count ?? 1) });
      assert.deepEqual(values(result.workbook.sheets[0]), {});
    }
  }
});

test('index equal to the current dimension appends new rows or columns', () => {
  const source = book();
  const row = success(apply(source, [insert('rows.insert', 8, [['last']])]));
  assert.equal(row.workbook.sheets[0].cells.A9.value, 'last');
  const column = success(apply(source, [insert('columns.insert', 6, [['last']])]));
  assert.equal(column.workbook.sheets[0].cells.G1.value, 'last');
});

test('malformed matrices and counts reject the entire batch without publishing an insertion', () => {
  const source = book(), before = serializeWorkbook(source);
  const sparseOuter = Array(1), sparseInner = [Array(1)];
  const matrices = [[], null, {}, [1], ['text'], [[undefined]], [[NaN]], [[Infinity]], [[-Infinity]], [[{}]], [[[]]], sparseOuter, sparseInner];
  for (const type of ['rows.insert', 'columns.insert']) {
    const invalid = matrices.map(matrix => insert(type, 0, matrix));
    for (const count of [0, 1, 3, 1.5, -1, NaN, Infinity, '2']) invalid.push(insert(type, 0, [['a'], ['b']], { count }));
    for (const index of [-1, 0.5, 99, NaN, Infinity, '0']) invalid.push(insert(type, index, [['a']]));
    for (const command of invalid) {
      const result = apply(source, [{ type: 'cells.set', sheetId, values: { A1: 'roll back' } }, command]);
      assert.equal(result.ok, false, JSON.stringify(command));
      assert.equal(result.commandIndex, 1);
      assert.equal('workbook' in result, false); assert.equal('results' in result, false);
      assert.equal(serializeWorkbook(source), before);
    }
  }
  assert.equal(apply(source, [{ type: 'rows.delete', sheetId, index: 0, values: [['x']] }]).ok, false);
});

test('other-axis overflow and model limits fail instead of truncating or expanding the payload', () => {
  const source = book({ rowCount: 2, columnCount: 2 });
  for (const type of ['rows.insert', 'columns.insert']) {
    assert.equal(apply(source, [insert(type, 0, [[1, 2, 3]])]).ok, false);
    assert.equal(apply(source, [insert(type, 0, [['x'.repeat(100_001)]])]).ok, false);
  }
  assert.equal(apply(book({ rowCount: 10_000 }), [insert('rows.insert', 0, [[1]])]).ok, false);
  assert.equal(apply(book({ columnCount: 1_000 }), [insert('columns.insert', 0, [[1]])]).ok, false);
});

test('insertion and formula feature switches remain effective with values', () => {
  for (const [type, feature] of [['rows.insert', 'insertRows'], ['columns.insert', 'insertColumns']]) {
    for (const features of [{ [feature]: false }, { rowColumnOperations: false }])
      assert.equal(apply(book(), [insert(type, 0, [['x']])], { features }).code, 'FEATURE_DISABLED');
    assert.equal(apply(book(), [insert(type, 0, [['=1+2']])], { features: { formulas: false } }).code, 'FEATURE_DISABLED');
    success(apply(book(), [insert(type, 0, [["'=1+2"]])], { features: { formulas: false } }));
  }
});

test('new values cannot write into the hidden interior of a merge that expands across the insertion', () => {
  const source = book({ cells: { A1: { value: 'merged' } }, merges: [{ top: 0, left: 0, bottom: 2, right: 2 }] });
  const before = serializeWorkbook(source);
  for (const type of ['rows.insert', 'columns.insert']) {
    assert.equal(apply(source, [insert(type, 1, [['overwrite merged']])]).ok, false);
    const blank = success(apply(source, [insert(type, 1, [[null]])]));
    assert.equal(blank.workbook.sheets[0].cells.A1.value, 'merged');
  }
  assert.equal(serializeWorkbook(source), before);
});

test('input rules evaluate the completed insertion and values together, not an intermediate empty row or column', () => {
  for (const type of ['rows.insert', 'columns.insert']) {
    const rows = type === 'rows.insert', formulaAddress = rows ? 'C1' : 'A3';
    const formula = rows ? '=SUM(A1:A3)/ROWS(A1:A3)' : '=SUM(A1:C1)/COLUMNS(A1:C1)';
    const source = book({ cells: {
      A1: { value: '1' }, [rows ? 'A2' : 'B1']: { value: '1' }, [rows ? 'A3' : 'C1']: { value: '1' },
      [formulaAddress]: { value: formula, validation: { type: 'number', min: 1, max: 1 } },
    } });
    const result = success(apply(source, [insert(type, 1, [[1]])]));
    assert.equal(calculateWorkbook(result.workbook)[sheetId][formulaAddress], 1);
    assert.equal(apply(source, [insert(type, 1, [[4]])]).ok, false, 'final validation errors still reject the whole change');
  }
});

test('named ranges, comments, dimensions and drawings follow the shared structural transformation', () => {
  const source = book({ cells: { B3: { value: 'original' } }, comments: { B3: { id: 'comment', text: 'note' } },
    rowHeights: { 2: 48 }, columnWidths: { 1: 130 }, drawings: [{ id: 'shape', type: 'shape', shape: 'rectangle',
      anchor: { row: 2, column: 1, offsetX: 0, offsetY: 0 }, width: 100, height: 40, fill: '#fff', stroke: '#000', strokeWidth: 1 }],
  }, { namedRanges: [{ id: 'range', name: 'Items', sheetId, range: { top: 1, left: 0, bottom: 3, right: 2 } }] });
  const row = success(apply(source, [insert('rows.insert', 2, [['new']])]));
  assert.equal(row.workbook.sheets[0].comments.B4.id, 'comment');
  assert.equal(row.workbook.sheets[0].drawings[0].anchor.row, 3);
  assert.equal(row.workbook.sheets[0].rowHeights[3], 48);
  assert.equal(row.workbook.namedRanges[0].range.bottom, 4);
  const column = success(apply(source, [insert('columns.insert', 1, [['new']])]));
  assert.equal(column.workbook.sheets[0].comments.C3.id, 'comment');
  assert.equal(column.workbook.sheets[0].drawings[0].anchor.column, 2);
  assert.equal(column.workbook.sheets[0].columnWidths[2], 130);
  assert.equal(column.workbook.namedRanges[0].range.right, 3);
});

test('headless session undo and redo restore both the insertion and its values as one operation', () => {
  const session = createSpreadsheetSession(book({ cells: { A2: { value: 'original' } } }));
  const before = serializeWorkbook(session.getWorkbook());
  success(session.execute(insert('rows.insert', 1, [['first', 1], ['second', 2]])));
  assert.equal(session.getCell(sheetId, 'A4').value, 'original');
  assert.equal(session.undo(), true);
  assert.equal(serializeWorkbook(session.getWorkbook()), before);
  assert.equal(session.undo(), false);
  assert.equal(session.redo(), true);
  assert.equal(session.getCell(sheetId, 'B3').value, '2');
  const prior = session.getWorkbook();
  assert.equal(session.execute(insert('columns.insert', 0, [[{}]])).ok, false);
  assert.equal(session.getWorkbook(), prior);
});
