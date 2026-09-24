import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { createMediaCache } from './src/state/media-cache.ts';
    export { MediaCacheContext } from './src/state/media-context.tsx';
    export { default as FilePreview } from './src/ui/file-preview.tsx';
    export { getPreviewFormat, EXPLORER_VIDEO_MIME_TYPES } from './src/model/preview-formats.ts';
  `, resolveDir: packageRoot, sourcefile: 'preview-source-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|react-test-renderer|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { createMediaCache, MediaCacheContext, FilePreview, getPreviewFormat, EXPLORER_VIDEO_MIME_TYPES } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`,
);
const source = id => ({ kind: 'existing', id });
const entry = (name = 'movie.mov', id = 'file') => ({ id, name, parent: 'root', kind: 'file', mime: '', size: 10,
  source: source(id), favorite: 0, createdAt: '', updatedAt: '' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
function cacheFor(t, options) { const cache = createMediaCache(options); t.after(() => cache.dispose()); return cache; }
function urlsFor(t) {
  const made = [], revoked = [];
  t.mock.method(URL, 'createObjectURL', blob => { const value = `blob:preview-${made.length}`; made.push({ blob, value }); return value; });
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  return { made, revoked };
}
async function mount(t, props, cache, strict = false) {
  let renderer;
  const element = props => {
    const preview = h(MediaCacheContext.Provider, { value: cache }, h(FilePreview, props));
    return strict ? h(StrictMode, null, preview) : preview;
  };
  await act(async () => { renderer = create(element(props)); });
  const unmount = async () => { if (renderer) { await act(async () => renderer.unmount()); renderer = null; } };
  t.after(unmount);
  return { get root() { return renderer.root; }, get json() { return renderer.toJSON(); }, unmount,
    async update(next) { await act(async () => renderer.update(element(next))); } };
}
const identity = (cacheKey = 'small', extra = {}) => ({ entryId: 'file', source: source('original'), revision: 0, cacheKey, ...extra });
const video = (cacheKey, read) => ({ kind: 'blob', cacheKey, mime: 'video/mp4', read });

test('variant lookup precedes reads and isolates variants, entries, sources, revisions and workspaces from originals', async t => {
  const cache = cacheFor(t), other = cacheFor(t); let reads = 0;
  const read = async () => { reads++; return new Blob(['preview']); };
  const first = cache.previewSources.acquire(identity(), read);
  const repeated = cache.previewSources.acquire(identity(), async () => { throw Error('new closure must be ignored'); });
  assert.equal(await first.promise, await repeated.promise); assert.equal(reads, 1);
  const leases = [cache.previewSources.acquire(identity('large'), read),
    cache.previewSources.acquire(identity('small', { entryId: 'another' }), read),
    cache.previewSources.acquire(identity('small', { source: source('different') }), read),
    cache.previewSources.acquire(identity('small', { revision: 1 }), read), other.previewSources.acquire(identity(), read)];
  await Promise.all(leases.map(lease => lease.promise)); assert.equal(reads, 6);
  const raw = cache.acquire(source('original'), async () => new Blob(['original']));
  assert.equal(await (await raw.promise).text(), 'original');
  for (const lease of [first, repeated, raw, ...leases]) lease.release();
  const reopened = cache.previewSources.acquire(identity(), read); await reopened.promise; assert.equal(reads, 6); reopened.release();
});

test('variant URLs are ref-counted and remain valid for consumers until their final release even after invalidation', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t); let reads = 0;
  const read = async () => { reads++; return new Blob(['preview']); };
  const a = cache.previewSources.acquire(identity(), read), b = cache.previewSources.acquire(identity(), read);
  await a.promise; await b.promise; const url = a.objectUrl('video/mp4');
  assert.equal(b.objectUrl('video/mp4'), url); assert.equal(made.length, 1);
  cache.invalidateExisting(1); assert.deepEqual(revoked, []);
  a.release(); assert.deepEqual(revoked, []); b.release(); assert.deepEqual(revoked, [url]);
  const next = cache.previewSources.acquire(identity(), read); await next.promise; assert.equal(reads, 2); next.release();
});

