import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: { contents: `export * from './model-entry';
  export { prepareWorksheetDrawings } from './export/xlsx/drawings';
  export { drawingTextTransform } from './ui/drawings/drawing-text-style';
  export { DrawingText } from './ui/drawings/drawing-text';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
function create(kind = 'shapes', patch = {}) {
  const result = m.applySpreadsheetCommands(m.createWorkbook(), [{ type: `${kind}.insert`, sheetId,
    ...(kind === 'shapes' ? { shape: 'rectangle', strokeWidth: 0 } : {}), anchor: { row: 3, column: 2 },
    width: 160, height: 80, text: '回転の確認', rotation: 30, textRotation: 90, ...patch }]);
  assert.equal(result.ok, true, result.message); return result.workbook;
}
const drawing = workbook => workbook.sheets[0].drawings[0];

test('shape and text angles remain independent through commands, copy, SPON and history', () => {
  for (const kind of ['shapes', 'textBoxes']) {
    const initial = create(kind, { textRotation: -90 });
    assert.equal(drawing(initial).rotation, 30); assert.equal(drawing(initial).textRotation, 270);
    assert.deepEqual(m.parseWorkbook(m.serializeWorkbook(initial)), initial);
    assert.equal(m.copySpreadsheetDrawing(initial, sheetId, drawing(initial).id).drawing.textRotation, 270);
    const session = m.createSpreadsheetSession(initial);
    const command = { type: `${kind}.update`, sheetId, drawingId: drawing(initial).id, patch: { textRotation: 450, textUpright: true } };
    assert.equal(session.execute(command).ok, true); assert.equal(drawing(session.getWorkbook()).rotation, 30);
    assert.equal(drawing(session.getWorkbook()).textRotation, 90); assert.equal(drawing(session.getWorkbook()).textUpright, true);
    assert.equal(session.undo(), true); assert.equal(drawing(session.getWorkbook()).textRotation, 270);
    assert.equal(session.redo(), true); assert.equal(drawing(session.getWorkbook()).textUpright, true);
    const reset = m.applySpreadsheetCommands(session.getWorkbook(), [{ ...command, patch: { textRotation: 360, textUpright: false } }]);
    assert.equal(reset.ok, true); assert.equal(drawing(reset.workbook).textRotation, undefined); assert.equal(drawing(reset.workbook).textUpright, undefined);
  }
});

test('invalid independent angles and upright flags reject the complete batch', () => {
  const initial = create();
  for (const patch of [{ textRotation: Infinity }, { textRotation: '90' }, { textRotation: null }, { textUpright: 1 }]) {
    const result = m.applySpreadsheetCommands(initial, [
      { type: 'cells.set', sheetId, values: { A1: 'must not be applied' } },
      { type: 'shapes.update', sheetId, drawingId: drawing(initial).id, patch },
    ]);
    assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND'); assert.equal(initial.sheets[0].cells.A1, undefined);
  }
  assert.equal(m.applySpreadsheetCommands(initial, [{ type: 'shapes.update', sheetId, drawingId: drawing(initial).id,
    patch: { textRotation: 10 } }], { features: { shapes: false } }).code, 'FEATURE_DISABLED');
});

test('text transforms add to the parent angle, while upright cancels it and preserves textbox background', () => {
  const shape = drawing(create());
  assert.deepEqual(m.drawingTextTransform(shape), { transform: 'rotate(90deg)', transformOrigin: 'center' });
  assert.equal(m.drawingTextTransform({ ...shape, textUpright: true }).transform, 'rotate(330deg)');
  assert.equal(m.drawingTextTransform({ ...shape, textUpright: true }, 45).transform, 'rotate(315deg)', 'live parent rotation is cancelled');
  assert.deepEqual(m.drawingTextTransform({ ...shape, textRotation: undefined }), {}, 'ordinary text inherits the parent exactly once');
  const box = drawing(create('textBoxes', { background: '#ff0000' }));
  const html = renderToStaticMarkup(createElement(m.DrawingText, { drawing: box }));
  assert.match(html, /aria-hidden="true"[^>]*background:#ff0000/);
  assert.match(html, /class="lxs-text-box"[^>]*background:transparent[^>]*transform:rotate\(90deg\)/);
});

test('independently authored XLSX text rotations and upright flags are imported without dropping them', async () => {
  const shapeXml = (id, body) => `<xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1524000" cy="762000"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="Shape"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm rot="1800000"><a:off x="1219200" y="800100"/><a:ext cx="1524000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr ${body}/><a:p><a:r><a:t>回転</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>`;
  const workbook = fixture({ sheets: [{ name: 'Sheet', xml: '<sheetData/><drawing r:id="drawing"/>' }], parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${shapeXml(1, 'rot="-5400000"')}${shapeXml(2, 'rot="5400000" upright="true"')}${shapeXml(3, 'rot="bad"')}</xdr:wsDr>`,
  } });
  const result = await m.importSpreadsheetXlsx(zip(workbook));
  const [counterclockwise, upright, malformed] = result.workbook.sheets[0].drawings;
  assert.equal(counterclockwise.rotation, 30); assert.equal(counterclockwise.textRotation, 270);
  assert.equal(upright.rotation, 30); assert.equal(upright.textRotation, 90); assert.equal(upright.textUpright, true);
  assert.equal(malformed.textRotation, undefined);
  assert.ok(result.warnings.some(warning => /不正な文字回転/.test(warning.message)));
  assert.ok(result.warnings.every(warning => !/図形と異なる文字の回転/.test(warning.message)));
});

