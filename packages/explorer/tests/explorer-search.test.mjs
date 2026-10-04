import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { build } from 'esbuild';
import { importTypeScript } from './import-typescript.mjs';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  entryPoints: ['src/state/use-explorer-search.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { useExplorerSearch } = await import(`data:text/javascript;base64,${Buffer.from(
  output.outputFiles[0].text + '\n//# sourceURL=explorer-search-contract.mjs').toString('base64')}`);
const { resolveExplorerSearchIds, createExplorerSearchResultAccumulator } = await importTypeScript('../src/model/search.ts');
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const controlledStream = () => {
  const pulls = [];
  let returned = 0;
  const iterator = {
    next() { const task = deferred(); pulls.push(task); return task.promise; },
    return() { returned++; return Promise.resolve({ done: true }); },
  };
  return { pulls, iterator, get returned() { return returned; }, stream: { [Symbol.asyncIterator]() { return iterator; } } };
};
const entry = (id, name = `${id}.txt`, parent = 'root', kind = 'file') => ({ id, name, parent, kind,
  size: 4, mime: 'text/plain', source: { kind: 'existing', id: `content-${id}` }, favorite: 0,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' });
const entries = [entry('folder', '資料', 'root', 'folder'), entry('alpha'), entry('beta', 'Beta.txt', 'folder')];
const root = { kind: 'folder', id: 'root', name: 'ファイル', path: '/' };

async function mount(t, supplied = {}) {
  const document = { defaultView: new EventTarget() };
  let current, renderer, closed = false;
  let options = { enabled: true, query: '', entries, location: root, tabId: 'tab-1', windowId: 'main',
    trigger: 'input', debounceMs: 0, revision: 0, ownerDocument: document, ...supplied };
  function Probe({ value }) { current = useExplorerSearch(value); return null; }
  const tree = () => h(StrictMode, null, h(Probe, { value: options }));
  await change(() => { renderer = create(tree()); });
  async function unmount() {
    if (closed) return;
    closed = true;
    await change(() => renderer.unmount());
  }
  t.after(unmount);
  return { get current() { return current; }, document, unmount,
    async update(patch) { options = { ...options, ...patch }; await change(() => renderer.update(tree())); } };
}

test('without an external handler the hook preserves built-in search, including nonempty queries', async t => {
  const hook = await mount(t, { query: 'Alpha' });
  assert.deepEqual(hook.current, { resultIds: null, resultHits: null, searchPending: false, searchError: null, externalSearch: false });
});

test('empty, whitespace and disabled searches never invoke the host', async t => {
  const calls = [];
  const hook = await mount(t, { onSearchRequest: request => { calls.push(request); return ['alpha']; } });
  await hook.update({ query: '   ' });
  await hook.update({ query: 'Alpha', enabled: false });
  assert.equal(calls.length, 0);
  assert.equal(hook.current.resultIds, null);
  assert.equal(hook.current.searchPending, false);
});

test('a StrictMode request uses trimmed text, public location and source IDs without reordering relevance', async t => {
  const calls = [];
  const before = structuredClone(entries);
  const hook = await mount(t, { query: '  revenue  ', windowId: 'popup-2',
    onSearchRequest(request, context) { calls.push({ request, context }); return ['beta', 'missing', 'alpha', 'beta', 'folder']; } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, { query: 'revenue', conditions: { matchCase: false, wholeName: false, useRegex: false }, entries, location: root, tabId: 'tab-1', windowId: 'popup-2' });
  assert.equal(calls[0].context.signal.aborted, false);
  assert.deepEqual(hook.current.resultIds, ['beta', 'alpha', 'folder']);
  assert.deepEqual(hook.current.resultHits, [{ entryId: 'beta' }, { entryId: 'alpha' }, { entryId: 'folder' }]);
  assert.equal(hook.current.searchPending, false);
  assert.equal(hook.current.searchError, null);
  assert.deepEqual(entries, before);
});

test('asynchronous queries hide old results immediately and ignore out-of-order responses even without host cancellation', async t => {
  const calls = [];
  const hook = await mount(t, { query: 'first', onSearchRequest(request, context) {
    const result = deferred(); calls.push({ request, context, result }); return result.promise;
  } });
  assert.equal(hook.current.searchPending, true);
  assert.deepEqual(hook.current.resultIds, []);
  await change(() => calls[0].result.resolve(['alpha']));
  assert.deepEqual(hook.current.resultIds, ['alpha']);
  await hook.update({ query: 'second' });
  assert.equal(calls[0].context.signal.aborted, true);
  assert.deepEqual(hook.current.resultIds, []);
  assert.equal(hook.current.searchPending, true);
  await hook.update({ query: 'third' });
  await change(() => calls[2].result.resolve(['folder']));
  await change(() => calls[1].result.resolve(['beta']));
  assert.deepEqual(hook.current.resultIds, ['folder']);
  assert.equal(hook.current.searchError, null);
});

test('view and draft changes abort the old query and resolve against their own current context', async t => {
  const cases = [
    ['tab', { tabId: 'tab-2' }],
    ['window', { windowId: 'popup-3' }],
    ['folder', { location: { kind: 'folder', id: 'folder', name: '資料', path: '/資料' } }],
    ['recent', { location: { kind: 'recent', id: null, name: '最近更新したファイル', path: null } }],
    ['draft', { entries: entries.filter(item => item.id !== 'beta') }],
  ];
  for (const [label, patch] of cases) await t.test(label, async subtest => {
    const calls = [];
    const hook = await mount(subtest, { query: 'text', onSearchRequest(request, context) {
      const result = deferred(); calls.push({ request, context, result }); return result.promise;
    } });
    await hook.update(patch);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].context.signal.aborted, true);
    await change(() => calls[0].result.reject(new Error('Stale failure')));
    assert.equal(hook.current.searchError, null);
    assert.equal(hook.current.searchPending, true);
    await change(() => calls[1].result.resolve(['beta', 'alpha']));
    assert.deepEqual(hook.current.resultIds, label === 'draft' ? ['alpha'] : ['beta', 'alpha']);
  });
});

test('clear, feature disable and handler removal abort pending work and restore local listing', async t => {
  for (const patch of [{ query: '' }, { enabled: false }, { onSearchRequest: undefined }]) await t.test(JSON.stringify(patch), async subtest => {
    let context;
    const result = deferred();
    const hook = await mount(subtest, { query: 'text', onSearchRequest(_, value) { context = value; return result.promise; } });
    await hook.update(patch);
    assert.equal(context.signal.aborted, true);
    await change(() => result.resolve(['alpha']));
    assert.deepEqual(hook.current, { resultIds: null, resultHits: null, searchPending: false, searchError: null, externalSearch: false });
  });
});

test('adding a handler activates external search and inline identity changes only affect the next request', async t => {
  const calls = [];
  const hook = await mount(t, { query: 'text' });
  await hook.update({ onSearchRequest: () => { calls.push('first'); return ['alpha']; } });
  assert.deepEqual(calls, ['first']);
  await hook.update({ location: { ...root }, onSearchRequest: () => { calls.push('latest'); return ['beta']; } });
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(hook.current.resultIds, ['alpha']);
  await hook.update({ query: 'another' });
  assert.deepEqual(calls, ['first', 'latest']);
  assert.deepEqual(hook.current.resultIds, ['beta']);
});

test('input debounce includes the waiting period in pending state and only searches the latest text', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const hook = await mount(t, { query: 'a', debounceMs: 100,
    onSearchRequest: request => { calls.push(request.query); return ['alpha']; } });
  assert.equal(hook.current.searchPending, true);
  assert.deepEqual(hook.current.resultIds, []);
  await change(() => t.mock.timers.tick(99));
  assert.deepEqual(calls, []);
  await hook.update({ query: 'ab' });
  await change(() => t.mock.timers.tick(99));
  assert.deepEqual(calls, []);
  await change(() => t.mock.timers.tick(1));
  assert.deepEqual(calls, ['ab']);
  assert.equal(hook.current.searchPending, false);
});

test('submit mode ignores debounce and revisions retry an unchanged query', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const hook = await mount(t, { query: 'text', trigger: 'submit', debounceMs: 1000,
    onSearchRequest: request => { calls.push(request.query); return ['alpha']; } });
  assert.deepEqual(calls, ['text']);
  await hook.update({ revision: 1 });
  assert.deepEqual(calls, ['text', 'text']);
});

test('explicit input submission flushes debounce, while later typing waits again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const hook = await mount(t, { query: 'text', debounceMs: 1000,
    onSearchRequest: request => { calls.push(request.query); return ['alpha']; } });
  await hook.update({ revision: 1 });
  assert.deepEqual(calls, ['text']);
  await change(() => t.mock.timers.tick(1000));
  assert.deepEqual(calls, ['text'], 'the old timer was cleared');
  await hook.update({ query: 'new text' });
  assert.deepEqual(calls, ['text']);
  await change(() => t.mock.timers.tick(1000));
  assert.deepEqual(calls, ['text', 'new text']);
});

test('nonfinite and negative delays behave as zero', async t => {
  for (const debounceMs of [-1, NaN, Infinity]) await t.test(String(debounceMs), async subtest => {
    const calls = [];
    const hook = await mount(subtest, { query: 'text', debounceMs,
      onSearchRequest: request => { calls.push(request.query); return []; } });
    assert.deepEqual(calls, ['text']);
    assert.equal(hook.current.searchPending, false);
  });
});

test('host errors and malformed responses are visible errors, with no fallback to filename search', async t => {
  const cases = [
    () => { throw new Error('Authentication required'); },
    () => Promise.reject(new Error('Search unavailable')),
    () => undefined,
    () => ({ ids: ['alpha'] }),
    () => ['alpha', null],
    () => Promise.reject('failure'),
  ];
  for (const onSearchRequest of cases) await t.test(String(onSearchRequest), async subtest => {
    const hook = await mount(subtest, { query: 'Alpha', onSearchRequest });
    assert.deepEqual(hook.current.resultIds, []);
    assert.equal(hook.current.externalSearch, true);
    assert.equal(hook.current.searchPending, false);
    assert.equal(typeof hook.current.searchError, 'string');
    assert.ok(hook.current.searchError.length > 0);
    await hook.update({ query: '' });
    assert.equal(hook.current.searchError, null);
  });
});

test('a retry replaces an error and can settle successfully', async t => {
  let attempts = 0;
  const hook = await mount(t, { query: 'text', onSearchRequest() {
    attempts++;
    if (attempts === 1) throw new Error('Temporary error');
    return ['beta'];
  } });
  assert.equal(hook.current.searchError, 'Temporary error');
  await hook.update({ revision: 1 });
  assert.equal(attempts, 2);
  assert.equal(hook.current.searchError, null);
  assert.deepEqual(hook.current.resultIds, ['beta']);
});

test('unmount and owner pagehide abort requests and prevent late state updates', async t => {
  for (const action of ['unmount', 'pagehide']) await t.test(action, async subtest => {
    let context;
    const pending = deferred();
    const hook = await mount(subtest, { query: 'text', onSearchRequest(_, value) { context = value; return pending.promise; } });
    if (action === 'unmount') await hook.unmount();
    else await change(() => hook.document.defaultView.dispatchEvent(new Event('pagehide')));
    assert.equal(context.signal.aborted, true);
    await change(() => pending.resolve(['alpha']));
    assert.deepEqual(hook.current.resultIds, []);
  });
});

test('pagehide cancels a scheduled debounce before any host request starts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const hook = await mount(t, { query: 'text', debounceMs: 100,
    onSearchRequest: request => { calls.push(request); return ['alpha']; } });
  await change(() => hook.document.defaultView.dispatchEvent(new Event('pagehide')));
  await change(() => t.mock.timers.tick(100));
  assert.equal(calls.length, 0);
});

test('restoring a page after pagehide restarts an aborted search without accepting its late response', async t => {
  const calls = [];
  const hook = await mount(t, { query: 'text', onSearchRequest(_, context) {
    const result = deferred(); calls.push({ context, result }); return result.promise;
  } });
  await change(() => hook.document.defaultView.dispatchEvent(new Event('pageshow')));
  assert.equal(calls.length, 1, 'the initial pageshow does not repeat a live request');
  await change(() => hook.document.defaultView.dispatchEvent(new Event('pagehide')));
  await change(() => hook.document.defaultView.dispatchEvent(new Event('pageshow')));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].context.signal.aborted, true);
  await change(() => calls[1].result.resolve(['beta']));
  await change(() => calls[0].result.resolve(['alpha']));
  assert.deepEqual(hook.current.resultIds, ['beta']);
  assert.equal(hook.current.searchPending, false);
});

test('ID normalization preserves the input and accepts an empty result', () => {
  const result = Object.freeze(['beta', 'missing', 'alpha', 'beta']);
  assert.deepEqual(resolveExplorerSearchIds(result, entries), ['beta', 'alpha']);
  assert.deepEqual(result, ['beta', 'missing', 'alpha', 'beta']);
  assert.deepEqual(resolveExplorerSearchIds([], entries), []);
});

test('changed detailed conditions or host params cancel stale external results', async t => {
  const calls = [];
  const hook = await mount(t, { query: 'Alpha', params: { category: 'old' }, onSearchRequest(request, context) {
    const task = deferred(); calls.push({ request, context, task }); return task.promise;
  } });
  await hook.update({ conditions: { matchCase: true, wholeName: true, useRegex: false }, params: { category: 'new' } });
  assert.equal(calls[0].context.signal.aborted, true);
  assert.deepEqual(calls[1].request.conditions, { matchCase: true, wholeName: true, useRegex: false });
  await change(() => calls[1].task.resolve(['beta']));
  await change(() => calls[0].task.resolve(['alpha']));
  assert.deepEqual(hook.current.resultIds, ['beta']);
});

test('rich results snapshot host data and clear all detail data while context changes are pending', async t => {
  for (const [label, patch] of [
    ['query', { query: 'new' }],
    ['params', { params: { customer: 'new' } }],
    ['tab', { tabId: 'tab-2' }],
    ['entries', { entries: entries.filter(item => item.id !== 'alpha') }],
    ['conditions', { conditions: { matchCase: true, wholeName: false, useRegex: false } }],
  ]) await t.test(label, async subtest => {
    const calls = [];
    const source = { entryId: 'alpha', snippet: 'old excerpt', reason: 'old reason', metadata: { tags: ['old'], nested: { score: 1 } } };
    const hook = await mount(subtest, { query: 'first', params: { customer: 'old' }, onSearchRequest(request, context) {
      const task = deferred(); calls.push({ request, context, task }); return task.promise;
    } });
    await change(() => calls[0].task.resolve([source]));
    assert.deepEqual(hook.current.resultHits, [source]);
    source.metadata.tags.push('host mutation');
    assert.deepEqual(hook.current.resultHits[0].metadata.tags, ['old']);
    assert.ok(Object.isFrozen(hook.current.resultHits));
    await hook.update(patch);
    assert.equal(calls[0].context.signal.aborted, true);
    assert.deepEqual(hook.current.resultHits, []);
    assert.deepEqual(hook.current.resultIds, []);
    assert.ok(Object.isFrozen(hook.current.resultHits));
    await hook.update({ revision: 1 });
    const next = { entryId: 'beta', snippet: 'current excerpt', metadata: { score: 2 } };
    await change(() => calls[2].task.resolve([next]));
    await change(() => calls[1].task.resolve([{ entryId: 'alpha', snippet: 'stale excerpt', metadata: { leaked: true } }]));
    assert.deepEqual(hook.current.resultHits, [next]);
    assert.deepEqual(hook.current.resultIds, ['beta']);
    await hook.update({ revision: 2 });
    await change(() => calls[3].task.reject(new Error('search unavailable')));
    assert.deepEqual(hook.current.resultHits, []);
    assert.equal(hook.current.searchError, 'search unavailable');
    await hook.update({ query: '' });
    assert.equal(hook.current.resultHits, null);
  });
});

test('cancelling rich searches cannot publish a late snippet or metadata', async t => {
  for (const patch of [{ query: '' }, { enabled: false }, { onSearchRequest: undefined }]) await t.test(JSON.stringify(patch), async subtest => {
    const task = deferred();
    const hook = await mount(subtest, { query: 'text', onSearchRequest: () => task.promise });
    await hook.update(patch);
    await change(() => task.resolve([{ entryId: 'alpha', snippet: 'cancelled', metadata: { source: 'old' } }]));
    assert.equal(hook.current.resultHits, null);
    assert.equal(hook.current.resultIds, null);
  });
});

test('async stream batches become visible while pending, then settle on completion with first-hit priority', async t => {
  const source = controlledStream();
  const hook = await mount(t, { query: 'text', onSearchRequest: () => source.stream });
  assert.equal(hook.current.searchPending, true);
  assert.deepEqual(hook.current.resultHits, []);
  const first = { entryId: 'beta', snippet: 'first match', metadata: { source: 1 } };
  await change(() => source.pulls[0].resolve({ value: [first], done: false }));
  assert.deepEqual(hook.current.resultHits, [first]);
  assert.equal(hook.current.searchPending, true);
  first.metadata.source = 99;
  await change(() => source.pulls[1].resolve({ value: ['missing', { entryId: 'beta', snippet: 'duplicate' }, 'alpha'], done: false }));
  assert.deepEqual(hook.current.resultIds, ['beta', 'alpha']);
  assert.equal(hook.current.resultHits[0].metadata.source, 1);
  assert.equal(hook.current.searchPending, true);
  await change(() => source.pulls[2].resolve({ value: ['ignored return value'], done: true }));
  assert.equal(hook.current.searchPending, false);
  assert.equal(hook.current.searchError, null);
  assert.equal(source.returned, 0, 'completed iterators do not need early-return cleanup');
});

test('a promise may resolve to a stream, and an empty stream completes normally', async t => {
  const source = controlledStream(), response = deferred();
  const hook = await mount(t, { query: 'text', onSearchRequest: () => response.promise });
  await change(() => response.resolve(source.stream));
  await change(() => source.pulls[0].resolve({ value: [], done: false }));
  assert.deepEqual(hook.current.resultHits, []);
  assert.equal(hook.current.searchPending, true);
  await change(() => source.pulls[1].resolve({ done: true }));
  assert.equal(hook.current.searchPending, false);
  assert.equal(hook.current.searchError, null);
});

test('stream errors retain accepted batches while rejecting malformed batches atomically and closing the iterator', async t => {
  for (const failure of ['network', 'invalid']) await t.test(failure, async subtest => {
    const source = controlledStream();
    const hook = await mount(subtest, { query: 'text', onSearchRequest: () => source.stream });
    await change(() => source.pulls[0].resolve({ value: [{ entryId: 'alpha', snippet: 'accepted' }], done: false }));
    await change(() => failure === 'network' ? source.pulls[1].reject(new Error('connection lost'))
      : source.pulls[1].resolve({ value: ['beta', { entryId: 'folder', snippet: 123 }], done: false }));
    assert.deepEqual(hook.current.resultHits, [{ entryId: 'alpha', snippet: 'accepted' }]);
    assert.equal(hook.current.searchPending, false);
    assert.ok(hook.current.searchError);
    assert.equal(source.returned, 1);
  });
});

test('new context cancels streaming iterators and rejects late chunks without mixing hits', async t => {
  for (const [label, patch] of [
    ['query', { query: 'second' }], ['params', { params: { customer: 'new' } }], ['tab', { tabId: 'tab-2' }],
    ['entries', { entries: entries.filter(item => item.id !== 'alpha') }],
  ]) await t.test(label, async subtest => {
    const calls = [];
    const hook = await mount(subtest, { query: 'first', onSearchRequest(_, context) {
      const source = controlledStream(); calls.push({ ...source, get returned() { return source.returned; }, context }); return source.stream;
    } });
    await change(() => calls[0].pulls[0].resolve({ value: [{ entryId: 'alpha', snippet: 'old' }], done: false }));
    await hook.update(patch);
    assert.equal(calls[0].context.signal.aborted, true);
    assert.equal(calls[0].returned, 1);
    assert.deepEqual(hook.current.resultHits, []);
    await change(() => calls[1].pulls[0].resolve({ value: [{ entryId: 'beta', snippet: 'new' }], done: false }));
    await change(() => calls[0].pulls[1].resolve({ value: [{ entryId: 'folder', snippet: 'late' }], done: false }));
    assert.deepEqual(hook.current.resultHits, [{ entryId: 'beta', snippet: 'new' }]);
    assert.equal(hook.current.searchPending, true);
    assert.equal(calls[0].pulls.length, 2, 'no further next() after a cancelled pending request');
    await change(() => calls[1].pulls[1].resolve({ done: true }));
    assert.equal(hook.current.searchPending, false);
  });
});

test('clear, unmount and pagehide call iterator.return without waiting for a non-cooperative next', async t => {
  for (const action of ['clear', 'unmount', 'pagehide']) await t.test(action, async subtest => {
    const source = controlledStream();
    let signal;
    const hook = await mount(subtest, { query: 'text', onSearchRequest(_, context) { signal = context.signal; return source.stream; } });
    if (action === 'clear') await hook.update({ query: '' });
    else if (action === 'unmount') await hook.unmount();
    else await change(() => hook.document.defaultView.dispatchEvent(new Event('pagehide')));
    assert.equal(signal.aborted, true);
    assert.equal(source.returned, 1);
    await change(() => source.pulls[0].resolve({ value: ['alpha'], done: false }));
    assert.deepEqual(hook.current.resultHits, action === 'clear' ? null : []);
  });
});

test('a stream arriving after its handler promise was cancelled is closed without starting next', async t => {
  const response = deferred(), source = controlledStream();
  const hook = await mount(t, { query: 'text', onSearchRequest: () => response.promise });
  await hook.update({ query: '' });
  await change(() => response.resolve(source.stream));
  assert.equal(source.pulls.length, 0);
  assert.equal(source.returned, 1);
  assert.equal(hook.current.resultHits, null);
});

test('native async generator cleanup runs after cancellation even when its pending next settles late', async t => {
  const wait = deferred();
  let finalized = 0;
  const hook = await mount(t, { query: 'text', onSearchRequest: async function* () {
    try { yield ['alpha']; await wait.promise; yield ['beta']; } finally { finalized++; }
  } });
  assert.deepEqual(hook.current.resultIds, ['alpha']);
  await hook.update({ query: '' });
  assert.equal(finalized, 0, 'native generators finish pending awaits before return');
  await change(() => wait.resolve());
  assert.equal(finalized, 1);
  assert.equal(hook.current.resultIds, null);
});

test('cumulative stream limits end pending state and retain only earlier accepted batches', async t => {
  const source = controlledStream();
  const hook = await mount(t, { query: 'text', onSearchRequest: () => source.stream });
  await change(() => source.pulls[0].resolve({ value: Array(60_000).fill('alpha'), done: false }));
  assert.deepEqual(hook.current.resultIds, ['alpha']);
  await change(() => source.pulls[1].resolve({ value: ['beta', ...Array(40_000).fill('unknown')], done: false }));
  assert.deepEqual(hook.current.resultIds, ['alpha']);
  assert.equal(hook.current.searchPending, false);
  assert.match(hook.current.searchError, /100,000/);
  assert.equal(source.returned, 1);
});

test('an immediately yielding empty stream yields control so cancellation can finish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let batches = 0, finalized = 0;
  const hook = await mount(t, { query: 'text', onSearchRequest: async function* () {
    try { while (true) { batches++; yield []; } } finally { finalized++; }
  } });
  assert.ok(batches > 0 && batches <= 32);
  assert.equal(hook.current.searchPending, true);
  await hook.update({ query: '' });
  const stoppedAt = batches;
  await change(() => t.mock.timers.tick(1));
  assert.equal(batches, stoppedAt);
  assert.equal(finalized, 1);
  assert.equal(hook.current.resultHits, null);
});

test('a synchronous data revision change blocks stale metadata before React has rendered', async t => {
  const requests = []; let dataRevision = 0, hydrated = 0, cached = entries;
  const hook = await mount(t, { query: 'remote', searchDataRevision: dataRevision, getSearchDataRevision: () => dataRevision,
    getEntries: () => cached, hydrateSearchEntries: supplied => { hydrated++; cached = [...cached, ...supplied]; return { entries: cached, addedCount: supplied.length }; },
    onSearchRequest: () => { const pending = deferred(); requests.push(pending); return pending.promise; } });
  dataRevision++;
  await change(() => requests[0].resolve({ hits: ['stale'], entries: [entry('stale')] }));
  assert.equal(hydrated, 0); assert.equal(cached, entries);
  await hook.update({ searchDataRevision: dataRevision });
  await change(() => requests[1].resolve({ hits: ['fresh'], entries: [entry('fresh')] }));
  assert.equal(hydrated, 1); assert.deepEqual(hook.current.resultIds, ['fresh']);
});

test('paused external searches neither invoke the host nor accept late cache metadata', async t => {
  const requests = []; let hydrated = 0;
  const hook = await mount(t, { query: 'remote', searchDataRevision: 0, externalPaused: true,
    hydrateSearchEntries: supplied => { hydrated++; return { entries: [...entries, ...supplied], addedCount: supplied.length }; },
    onSearchRequest: () => { const pending = deferred(); requests.push(pending); return pending.promise; } });
  assert.equal(requests.length, 0); assert.equal(hook.current.searchPending, false); assert.equal(hook.current.externalSearch, true);
  await hook.update({ externalPaused: false }); assert.equal(requests.length, 1);
  await hook.update({ externalPaused: true });
  await change(() => requests[0].resolve({ hits: ['stale'], entries: [entry('stale')] }));
  assert.equal(hydrated, 0); assert.equal(hook.current.searchPending, false); assert.deepEqual(hook.current.resultIds, []);
  await hook.update({ externalPaused: false });
  await change(() => requests[1].resolve({ hits: ['fresh'], entries: [entry('fresh')] }));
  assert.equal(hydrated, 1); assert.deepEqual(hook.current.resultIds, ['fresh']);
});

test('entry text limits accumulate across batches, including repeated known metadata, before hydration', async t => {
  const source = controlledStream(); let hydrated = 0;
  const record = { ...entry('alpha'), mime: 'x'.repeat(2_600_000) };
  const hook = await mount(t, { query: 'remote', searchDataRevision: 0,
    hydrateSearchEntries: () => { hydrated++; return { entries, addedCount: 0 }; }, onSearchRequest: () => source.stream });
  await change(() => source.pulls[0].resolve({ value: { hits: ['alpha'], entries: [record] }, done: false }));
  assert.equal(hydrated, 1); assert.deepEqual(hook.current.resultIds, ['alpha']);
  await change(() => source.pulls[1].resolve({ value: { hits: ['beta'], entries: [record] }, done: false }));
  assert.equal(hydrated, 1); assert.deepEqual(hook.current.resultIds, ['alpha']);
  assert.match(hook.current.searchError, /累計.*5,000,000/); assert.equal(source.returned, 1);
});

test('metadata batch getters are rejected without executing them or hydrating the cache', async t => {
  let getters = 0, hydrated = 0;
  const hook = await mount(t, { query: 'remote', searchDataRevision: 0,
    hydrateSearchEntries: () => { hydrated++; return { entries, addedCount: 0 }; },
    onSearchRequest: () => ({ get hits() { getters++; return ['alpha']; }, entries: [] }) });
  assert.equal(getters, 0); assert.equal(hydrated, 0); assert.match(hook.current.searchError, /getter/);
});


test('prepared batch limits use the validated count even if the host clears its array before commit', () => {
  const accumulator = createExplorerSearchResultAccumulator(entries), source = Array(60_000).fill('alpha');
  const prepared = accumulator.prepare(source);
  source.length = 0;
  assert.deepEqual(prepared.commit(), [{ entryId: 'alpha' }]);
  assert.throws(() => accumulator.append(Array(40_001).fill('beta')), /100,000/);
  assert.deepEqual(accumulator.append(['beta']), [{ entryId: 'alpha' }, { entryId: 'beta' }]);
});
