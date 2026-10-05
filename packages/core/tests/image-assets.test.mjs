import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const output = await build({ entryPoints: [new URL('../src/image-assets.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
const { collectEmbeddedImageAssets: collect, IMAGE_ASSET_LIMITS: limits } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
// Core validates the envelope; model wrappers validate the actual image contents.
const source = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
const id = bytes => `sha256:${createHash('sha256').update(Buffer.from(bytes)).digest('hex')}`;

test('shared assets identify file bytes and return stable input-aligned references', async () => {
  const one = source([1, 2, 3]), two = source([4, 5, 6]);
  const result = await collect([two, one, two]);
  assert.deepEqual(result.images, [
    { imageId: id([4, 5, 6]), src: two, mimeType: 'image/png', byteLength: 3 },
    { imageId: id([1, 2, 3]), src: one, mimeType: 'image/png', byteLength: 3 },
  ]);
  assert.deepEqual(result.imageIds, [id([4, 5, 6]), id([1, 2, 3]), id([4, 5, 6])]);
  assert.equal((await collect([one])).images[0].imageId, result.images[1].imageId);
});

test('input slots are snapshotted before asynchronous hashing', async () => {
  const input = [source([1]), source([2])], pending = collect(input);
  input.reverse(); input[1] = source([9]); input.push(source([3]));
  assert.deepEqual((await pending).imageIds, [id([1]), id([2])]);
});

test('invalid envelopes, counts, accessors and options fail without reading getters', async () => {
  const tooLong = 'a'.repeat(41 + Math.ceil(limits.imageBytes / 3) * 4);
  for (const input of [null, {}, [undefined], Array(1), Array(limits.sources + 1), [tooLong],
    ['https://example.test/a.png'], ['data:image/png;base64,'], ['data:image/png;base64,AA'],
    ['data:image/png;base64,AB=='], ['data:image/png;base64,!!!!'], ['data:text/html;base64,AAAA']])
    await assert.rejects(collect(input));
  let calls = 0;
  const input = []; Object.defineProperty(input, 0, { get() { calls++; return source([1]); } });
  await assert.rejects(collect(input));
  await assert.rejects(collect([], { get signal() { calls++; return undefined; } }));
  assert.equal(calls, 0);
  for (const options of [null, [], { extra: true }, { signal: {} }, { signal: null }]) await assert.rejects(collect([], options));
});

test('cancellation rejects with the host reason without returning a partial collection', async () => {
  const reason = new Error('Stop'), controller = new AbortController();
  const pending = collect([source([1]), source([2])], { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  await assert.rejects(collect([], { signal: controller.signal }), error => error === reason);
});

test('missing Web Crypto fails clearly for images and permits empty results', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  assert.deepEqual(await collect([]), { images: [], imageIds: [] });
  await assert.rejects(collect([source([1])]), /Web Crypto/);
});

test('a digest collision cannot silently merge different original files', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest: async () => new ArrayBuffer(32) } } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  await assert.rejects(collect([source([1]), source([2])]), /collision/);
});