test('XLSX stores independent DrawingML text rotation and restores it with reflected and upright frames', async () => {
  for (const kind of ['shapes', 'textBoxes']) for (const rotation of [0, 30]) for (const flipY of [false, true]) for (const textUpright of [false, true]) {
    const workbook = create(kind, { rotation, flipY, textUpright });
    const prepared = await m.prepareWorksheetDrawings(workbook.sheets[0], workbook.resources, { sheetIndex: 1 });
    const xml = await prepared.parts.find(part => part.path.endsWith('drawing1.xml')).content.text();
    if (rotation) assert.match(xml, /<a:xfrm[^>]*rot="1800000"/);
    assert.match(xml, new RegExp(`<a:bodyPr[^>]*upright="${textUpright ? 1 : 0}"[^>]*rot="${(!textUpright && flipY ? 270 : 90) * 60000}"`));
    const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(workbook));
    assert.equal(drawing(imported.workbook).rotation ?? 0, rotation); assert.equal(drawing(imported.workbook).textRotation, 90);
    assert.equal(!!drawing(imported.workbook).textUpright, textUpright);
    assert.ok(imported.warnings.every(warning => !/文字の回転|文字回転/.test(warning.message)));
  }
});

test('unrotated exports do not silently opt into keeping text horizontal after a later rotation', async () => {
  const workbook = create('shapes', { rotation: 0, textRotation: 0 });
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(workbook));
  const restored = drawing(imported.workbook);
  assert.equal(restored.textUpright, undefined);
  const changed = m.applySpreadsheetCommands(imported.workbook, [{ type: 'shapes.update', sheetId: imported.workbook.sheets[0].id,
    drawingId: restored.id, patch: { rotation: 90 } }]);
  assert.equal(changed.ok, true); assert.deepEqual(m.drawingTextTransform(drawing(changed.workbook)), {});
});

test('converting legacy rotated lines to endpoint geometry preserves the combined text angle', () => {
  for (const textUpright of [false, true]) {
    const workbook = create('shapes', { shape: 'line', textUpright });
    const before = drawing(workbook), points = m.getSpreadsheetLinePoints(workbook.sheets[0], before.id);
    const converted = m.applySpreadsheetCommands(workbook, [{ type: 'lines.update', sheetId, drawingId: before.id,
      start: { x: points.start.x + 10, y: points.start.y }, end: { x: points.end.x + 10, y: points.end.y } }]);
    assert.equal(converted.ok, true); assert.equal(drawing(converted.workbook).rotation, undefined);
    assert.equal(drawing(converted.workbook).textRotation, 120); assert.equal(!!drawing(converted.workbook).textUpright, textUpright);
  }
});