test('variant cancellation aborts only the last consumer and stale ignored reads do not replace new content', async t => {
  const cache = cacheFor(t, { concurrency: 1 }); const old = deferred(); let oldSignal;
  const a = cache.previewSources.acquire(identity(), ({ signal }) => { oldSignal = signal; return old.promise; });
  const b = cache.previewSources.acquire(identity(), () => old.promise);
  await flush(); a.release(); assert.equal(oldSignal.aborted, false); b.release(); assert.equal(oldSignal.aborted, true);
  await assert.rejects(a.promise, { name: 'AbortError' });
  const fresh = cache.previewSources.acquire(identity(), async () => new Blob(['fresh']));
  assert.equal(await (await fresh.promise).text(), 'fresh');
  old.resolve(new Blob(['stale'])); await flush();
  const same = cache.previewSources.acquire(identity(), () => { throw Error('must use fresh cache'); });
  assert.equal(await (await same.promise).text(), 'fresh'); fresh.release(); same.release();
});

test('local variants use File identity, survive existing-content invalidation, and accept cross-realm Blob shape', async t => {
  const cache = cacheFor(t); let reads = 0;
  const file = new File(['original'], 'movie.mov');
  const read = async () => { reads++; const blob = new Blob(['preview']); return new Proxy(blob, { get(target, key) { const result = Reflect.get(target, key, target); return typeof result === 'function' ? result.bind(target) : result; }, getPrototypeOf() { return Object.prototype; } }); };
  const a = cache.previewSources.acquire(identity('small', { source: { kind: 'local', file } }), read);
  assert.equal(await (await a.promise).text(), 'preview'); cache.invalidateExisting(1); assert.equal(a.active, true);
  const b = cache.previewSources.acquire(identity('small', { source: { kind: 'local', file } }), read); await b.promise; assert.equal(reads, 1);
  const c = cache.previewSources.acquire(identity('small', { source: { kind: 'local', file: new File(['original'], 'movie.mov') } }), read); await c.promise; assert.equal(reads, 2);
  a.release(); b.release(); c.release();
});

test('resolvers can preview unsupported extensions and preserve video URL, DOM and bytes through new closures and metadata', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t); let reads = 0, rawReads = 0;
  const file = entry('source.bin');
  const props = { entry: file, readFile: async () => { rawReads++; return new Blob(['original']); },
    resolvePreviewSource: () => video('small', async () => { reads++; return new Blob(['preview']); }) };
  const view = await mount(t, props, cache); const element = view.root.findByType('video'), url = element.props.src;
  await view.update({ ...props, entry: { ...file, favorite: 1, name: 'renamed.bin', source: { ...file.source } },
    resolvePreviewSource: () => video('small', async () => { throw Error('new read closure must not run'); }), processing: true, processingLabel: '変換中' });
  assert.equal(view.root.findByType('video'), element); assert.equal(element.props.src, url); assert.match(JSON.stringify(view.json), /変換中/);
  await view.update({ ...props, processing: false });
  assert.equal(view.root.findByType('video'), element); assert.equal(element.props.src, url);
  assert.equal(reads, 1); assert.equal(rawReads, 0); assert.equal(made.length, 1); assert.deepEqual(revoked, []);
});

test('pending resolver becomes ready on processing completion and does not read before ready', async t => {
  const cache = cacheFor(t); urlsFor(t); let reads = 0;
  const file = entry();
  const resolvePreviewSource = (_, { processing }) => processing ? { kind: 'pending', message: '準備中です' } : video('ready', async () => { reads++; return new Blob(['video']); });
  const view = await mount(t, { entry: file, processing: true, resolvePreviewSource }, cache);
  assert.equal(reads, 0); assert.match(JSON.stringify(view.json), /準備中です/); assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0);
  await view.update({ entry: file, processing: false, resolvePreviewSource }); assert.equal(reads, 1); assert.equal(view.root.findAllByType('video').length, 1);
});

