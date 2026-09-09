import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { jpegHeader, pngHeader } from './image-fixtures.mjs';

const output = await build({ stdin: { contents: `export * from './export/xlsx/drawings'; export * from './export/xlsx/images';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { prepareWorksheetDrawings, prepareXlsxImage, createXlsxMediaRegistry, containXlsxImage } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const png = pngHeader(1, 1);
const resource = (bytes = png, mimeType = 'image/png', width = 1, height = 1) => ({ name: 'image', mimeType, width, height,
  dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` });
const gif = resource(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'image/gif');
const imageDrawing = (id = 'picture', resourceId = 'asset') => ({ id, type: 'image', resourceId, alt: 'a < b & "c"',
  anchor: { row: 1, column: 1, offsetX: 5, offsetY: 7 }, width: 120, height: 80 });
const sheet = drawings => ({ id: 'sheet', name: 'Sheet', cells: {}, rowCount: 20, columnCount: 10, drawings });
const xmlPart = (result, name = 'xl/drawings/drawing1.xml') => result.parts.find(part => part.path === name).content.text();

function browser(t, { width = 1, height = 1, loading = false, encoding = false, failed = false, blob, contextAvailable = true } = {}) {
  const created = [], revoked = [], images = [], calls = [], canvases = [];
  const restore = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  };
  class ImageMock {
    naturalWidth = width; naturalHeight = height;
    constructor() { images.push(this); }
    set src(value) { this.source = value; if (value && !loading) queueMicrotask(() => { if (failed) this.onerror?.(); else this.onload?.(); }); }
  }
  restore('Image', ImageMock);
  restore('document', { createElement(name) {
    assert.equal(name, 'canvas');
    const canvas = { width: 0, height: 0, getContext: () => contextAvailable ? { drawImage: (...args) => calls.push(args) } : null,
      toBlob(callback, mime) { assert.equal(mime, 'image/png'); canvas.complete = () => callback(blob ?? new Blob([pngHeader(width, height)], { type: 'image/png' })); if (!encoding) canvas.complete(); } };
    canvases.push(canvas); return canvas;
  } });
  t.mock.method(URL, 'createObjectURL', input => { assert.ok(input instanceof Blob); const url = `blob:image-${created.length}`; created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  return { created, revoked, images, calls, canvases };
}

test('an empty sheet produces no drawing part or relationships', async () => {
  assert.deepEqual(await prepareWorksheetDrawings(sheet([]), undefined, { sheetIndex: 1 }), { parts: [], contentTypes: [] });
});

test('ordinary PNG and JPEG bytes are embedded unchanged without a browser', async () => {
  for (const [bytes, mimeType, width, height] of [[png, 'image/png', 1, 1], [jpegHeader({ orientation: 1 }), 'image/jpeg', 2, 3]]) {
    const prepared = await prepareXlsxImage(resource(bytes, mimeType, width, height));
    assert.deepEqual(Buffer.from(await prepared.content.arrayBuffer()), bytes);
    assert.equal(prepared.contentType, mimeType);
    assert.equal(prepared.width, width); assert.equal(prepared.height, height);
  }
});

test('contain uses displayed aspect ratio, centered inside both wide and tall frames', () => {
  assert.deepEqual(containXlsxImage({ x: 5, y: 7, width: 120, height: 80 }, { width: 1, height: 1 }), { x: 25, y: 7, width: 80, height: 80 });
  assert.deepEqual(containXlsxImage({ x: 5, y: 7, width: 60, height: 120 }, { width: 2, height: 1 }), { x: 5, y: 52, width: 60, height: 30 });
});

test('image anchors preserve column/row overrides and local offsets without UI header offsets', async () => {
  const source = { ...sheet([imageDrawing()]), columnWidths: { 0: 150 }, rowHeights: { 0: 40 } };
  const result = await prepareWorksheetDrawings(source, { images: { asset: resource() } }, { sheetIndex: 1 });
  const drawing = await xmlPart(result);
  assert.match(drawing, /<xdr:col>1<\/xdr:col><xdr:colOff>238125<\/xdr:colOff><xdr:row>1<\/xdr:row><xdr:rowOff>66675/);
  assert.match(drawing, /<a:off x="1666875" y="447675"\/>/);
  assert.match(drawing, /<xdr:ext cx="762000" cy="762000"\/>/);
  assert.match(drawing, /descr="a &lt; b &amp; &quot;c&quot;"/);
  assert.match(drawing, /<a:picLocks noChangeAspect="1"\/>/);
  assert.equal(result.drawingRelationshipTarget, '../drawings/drawing1.xml');
  assert.deepEqual(result.contentTypes, [{ extension: 'png', contentType: 'image/png' },
    { partName: '/xl/drawings/drawing1.xml', contentType: 'application/vnd.openxmlformats-officedocument.drawing+xml' }]);
});

test('shared resources produce one media part across repeated pictures and multiple sheets', async () => {
  const media = createXlsxMediaRegistry(), resources = { images: { asset: resource() } };
  const first = await prepareWorksheetDrawings(sheet([imageDrawing('one'), imageDrawing('two')]), resources, { sheetIndex: 1, media });
  const second = await prepareWorksheetDrawings(sheet([imageDrawing('three')]), resources, { sheetIndex: 2, media });
  const files = [...first.parts, ...second.parts].filter(part => part.path.startsWith('xl/media/'));
  assert.equal(files.length, 1);
  assert.equal((await xmlPart(first)).match(/r:embed="rIdImage1"/g).length, 2);
  assert.match(await xmlPart(second, 'xl/drawings/_rels/drawing2.xml.rels'), /Target="\.\.\/media\/image1_1.png"/);
  assert.equal(second.parts.some(part => part.path === 'xl/drawings/drawing2.xml'), true);
});

test('all native shapes and multiline text boxes retain style, alpha and literal escaped text', async () => {
  const base = { id: 'shape', anchor: { row: 0, column: 0, offsetX: 10, offsetY: 10 }, width: 120, height: 80 };
  const drawings = ['rectangle', 'ellipse', 'line', 'arrow'].map((shape, index) => ({ ...base, type: 'shape', shape,
    id: `${shape}${index}`, fill: '#f008', stroke: '#00f', strokeWidth: 2 }));
  drawings.push({ ...base, id: 'text "&', type: 'text', text: ' A < B & C\n  二行目', fontSize: 20, color: '#0a0', background: 'transparent', bold: true });
  const result = await prepareWorksheetDrawings(sheet(drawings), undefined, { sheetIndex: 1 });
  const drawing = await xmlPart(result);
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) ?? []).length, 5);
  assert.equal((drawing.match(/<xdr:sp>/g) ?? []).length, 5);
  assert.match(drawing, /prst="rect"/); assert.match(drawing, /prst="ellipse"/); assert.match(drawing, /prst="line"/);
  assert.match(drawing, /<a:alpha val="53333"\/>/);
  assert.match(drawing, /<a:tailEnd type="triangle" w="lg" len="lg"\/>/);
  assert.match(drawing, /<xdr:cNvSpPr txBox="1"\/>/);
  assert.match(drawing, /sz="1500" b="1"/);
  assert.match(drawing, /<a:t xml:space="preserve"> A &lt; B &amp; C<\/a:t>/);
  assert.match(drawing, /<a:t xml:space="preserve">  二行目<\/a:t>/);
  assert.match(drawing, /name="text &quot;&amp;"/);
  assert.equal(result.parts.some(part => part.path.endsWith('.rels')), false);
});

