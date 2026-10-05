import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: [new URL('../src/pdf/pdfjs-loader.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlidePdfLoader, SLIDE_PDF_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = () => new TextEncoder().encode('%PDF-1.7\nExample bytes handled by injected PDF.js');
function canvas() {
  const result = { width: 0, height: 0, copies: [], children: [] };
  result.getContext = () => ({ drawImage: (source, x, y) => result.copies.push({ width: source.width, height: source.height, x, y }) });
  result.ownerDocument = { createElement(tag) { assert.equal(tag, 'canvas'); const child = canvas(); result.children.push(child); return child; } };
  return result;
}
function engine({ pages = 3, width = 100, height = 50, delayedRender = false, loading, pageLoading } = {}) {
  const requests = [], renders = [], counts = { taskDestroy: 0, documentDestroy: 0, cleanup: 0, getPage: 0 };
  const page = { getViewport: ({ scale }) => ({ width: width * scale, height: height * scale }),
    cleanup() { counts.cleanup++; }, render(options) {
      const work = deferred(), render = { options, work, cancelled: 0 };
      renders.push(render);
      if (!delayedRender) work.resolve();
      return { promise: work.promise, cancel() { render.cancelled++; } };
    } };
  const document = { numPages: pages, async getPage() { counts.getPage++; return pageLoading ? pageLoading.promise : page; },
    async destroy() { counts.documentDestroy++; } };
  const pdfjs = { getDocument(options) { requests.push(options); return { promise: loading ? loading.promise : Promise.resolve(document),
    async destroy() { counts.taskDestroy++; } }; } };
  const controller = new AbortController();
  return { pdfjs, requests, renders, counts, document, page, controller,
    load: () => createSlidePdfLoader(pdfjs, input())({ signal: controller.signal }) };
}

test('the loader copies caller bytes at creation and supplies a separate worker-transfer buffer for each load', async () => {
  const host = engine(), bytes = input(), expected = bytes.slice(), options = { cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/fonts/', wasmUrl: '/wasm/' };
  const load = createSlidePdfLoader(host.pdfjs, bytes, options);
  bytes.fill(0); options.cMapUrl = '/changed/';
  const first = await load({ signal: new AbortController().signal });
  assert.deepEqual(host.requests[0].data, expected);
  assert.equal(host.requests[0].cMapUrl, '/cmaps/');
  assert.equal(host.requests[0].isEvalSupported, false);
  assert.equal(host.requests[0].enableXfa, false);
  assert.equal(host.requests[0].stopAtErrors, true);
  assert.equal(host.requests[0].maxImageSize, SLIDE_PDF_LIMITS.renderPixels);
  structuredClone(host.requests[0].data, { transfer: [host.requests[0].data.buffer] });
  const second = await load({ signal: new AbortController().signal });
  assert.deepEqual(host.requests[1].data, expected);
  await first.destroy(); await second.destroy();
});

test('ArrayBuffer and Blob inputs load without fetching URLs; unsafe options and bounded input failures reject', async () => {
  for (const data of [input().buffer, new Blob([input()])]) {
    const host = engine(); await (await createSlidePdfLoader(host.pdfjs, data)({ signal: host.controller.signal })).destroy();
    assert.deepEqual(host.requests[0].data, input());
    assert.equal('url' in host.requests[0], false);
  }
  const host = engine(), oversized = new Blob(['x']);
  Object.defineProperty(oversized, 'size', { value: SLIDE_PDF_LIMITS.fileBytes + 1 });
  for (const data of [null, 'https://example.com/file.pdf', new Uint8Array(), oversized]) assert.throws(() => createSlidePdfLoader(host.pdfjs, data));
  for (const options of [null, [], { isEvalSupported: true }, { password: 'secret' }, { cMapPacked: 'true' }, { cMapUrl: 123 }])
    assert.throws(() => createSlidePdfLoader(host.pdfjs, input(), options));
  assert.equal(host.requests.length, 0);
});

test('page numbers, dimensions and physical render pixel limits are validated before drawing', async () => {
  const host = engine(), document = await host.load();
  assert.equal(document.pageCount, 3);
  for (const pageNumber of [0, 4, 1.5, NaN]) await assert.rejects(document.getPage(pageNumber));
  assert.equal(host.counts.getPage, 0);
  const page = await document.getPage(2), target = canvas();
  assert.deepEqual([page.width, page.height], [100, 50]);
  for (const scale of [0, -1, NaN, Infinity, 100, 200]) await assert.rejects(page.render({ canvas: target, scale }));
  assert.equal(host.renders.length, 0); assert.equal(target.children.length, 0);
  await page.render({ canvas: target, scale: 2 });
  assert.deepEqual([target.width, target.height], [200, 100]);
  assert.deepEqual(target.copies, [{ width: 200, height: 100, x: 0, y: 0 }]);
  assert.notEqual(host.renders[0].options.canvas, target);
  assert.equal(host.renders[0].options.annotationMode, 0);
  assert.deepEqual([target.children[0].width, target.children[0].height], [0, 0]);
  assert.equal(host.counts.cleanup, 1);
  await document.destroy();
});

test('a page can render to thumbnails and the main canvas together and cleans up only after both finish', async () => {
  const host = engine({ delayedRender: true }), document = await host.load(), page = await document.getPage(1);
  const first = page.render({ canvas: canvas(), scale: .2 }), second = page.render({ canvas: canvas(), scale: 2 });
  host.renders[0].work.resolve(); await first;
  assert.equal(host.counts.cleanup, 0);
  host.renders[1].work.resolve(); await second;
  assert.equal(host.counts.cleanup, 1);
  await document.destroy();
});

test('new rendering on the same canvas cancels old work and only the new image can be committed', async () => {
  const host = engine({ delayedRender: true }), document = await host.load(), page = await document.getPage(1), target = canvas();
  const old = page.render({ canvas: target, scale: 1 }), rejected = assert.rejects(old, { name: 'AbortError' });
  const current = page.render({ canvas: target, scale: 2 });
  await rejected; assert.equal(host.renders[0].cancelled, 1);
  host.renders[1].work.resolve(); await current;
  host.renders[0].work.resolve(); await tick();
  assert.deepEqual(target.copies, [{ width: 200, height: 100, x: 0, y: 0 }]);
  await document.destroy();
});

test('abort during Blob reading prevents a loading task from being started even when bytes arrive later', async () => {
  const host = engine(), reading = deferred(), blob = new Blob(['PDF']);
  Object.defineProperty(blob, 'arrayBuffer', { value: () => reading.promise });
  const pending = createSlidePdfLoader(host.pdfjs, blob)({ signal: host.controller.signal });
  const error = new Error('Reader closed'); host.controller.abort(error);
  await assert.rejects(pending, cause => cause === error);
  reading.resolve(input().buffer); await tick();
  assert.equal(host.requests.length, 0);
});

test('pre-aborted or invalid loader contexts do not create PDF.js tasks', async () => {
  const host = engine(), load = createSlidePdfLoader(host.pdfjs, input());
  host.controller.abort();
  await assert.rejects(load({ signal: host.controller.signal }), { name: 'AbortError' });
  for (const signal of [undefined, null, {}]) await assert.rejects(load({ signal }));
  assert.equal(host.requests.length, 0);
});

test('abort destroys a pending task promptly and disposes a late document that ignored cancellation', async () => {
  const loading = deferred(), host = engine({ loading }), pending = host.load(), error = new Error('Source replaced');
  host.controller.abort(error);
  await assert.rejects(pending, cause => cause === error);
  assert.equal(host.counts.taskDestroy, 1);
  loading.resolve(host.document); await tick();
  assert.equal(host.counts.documentDestroy, 1);
});

test('abort inside getDocument still observes its later failure and frees the task', async () => {
  const loading = deferred(), host = engine({ loading }), getDocument = host.pdfjs.getDocument;
  host.pdfjs.getDocument = options => { const task = getDocument(options); host.controller.abort(); return task; };
  await assert.rejects(host.load(), { name: 'AbortError' });
  loading.reject(new Error('Late PDF.js failure')); await tick();
  assert.equal(host.counts.taskDestroy, 1);
});

test('aborted page requests dispose late pages and never publish them', async () => {
  const pageLoading = deferred(), host = engine({ pageLoading }), document = await host.load(), controller = new AbortController();
  const pending = document.getPage(1, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  pageLoading.resolve(host.page); await tick(); assert.equal(host.counts.cleanup, 1);
  await document.destroy();
});

test('destroy is idempotent, cancels renders and disallows further page and render work', async () => {
  const host = engine({ delayedRender: true }), document = await host.load(), page = await document.getPage(1), target = canvas();
  const pending = page.render({ canvas: target, scale: 1 }), rejected = assert.rejects(pending, { name: 'AbortError' });
  await Promise.all([document.destroy(), document.destroy()]); await rejected;
  assert.equal(host.counts.taskDestroy, 1); assert.equal(host.renders[0].cancelled, 1);
  await assert.rejects(document.getPage(1), { name: 'AbortError' });
  await assert.rejects(page.render({ canvas: target, scale: 1 }), { name: 'AbortError' });
  host.renders[0].work.reject(new Error('Late render failure')); await tick();
  assert.deepEqual(target.copies, []);
});

test('the loader signal remains active after loading and releases the loaded document', async () => {
  const host = engine(), document = await host.load();
  host.controller.abort(); await tick();
  assert.equal(host.counts.taskDestroy, 1);
  await assert.rejects(document.getPage(1), { name: 'AbortError' });
  await document.destroy(); assert.equal(host.counts.taskDestroy, 1);
});

test('excessive page counts, invalid page dimensions and password errors fail with cleanup', async () => {
  for (const pages of [0, 2001, Infinity]) {
    const host = engine({ pages }); await assert.rejects(host.load(), /ページ数/); await tick();
    assert.equal(host.counts.taskDestroy, 1);
  }
  for (const width of [0, NaN, 100001]) {
    const host = engine({ width }), document = await host.load();
    await assert.rejects(document.getPage(1), /寸法/); assert.equal(host.counts.cleanup, 1); await document.destroy();
  }
  const loading = deferred(), host = engine({ loading }), pending = host.load();
  loading.reject(Object.assign(new Error('Password needed'), { name: 'PasswordException' }));
  await assert.rejects(pending, /パスワード/); await tick(); assert.equal(host.counts.taskDestroy, 1);
});
