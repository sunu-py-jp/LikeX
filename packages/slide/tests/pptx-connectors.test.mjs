import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from "./src/model";
  export { importSlidePptx,exportSlidePptx } from "./src/model-entry";
  export { openOfficePackage } from "./src/ooxml";
  export { createZipArchive,getConnectorPortPoint,CONNECTOR_PORTS } from "./src/core";`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, applySlideCommands, getSlideConnectorOutline, exportSlidePptx, importSlidePptx,
  openOfficePackage, createZipArchive, getConnectorPortPoint, CONNECTOR_PORTS } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const close = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < .00011, `${actual.x} ≈ ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < .00011, `${actual.y} ≈ ${expected.y}`);
};
const deck = elements => createSlideDeck({ slides: [{ id: 'page', name: 'Connectors', background: '#ffffff', notes: '', elements }] });
const shape = (id, kind = 'rect', extra = {}) => createSlideElement({ type: 'shape', id, name: id, shape: kind, x: 120, y: 80, width: 240, height: 120, ...extra });
const line = (id, start, end, extra = {}) => createSlideElement({ type: 'shape', shape: 'line', id, name: id, line: { start, end }, strokeWidth: 3, stroke: '#123456', ...extra });
async function xmlOf(blob) {
  const archive = await openOfficePackage(blob);
  return new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'));
}
async function change(blob, transform) {
  const archive = await openOfficePackage(blob), entries = [];
  for (const path of archive.paths) {
    let bytes = await archive.read(path);
    if (path === 'ppt/slides/slide1.xml') bytes = new TextEncoder().encode(transform(new TextDecoder().decode(bytes)));
    entries.push({ path, content: new Blob([bytes]) });
  }
  return createZipArchive(entries);
}
function boundDeck() {
  const target = shape('target', 'ellipse', { rotation: 33 });
  const start = { ...getConnectorPortPoint(target, 'topRight', getSlideConnectorOutline(target)), binding: { targetId: target.id, port: 'topRight' } };
  // The connector deliberately precedes its target to exercise the second pass.
  return deck([line('link', start, { x: 550, y: 410 }, { endArrow: 'triangle' }), target]);
}

test('two-point lines keep every direction, zero dimension, locks and both arrowhead decorations', async () => {
  const arrows = ['none', 'triangle', 'openArrow', 'diamond', 'oval', 'stealth'];
  const points = [
    [{ x: 10, y: 20 }, { x: 110, y: 120 }], [{ x: 110, y: 20 }, { x: 10, y: 120 }],
    [{ x: 10, y: 120 }, { x: 110, y: 20 }], [{ x: 110, y: 120 }, { x: 10, y: 20 }],
    [{ x: 10, y: 20 }, { x: 110, y: 20 }], [{ x: 10, y: 20 }, { x: 10, y: 120 }],
    [{ x: 10, y: 20 }, { x: 10, y: 20 }],
  ];
  const elements = points.map(([start, end], index) => line(`line-${index}`, start, end, {
    startArrow: arrows[index % 6], endArrow: arrows[(index + 1) % 6], locked: true,
  }));
  const file = await exportSlidePptx(deck(elements)), xml = await xmlOf(file), result = await importSlidePptx(file);
  assert.equal((xml.match(/<p:cxnSp>/g) ?? []).length, points.length);
  assert.match(xml, /<a:headEnd type="arrow"/);
  assert.deepEqual(result.warnings, []);
  for (const [index, actual] of result.deck.slides[0].elements.entries()) {
    close(actual.line.start, points[index][0]); close(actual.line.end, points[index][1]);
    assert.equal(actual.startArrow, elements[index].startArrow); assert.equal(actual.endArrow, elements[index].endArrow);
    assert.equal(actual.locked, true); assert.equal(actual.stroke, '#123456'); assert.equal(actual.strokeWidth, 3);
  }
});

test('custom geometry exports native connections and reimports bindings before target movement', async () => {
  const source = boundDeck(), snapshot = JSON.stringify(source), file = await exportSlidePptx(source), xml = await xmlOf(file);
  assert.equal(JSON.stringify(source), snapshot);
  assert.match(xml, /<a:stCxn id="3" idx="1"\/>/);
  assert.match(xml, /name="likexPorts8" fmla="val 1"/);
  assert.match(xml, /name="likexShape_ellipse"/);
  assert.equal((xml.match(/<a:cxn ang=/g) ?? []).length, 8);
  const result = await importSlidePptx(file), [connector, target] = result.deck.slides[0].elements;
  assert.deepEqual(result.warnings, []);
  assert.equal(target.shape, 'ellipse'); assert.equal(target.rotation, 33);
  assert.deepEqual(connector.line.start.binding, { targetId: target.id, port: 'topRight' });
  close(connector.line.start, source.slides[0].elements[0].line.start);
  const moved = applySlideCommands(result.deck, { type: 'element.update', slideId: result.deck.slides[0].id,
    elementId: target.id, patch: { x: 400, width: 340, rotation: 120 } }).deck.slides[0];
  close(moved.elements[0].line.start, getConnectorPortPoint(moved.elements[1], 'topRight', getSlideConnectorOutline(moved.elements[1])));
  close(moved.elements[0].line.end, connector.line.end);
});

