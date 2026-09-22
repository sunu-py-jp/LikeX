import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export * from './src/render/export-images';
  export * from './src/render/types';
  export { awaitSlideImageTask } from './src/render/async';
  export { createSlideDeck, createSlideElement } from './src/model/normalize';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { exportImage, exportImages, SLIDE_IMAGE_EXPORT_LIMITS, createSlideDeck, createSlideElement, awaitSlideImageTask } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const slide = id => ({ id, name: id, background: '#ffffff', notes: '', elements: [] });
const deck = (count = 3, width = 40, height = 20) => createSlideDeck({ width, height,
  slides: Array.from({ length: count }, (_, index) => slide(`page-${index + 1}`)) });
// Contract tests need only a PNG signature and IHDR; pixel encoding belongs to
// the browser renderer tests. No native Blob or DOM is used by this adapter.
function pngBytes(width, height, length = 33) {
  const bytes = new Uint8Array(length);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const header = new DataView(bytes.buffer);
  header.setUint32(16, width); header.setUint32(20, height);
  bytes[24] = 8; bytes[25] = 6;
  return bytes;
}
function png(width, height, patch = {}) {
  const bytes = pngBytes(width, height);
  return { size: bytes.byteLength, type: 'image/png', arrayBuffer: async () => bytes.buffer,
    text: async () => '', ...patch };
}
const renderer = request => png(request.width, request.height);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function cancellation() {
  const listeners = new Set();
  const signal = { aborted: false, reason: undefined, throwIfAborted() { if (this.aborted) throw this.reason; },
    addEventListener(type, listener) { assert.equal(type, 'abort'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'abort'); listeners.delete(listener); },
  };
  return { signal, listeners, abort(reason) { signal.aborted = true; signal.reason = reason; for (const listener of [...listeners]) listener(); } };
}

test('single-page and ID targets report original page identity and rounded pixel dimensions', async () => {
  const input = deck(3, 41, 21), requests = [];
  const render = request => { requests.push(request); return renderer(request); };
  const result = await exportImage(input, { slideId: 'page-2', scale: .5, renderer: render });
  assert.deepEqual({ ...result, blob: undefined }, { blob: undefined, width: 21, height: 11,
    mimeType: 'image/png', pageNumber: 2, slideId: 'page-2' });
  assert.equal(result.blob.type, 'image/png');
  assert.equal(requests[0].slide, requests[0].deck.slides[1]);
  assert.equal(requests[0].format, 'png'); assert.equal(requests[0].scale, .5);
  assert.equal((await exportImage(input, { pageNumber: 3, format: 'png', renderer })).pageNumber, 3);
});

test('all pages, inclusive ranges and ordered unique lists execute sequentially', async () => {
  const input = deck(4);
  for (const [options, expected] of [[{}, [1, 2, 3, 4]], [{ range: { from: 2, to: 3 } }, [2, 3]],
    [{ pageNumbers: [4, 1, 3] }, [4, 1, 3]], [{ slideIds: ['page-3', 'page-1'] }, [3, 1]]]) {
    let active = 0, maximum = 0;
    const calls = [];
    const results = await exportImages(input, { ...options, renderer: async request => {
      maximum = Math.max(maximum, ++active); calls.push(request.pageNumber);
      await tick(); active--; return renderer(request);
    } });
    assert.equal(maximum, 1);
    assert.deepEqual(calls, expected); assert.deepEqual(results.map(result => result.pageNumber), expected);
  }
});

