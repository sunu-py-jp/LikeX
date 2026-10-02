import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `export * from './model-entry'; export { spreadsheetDrawingBox, spreadsheetDrawingOutline } from './model/lines'; export { getConnectorPortPoint } from './core';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const target = { id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 2, column: 2, offsetX: 0, offsetY: 0 }, width: 180, height: 80, strokeWidth: 2, fill: '#ffffff', stroke: '#112233' };
const book = () => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'One', rowCount: 30, columnCount: 20, cells: {}, drawings: [target] }, { id: 'other', name: 'Other', rowCount: 30, columnCount: 20, cells: {}, columnWidths: { 0: 160 }, rowHeights: { 0: 48 } }] });
const apply = (b, commands, options) => { const r = m.applySpreadsheetCommands(b, commands, options); assert.equal(r.ok, true, r.message); return r; };
const line = (b, points = { start: { x: 80, y: 50 }, end: { x: 350, y: 150 } }) => apply(b, [{ type: 'lines.insert', sheetId: 's', ...points }]);
const points = (b, id, sheet = 's') => m.getSpreadsheetLinePoints(b.sheets.find(item => item.id === sheet), id);

test('lines preserve horizontal, vertical, reversed and coincident endpoints across native serialization', () => {
  for (const pair of [[100, 80, 300, 80], [100, 180, 100, 40], [300, 200, 80, 30], [100, 80, 100, 80]]) {
    const wanted = { start: { x: pair[0], y: pair[1] }, end: { x: pair[2], y: pair[3] } }, result = line(book(), wanted), id = result.results[0].drawingId;
    assert.deepEqual(points(result.workbook, id), wanted);
    const restored = m.parseWorkbook(m.serializeWorkbook(result.workbook));
    assert.deepEqual(points(restored, id), wanted);
    assert.equal(m.serializeWorkbook(restored), m.serializeWorkbook(result.workbook));
    assert.ok(Object.isFrozen(restored.sheets[0].drawings.at(-1).line.start.anchor));
  }
});

test('bindings resolve eight outline ports after target move, resize, reflection and rotation', () => {
  for (const shape of ['rectangle', 'roundedRectangle', 'ellipse', 'triangle', 'diamond', 'rightArrow', 'leftArrow', 'bentArrow', 'uturnArrow', 'flowChartDocument', 'flowChartDelay']) {
    const initial = m.updateDrawing(book(), 's', 'box', { shape }), result = line(initial, { start: { x: 0, y: 0, binding: { targetId: 'box', port: 'topRight' } }, end: { x: 600, y: 200 } }), id = result.results[0].drawingId;
    const moved = m.updateDrawing(result.workbook, 's', 'box', { anchor: { row: 3, column: 4, offsetX: 5, offsetY: 7 }, width: 240, height: 120, rotation: 75, flipX: true });
    const sheet = moved.sheets[0], box = sheet.drawings[0], wanted = m.getConnectorPortPoint(m.spreadsheetDrawingBox(sheet, box), 'topRight', m.spreadsheetDrawingOutline(box));
    assert.deepEqual(points(moved, id).start, { ...wanted, binding: { targetId: 'box', port: 'topRight' } });
    const deleted = m.deleteDrawing(moved, 's', 'box');
    assert.deepEqual(points(deleted, id).start, wanted);
    assert.equal(deleted.sheets[0].drawings[0].line.start.binding, undefined);
  }
});

test('invalid, cross-sheet, self and line targets fail atomically, and rectangle edits cannot silently ignore endpoints', () => {
  const original = book(), before = m.serializeWorkbook(original);
  for (const binding of [{ targetId: 'missing', port: 'left' }, { targetId: 'box', port: 'middle' }, { targetId: 'box', port: 'left', extra: true }]) {
    const result = m.applySpreadsheetCommands(original, [{ type: 'cells.set', sheetId: 's', values: { A1: 'partial' } }, { type: 'lines.insert', sheetId: 's', start: { x: 0, y: 0, binding }, end: { x: 80, y: 40 } }]);
    assert.equal(result.ok, false); assert.equal(result.workbook, undefined); assert.equal(m.serializeWorkbook(original), before);
  }
  const created = line(original), id = created.results[0].drawingId;
  for (const targetId of [id, 'missing']) assert.equal(m.applySpreadsheetCommands(created.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, start: { x: 1, y: 1, binding: { targetId, port: 'top' } } }]).ok, false);
  assert.equal(m.applySpreadsheetCommands(created.workbook, [{ type: 'shapes.update', sheetId: 's', drawingId: id, patch: { width: 250 } }]).ok, false);
  assert.throws(() => m.updateDrawing(created.workbook, 's', id, { width: 250 }), /updateLineEndpoints/);
});

test('row/column changes follow free endpoint cell anchors and connected target ports', () => {
  const made = line(book(), { start: { x: 105, y: 60 }, end: { x: 305, y: 100, binding: { targetId: 'box', port: 'left' } } }), id = made.results[0].drawingId;
  const resized = m.resizeColumn(made.workbook, 's', 0, 180);
  assert.equal(points(resized, id).start.x, 185);
  assert.equal(points(resized, id).end.x, points(made.workbook, id).end.x + 80);
  const inserted = m.insertRows(resized, 's', 1, 2);
  assert.equal(points(inserted, id).start.y, 116);
  assert.equal(points(inserted, id).end.y, points(resized, id).end.y + 56);
  assert.deepEqual(points(m.deleteRows(inserted, 's', 1, 2), id), points(resized, id));
});

test('copy detaches outside targets; cross-sheet paste preserves endpoint offsets; whole-sheet duplicate remaps bindings', () => {
  const made = line(book(), { start: { x: 50, y: 20 }, end: { x: 0, y: 0, binding: { targetId: 'box', port: 'left' } } }), id = made.results[0].drawingId;
  const copied = m.copySpreadsheetDrawing(made.workbook, 's', id), before = points(made.workbook, id);
  assert.equal(copied.drawing.line.end.binding, undefined);
  const pasted = apply(made.workbook, [{ type: 'drawings.paste', sheetId: 'other', payload: copied, anchor: { row: 2, column: 2 } }]);
  const after = points(pasted.workbook, pasted.results[0].drawingId, 'other');
  assert.equal(after.end.x - after.start.x, before.end.x - before.start.x);
  assert.equal(after.end.y - after.start.y, before.end.y - before.start.y);
  assert.equal(after.end.binding, undefined);
  const dup = apply(made.workbook, [{ type: 'sheets.duplicate', sheetId: 's' }]);
  const sheet = dup.workbook.sheets.find(sheet => sheet.id !== 's' && sheet.id !== 'other');
  assert.equal(sheet.drawings[1].line.end.binding.targetId, sheet.drawings[0].id);
  assert.notEqual(sheet.drawings[0].id, 'box');
});

test('marker-only updates and line movement respect feature gates and undo/redo', () => {
  const made = line(book()), id = made.results[0].drawingId;
  for (const arrow of ['none', 'triangle', 'openArrow', 'diamond', 'oval', 'stealth']) {
    const r = apply(made.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, startArrow: arrow, endArrow: arrow }], { features: { resize: false } });
    assert.equal(r.workbook.sheets[0].drawings[1].startArrow, arrow);
  }
  assert.equal(m.applySpreadsheetCommands(made.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, end: { x: 50, y: 80 } }], { features: { resize: false } }).ok, false);
  assert.equal(m.applySpreadsheetCommands(made.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, endArrow: 'oval' }], { features: { shapes: false } }).ok, false);
  const session = m.createSpreadsheetSession(made.workbook);
  assert.equal(session.batch([{ type: 'lines.update', sheetId: 's', drawingId: id, endArrow: 'diamond' }]).ok, true);
  assert.equal(session.getWorkbook().sheets[0].drawings[1].endArrow, 'diamond');
  session.undo(); assert.equal(session.getWorkbook().sheets[0].drawings[1].endArrow, undefined);
  session.redo(); assert.equal(session.getWorkbook().sheets[0].drawings[1].endArrow, 'diamond');
});
