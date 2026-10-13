import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';
  export { getSpreadsheetLinePoints, withLinePoints } from './model/lines';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const emu = value => Math.round(value * 9525);
const transform = ({ x, y, width, height, rotation = 0 }) => `<xfrm rot="${rotation * 60000}"><off x="${emu(x)}" y="${emu(y)}"/><ext cx="${emu(width)}" cy="${emu(height)}"/></xfrm>`;
const line = (id, frame, references = '') => `<cxnSp><nvCxnSpPr><cNvPr id="${id}" name="Line ${id}"/><cNvCxnSpPr>${references}</cNvCxnSpPr></nvCxnSpPr><spPr>${transform(frame)}<prstGeom prst="straightConnector1"/><ln w="9525"/></spPr></cxnSp>`;
const shape = id => `<sp><nvSpPr><cNvPr id="${id}" name="Shape ${id}"/><cNvSpPr/></nvSpPr><spPr><prstGeom prst="rect"/><ln w="0"/></spPr><txBody><bodyPr/><p><r><t>Keep ${id}</t></r></p></txBody></sp>`;
const anchor = (object, { x, y, width, height }) => `<absoluteAnchor><pos x="${emu(x)}" y="${emu(y)}"/><ext cx="${emu(width)}" cy="${emu(height)}"/>${object}</absoluteAnchor>`;
const file = drawings => zip(fixture({ sheets: [{ name: 'Drawing recovery', xml: '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Keep cell</t></is></c></row></sheetData><drawing r:id="d"/>' }], parts: {
  'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="d" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  'xl/drawings/drawing1.xml': `<wsDr>${drawings}</wsDr>`,
} }));
const readPoints = sheet => m.getSpreadsheetLinePoints(sheet, sheet.drawings.find(d => d.line).id);

test('a rotation-expanded line is omitted with a warning, preserving cells and valid drawing references', async () => {
  const huge = { x: 3000, y: 3000, width: 10000, height: 10000, rotation: 45 };
  const normal = { x: 100, y: 100, width: 100, height: 0 };
  const input = file(anchor(line(1, huge), huge) + anchor(shape(2), { ...normal, height: 30 }) +
    anchor(line(3, normal, '<stCxn id="1" idx="0"/>'), normal));
  const result = await m.importSpreadsheetXlsx(input), sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, 'Keep cell');
  assert.equal(sheet.drawings.length, 2);
  assert.equal(sheet.drawings[0].text, 'Keep 2');
  assert.deepEqual(readPoints(sheet), { start: { x: 100, y: 100 }, end: { x: 200, y: 100 } });
  assert.ok(result.warnings.some(w => w.code === 'omitted' && /線.*10,000px/.test(w.message)));
  assert.ok(result.warnings.some(w => w.code === 'adjusted' && w.message.includes('接続を解除')));
  const again = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(result.workbook));
  assert.deepEqual(readPoints(again.workbook.sheets[0]), readPoints(sheet));
});

test('binding a short imported line to distant targets detaches without changing its source endpoints', async () => {
  const normal = { x: 100, y: 100, width: 100, height: 0 };
  const result = await m.importSpreadsheetXlsx(file(
    anchor(shape(1), { x: 100, y: 100, width: 100, height: 30 }) +
    anchor(shape(2), { x: 20000, y: 100, width: 100, height: 30 }) +
    anchor(line(3, normal, '<stCxn id="1" idx="3"/><endCxn id="2" idx="1"/>'), normal)));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.drawings.length, 3);
  assert.deepEqual(readPoints(sheet), { start: { x: 100, y: 100 }, end: { x: 200, y: 100 } });
  assert.ok(result.warnings.some(w => w.code === 'adjusted' && w.message.includes('接続を解除')));
});

test('a rotated line whose endpoint crosses the negative coordinate limit is isolated', async () => {
  const outside = { x: -10000, y: 100, width: 100, height: 100, rotation: 135 };
  const sourceAnchor = { x: 0, y: 100, width: 100, height: 100 };
  const result = await m.importSpreadsheetXlsx(file(anchor(line(1, outside), sourceAnchor) + anchor(shape(2), sourceAnchor)));
  assert.equal(result.workbook.sheets[0].cells.A1.value, 'Keep cell');
  assert.equal(result.workbook.sheets[0].drawings.length, 1);
  assert.equal(result.workbook.sheets[0].drawings[0].text, 'Keep 2');
  assert.ok(result.warnings.some(w => w.code === 'omitted' && w.message.includes('端点がシートの対応範囲外')));
});

test('binding expansion below 10,000px retains its supported port binding', async () => {
  const normal = { x: 100, y: 100, width: 100, height: 0 };
  const result = await m.importSpreadsheetXlsx(file(
    anchor(shape(1), { x: 100, y: 100, width: 100, height: 30 }) +
    anchor(shape(2), { x: 500, y: 100, width: 100, height: 30 }) +
    anchor(line(3, normal, '<stCxn id="1" idx="3"/><endCxn id="2" idx="1"/>'), normal)));
  const sheet = result.workbook.sheets[0], points = readPoints(sheet);
  assert.ok(points.start.binding); assert.ok(points.end.binding);
  assert.equal(result.warnings.length, 0);
});

test('native line operations still reject a span beyond 10,000px', async () => {
  const normal = { x: 100, y: 100, width: 100, height: 0 };
  const result = await m.importSpreadsheetXlsx(file(anchor(line(1, normal), normal)));
  const sheet = result.workbook.sheets[0];
  assert.throws(() => m.withLinePoints(sheet, sheet.drawings[0], {
    start: { x: 0, y: 100 }, end: { x: 11000, y: 100 },
  }), /線の幅・高さは10,000px|線の端点がシートの対応範囲外/);
});
