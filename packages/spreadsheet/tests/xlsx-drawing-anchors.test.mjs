import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export { readWorksheet } from './import/worksheet';
  export { readWorksheetDrawings } from './import/drawings'; export { parseXml } from './import/xml';
  export { anchorPoint, sheetDrawingGeometry, getSpreadsheetLinePoints } from './model/lines';
  export { rotatedDrawingBounds } from './model/drawing-transform';
  export { normalizeWorkbook } from './model/workbook';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = value => new TextEncoder().encode(value), emu = value => Math.round(value * 9525);
const drawingPath = 'xl/drawings/drawing1.xml';
const marker = (name, row, column, dx = 0, dy = 0) => `<${name}><col>${column}</col><colOff>${emu(dx)}</colOff><row>${row}</row><rowOff>${emu(dy)}</rowOff></${name}>`;
const transform = ({ x, y, width, height, rotation = 0, flipY = false }) => `<xfrm rot="${rotation * 60000}"${flipY ? ' flipV="1"' : ''}><off x="${emu(x)}" y="${emu(y)}"/><ext cx="${emu(width)}" cy="${emu(height)}"/></xfrm>`;
const shape = frame => `<sp><nvSpPr><cNvPr id="1"/><cNvSpPr/></nvSpPr><spPr>${transform(frame)}<prstGeom prst="rect"/><ln><noFill/></ln></spPr></sp>`;
const connector = frame => `<cxnSp><nvCxnSpPr><cNvPr id="2"/><cNvCxnSpPr/></nvCxnSpPr><spPr>${transform(frame)}<prstGeom prst="straightConnector1"/><ln><tailEnd type="triangle"/></ln></spPr></cxnSp>`;
const two = (object, start, end) => `<twoCellAnchor>${marker('from', ...start)}${marker('to', ...end)}${object}</twoCellAnchor>`;
const one = (object, start, width, height) => `<oneCellAnchor>${marker('from', ...start)}<ext cx="${emu(width)}" cy="${emu(height)}"/>${object}</oneCellAnchor>`;

