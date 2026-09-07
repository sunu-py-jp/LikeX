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
const { resolveExplorerSearchIds } = await importTypeScript('../src/model/search.ts');
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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
  assert.deepEqual(hook.current, { resultIds: null, searchPending: false, searchError: null, externalSearch: false });
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
  assert.deepEqual(calls[0].request, { query: 'revenue', entries, location: root, tabId: 'tab-1', windowId: 'popup-2' });
  assert.equal(calls[0].context.signal.aborted, false);
  assert.deepEqual(hook.current.resultIds, ['beta', 'alpha', 'folder']);
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
    assert.deepEqual(hook.current, { resultIds: null, searchPending: false, searchError: null, externalSearch: false });
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
