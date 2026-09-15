import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const output = await build({ stdin: { contents: `export * from './model-entry'; export { prepareWorksheetDrawings } from './export/xlsx/drawings';
  export { Shape } from './ui/drawings/shape'; export { drawingLabel } from './ui/drawings/drawing-helpers'; export { shapeTextFrame } from './model/shapes';`, resolveDir: new URL('../src/', import.meta.url).pathname },
bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { SPREADSHEET_SHAPES, createWorkbook, applySpreadsheetCommands: apply, parseWorkbook, serializeWorkbook,
  normalizeWorkbook, createSpreadsheetSession, copySpreadsheetDrawing, prepareWorksheetDrawings, Shape, drawingLabel, shapeTextFrame } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const presets = {
  rectangle: 'rect', roundedRectangle: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rightTriangle: 'rtTriangle',
  diamond: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid', rightArrow: 'rightArrow', leftArrow: 'leftArrow',
  upArrow: 'upArrow', downArrow: 'downArrow', leftRightArrow: 'leftRightArrow', upDownArrow: 'upDownArrow', line: 'line', arrow: 'line',
};
const sheetId = 'sheet-1';
const insert = (shape, props = {}) => ({ type: 'shapes.insert', sheetId, shape, anchor: { row: 2, column: 1 },
  width: 180, height: 90, text: '確認済み < & >', fill: '#ffeecc', stroke: '#123456', strokeWidth: 2,
  color: '#456789', fontSize: 18, bold: true, ...props });
const run = (book, commands, options) => { const result = apply(book, commands, options); assert.equal(result.ok, true, result.message); return result; };

test('the immutable public catalog contains exactly the supported basic shapes, block arrows and lines', () => {
  assert.deepEqual(catalogKinds(), Object.keys(presets));
  assert.ok(Object.isFrozen(SPREADSHEET_SHAPES));
  assert.equal(SPREADSHEET_SHAPES.filter(item => item.category === 'basic').length, 8);
  assert.equal(SPREADSHEET_SHAPES.filter(item => item.category === 'arrows').length, 6);
  assert.equal(SPREADSHEET_SHAPES.filter(item => item.category === 'lines').length, 2);
  for (const item of SPREADSHEET_SHAPES) { assert.ok(Object.isFrozen(item)); assert.ok(item.label.length); }
});
function catalogKinds() { return SPREADSHEET_SHAPES.map(item => item.kind); }

for (const { kind, label } of SPREADSHEET_SHAPES) {
  test(`${kind}: headless insert, update, copy/paste, JSON, reflection and history preserve the shape and text`, () => {
    const initial = run(createWorkbook(), [insert(kind, { flipX: true })]).workbook;
    const original = initial.sheets[0].drawings[0];
    assert.equal(drawingLabel(original), label);
    assert.equal(original.shape, kind); assert.equal(original.text, '確認済み < & >');
    assert.deepEqual(parseWorkbook(serializeWorkbook(initial)), initial);
    const payload = copySpreadsheetDrawing(initial, sheetId, original.id);
    const copied = run(initial, [{ type: 'drawings.paste', sheetId, payload, anchor: { row: 5, column: 2 } }]).workbook.sheets[0].drawings[1];
    assert.notEqual(copied.id, original.id);
    assert.deepEqual({ ...copied, id: original.id, anchor: original.anchor }, original);
    const session = createSpreadsheetSession(initial);
    assert.equal(session.execute({ type: 'shapes.update', sheetId, drawingId: original.id,
      patch: { shape: kind, flipY: true, width: 110, text: '変更後' } }).ok, true);
    assert.equal(session.getShape(sheetId, original.id).shape, kind);
    assert.equal(session.getShape(sheetId, original.id).flipY, true);
    assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), initial);
    assert.equal(session.redo(), true); assert.equal(session.getShape(sheetId, original.id).text, '変更後');
  });

  test(`${kind}: native Excel preset, text, color and both reflections are exported`, async () => {
    const book = run(createWorkbook(), [insert(kind, { flipX: true, flipY: true })]).workbook;
    const result = await prepareWorksheetDrawings(book.sheets[0], book.resources, { sheetIndex: 1 });
    const xml = await result.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
    assert.ok(xml.includes(`<a:prstGeom prst="${presets[kind]}">`));
    assert.match(xml, /flipH="1" flipV="1"/);
    assert.match(xml, /確認済み &lt; &amp; &gt;/);
    assert.match(xml, /upright="1"/);
    assert.match(xml, /123456/);
    if (kind !== 'line' && kind !== 'arrow') assert.match(xml, /FFEECC/);
  });

  test(`${kind}: SVG uses its actual geometry, retains reflection and finite coordinates at small sizes`, () => {
    for (const size of [{ width: 180, height: 90 }, { width: 12, height: 1 }, { width: 1, height: 12 }, { width: 1, height: 1 }]) {
      const drawing = run(createWorkbook(), [insert(kind, { ...size, flipX: true, flipY: true, strokeWidth: 20 })]).workbook.sheets[0].drawings[0];
      const svg = renderToStaticMarkup(createElement(Shape, { drawing }));
      assert.match(svg, /scale\(-1, -1\)/);
      assert.doesNotMatch(svg, /NaN|Infinity/);
      if (kind === 'rectangle' || kind === 'roundedRectangle') assert.match(svg, /<rect /);
      else if (kind === 'ellipse') assert.match(svg, /<ellipse /);
      else if (kind === 'line' || kind === 'arrow') assert.match(svg, /<line /);
      else assert.match(svg, /<polygon /);
      if (kind === 'roundedRectangle') assert.match(svg, /rx="/);
      if (kind === 'arrow') assert.match(svg, /marker-end="url/);
    }
  });
}

test('invalid and prototype shape names are rejected atomically at JSON and command boundaries', () => {
  const book = run(createWorkbook(), [insert('rectangle')]).workbook;
  const drawingId = book.sheets[0].drawings[0].id;
  for (const shape of ['__proto__', 'toString', 'constructor', 'star', 'cloud', 'Rectangle', '', 1, null]) {
    const bad = structuredClone(book); bad.sheets[0].drawings[0].shape = shape;
    assert.throws(() => normalizeWorkbook(bad), /種類/);
    for (const command of [insert(shape), { type: 'shapes.update', sheetId, drawingId, patch: { shape } }]) {
      const result = apply(book, [{ type: 'cells.set', sheetId, values: { A1: 'must not write' } }, command]);
      assert.equal(result.ok, false); assert.equal(result.code, 'INVALID_COMMAND');
      assert.equal(book.sheets[0].cells.A1, undefined);
    }
  }
});

test('all shapes follow the shapes feature switch for insert, update and paste', () => {
  for (const kind of catalogKinds()) {
    const book = run(createWorkbook(), [insert(kind)]).workbook, drawingId = book.sheets[0].drawings[0].id;
    const payload = copySpreadsheetDrawing(book, sheetId, drawingId);
    for (const command of [insert(kind), { type: 'shapes.update', sheetId, drawingId, patch: { shape: kind, text: 'blocked' } },
      { type: 'drawings.paste', sheetId, payload }]) {
      assert.equal(apply(book, [command], { features: { shapes: false } }).code, 'FEATURE_DISABLED');
    }
  }
});

test('non-square SVG slopes and arrowheads match the exported DrawingML adjustment guides', async () => {
  // DrawingML presets locate these vertices at ss * adj / 100000, where ss is the short side.
  // Verify the serialized guide against the rendered vertex, not a copy of catalog ratios.
  const positions = {
    parallelogram: { index: 0, axis: 0 }, trapezoid: { index: 0, axis: 0 },
    rightArrow: { index: 1, axis: 0, fromEnd: true }, leftArrow: { index: 1, axis: 0 },
    upArrow: { index: 1, axis: 1 }, downArrow: { index: 1, axis: 1, fromEnd: true },
    leftRightArrow: { index: 1, axis: 0 }, upDownArrow: { index: 1, axis: 1 },
  };
  for (const [shape, vertex] of Object.entries(positions)) {
    for (const [width, height] of [[180, 90], [90, 180], [90, 90]]) {
      for (const flip of [{}, { flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
        const book = run(createWorkbook(), [insert(shape, { width, height, ...flip })]).workbook;
        const drawing = book.sheets[0].drawings[0];
        const svg = renderToStaticMarkup(createElement(Shape, { drawing }));
        const points = svg.match(/points="([^"]+)"/)[1].split(' ').map(point => point.split(',').map(Number));
        const result = await prepareWorksheetDrawings(book.sheets[0], undefined, { sheetIndex: 1 });
        const xml = await result.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
        const value = Number(xml.match(/<a:gd name="adj2?" fmla="val (\d+)"/)[1]);
        const shortSide = Math.min(width - 2, height - 2), axis = vertex.axis === 0 ? width - 2 : height - 2;
        const offset = points[vertex.index][vertex.axis] - 1;
        const distance = vertex.fromEnd ? axis - offset : offset;
        assert.ok(Math.abs(shortSide * value / 100000 - distance) <= shortSide / 100000, `${shape}: ${width} × ${height}`);
        assert.equal(xml.includes('flipH="1"'), !!flip.flipX);
        assert.equal(xml.includes('flipV="1"'), !!flip.flipY);
      }
    }
  }
});

test('new presets use their native text rectangles and reflect their position without reflecting letters', () => {
  // Use a 120x120 inset geometry so the DrawingML fractional guides have simple expected coordinates.
  const expected = {
    triangle: { left: 31, top: 61, width: 60, height: 60 },
    rightTriangle: { left: 11, top: 71, width: 60, height: 40 },
    diamond: { left: 31, top: 31, width: 60, height: 60 },
    parallelogram: { left: 23.5, top: 23.5, width: 75, height: 75 },
    trapezoid: { left: 21, top: 21, width: 80, height: 100 },
    rightArrow: { left: 1, top: 31, width: 90, height: 60 },
    leftArrow: { left: 31, top: 31, width: 90, height: 60 },
    upArrow: { left: 31, top: 31, width: 60, height: 90 },
    downArrow: { left: 31, top: 1, width: 60, height: 90 },
    leftRightArrow: { left: 16, top: 31, width: 90, height: 60 },
    upDownArrow: { left: 31, top: 16, width: 60, height: 90 },
  };
  for (const [shape, frame] of Object.entries(expected)) {
    const drawing = run(createWorkbook(), [insert(shape, { width: 122, height: 122 })]).workbook.sheets[0].drawings[0];
    for (const [key, value] of Object.entries(frame)) assert.ok(Math.abs(shapeTextFrame(drawing)[key] - value) < 1e-9, `${shape}.${key}`);
    const flipped = shapeTextFrame({ ...drawing, flipX: true, flipY: true, rotation: 45 });
    assert.ok(Math.abs(flipped.left - (122 - frame.left - frame.width)) < 1e-9, shape);
    assert.ok(Math.abs(flipped.top - (122 - frame.top - frame.height)) < 1e-9, shape);
    assert.ok(Math.abs(flipped.width - frame.width) < 1e-9); assert.ok(Math.abs(flipped.height - frame.height) < 1e-9);
  }
  for (const shape of ['rectangle', 'ellipse', 'line', 'arrow']) {
    const drawing = run(createWorkbook(), [insert(shape, { width: 122, height: 122 })]).workbook.sheets[0].drawings[0];
    assert.deepEqual(shapeTextFrame(drawing), { left: 0, top: 0, width: 122, height: 122 }, 'existing text layout is unchanged');
  }
  const rounded = run(createWorkbook(), [insert('roundedRectangle', { width: 122, height: 62 })]).workbook.sheets[0].drawings[0];
  const margin = 60 * 16667 / 100000 * 29289 / 100000;
  const roundedExpected = { left: 1 + margin, top: 1 + margin, width: 120 - 2 * margin, height: 60 - 2 * margin };
  for (const [key, value] of Object.entries(roundedExpected)) assert.ok(Math.abs(shapeTextFrame(rounded)[key] - value) < 1e-9);
});