test('all supported target outlines and all eight port names survive the Office round trip', async () => {
  const elements = [];
  for (const kind of ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'arrow', 'leftArrow']) {
    const target = shape(`target-${kind}`, kind); elements.push(target);
    for (const port of CONNECTOR_PORTS) elements.push(line(`${kind}-${port}`,
      { ...getConnectorPortPoint(target, port, getSlideConnectorOutline(target)), binding: { targetId: target.id, port } }, { x: 700, y: 600 }));
  }
  const result = await importSlidePptx(await exportSlidePptx(deck(elements)));
  assert.deepEqual(result.warnings, []);
  for (let index = 0; index < elements.length; index += 9) {
    const target = result.deck.slides[0].elements[index]; assert.equal(target.shape, elements[index].shape);
    for (const [offset, port] of CONNECTOR_PORTS.entries()) {
      const connector = result.deck.slides[0].elements[index + offset + 1];
      assert.deepEqual(connector.line.start.binding, { targetId: target.id, port });
      close(connector.line.start, getConnectorPortPoint(target, port, getSlideConnectorOutline(target)));
    }
  }
});

test('native preset connector indices use Office ordering, not the custom eight-port ordering', async () => {
  const file = await change(await exportSlidePptx(boundDeck()), xml => xml
    .replace(/<a:custGeom>.*?<\/a:custGeom>/g, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'));
  const result = await importSlidePptx(file), [connector, target] = result.deck.slides[0].elements;
  assert.equal(target.shape, 'rect');
  assert.deepEqual(connector.line.start.binding, { targetId: target.id, port: 'left' });
  close(connector.line.start, getConnectorPortPoint(target, 'left'));
});

test('missing, duplicate or unknown connection sites preserve free endpoint coordinates and warn', async () => {
  const source = boundDeck(), file = await exportSlidePptx(source);
  for (const mutate of [xml => xml.replace('<a:stCxn id="3" idx="1"/>', '<a:stCxn id="999" idx="1"/>'),
    xml => xml.replace('<a:stCxn id="3" idx="1"/>', '<a:stCxn id="3" idx="99"/>'),
    xml => xml.replace(/<p:cNvPr id="3"/, '<p:cNvPr id="2"').replace('<a:stCxn id="3"', '<a:stCxn id="2"'),
    xml => xml.replace('name="likexPorts8" fmla="val 1"', 'name="unknownPorts" fmla="val 1"')]) {
    const result = await importSlidePptx(await change(file, mutate)), connector = result.deck.slides[0].elements[0];
    assert.equal(connector.line.start.binding, undefined);
    close(connector.line.start, source.slides[0].elements[0].line.start);
    assert.ok(result.warnings.some(message => message.includes('接続を解除')));
  }
});

test('external rotated/flipped lines retain their endpoint direction and curved connectors warn', async () => {
  const file = await exportSlidePptx(deck([line('free', { x: 100, y: 100 }, { x: 300, y: 200 })]));
  const result = await importSlidePptx(await change(file, xml => xml.replace(/<p:cxnSp>.*?<\/p:cxnSp>/, connector => connector.replace('<a:xfrm>', '<a:xfrm rot="5400000" flipH="1">'))));
  close(result.deck.slides[0].elements[0].line.start, { x: 250, y: 250 });
  close(result.deck.slides[0].elements[0].line.end, { x: 150, y: 50 });
  const curved = await importSlidePptx(await change(file, xml => xml.replace('prst="line"', 'prst="curvedConnector3"')));
  assert.ok(curved.warnings.some(message => message.includes('直線へ変更')));
});

test('unsupported connector text reports omission, while legacy static line text is retained', async () => {
  const warnings = [];
  const file = await exportSlidePptx(deck([line('text-line', { x: 10, y: 10 }, { x: 200, y: 50 }, { text: 'separate label' })]), { onWarning: message => warnings.push(message) });
  assert.ok(warnings.some(message => message.includes('接続線内の文字')));
  assert.equal((await importSlidePptx(file)).deck.slides[0].elements[0].text, '');
  const legacy = createSlideElement({ type: 'shape', shape: 'line', id: 'legacy', text: 'legacy label' });
  assert.equal((await importSlidePptx(await exportSlidePptx(deck([legacy])))).deck.slides[0].elements[0].text, 'legacy label');
});

test('both endpoints remain attached to text and image targets', async () => {
  const text = createSlideElement({ type: 'text', id: 'text', name: 'text-target', text: 'Node', x: 50, y: 80, width: 200, height: 90 });
  const image = createSlideElement({ type: 'image', id: 'image', name: 'image-target', x: 400, y: 250, width: 200, height: 100,
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=' });
  const connection = line('both', { ...getConnectorPortPoint(text, 'right'), binding: { targetId: text.id, port: 'right' } },
    { ...getConnectorPortPoint(image, 'topLeft'), binding: { targetId: image.id, port: 'topLeft' } });
  const result = await importSlidePptx(await exportSlidePptx(deck([connection, text, image])));
  assert.deepEqual(result.warnings, []);
  const [actual, actualText, actualImage] = result.deck.slides[0].elements;
  assert.equal(actualText.type, 'text'); assert.equal(actualImage.type, 'image');
  assert.deepEqual(actual.line.start.binding, { targetId: actualText.id, port: 'right' });
  assert.deepEqual(actual.line.end.binding, { targetId: actualImage.id, port: 'topLeft' });
  close(actual.line.start, connection.line.start); close(actual.line.end, connection.line.end);
});

test('automatic elbow paths and both connections round-trip in editable custom connector geometry', async () => {
  const a = shape('a', 'rect', { x: 100, y: 100, width: 160, height: 100, rotation: 25 });
  const b = shape('b', 'hexagon', { x: 420, y: 170, width: 150, height: 180 });
  const source = applySlideCommands(deck([a, b]), { type: 'line.add', slideId: 'page', id: 'elbow', routing: 'elbow',
    start: { x: 0, y: 0, binding: { targetId: a.id, port: 'left' } }, end: { x: 0, y: 0, binding: { targetId: b.id, port: 'right' } },
    startArrow: 'openArrow', endArrow: 'triangle' }).deck;
  const exported = await exportSlidePptx(source), xml = await xmlOf(exported);
  assert.match(xml, /<p:cxnSp>/); assert.match(xml, /<a:custGeom>/); assert.match(xml, /<a:lnTo>/);
  const result = await importSlidePptx(exported); assert.deepEqual(result.warnings, []);
  const actual = result.deck.slides[0].elements.find(item => item.shape === 'line'), expected = source.slides[0].elements.at(-1);
  assert.equal(actual.routing, 'elbow'); assert.equal(actual.startArrow, 'openArrow'); assert.equal(actual.endArrow, 'triangle');
  close(actual.line.start, expected.line.start); close(actual.line.end, expected.line.end);
  assert.equal(actual.line.start.binding.port, 'left'); assert.equal(actual.line.end.binding.port, 'right');
  let current = result.deck;
  for (let repeat=0; repeat<3; repeat++) {
    const next = await importSlidePptx(await exportSlidePptx(current)); current = next.deck;
    assert.deepEqual(next.warnings, []); const line = next.deck.slides[0].elements.find(item => item.shape === 'line');
    close(line.line.start, actual.line.start); close(line.line.end, actual.line.end);
  }
});

test('native Office bentConnector2 through bentConnector5 become automatic elbow routes with explicit adjustment notice', async () => {
  const file = await exportSlidePptx(deck([line('native', {x: 400, y: 180}, {x: 150, y: 420}, {endArrow:'triangle'})]));
  for (const preset of ['bentConnector2','bentConnector3','bentConnector4','bentConnector5']) {
    const result = await importSlidePptx(await change(file, xml => xml.replace('prst="line"','prst="'+preset+'"')));
    const actual = result.deck.slides[0].elements[0];
    assert.equal(actual.routing, 'elbow'); close(actual.line.start,{x:400,y:180}); close(actual.line.end,{x:150,y:420});
    assert.ok(result.warnings.some(message=>message.includes('自動の直交経路')));
  }
});


test('elbow paths retain reversed and degenerate endpoints, and unrecognized custom geometry warns', async () => {
  const points = [
    [{x:300,y:100},{x:100,y:300}], [{x:100,y:300},{x:300,y:100}],
    [{x:300,y:300},{x:100,y:100}], [{x:100,y:100},{x:300,y:100}],
    [{x:100,y:300},{x:100,y:100}], [{x:100,y:100},{x:100,y:100}],
  ];
  const source = deck(points.map(([start,end], index) => line('elbow-'+index,start,end,{routing:'elbow'})));
  const file = await exportSlidePptx(source), result = await importSlidePptx(file);
  assert.deepEqual(result.warnings, []);
  result.deck.slides[0].elements.forEach((actual,index) => {
    assert.equal(actual.routing,'elbow'); close(actual.line.start,points[index][0]); close(actual.line.end,points[index][1]);
  });
  const unknown = await importSlidePptx(await change(file, xml => xml.replaceAll('likexElbow1','unknownCustom')));
  assert.ok(unknown.warnings.some(message => message.includes('直線へ変更')));
  assert.ok(unknown.deck.slides[0].elements.every(element=>element.routing===undefined));
});
