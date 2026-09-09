import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/state/read-image.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { readImageResource } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const imageFile = (bytes = png, type = 'image/png') => new File([bytes], 'sample.png', { type });
function browser(t, { width = 1, height = 1, failure = false, pending = false } = {}) {
  const revoked = [], created = [], images = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    constructor() { images.push(this); }
    set src(value) {
      this.source = value;
      if (value && !pending) queueMicrotask(() => { if (failure) this.onerror?.(); else this.onload?.(); });
    }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: MockImage });
  t.mock.method(URL, 'createObjectURL', blob => { assert.ok(blob instanceof Blob); const url = `blob:mock-${created.length}`; created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Image', descriptor); else delete globalThis.Image; });
  return { revoked, created, images };
}

test('image reader returns a JSON resource with exact bytes and releases its temporary URL', async t => {
  const dom = browser(t);
  const resource = await readImageResource(imageFile());
  assert.deepEqual(resource, { name: 'sample.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 1, height: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(resource)), resource);
  assert.deepEqual(dom.revoked, dom.created);
  assert.equal(dom.created.length, 1);
  assert.ok(!Object.values(resource).some(value => value instanceof Blob));
});

test('Blob input supports an explicit name and File input keeps or overrides its name', async t => {
  const dom = browser(t);
  const blob = new Blob([png], { type: 'image/png' });
  assert.equal((await readImageResource(blob)).name, 'image');
  assert.equal((await readImageResource(blob, { name: 'downloaded.png' })).name, 'downloaded.png');
  assert.equal((await readImageResource(imageFile(), { name: 'renamed.png' })).name, 'renamed.png');
  assert.deepEqual(dom.revoked, dom.created);
});

test('invalid sources and names fail before decoding', async t => {
  const dom = browser(t);
  for (const source of [null, undefined, 'https://example.invalid/image.png', {}]) await assert.rejects(readImageResource(source), /File または Blob/);
  await assert.rejects(readImageResource(imageFile(), { name: 'x'.repeat(1001) }), /名前/);
  assert.equal(dom.created.length, 0);
});

test('empty, oversized, unsupported, and mismatched input is rejected before browser decode', async t => {
  const dom = browser(t);
  for (const file of [imageFile(new Uint8Array()), imageFile(new Uint8Array(5 * 1024 * 1024 + 1)),
    imageFile(png, 'image/svg+xml'), imageFile(png, 'image/jpeg'), imageFile(Buffer.from('<svg/>'), 'image/png')])
    await assert.rejects(readImageResource(file));
  assert.equal(dom.created.length, 0);
});

test('unsafe header dimensions are rejected before allocating browser image pixels', async t => {
  const dom = browser(t);
  for (const [width, height] of [[0, 1], [10_001, 1], [5_000, 5_000]]) {
    const bytes = Buffer.from(png); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    await assert.rejects(readImageResource(imageFile(bytes)), /ピクセル|画素/);
  }
  assert.equal(dom.created.length, 0);
});

test('browser decode failure releases the temporary URL', async t => {
  const dom = browser(t, { failure: true });
  await assert.rejects(readImageResource(imageFile()), /画像を読み込めません/);
  assert.deepEqual(dom.revoked, dom.created);
});

test('a decoded size that disagrees with the PNG header is rejected', async t => {
  const dom = browser(t, { width: 2 });
  await assert.rejects(readImageResource(imageFile()), /寸法/);
  assert.deepEqual(dom.revoked, dom.created);
});

test('abort during decode rejects and revokes the URL without returning a resource', async t => {
  const dom = browser(t, { pending: true }), controller = new AbortController();
  const reading = readImageResource(imageFile(), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.created.length, 1);
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
  assert.deepEqual(dom.revoked, dom.created);
  assert.equal(dom.images[0].source, '');
  assert.equal(dom.images[0].onload, null);
});

test('an aborted read cannot create an object URL after file bytes arrive', async t => {
  const dom = browser(t), controller = new AbortController();
  let finish;
  const file = { name: 'sample.png', size: png.length, type: 'image/png', arrayBuffer: () => new Promise(resolve => { finish = resolve; }) };
  const reading = readImageResource(file, { signal: controller.signal });
  controller.abort(); finish(Uint8Array.from(png).buffer);
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(dom.created.length, 0);
});

test('an absent MIME is detected from a supported image header', async t => {
  browser(t);
  assert.equal((await readImageResource(imageFile(png, ''))).mimeType, 'image/png');
});

test('JPEG orientation can swap decode dimensions while preserving the header resource dimensions', async t => {
  const dom = browser(t, { width: 3, height: 2 });
  const header = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 3, 0, 2, 1]);
  const resource = await readImageResource(imageFile(header, 'image/jpeg'));
  assert.equal(resource.width, 2);
  assert.equal(resource.height, 3);
  assert.deepEqual(dom.revoked, dom.created);
});