async function imported(drawings, dimensions) {
  const warnings = [], files = new Map([[drawingPath, bytes(`<wsDr>${drawings}</wsDr>`)]]);
  const context = { archive: { paths: [...files.keys()], has: path => files.has(path), read: async path => {
    assert.ok(files.has(path), path); return files.get(path);
  } }, resources: {}, warnings, warn: warning => warnings.push(warning) };
  const node = m.parseXml(bytes(`<worksheet>${dimensions}<drawing r:id="d"/></worksheet>`));
  const initial = await m.readWorksheet(node, 's', 'Sheet', [], [undefined], false, context);
  const sheet = await m.readWorksheetDrawings(node, initial, new Map([['d', { id: 'd',
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', target: drawingPath, external: false }]]), context);
  assert.doesNotThrow(() => m.normalizeWorkbook({ sheets: [sheet] }));
  return { sheet, warnings, start: m.anchorPoint(sheet.drawings[0].anchor, m.sheetDrawingGeometry(sheet)),
    points: m.getSpreadsheetLinePoints(sheet, sheet.drawings[1].id) };
}

test('external two-cell anchors and connector transforms preserve 10px worksheet rows and columns together', async () => {
  const frame = { x: 100, y: 100, width: 20, height: 20 };
  for (const dimensions of [
    '<sheetFormatPr defaultRowHeight="7.5" defaultColWidth="1.42578125"/><sheetData/>',
    `<sheetData>${Array.from({ length: 12 }, (_, index) => `<row r="${index + 1}" ht="7.5"/>`).join('')}</sheetData><cols><col min="1" max="12" width="1.42578125"/></cols>`,
  ]) {
    const result = await imported(two(shape(frame), [10, 10], [12, 12]) + two(connector(frame), [10, 10], [12, 12]), dimensions);
    assert.equal(result.sheet.rowHeights[0], 10); assert.equal(result.sheet.columnWidths[0], 10);
    assert.deepEqual(result.start, { x: 100, y: 100 });
    assert.deepEqual(result.points.start, result.start); assert.deepEqual(result.points.end, { x: 120, y: 120 });
    assert.equal(result.sheet.drawings[0].width, 20); assert.equal(result.sheet.drawings[0].height, 20);
    assert.equal(result.warnings.length, 0);
  }
});

test('normalizing oversized rows rebases free connector endpoints with the same two-cell anchor as shapes', async () => {
  const frame = { x: 128, y: 3000, width: 64, height: 1500 };
  const result = await imported(two(shape(frame), [2, 2], [3, 3]) + two(connector(frame), [2, 2], [3, 3]),
    '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
  assert.deepEqual(result.start, { x: 128, y: 2000 });
  assert.deepEqual(result.points.start, result.start); assert.deepEqual(result.points.end, { x: 192, y: 3000 });
  assert.equal(result.sheet.drawings[0].height, 1000);
});

test('subpixel source row heights still rebase connector transforms when raised to the 1px minimum', async () => {
  const frame = { x: 64, y: 5, width: 64, height: 1 };
  const result = await imported(two(shape(frame), [10, 1], [12, 2]) + two(connector(frame), [10, 1], [12, 2]),
    '<sheetFormatPr defaultRowHeight="0.375"/><sheetData/>');
  assert.deepEqual(result.start, { x: 64, y: 10 });
  assert.deepEqual(result.points.start, result.start); assert.deepEqual(result.points.end, { x: 128, y: 12 });
  assert.equal(result.sheet.drawings[0].height, 2);
});

test('one-cell anchors move native connector transforms without scaling their extents', async () => {
  const frame = { x: 128, y: 3000, width: 64, height: 60 };
  const result = await imported(one(shape(frame), [2, 2], 64, 60) + one(connector(frame), [2, 2], 64, 60),
    '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
  assert.deepEqual(result.start, { x: 128, y: 2000 });
  assert.deepEqual(result.points.start, result.start); assert.deepEqual(result.points.end, { x: 192, y: 2060 });
  assert.equal(result.sheet.drawings[0].height, 60);
});

test('rotated free connector endpoints are transformed before rebasing onto the normalized grid', async () => {
  const frame = { x: 128, y: 3000, width: 100, height: 100, rotation: 90 };
  const result = await imported(one(shape(frame), [2, 2], 100, 100) + one(connector(frame), [2, 2], 100, 100),
    '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
  assert.deepEqual(result.start, { x: 128, y: 2000 });
  assert.deepEqual(result.points.start, { x: 228, y: 2000 }); assert.deepEqual(result.points.end, { x: 128, y: 2100 });
});

test('quarter-turn shapes scale their local axes to match normalized two-cell anchors', async () => {
  for (const rotation of [90, 270]) {
    const frame = { x: 200, y: 2950, width: 3000, height: 100, rotation };
    const result = await imported(two(shape(frame), [1, 25, 50], [3, 27, 22]) + two(connector(frame), [1, 25, 50], [3, 27, 22]),
      '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
    const drawing = result.sheet.drawings[0], bounds = m.rotatedDrawingBounds({ left: result.start.x, top: result.start.y, width: drawing.width, height: drawing.height }, rotation);
    assert.equal(drawing.width, 2000); assert.equal(drawing.height, 100);
    for (const [key, expected] of Object.entries({ left: 1650, top: 1000, width: 100, height: 2000 }))
      assert.ok(Math.abs(bounds[key] - expected) < 1e-8, `${rotation}: ${key}: ${bounds[key]}`);
    assert.equal(result.warnings.some(item => item.message.includes('回転図形の変形')), false);
  }
});

test('nonuniform scaling of an oblique shape preserves its center and reports the unrepresentable shear', async () => {
  const size = 1500 / Math.sqrt(2), frame = { x: 814 - size / 2, y: 2250 - size / 2, width: size, height: size, rotation: 45 };
  const result = await imported(two(shape(frame), [1, 1], [2, 24, 28]) + two(connector(frame), [1, 1], [2, 24, 28]),
    '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
  const drawing = result.sheet.drawings[0];
  assert.ok(Math.abs(result.start.x + drawing.width / 2 - 814) < 0.001);
  assert.ok(Math.abs(result.start.y + drawing.height / 2 - 1500) < 0.001);
  assert.ok(Math.abs(drawing.width - size * 5 / 6) < 0.001);
  assert.ok(Math.abs(drawing.height - size * 5 / 6) < 0.001);
  assert.ok(result.warnings.some(item => item.code === 'adjusted' && item.message.includes('回転図形の変形')));
});

test('absolute anchors keep absolute positions when worksheet dimensions are normalized', async () => {
  const frame = { x: 128, y: 3000, width: 64, height: 60 };
  const absolute = object => `<absoluteAnchor><pos x="${emu(frame.x)}" y="${emu(frame.y)}"/><ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/>${object}</absoluteAnchor>`;
  const result = await imported(absolute(shape(frame)) + absolute(connector(frame)),
    '<sheetFormatPr defaultRowHeight="1125"/><sheetData/>');
  assert.deepEqual(result.start, { x: 128, y: 3000 });
  assert.deepEqual(result.points.start, result.start); assert.deepEqual(result.points.end, { x: 192, y: 3060 });
});
