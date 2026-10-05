import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { jpegHeader } from './image-fixtures.mjs';

const built = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { collectSpreadsheetImages, createWorkbook, normalizeWorkbook, serializeWorkbook, exportSpreadsheetXlsx, importSpreadsheetXlsx } =
  await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const otherPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
const thirdPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const bytes = src => Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
const id = src => `sha256:${createHash('sha256').update(bytes(src)).digest('hex')}`;
const resource = (dataUrl = png, patch = {}) => ({ name: 'Image', mimeType: 'image/png', dataUrl,
  width: dataUrl === png ? 40 : 1, height: dataUrl === png ? 20 : 1, ...patch });
const drawing = (id, resourceId = 'original', patch = {}) => ({ id, type: 'image', resourceId, alt: `Image ${id}`,
  anchor: { row: 1, column: 2, offsetX: 3, offsetY: 4 }, width: 200, height: 100, ...patch });
const sheet = (id, drawings = [], patch = {}) => ({ id, name: id, cells: {}, rowCount: 300, columnCount: 26, drawings, ...patch });
const book = (sheets, images = { original: resource() }) => ({ sheets, resources: { images } });
const clone = value => JSON.parse(JSON.stringify(value));
const placement = (book, sheetIndex, drawingIndex) => {
  const page = book.sheets[sheetIndex], item = page.drawings[drawingIndex];
  return { imageId: id(book.resources.images[item.resourceId].dataUrl), sheetId: page.id, sheetName: page.name, sheetIndex,
    drawingId: item.id, resourceId: item.resourceId, anchor: { ...item.anchor }, width: item.width, height: item.height,
    rotation: item.rotation ?? 0, flipX: item.flipX ?? false, flipY: item.flipY ?? false, alt: item.alt };
};

test('identical bytes under different resource IDs merge while all anchors and transforms remain independent', async () => {
  const source = book([sheet('first', [drawing('back'), drawing('front', 'copy', { width: 90, height: 180, rotation: 35,
    flipX: true, alt: 'Different use', anchor: { row: 12, column: 4, offsetX: 5, offsetY: 6 } })]),
    sheet('second', [drawing('back', 'copy', { flipY: true })])],
  { unused: resource(thirdPng), copy: resource(png, { name: 'Different file name' }), original: resource(), different: resource(otherPng) });
  const before = JSON.stringify(source), result = await collectSpreadsheetImages(source);
  assert.deepEqual(result.images, [{ imageId: id(png), src: png, mimeType: 'image/png', byteLength: bytes(png).length }]);
  assert.match(result.images[0].imageId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.placements, [placement(source, 0, 0), placement(source, 0, 1), placement(source, 1, 0)]);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(await collectSpreadsheetImages(source), result);
  result.placements[0].anchor.row = 99;
  assert.equal(source.sheets[0].drawings[0].anchor.row, 1);
});

test('unique asset order follows sheet and drawing order and distinct image bytes stay separate', async () => {
  const source = book([sheet('first', [drawing('other', 'other'), drawing('original')]), sheet('second', [drawing('repeat', 'other')])],
    { original: resource(), other: resource(otherPng) });
  const result = await collectSpreadsheetImages(source);
  assert.deepEqual(result.images.map(image => image.imageId), [id(otherPng), id(png)]);
  assert.deepEqual(result.placements.map(item => item.imageId), [id(otherPng), id(png), id(otherPng)]);
  assert.deepEqual(result.images.map(image => image.byteLength), [bytes(otherPng).length, bytes(png).length]);
});

test('GIF, WebP and EXIF-oriented JPEG are collected as their original bytes without conversion', async () => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const webp = `data:image/webp;base64,${Buffer.from('524946461a000000574542505650384c0d0000002f00000000071011118888fe0700', 'hex').toString('base64')}`;
  const jpeg = `data:image/jpeg;base64,${jpegHeader({ width: 2, height: 3, orientation: 6 }).toString('base64')}`;
  const result = await collectSpreadsheetImages(book([sheet('first', [drawing('gif', 'gif'), drawing('webp', 'webp'), drawing('jpeg', 'jpeg')])], {
    gif: resource(gif, { mimeType: 'image/gif' }), webp: resource(webp, { mimeType: 'image/webp' }),
    jpeg: resource(jpeg, { mimeType: 'image/jpeg', width: 2, height: 3 }),
  }));
  assert.deepEqual(result.images.map(image => image.src), [gif, webp, jpeg]);
  assert.deepEqual(result.images.map(image => image.imageId), [gif, webp, jpeg].map(id));
  assert.deepEqual(result.images.map(image => image.mimeType), ['image/gif', 'image/webp', 'image/jpeg']);
});

test('empty or non-image drawings omit unused resources without requiring Web Crypto', async t => {
  const source = book([sheet('first', [{ id: 'text', type: 'text', anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 },
    width: 100, height: 30, text: 'Only text', fontSize: 16, color: '#000000', background: '#ffffff' }])]);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; });
  assert.deepEqual(await collectSpreadsheetImages(source), { images: [], placements: [] });
  assert.deepEqual(await collectSpreadsheetImages(createWorkbook()), { images: [], placements: [] });
});

test('collection snapshots later sheets, anchors and resource bytes before its first await', async () => {
  const source = book([sheet('first', [drawing('one')]), sheet('second', [drawing('two', 'other')])],
    { original: resource(), other: resource(otherPng) });
  const expected = clone(source), pending = collectSpreadsheetImages(source);
  source.sheets[1].drawings[0].anchor.row = 99;
  source.sheets[1].drawings[0].alt = 'Changed after call';
  source.resources.images.other.dataUrl = png;
  source.sheets[1].name = 'Renamed';
  source.sheets.reverse();
  const result = await pending;
  assert.deepEqual(result.images.map(image => image.imageId), [id(png), id(otherPng)]);
  assert.deepEqual(result.placements, [placement(expected, 0, 0), placement(expected, 1, 0)]);
});

