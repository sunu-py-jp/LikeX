import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/index";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { OFFICE_SHAPE_PRESETS, isOfficeShapePreset, getOfficeShapeGeometry, getOfficeShapeOutline,
  getConnectorPortPoints, createOfficeConnectorGeometry, readOfficeConnectorShapeTag, officeXml } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { parseXml, child, children } = officeXml;
const parse = value => parseXml(new TextEncoder().encode(value));

test('Office catalog validates every preset and renders finite geometry for portrait, landscape and collapsed boxes', () => {
  assert.equal(OFFICE_SHAPE_PRESETS.length, 39);
  assert.equal(new Set(OFFICE_SHAPE_PRESETS.map(item => item.preset)).size, 39);
  for (const { preset, label, category } of OFFICE_SHAPE_PRESETS) {
    assert.equal(isOfficeShapePreset(preset), true);
    assert.ok(label);
    assert.ok(['basic', 'arrows', 'flowchart'].includes(category));
    for (const [width, height] of [[200, 100], [100, 200], [12, 1], [1, 12], [0, 0], [0, 100], [100, 0]]) {
      const geometry = getOfficeShapeGeometry(preset, width, height), outline = getOfficeShapeOutline(preset, width, height);
      assert.ok(geometry.paths.every(path => path.d.startsWith('M')));
      assert.doesNotMatch(JSON.stringify([geometry, outline]), /NaN|Infinity/);
      assert.equal(getConnectorPortPoints({ x: 0, y: 0, width, height }, outline).length, 8);
      assert.doesNotThrow(() => createOfficeConnectorGeometry(preset, outline));
    }
  }
  for (const value of ['__proto__', 'constructor', 'line', 'bentArrow<script>', null, 1, {}]) {
    assert.equal(isOfficeShapePreset(value), false);
    assert.throws(() => getOfficeShapeGeometry(value, 100, 100), TypeError);
  }
  for (const value of [-1, NaN, Infinity, 1e100]) assert.throws(() => getOfficeShapeGeometry('rect', value, 100), RangeError);
});

test('bent arrow default coordinates and curves match DrawingML on non-square boxes', () => {
  const geometry = getOfficeShapeGeometry('bentArrow', 200, 100);
  assert.match(geometry.paths[0].d, /^M0 100 L0 56\.25 C/);
  assert.match(geometry.paths[0].d, /L175 0 L200 25 L175 50 L175 37\.5/);
  assert.match(geometry.paths[0].d, /L25 100 Z$/);
  assert.equal(geometry.paths[0].d.split('C').length - 1, 2);
  // The U-shaped interior does not contain the box centre. Eight valid boundary
  // ports must still be available, including after rotation and reflection.
  const outline = getOfficeShapeOutline('uturnArrow', 100, 100);
  const ports = getConnectorPortPoints({ x: 10, y: 20, width: 100, height: 100, rotation: 90, flipX: true }, outline);
  assert.ok(ports.every(({ point }) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(new Set(ports.map(({ point }) => `${point.x},${point.y}`)).size >= 6);
});

test('multi-path flowcharts retain open strokes and native text rectangles in SVG and connected Office geometry', () => {
  const shape = getOfficeShapeGeometry('flowChartPredefinedProcess', 240, 120);
  assert.ok(shape.paths.some(path => path.fill === false));
  assert.ok(shape.textRect.left > 0);
  const outline = getOfficeShapeOutline('flowChartMultidocument', 240, 120);
  const geometry = parse(createOfficeConnectorGeometry('flowChartMultidocument', outline));
  assert.equal(readOfficeConnectorShapeTag(geometry), 'flowChartMultidocument');
  assert.equal(children(child(geometry, 'pathLst'), 'path').length, outline.paths.length);
  assert.equal(children(child(geometry, 'cxnLst'), 'cxn').length, 8);
  assert.equal(child(geometry, 'rect').attributes.t, 'lxText1');
  const guides = children(child(geometry, 'gdLst'), 'gd');
  assert.ok(guides.some(guide => guide.attributes.name === 'lxText1' && guide.attributes.fmla !== '*/ h 0 100000'));
  const paths = children(child(geometry, 'pathLst'), 'path');
  assert.ok(paths.some(path => path.attributes.fill === 'none'));
  assert.ok(paths.some(path => children(path, 'cubicBezTo').length > 0));
});

test('connector custom paths reject malformed coordinates, commands and ports before XML output', () => {
  const outline = getOfficeShapeOutline('bentArrow', 200, 100);
  for (const invalid of [
    { ...outline, ports: [] },
    { ...outline, ports: outline.ports.map(() => ({ x: Infinity, y: 0 })) },
    { ...outline, textRect: { left: 0, top: 0, width: NaN, height: 1 } },
    { ...outline, paths: [{ commands: [{ type: 'move', x: 0, y: 0 }, { type: 'cubic', x: 1, y: 1, x1: '0"/>', y1: 0, x2: 1, y2: 1 }] }] },
    { ...outline, paths: [{ commands: [{ type: 'move', x: 0, y: 0 }, { type: 'execute', value: '<xml/>' }] }] },
  ]) assert.throws(() => createOfficeConnectorGeometry('bentArrow', invalid), TypeError);
  assert.throws(() => createOfficeConnectorGeometry('bentArrow', { ...outline,
    paths: [{ commands: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 1e308, y: 0 }] }] }), RangeError);
});
