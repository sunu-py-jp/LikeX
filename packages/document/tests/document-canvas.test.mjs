import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const output = await build({ stdin: { contents: 'export * from "./src/model-entry";export {assertDocumentFeatures,resolveDocumentFeatures} from "./src/state/document-features";export {createZipArchive} from "./src/core";export {openOfficePackage} from "./src/ooxml";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createDocument, executeDocumentCommands: execute, getCanvases, getCanvas, getDocumentCanvasConnectorRoute: route, getDocumentCanvasTarget, serializeDocument, parseDocument, createDocumentSession, importDocumentDocx, exportDocumentDocx, openOfficePackage, createZipArchive, assertDocumentFeatures, resolveDocumentFeatures } = api;
const initial = () => execute(createDocument(), { type: 'canvas.insert', at: 0, width: 600, height: 360, shapes: [
  { id: 'review', preset: 'roundRect', text: '確認', x: 30, y: 30, width: 100, height: 60 },
  { id: 'approve', preset: 'diamond', text: '承認', x: 320, y: 200, width: 120, height: 80 },
], connectors: [{ id: 'route', start: { x: 0, y: 0, binding: { targetId: 'review', port: 'right' } }, end: { x: 0, y: 0, binding: { targetId: 'approve', port: 'left' } } }] }).document;
const canvas = doc => getCanvases(doc)[0];
const axisAligned = points => points.every((point, i) => !i || point.x === points[i - 1].x || point.y === points[i - 1].y);
async function replaced(blob, mutate) { const archive = await openOfficePackage(blob), entries = []; for (const path of archive.paths) { const content = await archive.read(path); entries.push({ path, content: new Blob([path === 'word/document.xml' ? mutate(new TextDecoder().decode(content)) : content]) }); } return createZipArchive(entries); }

test('canvas commands bind, route, follow shape moves, detach deleted targets and retain stable native data', () => {
  const original = initial(), item = canvas(original), line = item.node.attrs.connectors[0], before = serializeDocument(original);
  assert.deepEqual(line.start, { x: 130, y: 60, binding: { targetId: 'review', port: 'right' } });
  assert.deepEqual(line.end, { x: 320, y: 240, binding: { targetId: 'approve', port: 'left' } });
  assert.ok(axisAligned(route(item.node.attrs, line).points));
  const moved = execute(original, { type: 'canvas.shape.update', canvasId: item.id, id: 'approve', patch: { x: 350, y: 80 } }).document;
  const updated = getCanvas(moved, item.id).node.attrs;
  assert.deepEqual(updated.connectors[0].end, { x: 350, y: 120, binding: { targetId: 'approve', port: 'left' } });
  assert.ok(axisAligned(route(updated, updated.connectors[0]).points));
  const removed = execute(moved, { type: 'canvas.shape.delete', canvasId: item.id, id: 'review' }).document;
  assert.deepEqual(canvas(removed).node.attrs.connectors[0].start, { x: 130, y: 60 });
  assert.equal(canvas(removed).node.attrs.connectors[0].end.binding.targetId, 'approve');
  assert.equal(serializeDocument(parseDocument(serializeDocument(moved))), serializeDocument(moved)); assert.equal(serializeDocument(original), before);
  const session = createDocumentSession(original); session.execute({ type: 'canvas.shape.update', canvasId: item.id, id: 'approve', patch: { x: 400 } }); session.undo(); assert.equal(serializeDocument(session.getSnapshot().document), before);
});

test('canvas operations reject foreign references, duplicate IDs, malformed patches and atomic batch failures', () => {
  const original = initial(), id = canvas(original).id, before = serializeDocument(original);
  assert.throws(() => execute(original, { type: 'canvas.connector.insert', canvasId: id, connector: { id: 'foreign', start: { x: 0, y: 0, binding: { targetId: id, port: 'top' } }, end: { x: 5, y: 5 } } }), /same canvas/);
  assert.throws(() => execute(original, { type: 'canvas.shape.insert', canvasId: id, shape: { id: 'route', x: 0, y: 0, preset: 'rect' } }), /unique/);
  assert.throws(() => execute(original, [{ type: 'canvas.shape.update', canvasId: id, id: 'approve', patch: { x: 1 } }, { type: 'canvas.connector.update', canvasId: id, id: 'route', patch: { routing: 'script' } }]), /routing/);
  assert.throws(() => execute(original, { type: 'canvas.shape.update', canvasId: id, id: 'approve', patch: { id: 'overwritten' } }), /unsupported property/);
  assert.equal(serializeDocument(original), before);
});

test('public canvas routing helpers normalize optional shape dimensions and handle coincident endpoints', () => {
  const target = getDocumentCanvasTarget({ id: 'default-size', preset: 'rect', x: 0, y: 0 }); assert.equal(target.box.width, 240); assert.equal(target.box.height, 140);
  const result = route({ shapes: [{ id: 'default-size', preset: 'rect', x: 0, y: 0 }] }, { id: 'line', start: { x: 0, y: 0, binding: { targetId: 'default-size', port: 'right' } }, end: { x: 400, y: 80 } }); assert.ok(axisAligned(result.points)); assert.equal(result.points[0].x, 240);
  assert.ok(axisAligned(route({}, { id: 'zero', start: { x: 2, y: 2 }, end: { x: 2, y: 2 } }).points));
});

test('canvas text, formatting and resource feature flags also guard raw transaction replacement', () => {
  const original = initial(), block = canvas(original), id = block.id;
  for (const [features, command] of [
    [{ text: false }, { type: 'canvas.shape.update', canvasId: id, id: 'review', patch: { text: 'blocked' } }],
    [{ formatting: false }, { type: 'canvas.shape.update', canvasId: id, id: 'review', patch: { x: 100 } }],
    [{ formatting: false }, { type: 'canvas.connector.update', canvasId: id, id: 'route', patch: { routing: 'straight' } }],
    [{ shapes: false }, { type: 'canvas.shape.delete', canvasId: id, id: 'review' }],
  ]) {
    const changed = execute(original, command).document;
    assert.throws(() => assertDocumentFeatures(original, changed, [command], resolveDocumentFeatures(features)), /無効/);
    const raw = { type: 'transaction.apply', steps: [{ stepType: 'replace', from: block.from, to: block.to, slice: { content: [canvas(changed).node] } }] };
    assert.throws(() => assertDocumentFeatures(original, changed, [raw], resolveDocumentFeatures(features)), /無効/);
  }
});

test('DOCX canvases contain native grouped shapes and connectors with retained bindings after reimport', async () => {
  const source = initial(), exported = await exportDocumentDocx(source); assert.deepEqual(exported.warnings, []);
  const archive = await openOfficePackage(exported.blob), xml = new TextDecoder().decode(await archive.read('word/document.xml'));
  assert.match(xml, /<wpg:wgp>/); assert.match(xml, /<wps:cNvCnPr><a:stCxn/); assert.match(xml, /likexElbow/); assert.ok(!xml.includes('<pic:pic>'));
  const imported = await importDocumentDocx(exported.blob); assert.deepEqual(imported.warnings, []);
  const before = canvas(source).node.attrs, after = canvas(imported.document).node.attrs;
  assert.equal(after.shapes.length, 2); assert.equal(after.connectors.length, 1);
  for (let i = 0; i < 2; i++) { const a = { ...before.shapes[i] }, b = { ...after.shapes[i] }; delete a.id; delete b.id; assert.ok(Math.abs(a.strokeWidth - b.strokeWidth) < 1 / 9525); b.strokeWidth = a.strokeWidth; assert.deepEqual(b, a); }
  assert.equal(after.connectors[0].start.binding.targetId, after.shapes[0].id); assert.equal(after.connectors[0].end.binding.targetId, after.shapes[1].id);
  assert.equal(after.connectors[0].routing, 'elbow'); assert.equal(after.connectors[0].endArrow, 'triangle');
  assert.ok(axisAligned(route(after, after.connectors[0]).points));
  const moved = execute(imported.document, { type: 'canvas.shape.update', canvasId: canvas(imported.document).id, id: after.shapes[1].id, patch: { y: 60 } }).document;
  assert.equal(canvas(moved).node.attrs.connectors[0].end.y, 100);
});

test('independent Word group fixture retains native preset connector references', async () => {
  const xml = await readFile(new URL('./fixtures/word-connected-canvas.xml', import.meta.url), 'utf8');
  const input = await replaced((await exportDocumentDocx(createDocument())).blob, source => source.replace('<w:body>', `<w:body>${xml}`));
  const imported = await importDocumentDocx(input), item = canvas(imported.document).node.attrs;
  assert.equal(item.shapes.length, 2); assert.equal(item.connectors.length, 1); assert.equal(item.shapes[0].text, 'Review');
  assert.equal(item.connectors[0].start.binding.port, 'right'); assert.equal(item.connectors[0].end.binding.port, 'left');
  assert.equal(item.connectors[0].routing, 'elbow'); assert.equal(item.connectors[0].start.x, 150); assert.equal(item.connectors[0].end.y, 240);
  assert.ok(imported.warnings.some(message => message.includes('自動直交ルート')));
});

test('disabled text cannot be redistributed between two shapes, including a raw transaction', () => {
  const original = initial(), id = canvas(original).id;
  const commands = [{ type: 'canvas.shape.update', canvasId: id, id: 'review', patch: { text: '確認承認' } }, { type: 'canvas.shape.update', canvasId: id, id: 'approve', patch: { text: '' } }];
  const next = execute(original, commands).document;
  assert.throws(() => assertDocumentFeatures(original, next, commands, resolveDocumentFeatures({ text: false })), /文字/);
  assert.throws(() => assertDocumentFeatures(original, next, [{ type: 'transaction.apply', steps: [] }], resolveDocumentFeatures({ text: false })), /文字/);
});

test('DOCX rotates child connectors before non-uniform group scaling', async () => {
  const fixture = await readFile(new URL('./fixtures/word-connected-canvas.xml', import.meta.url), 'utf8');
  const line = '<wps:wsp><wps:cNvPr id="20" name="Rotated line"/><wps:cNvCnPr/><wps:spPr><a:xfrm rot="5400000"><a:off x="952500" y="952500"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>';
  const xml = fixture.replace('<a:chExt cx="5715000"', '<a:chExt cx="2857500"').replace(/<wps:wsp>.*<\/wps:wsp>/s, line);
  const blob = await replaced((await exportDocumentDocx(createDocument())).blob, source => source.replace('<w:body>', `<w:body>${xml}`));
  const imported = await importDocumentDocx(blob), connector = canvas(imported.document).node.attrs.connectors[0];
  assert.deepEqual(connector.start, { x: 400, y: 100 }); assert.deepEqual(connector.end, { x: 200, y: 200 }); assert.deepEqual(imported.warnings, []);
});

test('DOCX detached straight lines preserve direction, arrowheads and degenerate extents', async () => {
  for (const [start, end] of [[{ x: 300, y: 10 }, { x: 20, y: 80 }], [{ x: 50, y: 90 }, { x: 50, y: 0 }], [{ x: 70, y: 20 }, { x: 70, y: 20 }]]) {
    const source = execute(createDocument(), { type: 'canvas.insert', at: 0, connectors: [{ id: 'line', start, end, routing: 'straight', startArrow: 'diamond', endArrow: 'openArrow' }] }).document;
    const imported = await importDocumentDocx((await exportDocumentDocx(source)).blob), line = canvas(imported.document).node.attrs.connectors[0];
    assert.deepEqual(imported.warnings, []); assert.deepEqual(line.start, start); assert.deepEqual(line.end, end); assert.equal(line.startArrow, 'diamond'); assert.equal(line.endArrow, 'openArrow');
  }
});

test('DOCX unsupported connector formatting is diagnosed while retaining the editable line', async () => {
  const source = execute(createDocument(), { type: 'canvas.insert', at: 0, connectors: [{ id: 'line', start: { x: 20, y: 30 }, end: { x: 100, y: 90 }, routing: 'straight' }] }).document;
  const changed = await replaced((await exportDocumentDocx(source)).blob, xml => xml.replace('<a:ln w="19050">', '<a:ln w="1905000">').replace('<a:srgbClr val="334155"/>', '<a:srgbClr val="334155"><a:alpha val="10000"/></a:srgbClr>').replace('<a:prstDash val="solid"/>', '<a:custDash><a:ds d="100" sp="100"/></a:custDash>').replace('<a:tailEnd type="triangle"/>', '<a:tailEnd type="triangle" w="lg" len="lg"/>'));
  const imported = await importDocumentDocx(changed), line = canvas(imported.document).node.attrs.connectors[0];
  assert.equal(line.strokeWidth, 2); assert.equal(line.endArrow, 'triangle');
  for (const text of ['線幅', '透明度', '単色実線', '標準サイズ']) assert.ok(imported.warnings.some(warning => warning.includes(text)), text);
});
