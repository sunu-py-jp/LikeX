import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { createMediaCache } from './src/state/media-cache.ts';
      export { MediaCacheContext } from './src/state/media-context.tsx';
      export { FileThumbnail } from './src/ui/explorer-file-icon.tsx';
      export { default as FilePreview } from './src/ui/file-preview.tsx';
      export * from './src/model/preview-table.ts';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-media.tsx',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|react-test-renderer|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({
      path: import.meta.resolve(path), external: true,
    }));
  } }],
});
const { createMediaCache, MediaCacheContext, FileThumbnail, FilePreview, parseDelimited,
  MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_TABLE_CELLS, MAX_TABLE_CELL_CHARACTERS } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`,
);

const source = id => ({ kind: 'existing', id });
const entry = (name = 'photo.png', id = name) => ({
  id, name, parent: 'root', kind: 'file', mime: '', size: 10,
  source: source(id), favorite: 0, createdAt: '', updatedAt: '',
});
const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function cacheFor(t, options) {
  const cache = createMediaCache(options);
  t.after(() => cache.dispose());
  return cache;
}
function urlsFor(t) {
  const made = [], revoked = [];
  t.mock.method(URL, 'createObjectURL', blob => { const value = `blob:media-${made.length}`; made.push({ blob, value }); return value; });
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  return { made, revoked };
}

test('media reads share source identity and ref-count URLs across consumers, but isolate reader and workspace', async t => {
  const cache = cacheFor(t), other = cacheFor(t);
  const { made, revoked } = urlsFor(t);
  let reads = 0;
  const reader = async () => { reads++; return new Blob(['photo'], { type: 'image/png' }); };
  const a = cache.acquire(source('same'), reader), b = cache.acquire(source('same'), reader);
  assert.equal(await a.promise, await b.promise);
  assert.equal(reads, 1);
  const url = a.objectUrl();
  assert.equal(b.objectUrl('image/png'), url, 'matching MIME and raw image use the same URL');
  assert.equal(made.length, 1);
  a.release(); a.release();
  assert.deepEqual(revoked, []);
  b.release();
  assert.deepEqual(revoked, [url]);
  const reused = cache.acquire(source('same'), reader); await reused.promise;
  assert.equal(reads, 1); reused.release();
  const differentReader = cache.acquire(source('same'), async () => new Blob(['other']));
  assert.equal(await (await differentReader.promise).text(), 'other');
  const differentWorkspace = other.acquire(source('same'), reader); await differentWorkspace.promise;
  assert.equal(reads, 2);
  differentReader.release(); differentWorkspace.release();
});

test('local media preserves the original File and ignores the host reader', async t => {
  const cache = cacheFor(t);
  const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
  const a = cache.acquire({ kind: 'local', file }, () => { throw Error('Unexpected host read'); });
  const b = cache.acquire({ kind: 'local', file });
  assert.equal(await a.promise, file); assert.equal(await b.promise, file);
  a.release(); b.release();
});

test('media concurrency is bounded and queued work is removed before its reader starts', async t => {
  const cache = cacheFor(t, { concurrency: 2 });
  const calls = [], pending = new Map();
  const reader = id => { calls.push(id); const work = deferred(); pending.set(id, work); return work.promise; };
  const leases = ['a', 'b', 'c', 'd'].map(id => cache.acquire(source(id), reader));
  await flush(); assert.deepEqual(calls, ['a', 'b']);
  leases[2].release();
  await assert.rejects(leases[2].promise, /キャンセル/);
  pending.get('a').resolve(new Blob(['a'])); await flush();
  assert.deepEqual(calls, ['a', 'b', 'd']);
  pending.get('b').resolve(new Blob(['b'])); pending.get('d').resolve(new Blob(['d']));
  await Promise.all([leases[0].promise, leases[1].promise, leases[3].promise]);
  leases.forEach(lease => lease.release());
});

test('an abandoned in-flight result is discarded, but a new consumer can join before it completes', async t => {
  const cache = cacheFor(t);
  const pending = [], reader = () => { const work = deferred(); pending.push(work); return work.promise; };
  const a = cache.acquire(source('photo'), reader); await flush(); a.release();
  pending[0].resolve(new Blob(['old'])); await a.promise; await flush();
  const b = cache.acquire(source('photo'), reader); await flush();
  assert.equal(pending.length, 2);
  b.release();
  const c = cache.acquire(source('photo'), reader);
  pending[1].resolve(new Blob(['current']));
  assert.equal(await (await c.promise).text(), 'current');
  assert.equal(pending.length, 2);
  c.release();
});

test('idle media is evicted by entry count and byte budget using recent access', async t => {
  const cache = cacheFor(t, { maxEntries: 2, maxBytes: 6 });
  const calls = [];
  const reader = async id => { calls.push(id); return new Blob([id.repeat(3)]); };
  const read = async id => { const lease = cache.acquire(source(id), reader); await lease.promise; lease.release(); };
  await read('a'); await read('b'); await read('a'); await read('c'); await read('a');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  await read('b'); assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
  const oversized = cache.acquire(source('large'), async () => new Blob(['large payload']));
  await oversized.promise;
  assert.equal(oversized.active, true, 'active content remains pinned even above the idle budget');
  oversized.release();
  await read('a'); assert.equal(calls.at(-1), 'a');
});

test('disposing releases all object URLs and queued work and permits a fresh StrictMode-style reuse', async t => {
  const cache = cacheFor(t, { concurrency: 1 });
  const { revoked } = urlsFor(t);
  const reader = async () => new Blob(['ready']);
  const ready = cache.acquire(source('ready'), reader); await ready.promise;
  const url = ready.objectUrl();
  const queued = cache.acquire(source('queued'), reader);
  cache.dispose();
  assert.deepEqual(revoked, [url]);
  assert.equal(ready.active, false);
  await assert.rejects(queued.promise, /キャンセル/);
  ready.release(); queued.release();
  assert.deepEqual(revoked, [url], 'cleanup stays idempotent');
  const next = cache.acquire(source('ready'), reader);
  assert.equal(await (await next.promise).text(), 'ready'); next.release();
});

test('save revisions invalidate existing content and URLs once while preserving local File consumers', async t => {
  const cache = cacheFor(t); const { revoked } = urlsFor(t);
  let reads = 0, changes = 0;
  const reader = async () => new Blob([String(++reads)]);
  const remote = cache.acquire(source('stored'), reader);
  const file = new File(['local'], 'photo.png');
  const local = cache.acquire({ kind: 'local', file });
  await remote.promise; await local.promise;
  const remoteUrl = remote.objectUrl(), localUrl = local.objectUrl();
  const unsubscribe = cache.subscribe(() => changes++);
  cache.invalidateExisting(1);
  assert.equal(remote.active, false); assert.equal(local.active, true);
  assert.deepEqual(revoked, [remoteUrl]); assert.equal(changes, 1);
  const refreshed = cache.acquire(source('stored'), reader);
  assert.equal(await (await refreshed.promise).text(), '2');
  const refreshedUrl = refreshed.objectUrl();
  cache.invalidateExisting(1);
  assert.equal(refreshed.active, true); assert.equal(changes, 1);
  assert.deepEqual(revoked, [remoteUrl]);
  remote.release(); refreshed.release(); local.release(); unsubscribe();
  assert.deepEqual(revoked, [remoteUrl, refreshedUrl, localUrl]);
});

test('a stale read completing after save invalidation cannot replace or remove the refreshed content', async t => {
  const cache = cacheFor(t); const pending = [];
  const reader = () => { const work = deferred(); pending.push(work); return work.promise; };
  const old = cache.acquire(source('same'), reader); await flush();
  cache.invalidateExisting(1); await assert.rejects(old.promise, /キャンセル/);
  const current = cache.acquire(source('same'), reader); await flush();
  pending[1].resolve(new Blob(['current'])); await current.promise;
  pending[0].resolve(new Blob(['old'])); await flush();
  const repeated = cache.acquire(source('same'), reader);
  assert.equal(await (await repeated.promise).text(), 'current');
  assert.equal(pending.length, 2);
  old.release(); current.release(); repeated.release();
});

function viewport() {
  const instances = [];
  const document = { defaultView: { IntersectionObserver: class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; instances.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  } } };
  return { document, instances,
    async show(visible) {
      await act(async () => {
        for (const observer of instances) if (!observer.disconnected)
          observer.callback([...observer.targets].map(target => ({ target, isIntersecting: visible })));
      });
    },
  };
}

async function mount(t, node, cache, document, strict = false) {
  const element = current => {
    const wrapped = h(MediaCacheContext.Provider, { value: cache }, current);
    return strict ? h(StrictMode, null, wrapped) : wrapped;
  };
  let renderer;
  await act(async () => {
    renderer = create(element(node), {
      createNodeMock: () => ({ ownerDocument: document }),
    });
  });
  const unmount = async () => { if (renderer) { await act(async () => renderer.unmount()); renderer = null; } };
  t.after(unmount);
  return { get root() { return renderer.root; }, unmount,
    async update(next) { await act(async () => renderer.update(element(next))); },
  };
}

test('thumbnails read only while visible, share one observer per document and one read across windows', async t => {
  const cache = cacheFor(t), first = viewport(), second = viewport();
  const { made, revoked } = urlsFor(t);
  let reads = 0;
  const reader = async () => { reads++; return new Blob(['image'], { type: 'image/png' }); };
  const picture = entry();
  const a = await mount(t, h(FileThumbnail, { entry: picture, readFile: reader }), cache, first.document);
  const b = await mount(t, h(FileThumbnail, { entry: { ...picture }, readFile: reader }), cache, first.document);
  const c = await mount(t, h(FileThumbnail, { entry: { ...picture }, readFile: reader }), cache, second.document);
  assert.equal(reads, 0); assert.equal(first.instances.length, 1); assert.equal(second.instances.length, 1);
  await first.show(true); await second.show(true);
  assert.equal(reads, 1); assert.equal(made.length, 1);
  assert.equal(a.root.findByType('img').props.src, c.root.findByType('img').props.src);
  await a.update(h(FileThumbnail, { entry: { ...picture, name: 'renamed.png', favorite: 1, source: { ...picture.source } }, readFile: reader }));
  assert.equal(reads, 1); assert.equal(made.length, 1);
  await first.show(false); assert.deepEqual(revoked, []);
  assert.equal(a.root.findAllByType('img').length, 0);
  await c.unmount(); assert.deepEqual(revoked, [made[0].value]);
  await first.show(true); assert.equal(reads, 1); assert.equal(made.length, 2);
  await a.unmount(); assert.equal(first.instances[0].disconnected, false);
  await b.unmount(); assert.equal(first.instances[0].disconnected, true);
  assert.equal(second.instances[0].disconnected, true);
});

test('preview and thumbnail share reads, and metadata-only changes do not rebuild preview URLs', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t);
  let reads = 0;
  const reader = async () => { reads++; return new Blob(['image'], { type: 'image/png' }); };
  const picture = entry();
  const thumbnail = await mount(t, h(FileThumbnail, { entry: picture, readFile: reader }), cache);
  const preview = await mount(t, h(FilePreview, { entry: { ...picture }, readFile: reader }), cache);
  assert.equal(reads, 1); assert.equal(made.length, 1);
  await preview.update(h(FilePreview, { entry: { ...picture, name: 'renamed.png', parent: 'another', source: { ...picture.source } }, readFile: reader, allowDownload: false }));
  assert.equal(reads, 1); assert.equal(made.length, 1);
  assert.equal(preview.root.findByType('img').props.alt, 'renamed.png');
  await thumbnail.unmount(); assert.deepEqual(revoked, []);
  await preview.unmount(); assert.deepEqual(revoked, [made[0].value]);
});

test('save invalidation refreshes visible thumbnail and preview together with no change to source ID or reader', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t);
  let reads = 0, content = 'before';
  const reader = async () => { reads++; return new Blob([content], { type: 'image/png' }); };
  const picture = entry();
  const thumbnail = await mount(t, h(FileThumbnail, { entry: picture, readFile: reader }), cache);
  const preview = await mount(t, h(FilePreview, { entry: picture, readFile: reader }), cache);
  const firstUrl = made[0].value;
  content = 'after';
  await act(async () => cache.invalidateExisting(1));
  assert.equal(reads, 2); assert.equal(made.length, 2);
  assert.equal(await made[1].blob.text(), 'after');
  assert.equal(thumbnail.root.findByType('img').props.src, made[1].value);
  assert.equal(preview.root.findByType('img').props.src, made[1].value);
  assert.deepEqual(revoked, [firstUrl]);
  await act(async () => cache.invalidateExisting(1));
  assert.equal(reads, 2); assert.equal(made.length, 2);
});

test('late preview results cannot replace a new source, while the new reader is honored', async t => {
  const cache = cacheFor(t); const old = deferred();
  const oldReader = () => old.promise;
  const file = entry('note.txt');
  const preview = await mount(t, h(FilePreview, { entry: file, readFile: oldReader }), cache);
  const reader = async () => new Blob(['new content']);
  await preview.update(h(FilePreview, { entry: { ...file, source: source('new') }, readFile: reader }));
  assert.equal(preview.root.findByType('pre').props.children, 'new content');
  await act(async () => old.resolve(new Blob(['old content'])));
  assert.equal(preview.root.findByType('pre').props.children, 'new content');
});

test('StrictMode thumbnails cancel unused setup and release URLs on final unmount', async t => {
  const cache = cacheFor(t); const { made, revoked } = urlsFor(t);
  let reads = 0;
  const reader = async () => { reads++; return new Blob(['image']); };
  const view = await mount(t, h(FileThumbnail, { entry: entry(), readFile: reader }), cache, undefined, true);
  assert.equal(reads, 1); assert.equal(made.length, 1);
  await view.unmount(); assert.deepEqual(revoked, [made[0].value]);
});

test('delimited previews preserve quoted fields and bound rows, columns, total cells and cell text', () => {
  assert.deepEqual(parseDelimited('a,b\r\n"x,y","say ""hi"""\r\n"one\ntwo",z', ','), [
    ['a', 'b'], ['x,y', 'say "hi"'], ['one\ntwo', 'z'],
  ]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  const wide = Array.from({ length: 80 }, (_, index) => String(index)).join(',');
  const rows = parseDelimited(Array.from({ length: 300 }, () => wide).join('\n'), ',');
  assert.equal(rows.length, MAX_TABLE_ROWS);
  assert.ok(rows.every(row => row.length === MAX_TABLE_COLUMNS));
  assert.equal(rows.flat().length, MAX_TABLE_CELLS);
  assert.equal(parseDelimited('x'.repeat(20_000), ',')[0][0].length, MAX_TABLE_CELL_CHARACTERS);
  assert.deepEqual(parseDelimited('', ','), []);
  assert.deepEqual(parseDelimited('""', ','), [['']]);
});

test('CSV rendering stays bounded and does not read unchanged content again on metadata changes', async t => {
  const cache = cacheFor(t);
  const text = Array.from({ length: 201 }, () => Array.from({ length: 51 }, () => 'value').join(',')).join('\n');
  let reads = 0, textReads = 0;
  const blob = new Blob([text]);
  t.mock.method(blob, 'text', async () => { textReads++; return text; });
  const reader = async () => { reads++; return blob; };
  const csv = { ...entry('table.csv'), size: blob.size };
  const view = await mount(t, h(FilePreview, { entry: csv, readFile: reader }), cache);
  assert.equal(view.root.findAllByType('tr').length, MAX_TABLE_ROWS);
  assert.equal(view.root.findAllByType('th').length + view.root.findAllByType('td').length, MAX_TABLE_CELLS);
  await view.update(h(FilePreview, { entry: { ...csv, parent: 'folder', source: { ...csv.source } }, readFile: reader }));
  assert.equal(reads, 1); assert.equal(textReads, 1);
});
