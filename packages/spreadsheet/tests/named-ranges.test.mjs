import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './model-entry'; export * from './model/query-reader';`,
  resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { applySpreadsheetCommands: apply, createWorkbook, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  getNamedRange, getRangeByName, workbooksEqual, setCellValues, getSheets, getNamedRanges,
  getImages, getShapes, getDrawings, getTextBoxes, getTables, getTable, getTableByName,
  createSpreadsheetSession, createSpreadsheetReader, getSheetReader } = api;
const sheetId = 'sheet-1';
const run = (workbook, ...commands) => { const result = apply(workbook, commands); assert.equal(result.ok, true, result.message); return result; };
const named = (workbook = createWorkbook()) => run(workbook, { type: 'namedRanges.add', sheetId, name: '売上明細', range: 'B3:D6' }).workbook;

test('named range commands preserve a stable ID and raw matrix through rename, range update and JSON round trip', () => {
  let workbook = named(setCellValues(createWorkbook(), sheetId, { B3: '商品', C3: '=2+3' }));
  const first = getNamedRange(workbook, '売上明細');
  assert.deepEqual(first.range, { top: 2, left: 1, bottom: 5, right: 3 }); assert.equal(first.address, 'B3:D6');
  assert.deepEqual(getRangeByName(workbook, '売上明細')[0].map(cell => cell?.value ?? null), ['商品', '=2+3', null]);
  workbook = run(workbook, { type: 'namedRanges.update', sheetId, namedRangeId: first.id, name: 'Sales', range: '$b$3:C4' }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細'), undefined);
  assert.equal(getNamedRange(workbook, 'sales').id, first.id); assert.equal(getNamedRange(workbook, 'SALES').address, 'B3:C4');
  assert.equal(workbooksEqual(parseWorkbook(serializeWorkbook(workbook)), workbook), true);
  assert.equal(getNamedRange(workbook, 'Missing'), undefined); assert.equal(getRangeByName(workbook, 'Missing'), undefined);
  assert.ok(Object.isFrozen(getNamedRange(workbook, 'sales').range));
});

test('only changing a definition participates in equality, dirty history and undo/redo', () => {
  const session = createSpreadsheetSession(createWorkbook());
  const result = session.execute({ type: 'namedRanges.add', sheetId, name: 'Data', range: 'A1:B2' });
  assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(session.getHistoryState().undoCount, 1);
  const id = session.getNamedRange('Data').id;
  assert.equal(session.undo(), true); assert.equal(session.getNamedRange('Data'), undefined);
  assert.equal(session.redo(), true); assert.equal(session.getNamedRange('Data').id, id);
  const noChange = session.execute({ type: 'namedRanges.update', sheetId, namedRangeId: id, name: 'Data', range: 'A1:B2' });
  assert.equal(noChange.changed, false); assert.equal(session.getHistoryState().undoCount, 1);
});

test('names reject duplicate spelling, invalid identity, reserved names, malformed ranges and missing sheets', () => {
  let workbook = run(createWorkbook(), { type: 'namedRanges.add', sheetId, name: 'Sales', range: 'A1:B2' }).workbook;
  for (const name of ['sales', '', '1name', 'A1', 'R1C1', 'R', 'a b', '_xlnm.Test', '_LikeX_list_1'])
    assert.equal(apply(workbook, [{ type: 'namedRanges.add', sheetId, name, range: 'A1:B2' }]).ok, false, name);
  for (const range of ['A0', 'D4:B2', 'A1:ZZ999999', 'Other!A1', 'A1:B2:C3', 'A1:', null])
    assert.equal(apply(workbook, [{ type: 'namedRanges.add', sheetId, name: 'Other', range }]).ok, false);
  const definition = workbook.namedRanges[0];
  for (const bad of [undefined, { ...definition, id: '' }, { ...definition, sheetId: 'missing' }])
    assert.throws(() => normalizeWorkbook({ ...workbook, namedRanges: [bad] }));
  assert.throws(() => normalizeWorkbook({ ...workbook, namedRanges: [definition, { ...definition, name: 'Other' }] }));
  const mutable = structuredClone(workbook), normalized = normalizeWorkbook(mutable);
  mutable.namedRanges[0].range.top = 50;
  assert.equal(normalized.namedRanges[0].range.top, 0); assert.ok(Object.isFrozen(normalized.namedRanges[0]));
});

test('cell editing, drawing add/update/delete and sheet rename do not lose workbook names', () => {
  let workbook = named(); const original = workbook.namedRanges;
  workbook = setCellValues(workbook, sheetId, { A1: 'outside' });
  const added = run(workbook, { type: 'shapes.insert', sheetId, shape: 'rectangle', anchor: { row: 0, column: 0 } });
  workbook = added.workbook;
  const drawingId = added.results[0].drawingId;
  workbook = run(workbook, { type: 'shapes.update', sheetId, drawingId, patch: { text: 'updated' } }).workbook;
  workbook = run(workbook, { type: 'drawings.delete', sheetId, drawingId }).workbook;
  workbook = run(workbook, { type: 'sheets.rename', sheetId, name: 'New name' }).workbook;
  assert.deepEqual(workbook.namedRanges, original);
});

test('insertions move or expand a named range, deletions shrink it and complete removal drops it', () => {
  let workbook = named();
  workbook = run(workbook, { type: 'rows.insert', sheetId, index: 0, count: 2 }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細').address, 'B5:D8');
  workbook = run(workbook, { type: 'rows.insert', sheetId, index: 5, count: 2 }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細').address, 'B5:D10');
  workbook = run(workbook, { type: 'columns.insert', sheetId, index: 2, count: 1 }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細').address, 'B5:E10');
  workbook = run(workbook, { type: 'rows.delete', sheetId, index: 3, count: 3 }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細').address, 'B4:E7');
  workbook = run(workbook, { type: 'columns.delete', sheetId, index: 1, count: 4 }).workbook;
  assert.equal(getNamedRange(workbook, '売上明細'), undefined);
});

test('full cut/move follows the named rectangle across sheets and partial moves reject atomically', () => {
  const initial = named(), added = run(initial, { type: 'sheets.add', name: 'Target' });
  const targetId = added.results[0].sheetId;
  const failed = apply(added.workbook, [{ type: 'cells.set', sheetId, values: { A1: 'not applied' } },
    { type: 'cells.move', sheetId: targetId, source: { sheetId, top: 2, left: 1, bottom: 2, right: 3 }, target: { row: 0, column: 0 } }]);
  assert.equal(failed.ok, false); assert.equal(added.workbook.sheets[0].cells.A1, undefined);
  const moved = run(added.workbook, { type: 'cells.move', sheetId: targetId, source: { sheetId, top: 2, left: 1, bottom: 5, right: 3 }, target: { row: 8, column: 3 } });
  assert.equal(getNamedRange(moved.workbook, '売上明細').sheetId, targetId);
  assert.equal(getNamedRange(moved.workbook, '売上明細').address, 'D9:F12');
  assert.equal(getNamedRange(moved.workbook, '売上明細').id, initial.namedRanges[0].id);
  const removed = run(moved.workbook, { type: 'sheets.delete', sheetId: targetId }).workbook;
  assert.equal(getNamedRange(removed, '売上明細'), undefined);
});

test('named deletion defaults to definition-only, values clear retains formatting, and all deletes borders/comments', () => {
  const initial = normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 10, columnCount: 10,
    cells: { B3: { value: 'old', format: { bold: true, borders: { bottom: { color: '#333', width: 1 } } } } },
    comments: { B3: { id: 'comment-1', text: 'note' } } }] });
  const workbook = named(initial), id = workbook.namedRanges[0].id;
  const onlyName = run(workbook, { type: 'namedRanges.delete', sheetId, namedRangeId: id }).workbook;
  assert.equal(onlyName.namedRanges, undefined); assert.deepEqual(onlyName.sheets[0].cells, initial.sheets[0].cells);
  const values = run(workbook, { type: 'namedRanges.clear', sheetId, namedRangeId: id }).workbook;
  assert.equal(values.sheets[0].cells.B3.value, ''); assert.ok(values.sheets[0].cells.B3.format.borders.bottom);
  assert.ok(values.sheets[0].comments.B3); assert.ok(getNamedRange(values, '売上明細'));
  const all = run(workbook, { type: 'namedRanges.delete', sheetId, namedRangeId: id, clear: 'all' }).workbook;
  assert.equal(all.sheets[0].cells.B3, undefined); assert.equal(all.sheets[0].comments.B3, undefined); assert.equal(all.namedRanges, undefined);
});

test('named clearing honors feature gates, atomic batches and merged-range boundaries', () => {
  const workbook = named(normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 10, columnCount: 10,
    cells: { B3: { value: 'old', format: { bold: true } } }, merges: [{ top: 2, left: 1, bottom: 2, right: 2 }] }] }));
  const id = workbook.namedRanges[0].id;
  assert.equal(apply(workbook, [{ type: 'namedRanges.delete', sheetId, namedRangeId: id, clear: 'all' }], { features: { formatting: false } }).ok, false);
  assert.equal(apply(workbook, [{ type: 'namedRanges.clear', sheetId, namedRangeId: id }], { features: { namedRanges: false } }).ok, false);
  const all = run(workbook, { type: 'namedRanges.clear', sheetId, namedRangeId: id, mode: 'all' }).workbook;
  assert.equal(all.sheets[0].merges.length, 0); assert.ok(all.namedRanges.length);
});

test('collection getters enumerate in stored order, keep JSON metadata detached and support sheet scope', () => {
  const image = { type: 'image', id: 'image-1', resourceId: 'resource-1', alt: 'Logo',
    anchor: { row: 2, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 50 };
  const shape = { type: 'shape', id: 'shape-1', shape: 'rectangle', fill: '#fff', stroke: '#000', strokeWidth: 1,
    anchor: { row: 5, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 50 };
  const text = { type: 'text', id: 'text-1', text: 'Note', fontSize: 16, color: '#000', background: '#fff',
    anchor: { row: 8, column: 0, offsetX: 0, offsetY: 0 }, width: 100, height: 50 };
  const table = { id: 'table-1', name: 'Orders', range: { top: 0, left: 0, bottom: 1, right: 1 },
    columns: [{ id: 'column-1', name: 'Item' }, { id: 'column-2', name: 'Price' }] };
  const workbook = { sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
    cells: { A1: { value: 'Item' }, B1: { value: 'Price' } }, drawings: [shape, image, text], tables: [table] },
    { id: 'sheet-2', name: 'Other', rowCount: 20, columnCount: 10, cells: {} }],
    namedRanges: [{ id: 'name-1', name: 'Prices', sheetId, range: { top: 1, left: 1, bottom: 3, right: 1 } }] };
  assert.deepEqual(getSheets(workbook).map(sheet => sheet.id), [sheetId, 'sheet-2']);
  assert.deepEqual(getDrawings(workbook, sheetId).map(item => item.id), ['shape-1', 'image-1', 'text-1']);
  assert.deepEqual(getImages(workbook, sheetId), [image]); assert.deepEqual(getShapes(workbook, sheetId), [shape]);
  assert.deepEqual(getTextBoxes(workbook, sheetId), [text]);
  assert.deepEqual(getImages(workbook, 'sheet-2'), []); assert.deepEqual(getNamedRanges(workbook, 'sheet-2'), []);
  assert.equal(getNamedRanges(workbook)[0].address, 'B2:B4'); assert.equal(getNamedRanges(workbook, sheetId)[0].sheetId, sheetId);
  assert.equal(getTables(workbook)[0].address, 'A1:B2'); assert.deepEqual(getTables(workbook, 'sheet-2'), []);
  assert.deepEqual(getTable(workbook, 'table-1'), getTableByName(workbook, 'orders'));
  const read = getImages(workbook, sheetId); assert.ok(Object.isFrozen(read)); assert.ok(Object.isFrozen(read[0].anchor));
  image.alt = 'Changed'; assert.equal(read[0].alt, 'Logo');
  const tables = getTables(workbook); table.columns[0].name = 'Changed'; assert.equal(tables[0].columns[0].name, 'Item');
  for (const getter of [getNamedRanges, getDrawings, getImages, getShapes, getTextBoxes, getTables]) assert.throws(() => getter(workbook, 'missing'));
});

test('fixed sheet reader stays on its captured data while live readers follow edits and reject deleted sheets', () => {
  let workbook = named();
  workbook = run(workbook, { type: 'sheets.add', name: 'Other' }).workbook;
  const reader = createSpreadsheetReader(() => workbook), fixed = getSheetReader(workbook, sheetId), live = reader.sheet(sheetId);
  assert.equal(fixed.getInfo().id, sheetId); assert.equal(live.getNamedRanges()[0].name, '売上明細');
  assert.deepEqual(live.getImages(), []); assert.deepEqual(live.getTables(), []);
  workbook = setCellValues(workbook, sheetId, { A1: 'new' });
  assert.equal(live.getCell('A1').value, 'new'); assert.equal(fixed.getCell('A1'), undefined);
  workbook = run(workbook, { type: 'sheets.delete', sheetId }).workbook;
  assert.throws(() => live.getInfo()); assert.throws(() => live.getImages()); assert.equal(fixed.getInfo().id, sheetId);
  assert.throws(() => reader.sheet('missing')); assert.throws(() => getSheetReader(workbook, 'missing'));
  const session = createSpreadsheetSession(createWorkbook()), scoped = session.sheet(sheetId);
  session.execute({ type: 'cells.set', sheetId, values: { A1: 'session' } });
  assert.equal(scoped.getCell('A1').value, 'session'); assert.equal(session.getSheets().length, 1);
});

test('table geometry tracks whole-range moves and row edits, headers stay consistent, sheet copies get new identities', () => {
  const table = { id: 'table-1', name: 'Orders', range: { top: 2, left: 1, bottom: 5, right: 2 },
    columns: [{ id: 'c1', name: 'Item' }, { id: 'c2', name: 'Price' }] };
  let workbook = normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
    cells: { B3: { value: 'Item' }, C3: { value: 'Price' }, B4: { value: 'Example' } }, tables: [table] }] });
  workbook = run(workbook, { type: 'rows.insert', sheetId, index: 4, count: 2 }).workbook;
  assert.equal(getTable(workbook, table.id).address, 'B3:C8');
  assert.equal(apply(workbook, [{ type: 'columns.insert', sheetId, index: 2 }]).ok, false);
  assert.equal(apply(workbook, [{ type: 'rows.delete', sheetId, index: 2 }]).ok, false);
  workbook = setCellValues(workbook, sheetId, { C3: 'Amount' });
  assert.equal(getTable(workbook, table.id).columns[1].name, 'Amount');
  assert.throws(() => setCellValues(workbook, sheetId, { C3: 'Item' }));
  const cloned = run(workbook, { type: 'sheets.duplicate', sheetId });
  const copies = getTables(cloned.workbook); assert.equal(copies.length, 2);
  assert.notEqual(copies[0].id, copies[1].id); assert.notEqual(copies[0].name, copies[1].name);
  assert.notEqual(copies[0].columns[0].id, copies[1].columns[0].id);
  const moved = run(workbook, { type: 'cells.move', sheetId, source: { sheetId, top: 2, left: 1, bottom: 7, right: 2 }, target: { row: 9, column: 4 } }).workbook;
  assert.equal(getTable(moved, table.id).address, 'E10:F15');
  assert.equal(getTable(moved, table.id).id, table.id);
  const deleted = run(moved, { type: 'rows.delete', sheetId, index: 9, count: 6 }).workbook;
  assert.equal(getTable(deleted, table.id), undefined);
});

test('removing the final image resource retains names without resurrecting image bytes', () => {
  const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
  const created = run(named(), { type: 'images.insert', sheetId, resource, anchor: { row: 0, column: 0 } });
  assert.ok(created.workbook.resources.images);
  const deleted = run(created.workbook, { type: 'drawings.delete', sheetId, drawingId: created.results[0].drawingId }).workbook;
  assert.equal(deleted.resources, undefined); assert.equal(getNamedRange(deleted, '売上明細').address, 'B3:D6');
});

test('duplicating multiple maximum-length table names allocates unique truncated suffixes', () => {
  const table = (id, name, top) => ({ id, name, range: { top, bottom: top + 1, left: 0, right: 0 }, columns: [{ id: `${id}-col`, name: 'Item' }] });
  const workbook = normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
    cells: { A1: { value: 'Item' }, A4: { value: 'Item' } },
    tables: [table('first', `${'A'.repeat(254)}X`, 0), table('second', `${'A'.repeat(254)}Y`, 3)] }] });
  const result = run(workbook, { type: 'sheets.duplicate', sheetId }).workbook;
  const names = getTables(result).map(item => item.name);
  assert.equal(new Set(names).size, 4); assert.ok(names.every(name => name.length <= 255));
});

test('header-only tables move across sheets, delete as a whole and reject shared names', () => {
  const table = { id: 'table-1', name: 'Orders', range: { top: 2, left: 1, bottom: 2, right: 2 },
    columns: [{ id: 'c1', name: 'Item' }, { id: 'c2', name: 'Price' }] };
  const workbook = normalizeWorkbook({ sheets: [{ id: sheetId, name: 'Data', rowCount: 20, columnCount: 10,
    cells: { B3: { value: 'Item' }, C3: { value: 'Price' } }, tables: [table] },
    { id: 'sheet-2', name: 'Other', rowCount: 20, columnCount: 10, cells: {} }] });
  assert.equal(apply(workbook, [{ type: 'namedRanges.add', sheetId, name: 'orders', range: 'A1' }]).ok, false);
  const moved = run(workbook, { type: 'cells.move', sheetId: 'sheet-2', source: { sheetId, ...table.range }, target: { row: 0, column: 0 } }).workbook;
  assert.equal(getTables(moved, sheetId).length, 0); assert.equal(getTable(moved, table.id).sheetId, 'sheet-2');
  assert.equal(getTable(moved, table.id).address, 'A1:B1');
  const deleted = run(moved, { type: 'columns.delete', sheetId: 'sheet-2', index: 0, count: 2 }).workbook;
  assert.equal(getTables(deleted).length, 0);
});