test('invalid drawings, resources, cell data and options reject without partial collection or mutation', async () => {
  const source = book([sheet('first', [drawing('one'), drawing('two')])]), before = JSON.stringify(source);
  for (const input of [undefined, null, {}, { ...source, schemaVersion: 2 }]) await assert.rejects(collectSpreadsheetImages(input));
  for (const mutate of [
    book => { book.sheets[0].drawings[1].resourceId = 'missing'; },
    book => { book.sheets[0].drawings[1].width = 0; },
    book => { book.sheets[0].drawings[1].anchor.row = 300; },
    book => { book.resources.images.original.dataUrl = 'https://example.com/image.png'; },
    book => { book.resources.images.original.width = 999; },
    book => { book.sheets[0].cells.A1 = { value: 123 }; },
  ]) {
    const invalid = clone(source); mutate(invalid); const snapshot = clone(invalid);
    await assert.rejects(collectSpreadsheetImages(invalid)); assert.deepEqual(invalid, snapshot);
  }
  for (const options of [null, [], { unknown: true }, { signal: null }, { signal: {} }])
    await assert.rejects(collectSpreadsheetImages(source, options));
  let getters = 0;
  await assert.rejects(collectSpreadsheetImages(source, { get signal() { getters++; return undefined; } }));
  assert.equal(getters, 0); assert.equal(JSON.stringify(source), before);
});

test('pre-abort and abort while hashing reject with the host reason and preserve the workbook', async () => {
  const source = book([sheet('first', [drawing('one')]), sheet('second', [drawing('two', 'other')])],
    { original: resource(), other: resource(otherPng) });
  const before = JSON.stringify(source), reason = new Error('Stopped by host'), pre = new AbortController();
  pre.abort(reason);
  await assert.rejects(collectSpreadsheetImages(source, { signal: pre.signal }), error => error === reason);
  const active = new AbortController(), pending = collectSpreadsheetImages(source, { signal: active.signal });
  active.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(JSON.stringify(source), before);
});

test('headless collection does not load React or access DOM, image decoding, Blob or networking', async t => {
  for (const path of Object.keys(built.metafile.inputs)) assert.doesNotMatch(path, /node_modules\/(?:react|react-dom)\//);
  const source = book([sheet('first', [drawing('one')])]);
  for (const name of ['document', 'window', 'Image', 'createImageBitmap', 'Blob', 'fetch', 'XMLHttpRequest']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error(`Unexpected global ${name}`); } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  assert.equal((await collectSpreadsheetImages(source)).images[0].imageId, id(png));
});

test('real XLSX roundtrip maps 30 placements to three analyses even across distinct media paths with the same bytes', async () => {
  const sources = [png, otherPng, thirdPng];
  const source = normalizeWorkbook(book(Array.from({ length: 3 }, (_, sheetIndex) => sheet(`Sheet${sheetIndex + 1}`,
    Array.from({ length: 10 }, (_, drawingIndex) => {
      const index = sheetIndex * 10 + drawingIndex;
      return drawing(`drawing-${index}`, `resource-${index % 6}`, { anchor: { row: drawingIndex * 2, column: sheetIndex, offsetX: 5, offsetY: 6 },
        width: (20 + index) * (index % 3 === 0 ? 2 : 1), height: 20 + index,
        rotation: index * 5, flipX: index % 2 === 0, flipY: index % 3 === 0 });
    }))), Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`resource-${index}`, resource(sources[index % 3], { name: `File ${index}` })]))));
  const before = serializeWorkbook(source), file = await exportSpreadsheetXlsx(source);
  const imported = await importSpreadsheetXlsx(file);
  assert.deepEqual(imported.warnings, []);
  // The exporter writes each resource ID as its own media part; the importer keeps those six paths distinct.
  assert.equal(Object.keys(imported.workbook.resources.images).length, 6);
  const result = await collectSpreadsheetImages(imported.workbook);
  assert.deepEqual(result.images.map(image => image.imageId), sources.map(id));
  assert.equal(result.placements.length, 30);
  const expected = imported.workbook.sheets.flatMap((sheet, sheetIndex) => sheet.drawings.map((_, drawingIndex) => placement(imported.workbook, sheetIndex, drawingIndex)));
  assert.deepEqual(result.placements, expected);
  let calls = 0;
  const analyze = async asset => { calls++; return `Description for ${asset.imageId}`; };
  const analyses = new Map(await Promise.all(result.images.map(async asset => [asset.imageId, await analyze(asset)])));
  const annotated = result.placements.map(item => ({ ...item, description: analyses.get(item.imageId) }));
  assert.equal(calls, 3); assert.equal(annotated.length, 30);
  assert.ok(annotated.every(item => item.description === `Description for ${item.imageId}`));
  for (const [index, item] of result.placements.entries()) {
    const original = source.sheets.flatMap(sheet => sheet.drawings)[index];
    assert.deepEqual(item.anchor, original.anchor);
    for (const key of ['width', 'height', 'rotation']) assert.ok(Math.abs(item[key] - (original[key] ?? 0)) < .00011);
    assert.equal(item.flipX, original.flipX ?? false); assert.equal(item.flipY, original.flipY ?? false);
    assert.equal(item.alt, original.alt);
  }
  assert.equal(serializeWorkbook(source), before);
});