test('failed preparation reads retry once after processing ends while successful reads never restart', async t => {
  for (const custom of [false, true]) {
    const cache = cacheFor(t); urlsFor(t); let reads = 0, processing = true;
    const read = async () => { reads++; if (processing) throw Error('not ready'); return new Blob(['video']); };
    const props = { entry: entry(), processing, ...(custom ? { resolvePreviewSource: () => video('same', read) } : { readFile: read }) };
    const view = await mount(t, props, cache); assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0); assert.match(JSON.stringify(view.json), /処理中/);
    processing = false; await view.update({ ...props, processing });
    assert.equal(reads, 2); assert.equal(view.root.findAllByType('video').length, 1);
    await view.update({ ...props, processing: true }); await view.update({ ...props, processing: false }); assert.equal(reads, 2);
  }
});

test('semantic cacheKey or source changes refresh previews, pending resolvers and reads are aborted on change or close', async t => {
  const cache = cacheFor(t); urlsFor(t); const old = deferred(), resolverSignals = []; let readSignal;
  const initial = entry('movie.bin');
  const view = await mount(t, { entry: initial, resolvePreviewSource: (_, { signal }) => { resolverSignals.push(signal); return old.promise; } }, cache);
  await view.update({ entry: { ...initial, source: source('new') }, resolvePreviewSource: () => video('a', async () => new Blob(['new'])) });
  assert.equal(resolverSignals[0].aborted, true); const first = view.root.findByType('video').props.src;
  await act(async () => old.resolve({ kind: 'pending', message: 'stale' })); assert.equal(view.root.findByType('video').props.src, first);
  await view.update({ entry: { ...initial, source: source('new') }, resolvePreviewSource: () => video('b', async () => new Blob(['changed'])) });
  assert.notEqual(view.root.findByType('video').props.src, first);
  const waiting = deferred();
  await view.update({ entry: { ...initial, source: source('last') }, resolvePreviewSource: () => video('pending', ({ signal }) => { readSignal = signal; return waiting.promise; }) });
  await view.unmount(); assert.equal(readSignal.aborted, true); waiting.resolve(new Blob(['late'])); await flush();
});

test('direct media URLs use native src/crossOrigin and never read, fetch, create or revoke a Blob URL', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t); let reads = 0;
  t.mock.method(globalThis, 'fetch', () => { throw Error('library must not fetch direct URLs'); });
  const props = { entry: entry('source.bin'), readFile: async () => { reads++; throw Error('raw read'); },
    resolvePreviewSource: () => ({ kind: 'url', url: 'https://media.example.test/movie.mp4?token=private', mode: 'video', crossOrigin: 'use-credentials' }) };
  const view = await mount(t, props, cache);
  assert.equal(view.root.findByType('video').props.src, 'https://media.example.test/movie.mp4?token=private');
  assert.equal(view.root.findByType('video').props.crossOrigin, 'use-credentials'); assert.equal(reads, 0); assert.equal(made.length, 0);
  await view.unmount(); assert.deepEqual(revoked, []);
});

test('direct PDF URLs default to strict sandbox and support explicit trusted-host overrides', async t => {
  const cache = cacheFor(t); const { made } = urlsFor(t);
  const props = { entry: entry('source.bin'), resolvePreviewSource: () => ({ kind: 'url', url: 'https://media.example.test/signed.pdf#page=2', mode: 'pdf' }), allowDownload: false };
  const view = await mount(t, props, cache);
  assert.equal(view.root.findByType('iframe').props.sandbox, ''); assert.match(view.root.findByType('iframe').props.src, /#page=2&toolbar=0$/);
  await view.update({ ...props, previewOptions: { pdfSandbox: 'allow-same-origin' } }); assert.equal(view.root.findByType('iframe').props.sandbox, 'allow-same-origin');
  await view.update({ ...props, previewOptions: { pdfSandbox: false } }); assert.equal(view.root.findByType('iframe').props.sandbox, undefined); assert.equal(made.length, 0);
});

test('unsafe URL schemes fail visibly without falling back to original bytes', async t => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/secret', 'blob:javascript:alert(1)']) {
    const cache = cacheFor(t); let reads = 0;
    const view = await mount(t, { entry: entry(), readFile: () => { reads++; throw Error('unexpected'); }, resolvePreviewSource: () => ({ kind: 'url', url, mode: 'pdf' }) }, cache);
    assert.equal(view.root.findAllByType('iframe').length, 0); assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 1); assert.equal(reads, 0);
  }
});

