import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/ooxml";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createOfficeConnectorGeometry, readOfficeConnectorShapeTag, getOfficePresetConnectorPort, officeXml } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { parseXml, child, children } = officeXml;
const parse = value => parseXml(new TextEncoder().encode(value));

test('custom geometry uses eight ordered sites scaled with actual shape width/height', () => {
  const xml = createOfficeConnectorGeometry('ellipse', { type: 'ellipse' }), geometry = parse(xml);
  assert.equal(readOfficeConnectorShapeTag(geometry), 'ellipse');
  const guides = new Map(children(child(geometry, 'gdLst'), 'gd').map(node => [node.attributes.name, node.attributes.fmla]));
  assert.equal(guides.get('lxPort0x'), '*/ w 50000 100000');
  assert.equal(guides.get('lxPort0y'), '*/ h 0 100000');
  assert.equal(guides.get('lxPort1x'), '*/ w 85355 100000');
  assert.equal(guides.get('lxPort1y'), '*/ h 14645 100000');
  assert.equal(children(child(geometry, 'cxnLst'), 'cxn').length, 8);
  assert.deepEqual({ ...child(children(child(geometry, 'cxnLst'), 'cxn')[6], 'pos').attributes }, { x: 'lxPort6x', y: 'lxPort6y' });
  assert.equal(children(child(child(geometry, 'pathLst'), 'path'), 'arcTo').length, 4);
});

test('polygon and rounded geometry retain real paths and reject malformed tags or outlines', () => {
  const polygon = parse(createOfficeConnectorGeometry('triangle', { type: 'polygon', points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }));
  assert.equal(children(child(child(polygon, 'pathLst'), 'path'), 'lnTo').length, 2);
  const rounded = parse(createOfficeConnectorGeometry('roundRect', { type: 'roundedRect', radiusX: .12, radiusY: .24 }));
  assert.equal(child(child(child(rounded, 'pathLst'), 'path'), 'arcTo').attributes.wR, '12000');
  assert.equal(child(child(child(rounded, 'pathLst'), 'path'), 'arcTo').attributes.hR, '24000');
  assert.throws(() => createOfficeConnectorGeometry('rect"/><a:bad>'), TypeError);
  assert.throws(() => createOfficeConnectorGeometry('rect', { type: 'polygon', points: [] }), TypeError);
  const plain = createOfficeConnectorGeometry('rect');
  assert.equal(readOfficeConnectorShapeTag(parse(plain.replace('name="likexPorts8" fmla="val 1"', 'name="likexPorts8" fmla="val 2"'))), undefined);
  assert.equal(readOfficeConnectorShapeTag(parse(plain.replace(/<a:cxn .*?<\/a:cxn>/, ''))), undefined);
});

test('preset indices use their real Office ordering and do not claim unsupported shoulder ports', () => {
  assert.equal(getOfficePresetConnectorPort('rect', 1), 'left');
  assert.equal(getOfficePresetConnectorPort('ellipse', 7), 'topRight');
  assert.equal(getOfficePresetConnectorPort('triangle', 2), 'bottomLeft');
  for (const preset of ['flowChartProcess', 'flowChartDecision', 'flowChartTerminator', 'flowChartPredefinedProcess', 'flowChartPreparation', 'flowChartDelay'])
    assert.deepEqual([0, 1, 2, 3].map(index => getOfficePresetConnectorPort(preset, index)), ['top', 'left', 'bottom', 'right']);
  assert.equal(getOfficePresetConnectorPort('rightArrow', 0), undefined);
  assert.equal(getOfficePresetConnectorPort('leftArrow', 3), 'right');
  for (const index of [-1, 8, NaN, 1.5]) assert.equal(getOfficePresetConnectorPort('rect', index), undefined);
  assert.equal(getOfficePresetConnectorPort('freeform', 0), undefined);
});
