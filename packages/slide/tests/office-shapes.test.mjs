import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: `export * from './src/model-entry';
  export { openOfficePackage } from './src/ooxml'; export { createZipArchive, CONNECTOR_PORTS, getConnectorPortPoint } from './src/core';
  export { getSlideShapeGeometry } from './src/render/render-style';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const page = elements => m.createSlideDeck({ slides: [{ id: 'page', name: 'Office shapes', background: '#ffffff', notes: '', elements }] });
const shape = (kind, extra = {}) => m.createSlideElement({ type: 'shape', shape: kind, id: `shape-${kind}`, name: kind, x: 40, y: 60, width: 280, height: 180, fill: '#369cba', stroke: '#143348', strokeWidth: 2, text: '受注確認', textColor: '#112233', fontSize: 20, ...extra });

const required = ['bentArrow', 'bentUpArrow', 'uturnArrow', 'leftUpArrow', 'leftRightUpArrow', 'quadArrow', 'chevron', 'homePlate', 'pentagon', 'hexagon', 'octagon', 'star5', 'plus', 'flowChartProcess', 'flowChartDecision', 'flowChartTerminator', 'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartDocument', 'flowChartMultidocument', 'flowChartPreparation', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartMerge', 'flowChartDelay'];
test('public catalog inserts every Office shape atomically and persists its editable preset', () => {
  for (const kind of required) assert.ok(m.SLIDE_SHAPES.some(item => item.shape === kind), kind);
  const source = page([]), commands = m.SLIDE_SHAPES.map(item => ({ type: 'element.add', slideId: 'page', element: shape(item.shape) }));
  const result = m.applySlideCommands(source, commands).deck;
  assert.equal(source.slides[0].elements.length, 0);
  assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(result)), result);
  assert.throws(() => m.applySlideCommands(source, [...commands, { type: 'element.add', slideId: 'page', element: { type: 'shape', shape: 'unsupportedArrow' } }]));
  assert.equal(source.slides[0].elements.length, 0);
  for (const kind of required) {
    const geometry = m.getSlideShapeGeometry(shape(kind));
    assert.equal(geometry.kind, 'paths'); assert.ok(geometry.paths.length > 0);
    assert.ok(geometry.paths.every(path => path.d.length > 12 && !/NaN|Infinity/.test(path.d)));
  }
});

test('all catalog presets export native editable DrawingML and import without approximation', async () => {
  const original = page(m.SLIDE_SHAPES.map(item => shape(item.shape)));
  const file = await m.exportSlidePptx(original), archive = await m.openOfficePackage(file);
  const xml = new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'));
  for (const item of m.SLIDE_SHAPES) assert.ok(xml.includes(`prst="${item.preset}"`), item.preset);
  const result = await m.importSlidePptx(file);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.deck.slides[0].elements.map(item => item.shape), original.slides[0].elements.map(item => item.shape));
  for (const item of result.deck.slides[0].elements) {
    assert.equal(item.text, '受注確認'); assert.equal(item.fill, '#369cba'); assert.equal(item.stroke, '#143348');
    assert.equal(item.strokeWidth, 2); assert.equal(item.textColor, '#112233');
  }
});

test('expanded shapes retain their outline, eight connector ports and attached endpoints through PPTX', async () => {
  const elements = [];
  for (const kind of required) {
    const target = shape(kind); elements.push(target);
    for (const port of m.CONNECTOR_PORTS) elements.push(m.createSlideElement({ type: 'shape', shape: 'line', id: `${kind}-${port}`,
      line: { start: { x: 0, y: 0, binding: { targetId: target.id, port } }, end: { x: 500, y: 450 } }, endArrow: 'triangle' }));
  }
  const original = page(elements), result = await m.importSlidePptx(await m.exportSlidePptx(original));
  assert.deepEqual(result.warnings, []);
  for (let index = 0; index < elements.length; index += 9) {
    const target = result.deck.slides[0].elements[index]; assert.equal(target.shape, elements[index].shape);
    for (const [offset, port] of m.CONNECTOR_PORTS.entries()) {
      const connector = result.deck.slides[0].elements[index + offset + 1];
      assert.deepEqual(connector.line.start.binding, { targetId: target.id, port });
      const expected = m.getConnectorPortPoint(target, port, m.getSlideConnectorOutline(target));
      assert.ok(Math.abs(connector.line.start.x - expected.x) < .001);
      assert.ok(Math.abs(connector.line.start.y - expected.y) < .001);
    }
  }
});

test('independent Office preset XML imports bent arrows and flowcharts and reports unsupported adjustments', async () => {
  const file = await m.exportSlidePptx(page([])), archive = await m.openOfficePackage(file), entries = [];
  const fixture = await readFile(new URL('./fixtures/office-shape-presets.xml', import.meta.url), 'utf8');
  for (const path of archive.paths) entries.push({ path, content: new Blob([path === 'ppt/slides/slide1.xml' ? fixture : await archive.read(path)]) });
  const imported = await m.importSlidePptx(await m.createZipArchive(entries));
  assert.deepEqual(imported.deck.slides[0].elements.map(item => item.shape), ['bentArrow', 'uturnArrow', 'flowChartDocument', 'flowChartPredefinedProcess', 'flowChartMultidocument', 'hexagon', 'bentUpArrow']);
  assert.equal(imported.warnings.length, 1); assert.match(imported.warnings[0], /調整値/);
  assert.equal(imported.deck.slides[0].elements[0].rotation, 90);
  const repeated = await m.importSlidePptx(await m.exportSlidePptx(imported.deck));
  assert.deepEqual(repeated.warnings, []);
  assert.deepEqual(repeated.deck.slides[0].elements.map(item => item.shape), imported.deck.slides[0].elements.map(item => item.shape));
});

test('new shape text fits within the dedicated geometry text region', () => {
  const arrow = shape('flowChartPreparation', { text: 'Long text which must wrap inside the shape text region' });
  const rect = m.getSlideShapeTextRect(arrow), layout = m.measureSlideText(arrow, text => text.length * 10);
  assert.equal(layout.availableWidth, Math.max(0, rect.width - 24));
  assert.equal(layout.availableHeight, Math.max(0, rect.height - 16));
  assert.ok(rect.width < arrow.width || rect.height < arrow.height);
});