test('rotation-aware JPEG and GIF conversion requires Canvas rather than dropping the picture', async () => {
  await assert.rejects(prepareXlsxImage(resource(jpegHeader({ orientation: 6 }), 'image/jpeg', 2, 3)), /Canvas.*ブラウザー/);
  await assert.rejects(prepareXlsxImage(gif), /Canvas.*ブラウザー/);
});

test('oriented JPEG conversion uses displayed dimensions and releases all temporary resources', async t => {
  const dom = browser(t, { width: 3, height: 2 });
  const prepared = await prepareXlsxImage(resource(jpegHeader({ orientation: 6 }), 'image/jpeg', 2, 3));
  assert.equal(prepared.contentType, 'image/png'); assert.equal(prepared.extension, 'png');
  assert.deepEqual([prepared.width, prepared.height], [3, 2]);
  assert.deepEqual(dom.calls[0].slice(1), [0, 0, 3, 2]);
  assert.deepEqual(dom.revoked, dom.created);
  assert.equal(dom.images[0].source, '');
  assert.equal(dom.canvases[0].width, 0); assert.equal(dom.canvases[0].height, 0);
});

test('GIF is captured to PNG once, with no opaque background paint', async t => {
  const dom = browser(t), media = createXlsxMediaRegistry(), resources = { images: { asset: gif } };
  const first = await prepareWorksheetDrawings(sheet([imageDrawing()]), resources, { sheetIndex: 1, media });
  const second = await prepareWorksheetDrawings(sheet([imageDrawing()]), resources, { sheetIndex: 2, media });
  assert.equal(dom.calls.length, 1);
  assert.equal(dom.created.length, 1);
  assert.equal([...first.parts, ...second.parts].filter(part => part.path.startsWith('xl/media/')).length, 1);
});

