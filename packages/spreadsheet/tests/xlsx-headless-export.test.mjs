import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { jpegHeader, pngHeader } from './image-fixtures.mjs';

const built = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { createWorkbook, exportSpreadsheetXlsx, importSpreadsheetXlsx, serializeWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const image = (bytes = gifBytes, mimeType = 'image/gif', width = 1, height = 1) =>
  ({ name: '添付画像', mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, width, height });
function workbook(resource = image()) {
  const book = createWorkbook();
  return { ...book, resources: { images: { asset: resource } }, sheets: book.sheets.map(sheet => ({ ...sheet,
    drawings: [{ id: 'picture', type: 'image', resourceId: 'asset', alt: 'sample',
      anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 }, width: 120, height: 80 }],
  })) };
}
const png = (width = 1, height = 1) => new Blob([pngHeader(width, height)], { type: 'image/png' });

test('the public headless exporter converts an image once across sheets and round-trips it without DOM', async () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof Image, 'undefined');
  for (const input of Object.keys(built.metafile.inputs)) assert.doesNotMatch(input, /node_modules\/(?:react|react-dom)\//);
  const source = workbook();
  source.sheets.push({ ...source.sheets[0], id: 'sheet-2', name: 'Second' });
  const before = serializeWorkbook(source), requests = [];
  const blob = await exportSpreadsheetXlsx(source, { rasterizeImage(request) {
    requests.push(request);
    assert.equal(request.resourceId, 'asset');
    assert.equal(request.name, '添付画像');
    assert.ok(request.source instanceof Blob);
    assert.equal(request.source.type, 'image/gif');
    assert.ok(Object.isFrozen(request));
    return png(request.width, request.height);
  } });
  assert.equal(requests.length, 1);
  assert.ok(blob instanceof Blob);
  const { workbook: restored } = await importSpreadsheetXlsx(blob);
  assert.equal(restored.sheets.length, 2);
  assert.equal(restored.sheets[0].drawings[0].type, 'image');
  assert.equal(restored.sheets[1].drawings[0].type, 'image');
  assert.equal(Object.values(restored.resources.images)[0].mimeType, 'image/png');
  assert.equal(serializeWorkbook(source), before);
});

test('EXIF orientation supplies displayed dimensions, while plain PNG/JPEG require no converter', async () => {
  const calls = [];
  await exportSpreadsheetXlsx(workbook(image(jpegHeader({ orientation: 6 }), 'image/jpeg', 2, 3)), {
    rasterizeImage(request) { calls.push([request.width, request.height]); return png(request.width, request.height); },
  });
  assert.deepEqual(calls, [[3, 2]]);
  for (const resource of [image(pngHeader(2, 3), 'image/png', 2, 3), image(jpegHeader({ orientation: 1 }), 'image/jpeg', 2, 3)]) {
    await exportSpreadsheetXlsx(workbook(resource), { rasterizeImage() { assert.fail('unnecessary conversion'); } });
  }
});

test('WebP conversion produces a PNG resource that survives an XLSX round-trip without DOM', async () => {
  const webp = Buffer.from('524946461a000000574542505650384c0d0000002f00000000071011118888fe0700', 'hex');
  let calls = 0;
  const blob = await exportSpreadsheetXlsx(workbook(image(webp, 'image/webp')), {
    rasterizeImage({ source, width, height }) {
      calls++;
      assert.equal(source.type, 'image/webp');
      assert.deepEqual([width, height], [1, 1]);
      return png(width, height);
    },
  });
  assert.equal(calls, 1);
  const { workbook: restored } = await importSpreadsheetXlsx(blob);
  const picture = restored.sheets[0].drawings[0];
  const resource = restored.resources.images[picture.resourceId];
  assert.equal(picture.type, 'image');
  assert.equal(resource.mimeType, 'image/png');
  assert.deepEqual([resource.width, resource.height], [1, 1]);
});

test('conversion errors identify the resource and never silently omit an image', async () => {
  await assert.rejects(exportSpreadsheetXlsx(workbook()), /添付画像.*asset.*rasterizeImage/);
  await assert.rejects(exportSpreadsheetXlsx(workbook(), { rasterizeImage() { throw new Error('decoder failed'); } }), /asset.*decoder failed/);
});

test('host converter output is checked for MIME, bytes, dimensions and size', async () => {
  const invalid = [
    new Blob([pngHeader(1, 1)], { type: 'image/jpeg' }),
    new Blob(['not a png'], { type: 'image/png' }),
    png(2, 1),
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }),
    { type: 'image/png', size: 1, arrayBuffer: () => png().arrayBuffer() },
  ];
  for (const result of invalid)
    await assert.rejects(exportSpreadsheetXlsx(workbook(), { rasterizeImage: () => result }), /添付画像.*asset/);
});

test('cancelling a non-cooperative converter rejects promptly and ignores its late result', async () => {
  const controller = new AbortController();
  let complete, started;
  const ready = new Promise(resolve => { started = resolve; });
  const task = exportSpreadsheetXlsx(workbook(), { signal: controller.signal,
    rasterizeImage({ signal }) {
      assert.equal(signal, controller.signal);
      started();
      return new Promise(resolve => { complete = resolve; });
    },
  });
  await ready;
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  complete(png());
  await Promise.resolve();
  const before = new AbortController(); before.abort();
  await assert.rejects(exportSpreadsheetXlsx(workbook(), { signal: before.signal,
    rasterizeImage() { assert.fail('pre-aborted conversion'); } }), { name: 'AbortError' });
});

test('cancellation also stops waiting for the converter result bytes', { timeout: 1000 }, async () => {
  const controller = new AbortController(), converted = png();
  let complete, started;
  const ready = new Promise(resolve => { started = resolve; });
  const task = exportSpreadsheetXlsx(workbook(), { signal: controller.signal,
    rasterizeImage: () => ({ type: converted.type, size: converted.size, text: () => converted.text(),
      arrayBuffer() { started(); return new Promise(resolve => { complete = resolve; }); },
    }),
  });
  await ready;
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  complete(await converted.arrayBuffer());
  await Promise.resolve();
});