test('SVG/HTML stay inert despite extension and MIME overrides, and PDF bytes require a signature', async t => {
  for (const [name, content, type] of [['unsafe.svg', '<svg onload="alert(1)"/>', ''], ['unsafe.html', '<script>alert(1)</script>', ''], ['fake.pdf', '<html>unsafe</html>', 'application/pdf'], ['fake.pdf', '<svg/>', 'image/svg+xml']]) {
    const cache = cacheFor(t); const { made } = urlsFor(t);
    const view = await mount(t, { entry: entry(name), readFile: async () => new Blob([content], { type }), previewOptions: { formatsByExtension: { '.svg': { mode: 'pdf' }, '.html': { mode: 'pdf' } }, pdfSandbox: false } }, cache);
    assert.equal(view.root.findByType('pre').props.children, content); assert.equal(view.root.findAllByType('iframe').length, 0); assert.equal(made.length, 0);
  }
  const cache = cacheFor(t); const { made } = urlsFor(t);
  const props = { entry: entry('document.pdf'), readFile: async () => new Blob(['%PDF-1.7\nbytes'], { type: 'application/octet-stream' }) };
  const view = await mount(t, props, cache); assert.equal(view.root.findAllByType('iframe').length, 1); assert.equal(made[0].blob.type, 'application/pdf');
  await view.update({ ...props, readFile: async () => new Blob(['not a PDF']) }); assert.equal(view.root.findAllByType('iframe').length, 0); assert.match(JSON.stringify(view.json), /有効なPDF/);
});

test('default and configured text previews enforce both metadata and actual byte limits', async t => {
  const cache = cacheFor(t); let reads = 0;
  const view = await mount(t, { entry: { ...entry('large.txt'), size: 2 ** 20 + 1 }, readFile: async () => { reads++; return new Blob(['small']); } }, cache);
  assert.equal(reads, 0); assert.match(JSON.stringify(view.json), /1 MB/);
  await view.update({ entry: entry('small.bin'), resolvePreviewSource: () => ({ kind: 'blob', cacheKey: 'large-text', mode: 'text', mime: 'text/plain', read: async () => new Blob(['x'.repeat(2 ** 20 + 1)]) }) });
  assert.match(JSON.stringify(view.json), /1 MB/); assert.equal(view.root.findAllByType('pre').length, 0);
});

test('all upload-video suffixes use the shared preview registry and extension overrides normalize or disable defaults', () => {
  assert.equal(Object.keys(EXPLORER_VIDEO_MIME_TYPES).length, 11);
  for (const [suffix, mime] of Object.entries(EXPLORER_VIDEO_MIME_TYPES)) assert.deepEqual(getPreviewFormat(entry(`movie${suffix.toUpperCase()}`)), { mode: 'video', mime });
  assert.deepEqual(getPreviewFormat(entry('file.CUSTOM'), { formatsByExtension: { ' .CuStOm ': { mode: 'video', mime: 'video/custom' } } }), { mode: 'video', mime: 'video/custom' });
  assert.equal(getPreviewFormat(entry('movie.mp4'), { formatsByExtension: { '.mp4': false } }), null);
  assert.throws(() => getPreviewFormat(entry(), { formatsByExtension: { mp4: { mode: 'video' } } }), /ドット/);
});

test('StrictMode setup aborts unused work and one preview read survives until final unmount', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t); let reads = 0;
  const view = await mount(t, { entry: entry(), resolvePreviewSource: () => video('small', async () => { reads++; return new Blob(['video']); }) }, cache, true);
  assert.equal(reads, 1); assert.equal(made.length, 1); await view.unmount(); assert.deepEqual(revoked, [made[0].value]);
});