test('invalid and conflicting selectors reject the entire selection before any renderer runs', async () => {
  let calls = 0;
  const render = request => { calls++; return renderer(request); };
  const singles = [{}, { pageNumber: 0 }, { pageNumber: 4 }, { pageNumber: 1.5 }, { pageNumber: NaN },
    { slideId: '' }, { slideId: 'missing' }, { pageNumber: 1, slideId: 'page-1' }, { pageNumbers: [1] }];
  const multiples = [{ pageNumbers: [] }, { slideIds: [] }, { pageNumbers: [1, 1] }, { pageNumbers: [1, 4] },
    { slideIds: ['page-1', 'page-1'] }, { slideIds: ['page-1', 'missing'] }, { pageNumbers: [1, , 3] },
    { range: { from: 2, to: 1 } }, { range: { from: 0, to: 2 } }, { range: { from: 1, to: 4 } },
    { range: { from: 1, to: 2.5 } }, { range: null }, { pageNumbers: '1' },
    { range: { from: 1, to: 2 }, pageNumbers: [1] }, { pageNumbers: [1], slideIds: ['page-1'] },
    { pageNumber: 1 }];
  for (const options of singles) await assert.rejects(exportImage(deck(), { ...options, renderer: render }));
  for (const options of multiples) await assert.rejects(exportImages(deck(), { ...options, renderer: render }));
  await assert.rejects(exportImages(deck(), { renderer: render, get scale() { throw Error('must not invoke getter'); } }), /対応していない/);
  assert.equal(calls, 0);
});

test('format, scale, model, per-image dimensions and total pixels are validated before rendering', async () => {
  let calls = 0;
  const render = request => { calls++; return renderer(request); };
  for (const scale of [0, -1, Infinity, NaN, '2', .00001, Number.MAX_VALUE])
    await assert.rejects(exportImages(deck(), { scale, renderer: render }));
  await assert.rejects(exportImages(deck(), { format: 'jpeg', renderer: render }));
  await assert.rejects(exportImages(deck(), {}), /renderer/);
  await assert.rejects(exportImages({ ...deck(), version: 2 }, { renderer: render }));
  await assert.rejects(exportImages(deck(1, 4096, 1), { scale: 4.001, renderer: render }), /上限/);
  await assert.rejects(exportImages(deck(1, 10_000, 4001), { renderer: render }), /上限/);
  await assert.rejects(exportImages(deck(5, 10_000, 4000), { renderer: render }), /全体/);
  assert.equal(calls, 0);
  assert.equal((await exportImage(deck(1, 4096, 1), { pageNumber: 1, scale: 4, renderer })).width, SLIDE_IMAGE_EXPORT_LIMITS.dimension);
  assert.equal((await exportImages(deck(4, 10_000, 4000), { renderer })).length, 4);
});

test('every request shares one detached deeply frozen snapshot despite caller or renderer mutation', async () => {
  const source = JSON.parse(JSON.stringify(createSlideDeck({ slides: [
    { ...slide('page-1'), elements: [createSlideElement({ type: 'text', id: 'text', text: 'original' })] }, slide('page-2'),
  ] })));
  const first = deferred(), requests = [];
  const pending = exportImages(source, { renderer: request => {
    requests.push(request);
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.deck) && Object.isFrozen(request.slide));
    assert.throws(() => { request.deck.slides.reverse(); }, TypeError);
    assert.throws(() => { request.deck.slides[0].elements[0].text = 'renderer mutation'; }, TypeError);
    return request.pageNumber === 1 ? first.promise : renderer(request);
  } });
  assert.notEqual(requests[0].deck, source); assert.notEqual(requests[0].slide, source.slides[0]);
  source.slides.reverse(); source.title = 'caller mutation'; source.slides[1].elements[0].text = 'changed';
  first.resolve(renderer(requests[0]));
  const results = await pending;
  assert.deepEqual(results.map(result => result.slideId), ['page-1', 'page-2']);
  assert.equal(requests[0].deck, requests[1].deck);
  assert.equal(requests[1].deck.slides[0].elements[0].text, 'original');
  const normalized = deck();
  await exportImage(normalized, { pageNumber: 1, renderer: request => {
    assert.notEqual(request.deck, normalized); assert.notEqual(request.slide, normalized.slides[0]); return renderer(request);
  } });
});