test('cancel during decode rejects promptly and a late decoder callback does not write a PNG', async t => {
  const dom = browser(t, { loading: true }), abort = new AbortController();
  const task = prepareXlsxImage(gif, abort.signal);
  const late = dom.images[0].onload;
  abort.abort();
  await assert.rejects(task, { name: 'AbortError' });
  late();
  assert.deepEqual(dom.revoked, dom.created);
  assert.equal(dom.calls.length, 0);
});

test('cancel during encoding ignores a late PNG result and frees its canvas', async t => {
  const dom = browser(t, { encoding: true }), abort = new AbortController();
  const task = prepareXlsxImage(gif, abort.signal);
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(task, { name: 'AbortError' });
  dom.canvases[0].complete();
  assert.deepEqual(dom.revoked, dom.created);
  assert.equal(dom.canvases[0].width, 0);
});

test('decoder errors, ignored EXIF, missing Canvas and oversized output fail explicitly', async t => {
  await t.test('decode error', async t => { const dom = browser(t, { failed: true }); await assert.rejects(prepareXlsxImage(gif), /読み込めない/); assert.deepEqual(dom.revoked, dom.created); });
  await t.test('EXIF mismatch', async t => { const dom = browser(t, { width: 2, height: 3 }); await assert.rejects(prepareXlsxImage(resource(jpegHeader({ orientation: 6 }), 'image/jpeg', 2, 3)), /表示寸法/); assert.deepEqual(dom.revoked, dom.created); });
  await t.test('no context', async t => { const dom = browser(t, { contextAvailable: false }); await assert.rejects(prepareXlsxImage(gif), /Canvas/); assert.equal(dom.created.length, 0); });
  await t.test('PNG exceeds limit', async t => { const dom = browser(t, { blob: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }) }); await assert.rejects(prepareXlsxImage(gif), /5 MiB/); assert.deepEqual(dom.revoked, dom.created); });
});

test('pre-aborted exports and invalid resources are rejected before browser allocation', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareWorksheetDrawings(sheet([imageDrawing()]), {}, { sheetIndex: 1, signal: abort.signal }), { name: 'AbortError' });
  await assert.rejects(prepareXlsxImage(resource(pngHeader(10_001, 1), 'image/png', 10_001, 1)), /上限/);
  await assert.rejects(prepareXlsxImage({ ...resource(), dataUrl: 'https://example.invalid/image.png' }), /有効な/);
  await assert.rejects(prepareWorksheetDrawings(sheet([imageDrawing()]), undefined, { sheetIndex: 1 }), /リソース/);
});
