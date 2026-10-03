import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zip, fixture, rel } from './helpers/xlsx-import-fixtures.mjs';
const output = await build({ stdin: { contents: `export * from './model-entry'; export { prepareWorksheetDrawings } from './export/xlsx/drawings';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const target = (id, row, column) => ({ id, type: 'shape', shape: 'roundedRectangle', anchor: { row, column, offsetX: 0, offsetY: 0 }, width: 160, height: 90, fill: '#fff', stroke: '#112233', strokeWidth: 2 });
const book = () => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Flow', rowCount: 100, columnCount: 20, cells: {}, drawings: [target('a', 2, 1), target('b', 9, 5)] }] });
const apply = (workbook, commands, options) => { const result = m.applySpreadsheetCommands(workbook, commands, options); assert.equal(result.ok, true, result.message); return result; };
const insert = (workbook = book(), patch = {}) => apply(workbook, [{ type: 'lines.insert', sheetId: 's', start: { x: 80, y: 120 }, end: { x: 400, y: 260 }, routing: 'elbow', ...patch }]);
const route = (workbook, id) => m.getSpreadsheetLineRoute(workbook.sheets[0], id);
const endpoints = (workbook, id) => m.getSpreadsheetLinePoints(workbook.sheets[0], id);
function orthogonal(actual) {
  assert.ok(actual.points.length >= 1);
  for (let index = 1; index < actual.points.length; index++) {
    const previous = actual.points[index - 1], point = actual.points[index];
    assert.ok(Math.abs(previous.x - point.x) < 1e-6 || Math.abs(previous.y - point.y) < 1e-6, JSON.stringify(actual.points));
  }
}

test('elbow routing persists through native JSON, copy and history; omitted routing stays straight', () => {
  for (const [x, y] of [[400, 260], [20, 20], [80, 260], [400, 120], [80, 120]]) {
    const made = insert(book(), { end: { x, y } }), id = made.results[0].drawingId;
    orthogonal(route(made.workbook, id));
    assert.deepEqual(m.parseWorkbook(m.serializeWorkbook(made.workbook)), made.workbook);
    const payload = m.copySpreadsheetDrawing(made.workbook, 's', id);
    const pasted = apply(made.workbook, [{ type: 'drawings.paste', sheetId: 's', payload, anchor: { row: 15, column: 3 } }]);
    assert.equal(pasted.workbook.sheets[0].drawings.at(-1).routing, 'elbow'); orthogonal(route(pasted.workbook, pasted.results[0].drawingId));
    const session = m.createSpreadsheetSession(made.workbook);
    assert.equal(session.execute({ type: 'lines.update', sheetId: 's', drawingId: id, routing: 'straight' }).ok, true);
    assert.equal(session.getShape('s', id).routing, undefined);
    assert.ok(route(session.getWorkbook(), id).points.length <= 2);
    assert.equal(session.undo(), true); assert.equal(session.getShape('s', id).routing, 'elbow');
    assert.equal(session.redo(), true); assert.equal(session.getShape('s', id).routing, undefined);
  }
});

test('bound elbow routes recalculate after target moves, transforms, and grid structure changes', () => {
  const made = insert(book(), { start: { x: 0, y: 0, binding: { targetId: 'a', port: 'right' } }, end: { x: 0, y: 0, binding: { targetId: 'b', port: 'left' } } });
  const id = made.results[0].drawingId, before = route(made.workbook, id);
  let changed = m.updateDrawing(made.workbook, 's', 'b', { width: 200, height: 120, rotation: 45, anchor: { row: 14, column: 7, offsetX: 4, offsetY: 3 } });
  changed = m.insertRows(changed, 's', 1, 2); changed = m.resizeColumn(changed, 's', 0, 150);
  const actual = route(changed, id), points = endpoints(changed, id); orthogonal(actual);
  assert.notDeepEqual(actual.points, before.points);
  assert.deepEqual(actual.points[0], { x: points.start.x, y: points.start.y });
  assert.deepEqual(actual.points.at(-1), { x: points.end.x, y: points.end.y });
  const bounds = m.getDrawingBounds(changed, 's', id);
  assert.equal(bounds.left, actual.bounds.x); assert.equal(bounds.top, actual.bounds.y);
  assert.equal(bounds.right, actual.bounds.x + actual.bounds.width); assert.equal(bounds.bottom, actual.bounds.y + actual.bounds.height);
  const detached = m.deleteDrawing(changed, 's', 'a');
  assert.equal(endpoints(detached, id).start.binding, undefined); orthogonal(route(detached, id));
});

test('routing validation is atomic and follows shapes permissions', () => {
  const made = insert(), id = made.results[0].drawingId, before = m.serializeWorkbook(made.workbook);
  for (const routing of ['curve', null, false, {}, 2]) {
    const result = m.applySpreadsheetCommands(made.workbook, [{ type: 'cells.set', sheetId: 's', values: { A1: 'partial' } }, { type: 'lines.update', sheetId: 's', drawingId: id, routing }]);
    assert.equal(result.ok, false); assert.equal(m.serializeWorkbook(made.workbook), before);
  }
  const bad = structuredClone(made.workbook); bad.sheets[0].drawings[0].routing = 'elbow';
  assert.throws(() => m.normalizeWorkbook(bad), /経路/);
  assert.equal(m.applySpreadsheetCommands(made.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, routing: 'straight' }], { features: { shapes: false } }).ok, false);
  assert.equal(m.applySpreadsheetCommands(made.workbook, [{ type: 'lines.update', sheetId: 's', drawingId: id, routing: 'straight' }], { features: { resize: false } }).ok, true);
});

test('legacy rectangle lines become endpoint lines through the route update API without moving their endpoints', () => {
  const workbook = m.addDrawing(book(), 's', { ...target('legacy', 4, 2), shape: 'arrow', flipX: true, rotation: 30 });
  const before = endpoints(workbook, 'legacy');
  const converted = apply(workbook, [{ type: 'lines.update', sheetId: 's', drawingId: 'legacy', routing: 'elbow' }]).workbook;
  const line = converted.sheets[0].drawings.at(-1);
  assert.equal(line.routing, 'elbow'); assert.ok(line.line); assert.equal(line.rotation, undefined);
  const after = endpoints(converted, 'legacy');
  assert.ok(Math.abs(after.start.x - before.start.x) < 1e-9); assert.ok(Math.abs(after.end.y - before.end.y) < 1e-9);
  orthogonal(route(converted, 'legacy'));
});

test('XLSX keeps automatic elbow geometry, free endpoint direction, bindings, and arrow markers', async () => {
  for (const patch of [
    { start: { x: 420, y: 350 }, end: { x: 80, y: 110 } },
    { start: { x: 80, y: 120 }, end: { x: 80, y: 120 } },
    { start: { x: 0, y: 0, binding: { targetId: 'a', port: 'left' } }, end: { x: 0, y: 0, binding: { targetId: 'b', port: 'left' } } },
  ]) {
    const made = insert(book(), { ...patch, startArrow: 'oval', endArrow: 'triangle' }), id = made.results[0].drawingId;
    const parts = await m.prepareWorksheetDrawings(made.workbook.sheets[0], undefined, { sheetIndex: 1 });
    const xml = await parts.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
    assert.match(xml, /<xdr:cxnSp>/); assert.match(xml, /<a:custGeom>/); assert.match(xml, /<a:lnTo>/);
    const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(made.workbook));
    const restored = imported.workbook.sheets[0].drawings.at(-1);
    assert.equal(restored.routing, 'elbow'); assert.equal(restored.startArrow, 'oval'); assert.equal(restored.endArrow, 'triangle');
    const actual = endpoints(imported.workbook, restored.id), expected = endpoints(made.workbook, id);
    for (const end of ['start', 'end']) {
      assert.ok(Math.abs(actual[end].x - expected[end].x) < .001); assert.ok(Math.abs(actual[end].y - expected[end].y) < .001);
      assert.equal(actual[end].binding?.port, expected[end].binding?.port);
    }
    orthogonal(route(imported.workbook, restored.id));
    assert.equal(imported.warnings.some(warning => /直線|経由点/.test(warning.message)), false);
  }
});


test('external bentConnector2 through bentConnector5 import as automatic elbow lines with explicit waypoint warning', async () => {
  for (const preset of ['bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5']) {
    const drawings = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:absoluteAnchor><xdr:pos x="952500" y="952500"/><xdr:ext cx="1905000" cy="952500"/><xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="1" name="External elbow"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:xfrm flipH="1"><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst><a:gd name="adj1" fmla="val 30000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="175066"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;
    const imported = await m.importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: 'External', xml: '<sheetData/><drawing r:id="drawing"/>' }], parts: {
      'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      'xl/drawings/drawing1.xml': drawings,
    } })));
    const line = imported.workbook.sheets[0].drawings[0];
    assert.equal(line.routing, 'elbow'); assert.equal(line.endArrow, 'triangle');
    assert.deepEqual(endpoints(imported.workbook, line.id), { start: { x: 300, y: 100 }, end: { x: 100, y: 200 } });
    assert.ok(imported.warnings.some(warning => warning.message.includes('自動経路')));
    orthogonal(route(imported.workbook, line.id));
  }
});

test('XLSX retains maximum-span elbow connectors whose automatic bends extend beyond endpoint limits', async () => {
  const workbook = m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Wide flow', rowCount: 100, columnCount: 200, cells: {}, drawings: [target('a', 2, 1), target('b', 9, 101)] }] });
  const made = insert(workbook, { start: { x: 0, y: 0, binding: { targetId: 'a', port: 'left' } }, end: { x: 0, y: 0, binding: { targetId: 'b', port: 'left' } } });
  const id = made.results[0].drawingId;
  assert.ok(route(made.workbook, id).bounds.width > 10_000);
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(made.workbook));
  assert.equal(imported.workbook.sheets[0].drawings.length, 3);
  const restored = imported.workbook.sheets[0].drawings.at(-1);
  assert.equal(restored.routing, 'elbow');
  const actual = endpoints(imported.workbook, restored.id), expected = endpoints(made.workbook, id);
  for (const end of ['start', 'end']) {
    assert.ok(Math.abs(actual[end].x - expected[end].x) < .001);
    assert.ok(Math.abs(actual[end].y - expected[end].y) < .001);
    assert.equal(actual[end].binding.port, 'left');
  }
});