test('PNG signatures, IHDR dimensions, declared size and Blob contracts are checked', async () => {
  const invalid = [null, {}, png(40, 20, { type: 'image/jpeg' }), png(40, 20, { size: -1 }),
    png(40, 20, { size: 33.5 }), png(40, 20, { size: NaN }), png(40, 20, { size: 34 }),
    png(40, 20, { text: null }), png(39, 20), png(40, 21),
    png(40, 20, { arrayBuffer: async () => new Uint8Array(33) }),
    png(40, 20, { arrayBuffer: async () => new ArrayBuffer(32) })];
  for (const value of invalid) await assert.rejects(exportImage(deck(), { pageNumber: 1, renderer: () => value }));
  for (const position of [0, 7, 11, 12]) {
    const bytes = pngBytes(40, 20); bytes[position] ^= 1;
    await assert.rejects(exportImage(deck(), { pageNumber: 1, renderer: () => png(40, 20, { arrayBuffer: async () => bytes.buffer }) }), /署名|IHDR/);
  }
  let reads = 0;
  await assert.rejects(exportImage(deck(), { pageNumber: 1, renderer: () => png(40, 20, {
    size: SLIDE_IMAGE_EXPORT_LIMITS.totalBytes + 1, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); },
  }) }), /上限/);
  assert.equal(reads, 0);
});

test('the cumulative Blob budget stops before reading an oversized next output', async () => {
  const bytes = pngBytes(40, 20, 60 * 1024 * 1024);
  let calls = 0, reads = 0;
  await assert.rejects(exportImages(deck(), { renderer: () => {
    calls++;
    return png(40, 20, { size: bytes.length, arrayBuffer: async () => { reads++; return bytes.buffer; } });
  } }), /上限/);
  assert.equal(calls, 2); assert.equal(reads, 1);
});

test('pre-aborted exports never render and active aborts promptly reject and observe late renderer failures', async () => {
  const control = cancellation(), reason = new Error('cancelled by host');
  control.abort(reason);
  await assert.rejects(exportImages(deck(), { signal: control.signal, renderer: () => assert.fail('rendered') }), error => error === reason);
  const active = cancellation(), first = deferred();
  let calls = 0;
  const pending = exportImages(deck(), { signal: active.signal, renderer: request => {
    calls++; assert.equal(request.signal, active.signal); return first.promise;
  } });
  active.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(active.listeners.size, 0);
  first.reject(new Error('late renderer error'));
  await tick(); assert.equal(calls, 1);
});

test('aborting a pending Blob read also settles promptly and never starts another page', async () => {
  const control = cancellation(), reading = deferred(), started = deferred();
  let calls = 0;
  const pending = exportImages(deck(), { signal: control.signal, renderer: request => {
    calls++; return png(request.width, request.height, { arrayBuffer: () => { started.resolve(); return reading.promise; } });
  } });
  await started.promise;
  control.abort(undefined);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(control.listeners.size, 0);
  reading.reject(new Error('late read error'));
  await tick(); assert.equal(calls, 1);
});

test('render and read failures return no partial results and dispose abort subscriptions', async () => {
  for (const readFailure of [false, true]) {
    const control = cancellation(), failure = new Error('render failed');
    let calls = 0;
    await assert.rejects(exportImages(deck(), { signal: control.signal, renderer: request => {
      if (++calls === 2) {
        if (!readFailure) throw failure;
        return png(request.width, request.height, { arrayBuffer: async () => { throw failure; } });
      }
      return renderer(request);
    } }), error => error === failure);
    assert.equal(calls, 2); assert.equal(control.listeners.size, 0);
  }
});

test('shared task waiting supports PromiseLike values and an abort inside a synchronous task', async () => {
  const control = cancellation();
  const value = await awaitSlideImageTask(() => ({ then(resolve) { queueMicrotask(() => resolve(42)); } }), control.signal);
  assert.equal(value, 42); assert.equal(control.listeners.size, 0);
  const reason = new Error('cancel before returning');
  await assert.rejects(awaitSlideImageTask(() => {
    control.abort(reason);
    return Promise.reject(new Error('later task rejection'));
  }, control.signal), error => error === reason);
  await tick(); assert.equal(control.listeners.size, 0);
});

test('portable exports do not require global Blob, document, window or DOMException', async t => {
  for (const name of ['Blob', 'document', 'window', 'DOMException']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error(`Unexpected global ${name}`); } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  assert.equal((await exportImages(deck(), { renderer })).length, 3);
  const control = cancellation(); control.abort(undefined);
  await assert.rejects(exportImages(deck(), { renderer, signal: control.signal }), { name: 'AbortError' });
});
