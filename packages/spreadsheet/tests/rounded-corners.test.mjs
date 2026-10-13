import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundle = await build({ stdin: { contents: `export * from './model-entry';
  export { Shape } from './ui/drawings/shape'; export { shapeTextFrame } from './model/shapes';
  export { spreadsheetDrawingOutline } from './model/lines';
  export { prepareWorksheetDrawings } from './export/xlsx/drawings';
  export { readWorksheetDrawings } from './import/drawings'; export { parseXml } from './import/xml';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  jsx: 'automatic', plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const insert = extra => ({ type: 'shapes.insert', sheetId, shape: 'roundedRectangle', anchor: { row: 2, column: 1 },
  width: 182, height: 102, strokeWidth: 2, ...extra });
function apply(book, commands) { const result = m.applySpreadsheetCommands(book, commands); assert.equal(result.ok, true, result.message); return result.workbook; }
const make = ratio => apply(m.createWorkbook(), [insert(ratio === undefined ? {} : { cornerRadiusRatio: ratio })]);
const drawing = book => book.sheets[0].drawings[0];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);

test('roundness uses one radius for SVG, text area and connection outline, including zero and maximum', () => {
  for (const ratio of [undefined, 0, 0.3, 0.5]) {
    const shape = drawing(make(ratio)), radius = 100 * (ratio ?? 0.16667);
    const svg = renderToStaticMarkup(createElement(m.Shape, { drawing: shape }));
    close(Number(svg.match(/rx="([^"]+)"/)[1]), radius);
    const text = m.shapeTextFrame(shape), outline = m.spreadsheetDrawingOutline(shape);
    close(text.left, 1 + radius * 0.29289); close(text.width, 180 - 2 * radius * 0.29289);
    close(outline.radiusX * 180, radius); close(outline.radiusY * 100, radius);
    assert.equal(shape.cornerRadiusRatio, ratio, 'legacy omission and explicit zero remain distinct');
  }
});

test('corner radius persists through commands, immutable updates, JSON, copy, undo and redo', () => {
  const initial = make(0.35), original = drawing(initial);
  assert.deepEqual(m.parseWorkbook(m.serializeWorkbook(initial)), initial);
  const payload = m.copySpreadsheetDrawing(initial, sheetId, original.id);
  const copied = apply(initial, [{ type: 'drawings.paste', sheetId, payload, anchor: { row: 5, column: 3 } }]);
  assert.equal(copied.sheets[0].drawings[1].cornerRadiusRatio, 0.35);
  const session = m.createSpreadsheetSession(initial);
  assert.equal(session.execute({ type: 'shapes.update', sheetId, drawingId: original.id, patch: { cornerRadiusRatio: 0 } }).ok, true);
  assert.equal(session.getShape(sheetId, original.id).cornerRadiusRatio, 0);
  assert.equal(original.cornerRadiusRatio, 0.35);
  assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), initial);
  assert.equal(session.redo(), true); assert.equal(session.getShape(sheetId, original.id).cornerRadiusRatio, 0);
});

test('invalid radius rejects insert, update and batch atomically and cannot enter native JSON', () => {
  const initial = make(0.2), original = drawing(initial);
  for (const value of [-0.01, 0.50001, NaN, Infinity, -Infinity, '0.2', null]) {
    assert.equal(m.applySpreadsheetCommands(initial, [insert({ cornerRadiusRatio: value })]).ok, false);
    const result = m.applySpreadsheetCommands(initial, [
      { type: 'cells.set', sheetId, values: { A1: 'must not persist' } },
      { type: 'shapes.update', sheetId, drawingId: original.id, patch: { cornerRadiusRatio: value } },
    ]);
    assert.equal(result.ok, false); assert.equal(initial.sheets[0].cells.A1, undefined); assert.equal(original.cornerRadiusRatio, 0.2);
    assert.throws(() => m.normalizeWorkbook({ ...initial, sheets: [{ ...initial.sheets[0], drawings: [{ ...original, cornerRadiusRatio: value }] }] }));
  }
});

const path = 'xl/drawings/drawing1.xml', bytes = value => new TextEncoder().encode(value);
async function importDrawing(xml, base) {
  const warnings = [], context = { archive: { paths: [path], has: name => name === path, read: async name => { assert.equal(name, path); return bytes(xml); } },
    resources: {}, warnings, warn: warning => warnings.push(warning) };
  const sheet = await m.readWorksheetDrawings(m.parseXml(bytes('<worksheet><sheetFormatPr defaultRowHeight="21" defaultColWidth="14.28515625"/><drawing r:id="drawing"/></worksheet>')),
    { ...base, drawings: undefined }, new Map([['drawing', { id: 'drawing', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing', target: path, external: false }]]), context);
  return { sheet, warnings };
}
async function exportDrawing(book) {
  const result = await m.prepareWorksheetDrawings(book.sheets[0], book.resources, { sheetIndex: 1 });
  return result.parts.find(part => part.path === path).content.text();
}

test('native XLSX roundRect adjustment roundtrips zero, nondefault and maximum without approximation', async () => {
  for (const ratio of [undefined, 0, 0.3, 0.5]) {
    const book = make(ratio), xml = await exportDrawing(book), result = await importDrawing(xml, book.sheets[0]);
    assert.match(xml, /prst="roundRect"/);
    if (ratio !== undefined) assert.ok(xml.includes(`<a:gd name="adj" fmla="val ${ratio * 100000}"/>`));
    assert.equal(result.sheet.drawings[0].cornerRadiusRatio, ratio);
    assert.equal(result.warnings.length, 0);
    assert.equal(drawing(book).cornerRadiusRatio, ratio);
  }
});

test('connected custom geometry retains its radius and attachment through XLSX', async () => {
  for (const ratio of [0, 0.4, 0.5]) {
    const book = make(ratio), shape = drawing(book);
    const connected = apply(book, [{ type: 'lines.insert', sheetId, start: { x: 10, y: 10 },
      end: { x: 0, y: 0, binding: { targetId: shape.id, port: 'topRight' } } }]);
    const expected = m.getSpreadsheetLinePoints(connected.sheets[0], connected.sheets[0].drawings[1].id);
    const result = await importDrawing(await exportDrawing(connected), connected.sheets[0]);
    assert.equal(result.sheet.drawings[0].cornerRadiusRatio, ratio);
    assert.deepEqual(result.sheet.drawings[1].line.end.binding, { targetId: result.sheet.drawings[0].id, port: 'topRight' });
    const actual = m.getSpreadsheetLinePoints(result.sheet, result.sheet.drawings[1].id);
    close(actual.end.x, expected.end.x); close(actual.end.y, expected.end.y);
    assert.equal(result.warnings.length, 0);
  }
});

test('native adjusted roundRect keeps standard cardinal connections instead of detaching', async () => {
  const book = make(0.4), connected = apply(book, [{ type: 'lines.insert', sheetId, start: { x: 10, y: 10 },
    end: { x: 0, y: 0, binding: { targetId: drawing(book).id, port: 'left' } } }]);
  const xml = (await exportDrawing(connected)).replace(/<a:custGeom>[\s\S]*?<\/a:custGeom>/,
    '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>').replace('idx="6"', 'idx="1"');
  const result = await importDrawing(xml, book.sheets[0]);
  assert.equal(result.sheet.drawings[0].cornerRadiusRatio, 0.4);
  assert.equal(result.sheet.drawings[1].line.end.binding.port, 'left');
  assert.equal(result.warnings.length, 0);
});

test('unsupported radius formulas and out-of-range Office adjustments warn instead of silently losing deformation', async () => {
  const book = make(0.3), xml = await exportDrawing(book);
  for (const [value, expected] of [['val 90000', 0.5], ['val -1', 0], ['*/ 2 3 4', undefined]]) {
    const result = await importDrawing(xml.replace('val 30000', value), book.sheets[0]);
    assert.equal(result.sheet.drawings[0].cornerRadiusRatio, expected);
    assert.ok(result.warnings.some(warning => warning.message.includes('変形')));
  }
});
