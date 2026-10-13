import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export { readWorksheet } from './import/worksheet';
  export { readWorksheetDrawings } from './import/drawings'; export { parseXml } from './import/xml';
  export { prepareWorksheetDrawings } from './export/xlsx/drawings';
  export { getSpreadsheetLinePoints } from './model/lines'; export { normalizeWorkbook } from './model/workbook';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = value => new TextEncoder().encode(value), emu = value => Math.round(value * 9525);
const drawingPath = 'xl/drawings/drawing1.xml';
const marker = (name, x, y) => `<${name}><col>${Math.floor(x / 64)}</col><colOff>${emu(x % 64)}</colOff><row>${Math.floor(y / 20)}</row><rowOff>${emu(y % 20)}</rowOff></${name}>`;
const transform = ({ x, y, width, height, rotation = 0, flipX = false, flipY = false }) => `<xfrm rot="${rotation * 60000}" flipH="${+flipX}" flipV="${+flipY}"><off x="${emu(x)}" y="${emu(y)}"/><ext cx="${emu(width)}" cy="${emu(height)}"/></xfrm>`;
const line = (tag, frame) => `<${tag}>${tag === 'sp' ? '<nvSpPr><cNvPr id="1"/><cNvSpPr/></nvSpPr>' : '<nvCxnSpPr><cNvPr id="1"/><cNvCxnSpPr/></nvCxnSpPr>'}<spPr>${frame ? transform(frame) : ''}<prstGeom prst="line"/><ln w="19050"><solidFill><srgbClr val="123456"/></solidFill><headEnd type="diamond"/><tailEnd type="triangle"/></ln></spPr></${tag}>`;
const anchor = (kind, object, { x, y, width, height }) => `<${kind}>${marker('from', x, y)}${kind === 'twoCellAnchor' ? marker('to', x + width, y + height) : `<ext cx="${emu(width)}" cy="${emu(height)}"/>`}${object}</${kind}>`;

async function imported(xml, fullDocument = false) {
  const warnings = [], files = new Map([[drawingPath, bytes(fullDocument ? xml : `<wsDr>${xml}</wsDr>`)]]);
  const context = { archive: { paths: [...files.keys()], has: path => files.has(path), read: async path => {
    assert.ok(files.has(path), path); return files.get(path);
  } }, resources: {}, warnings, warn: warning => warnings.push(warning) };
  const node = m.parseXml(bytes('<worksheet><sheetFormatPr defaultRowHeight="15"/><sheetData/><drawing r:id="d"/></worksheet>'));
  const initial = await m.readWorksheet(node, 's', 'Sheet', [], [undefined], false, context);
  const sheet = await m.readWorksheetDrawings(node, initial, new Map([['d', { id: 'd',
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', target: drawingPath, external: false }]]), context);
  assert.doesNotThrow(() => m.normalizeWorkbook({ sheets: [sheet] }));
  return { sheet, warnings };
}
const equalPoint = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8, `x: ${actual.x} vs ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8, `y: ${actual.y} vs ${expected.y}`);
};

test('cell anchors position unrotated connectors even when cached transforms disagree', async () => {
  for (const kind of ['oneCellAnchor', 'twoCellAnchor']) for (const [width, height] of [[128, 0], [0, 60], [128, 60]]) {
    const frame = { x: 128, y: 200, width, height };
    const result = await imported(anchor(kind, line('cxnSp', { ...frame, x: 208, y: 120, width: width * 2, height: height * 2 }), frame));
    assert.equal(result.sheet.drawings?.length, 1);
    const points = m.getSpreadsheetLinePoints(result.sheet, result.sheet.drawings[0].id);
    equalPoint(points.start, { x: 128, y: 200 }); equalPoint(points.end, { x: 128 + width, y: 200 + height });
    assert.equal(result.warnings.length, 0);
  }
});

test('native sp lines import exact visible endpoints, including zero extents and flips', async () => {
  for (const kind of ['oneCellAnchor', 'twoCellAnchor']) for (const [width, height] of [[128, 0], [0, 60], [128, 60], [0, 0]]) {
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const frame = { x: 128, y: 200, width, height, flipX, flipY };
      const result = await imported(anchor(kind, line('sp', frame), frame));
      assert.equal(result.sheet.drawings?.length, 1);
      const drawing = result.sheet.drawings[0], points = m.getSpreadsheetLinePoints(result.sheet, drawing.id);
      equalPoint(points.start, { x: 128 + (flipX ? width : 0), y: 200 + (flipY ? height : 0) });
      equalPoint(points.end, { x: 128 + (flipX ? 0 : width), y: 200 + (flipY ? 0 : height) });
      assert.equal(drawing.startArrow, 'diamond'); assert.equal(drawing.endArrow, 'triangle');
      assert.equal(drawing.strokeWidth, 2); assert.equal(drawing.stroke, '#123456');
      assert.ok(drawing.line); assert.equal(result.warnings.length, 0);
    }
  }
});

test('native sp line rotation is applied to endpoints without a second legacy inset', async () => {
  const frame = { x: 128, y: 200, width: 120, height: 60, rotation: 90 };
  const result = await imported(anchor('oneCellAnchor', line('sp', frame), frame));
  const drawing = result.sheet.drawings[0], points = m.getSpreadsheetLinePoints(result.sheet, drawing.id);
  equalPoint(points.start, { x: 218, y: 170 }); equalPoint(points.end, { x: 158, y: 290 });
  assert.equal(drawing.rotation, undefined); assert.ok(drawing.line);
});

test('zero-extent cell anchors recover native lines without a transform', async () => {
  for (const tag of ['sp', 'cxnSp']) for (const [width, height] of [[128, 0], [0, 60]]) {
    const frame = { x: 128, y: 200, width, height };
    const result = await imported(anchor('twoCellAnchor', line(tag), frame));
    assert.equal(result.sheet.drawings?.length, 1);
    const points = m.getSpreadsheetLinePoints(result.sheet, result.sheet.drawings[0].id);
    equalPoint(points.start, { x: 128, y: 200 }); equalPoint(points.end, { x: 128 + width, y: 200 + height });
  }
});

test('native sp line endpoints and arrowheads survive export as native connectors and reimport', async () => {
  for (const [width, height, rotation] of [[128, 0, 0], [0, 60, 0], [128, 60, 0], [128, 60, 45]]) {
    const frame = { x: 128, y: 200, width, height, rotation, flipX: true };
    const first = await imported(anchor('oneCellAnchor', line('sp', frame), frame));
    const output = await m.prepareWorksheetDrawings(first.sheet, undefined, { sheetIndex: 1 });
    const xml = await output.parts.find(part => part.path === drawingPath).content.text();
    assert.match(xml, /<xdr:cxnSp>/);
    const second = await imported(xml, true);
    const before = m.getSpreadsheetLinePoints(first.sheet, first.sheet.drawings[0].id);
    const after = m.getSpreadsheetLinePoints(second.sheet, second.sheet.drawings[0].id);
    for (const key of ['start', 'end']) {
      assert.ok(Math.abs(before[key].x - after[key].x) < 1 / 9525);
      assert.ok(Math.abs(before[key].y - after[key].y) < 1 / 9525);
    }
    assert.equal(second.sheet.drawings[0].startArrow, 'diamond');
    assert.equal(second.sheet.drawings[0].endArrow, 'triangle');
    assert.equal(second.warnings.length, 0);
  }
});