test('processing completion retries malformed preview bytes while other consumers retain URLs and replacements remain cached', async t => {
  for (const custom of [false, true]) {
    const cache = cacheFor(t); const { revoked } = urlsFor(t); let reads = 0, bytes = 'preparing';
    const read = async () => { reads++; return new Blob([bytes]); };
    const file = { ...entry('document.pdf'), source: source('original') };
    const held = custom ? cache.previewSources.acquire(identity(), read) : cache.acquire(file.source, read);
    await held.promise; const heldUrl = held.objectUrl('application/octet-stream');
    const props = { entry: file, processing: true, ...(custom ? { resolvePreviewSource: () => ({ kind: 'blob', cacheKey: 'small', mime: 'application/pdf', read }) } : { readFile: read }) };
    const view = await mount(t, props, cache); assert.equal(reads, 1); assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0); assert.match(JSON.stringify(view.json), /処理中/);
    bytes = '%PDF-1.7\nready'; await view.update({ ...props, processing: false });
    assert.equal(reads, 2); assert.equal(view.root.findAllByType('iframe').length, 1); assert.deepEqual(revoked, []);
    held.release(); assert.deepEqual(revoked, [heldUrl]);
    const replacement = custom ? cache.previewSources.acquire(identity(), read) : cache.acquire(file.source, read);
    assert.equal(await (await replacement.promise).text(), bytes); assert.equal(reads, 2); replacement.release();
  }
});

test('old discarded raw completion cannot remove a newer record for the same source and reader', async t => {
  const cache = cacheFor(t), old = deferred(); let calls = 0;
  const read = async () => ++calls === 1 ? old.promise : new Blob(['replacement']);
  const first = cache.acquire(source('same'), read); await flush(); first.release(); cache.discard(source('same'), read);
  const next = cache.acquire(source('same'), read); assert.equal(await (await next.promise).text(), 'replacement');
  old.resolve(new Blob(['old'])); await first.promise; await flush();
  const repeated = cache.acquire(source('same'), read); assert.equal(await (await repeated.promise).text(), 'replacement'); assert.equal(calls, 2);
  next.release(); repeated.release();
});

test('direct URL cacheKey versions force media replacement while unchanged versions preserve playback without library fetching', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t);
  t.mock.method(globalThis, 'fetch', () => { throw Error('library must not fetch direct URLs'); });
  const props = cacheKey => ({ entry: entry('source.bin'), resolvePreviewSource: () => ({ kind: 'url', url: 'https://media.example.test/movie.mp4', mode: 'video', cacheKey }) });
  const view = await mount(t, props('v1'), cache), first = view.root.findByType('video');
  await view.update({ ...props('v1'), processing: true }); assert.equal(view.root.findByType('video'), first);
  await view.update({ ...props('v1'), processing: false }); assert.equal(view.root.findByType('video'), first);
  await view.update(props('v2')); assert.notEqual(view.root.findByType('video'), first);
  assert.equal(view.root.findByType('video').props.src, 'https://media.example.test/movie.mp4'); assert.equal(made.length, 0); assert.deepEqual(revoked, []);
});

test('resolver rejections while processing show waiting and retry on completion, with final failures displayed as errors', async t => {
  const cache = cacheFor(t); let calls = 0;
  const resolvePreviewSource = async (_, { processing }) => {
    calls++; if (processing) throw Error('source is preparing');
    return { kind: 'url', url: 'https://media.example.test/ready.mp4', mode: 'video' };
  };
  const props = { entry: entry(), resolvePreviewSource, processing: true, processingLabel: '準備完了を待っています' };
  const view = await mount(t, props, cache);
  assert.equal(calls, 1); assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0); assert.match(JSON.stringify(view.json), /準備完了を待っています/);
  await view.update({ ...props, processing: false }); assert.equal(calls, 2); assert.equal(view.root.findAllByType('video').length, 1);
  await view.update({ ...props, processing: false, resolvePreviewSource: async () => { throw Error('final failure'); } });
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 1); assert.match(JSON.stringify(view.json), /final failure/);
});
