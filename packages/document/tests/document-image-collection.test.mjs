import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, collectDocumentImages, getImages, serializeDocument, parseDocument, importDocumentDocx, exportDocumentDocx } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=';
const image = (id, src = png, width = 120, height = 60) => ({ type: 'image', attrs: { id, src, width, height, alt: `Image ${id}` } });
const imageId = src => `sha256:${createHash('sha256').update(Buffer.from(src.split(',')[1], 'base64')).digest('hex')}`;
function nestedDocument() {
  return createDocument({ id: 'report', content: { type: 'doc', content: [
    image('first'),
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [image('cell-image', png, 240, 120)] }] }] },
    { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph' }, image('list-image', png, 60, 30)] }] },
    image('other', pixel, 20, 20),
  ] } });
}

test('collects unique source bytes and every nested image with stable IDs, dimensions and ProseMirror positions', async () => {
  const document = nestedDocument(), before = serializeDocument(document);
  const result = await collectDocumentImages(document);
  assert.equal(typeof globalThis.document, 'undefined'); assert.equal(typeof globalThis.window, 'undefined');
  assert.deepEqual(result.images, [png, pixel].map(src => ({ imageId: imageId(src), src, mimeType: 'image/png', byteLength: Buffer.from(src.split(',')[1], 'base64').length })));
  assert.deepEqual(result.placements.map(item => [item.imageId, item.documentId, item.blockId, item.from, item.to, item.width, item.height, item.alt]), [
    [imageId(png), 'report', 'first', 0, 1, 120, 60, 'Image first'],
    [imageId(png), 'report', 'cell-image', 4, 5, 240, 120, 'Image cell-image'],
    [imageId(png), 'report', 'list-image', 12, 13, 60, 30, 'Image list-image'],
    [imageId(pixel), 'report', 'other', 15, 16, 20, 20, 'Image other'],
  ]);
  assert.ok(result.placements.every(item => !Object.hasOwn(item, 'pageNumber')));
  assert.deepEqual(result.placements.map(({ blockId, from, to }) => ({ blockId, from, to })),
    getImages(document).map(({ id, from, to }) => ({ blockId: id, from, to })));
  assert.equal(serializeDocument(document), before); assert.deepEqual(parseDocument(before), document);
  result.placements[0].width = 999;
  assert.equal(getImages(document)[0].node.attrs.width, 120);
  assert.equal((await collectDocumentImages(document)).placements[0].width, 120);
});

test('DOCX roundtrip retains repeated image bytes and separately resized placements', async () => {
  const document = nestedDocument(), initial = await collectDocumentImages(document);
  const exported = await exportDocumentDocx(document), imported = await importDocumentDocx(exported.blob);
  const result = await collectDocumentImages(imported.document);
  assert.deepEqual(result.images, initial.images);
  assert.deepEqual(result.placements.map(({ imageId, width, height, alt }) => ({ imageId, width, height, alt })),
    initial.placements.map(({ imageId, width, height, alt }) => ({ imageId, width, height, alt })));
  assert.deepEqual(result.placements.map(({ blockId, from, to }) => ({ blockId, from, to })),
    getImages(imported.document).map(({ id, from, to }) => ({ blockId: id, from, to })));
  assert.equal(result.placements.length, 4);
});

test('empty collections succeed and full model validation rejects invalid images or unrelated nodes', async () => {
  assert.deepEqual(await collectDocumentImages(createDocument()), { images: [], placements: [] });
  const invalidImage = structuredClone(nestedDocument()); invalidImage.content.content[0].attrs.src = 'https://example.com/logo.png';
  await assert.rejects(collectDocumentImages(invalidImage), /PNG|JPEG/);
  const unsupportedImage = structuredClone(nestedDocument()); unsupportedImage.content.content[0].attrs.src = 'data:image/svg+xml;base64,PHN2Zy8+';
  await assert.rejects(collectDocumentImages(unsupportedImage), /PNG|JPEG/);
  const invalidNode = structuredClone(nestedDocument()); invalidNode.content.content.push({ type: 'script' });
  await assert.rejects(collectDocumentImages(invalidNode), /unsupported/);
  await assert.rejects(collectDocumentImages(nestedDocument(), { pageNumber: 1 }), /unsupported/);
  await assert.rejects(collectDocumentImages(nestedDocument(), null), /plain object/);
});

test('collection snapshots IDs, sources and placement metadata before hashing awaits', async t => {
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, 'digest', async (...args) => { await gate; return originalDigest(...args); });
  const source = structuredClone(nestedDocument());
  const pending = collectDocumentImages(source);
  source.id = 'replacement'; source.content.content[0].attrs = { ...source.content.content[0].attrs, id: 'new', src: pixel, width: 800, alt: 'Changed' };
  source.content.content.splice(1);
  release();
  const result = await pending;
  assert.equal(result.placements.length, 4);
  assert.deepEqual(result.placements[0], { imageId: imageId(png), documentId: 'report', blockId: 'first', from: 0, to: 1, width: 120, height: 60, alt: 'Image first' });
  assert.equal(result.images[0].src, png);
});

test('pre-aborted and in-flight collection reject without returning a partial result', async t => {
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(collectDocumentImages(nestedDocument(), { signal: aborted.signal }), { name: 'AbortError' });
  const controller = new AbortController();
  t.mock.method(crypto.subtle, 'digest', () => { controller.abort(); return new Promise(() => {}); });
  await assert.rejects(collectDocumentImages(nestedDocument(), { signal: controller.signal }), { name: 'AbortError' });
});
