import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { createDraftSnapshot, applyAction, getSavePayload, mergeExplorerSearchEntries } from './src/model-entry.ts';
  export { prepareExplorerSearchEntries } from './src/model/search-entries.ts';
`, sourcefile: 'search-entries-tests.ts', resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useExplorerDraft, createDraftSnapshot, applyAction, getSavePayload, mergeExplorerSearchEntries, prepareExplorerSearchEntries } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-search-entries-tests.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const entry = (id, parent = 'root', kind = 'file', name = kind === 'folder' ? id : `${id}.txt`) => ({ id, parent, kind, name,
  size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '', favorite: 0,
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null });
const folder = (id, parent = 'root') => entry(id, parent, 'folder');
async function mount(t, supplied = {}) {
  let current, renderer, closed = false;
  const events = [];
  let options = { initialEntries: [], onSave: () => {}, onEvent: event => events.push(event), onLoadFolder: () => [], ...supplied };
  function Probe() { current = useExplorerDraft(options); return null; }
  const tree = () => h(StrictMode, null, h(Probe));
  await change(() => { renderer = create(tree()); });
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { get current() { return current; }, events, unmount,
    async update(patch) { options = { ...options, ...patch }; await change(() => renderer.update(tree())); } };
}
async function hydrate(hook, entries, revision = hook.current.getSearchDataRevision()) {
  let result; await change(() => { result = hook.current.hydrateSearchEntries(entries, revision); }); return result;
}

test('search entries hydrate unknown ancestors in arbitrary order without changing save deltas or caller data', () => {
  const baseline = createDraftSnapshot([entry('cached')]);
  const response = [entry('hit', 'nested'), folder('nested', 'top'), folder('top')], original = structuredClone(response);
  const result = mergeExplorerSearchEntries(baseline, baseline, response);
  assert.equal(result.addedCount, 3);
  assert.deepEqual(result.draft.entries.map(item => item.id), ['cached', 'hit', 'nested', 'top']);
  assert.deepEqual(getSavePayload(result.baseline, result.draft).changes, { created: [], updated: [], deleted: [] });
  assert.deepEqual(response, original); assert.equal(baseline.entries.length, 1);
  response[0].source.id = 'changed'; response[1].name = 'changed';
  assert.equal(result.draft.entries[1].source.id, 'body-hit'); assert.equal(result.draft.entries[2].name, 'nested');
  assert.ok(Object.isFrozen(result.draft.entries[1].source)); assert.ok(Object.isFrozen(result.draft.entries));
});

test('search hydration ignores known metadata and preserves local rename, move and deletion', () => {
  const baseline = createDraftSnapshot([folder('a'), folder('b'), entry('renamed', 'a'), entry('moved', 'a'), entry('deleted', 'a')]);
  let draft = applyAction(baseline, { action: 'rename', ids: ['renamed'], name: 'local.txt' });
  draft = applyAction(draft, { action: 'move', ids: ['moved'], parent: 'b' });
  draft = applyAction(draft, { action: 'delete', ids: ['deleted'] });
  const result = mergeExplorerSearchEntries(baseline, draft, [entry('renamed', 'a', 'file', 'remote.txt'), entry('moved', 'a'), entry('deleted', 'a'), entry('new', 'a')]);
  assert.equal(result.draft.entries.find(item => item.id === 'renamed').name, 'local.txt');
  assert.equal(result.draft.entries.find(item => item.id === 'moved').parent, 'b');
  assert.equal(result.draft.entries.some(item => item.id === 'deleted'), false);
  assert.deepEqual(getSavePayload(result.baseline, result.draft).changes, getSavePayload(baseline, draft).changes);
  const same = mergeExplorerSearchEntries(result.baseline, result.draft, [entry('deleted', 'a')]);
  assert.equal(same.baseline, result.baseline); assert.equal(same.draft, result.draft); assert.equal(same.addedCount, 0);
});

test('search identity, hierarchy and name conflicts reject the complete batch atomically', () => {
  const baseline = createDraftSnapshot([folder('a'), folder('b'), entry('known', 'a')]);
  const draft = applyAction(baseline, { action: 'createFile', parent: 'a', name: 'local.txt' });
  const local = draft.entries.find(item => !baseline.entries.some(original => original.id === item.id));
  for (const invalid of [
    [entry('missing', 'absent')], [entry('child', 'known')], [folder('x', 'y'), folder('y', 'x')],
    [entry('duplicate'), entry('duplicate')], [entry('known', 'a'), entry('known', 'a')],
    [entry('known', 'b')], [folder('known', 'a')], [entry(local.id, 'a')],
    [entry('new', 'a', 'file', 'known.txt')], [entry('new', 'a', 'file', 'local.txt')],
  ]) {
    assert.throws(() => mergeExplorerSearchEntries(baseline, draft, [entry('valid'), ...invalid]));
    assert.equal(baseline.entries.length, 3); assert.equal(draft.entries.length, 4);
  }
});

test('search hydration never resurrects deleted ancestors and still accepts children of locally moved folders', () => {
  const baseline = createDraftSnapshot([folder('a'), folder('b'), folder('deleted')]);
  let draft = applyAction(baseline, { action: 'delete', ids: ['deleted'] });
  assert.throws(() => mergeExplorerSearchEntries(baseline, draft, [entry('new', 'deleted'), folder('deleted')]), /親フォルダ/);
  assert.equal(draft.entries.some(item => item.id === 'deleted'), false);
  draft = applyAction(draft, { action: 'move', ids: ['a'], parent: 'b' });
  const result = mergeExplorerSearchEntries(baseline, draft, [folder('a'), entry('new', 'a')]);
  assert.equal(result.draft.entries.find(item => item.id === 'a').parent, 'b');
  assert.equal(result.draft.entries.find(item => item.id === 'new').parent, 'a');
});

test('search metadata validates structure, clones sources and enforces count and text budgets before merging', () => {
  const baseline = createDraftSnapshot([entry('known')]);
  for (const invalid of [null, {}, [null], [{ ...entry('bad'), size: Infinity }], [{ ...entry('bad'), favorite: -1 }],
    [{ ...entry('bad'), createdAt: null }], [{ ...entry('bad'), source: { kind: 'existing', id: '' } }],
    [{ ...entry('bad'), source: { kind: 'local', file: {} } }], [{ ...entry('bad'), id: 'root' }]])
    assert.throws(() => mergeExplorerSearchEntries(baseline, baseline, invalid));
  assert.throws(() => mergeExplorerSearchEntries(baseline, baseline, Array(100_001).fill(null)), /100,000/);
  assert.throws(() => mergeExplorerSearchEntries(baseline, baseline, [{ ...entry('known'), mime: 'x'.repeat(5_000_000) }]), /5,000,000/);
  const sample = entry('sample'), emptyMime = { ...sample, mime: '' };
  const overhead = prepareExplorerSearchEntries([emptyMime]).textLength;
  const prepared = prepareExplorerSearchEntries([{ ...sample, mime: 'x'.repeat(5_000_000 - overhead) }]);
  assert.equal(prepared.textLength, 5_000_000); assert.ok(Object.isFrozen(prepared.entries));
  assert.ok(Object.isFrozen(prepared.entries[0].source));
  assert.equal(baseline.entries.length, 1);
});

test('read-only search hydration is clean, emits only its cache event and leaves folder completeness untouched', async t => {
  const dirty = [], hook = await mount(t, { onSave: undefined, initialEntries: [folder('complete')],
    folderLoading: { initialLoadedFolderIds: ['complete'] }, onDirtyChange: value => dirty.push(value) });
  const revision = hook.current.searchDataRevision;
  const result = await hydrate(hook, [entry('hit', 'unread'), folder('unread')]);
  assert.equal(result.addedCount, 2); assert.equal(hook.current.entries.length, 3);
  assert.equal(hook.current.dirty, false); assert.ok(dirty.every(value => value === false));
  assert.equal(hook.current.getFolderLoadState('complete').status, 'loaded');
  assert.equal(hook.current.getFolderLoadState('unread').status, 'unloaded');
  assert.equal(hook.current.getFolderLoadState('root').status, 'unloaded');
  assert.equal(hook.current.getSearchDataRevision(), revision); assert.equal(hook.current.searchDataRevision, revision);
  assert.deepEqual(hook.events, [{ type: 'search-hydrate', addedCount: 2 }]);
  await hydrate(hook, [folder('unread')]); assert.equal(hook.events.length, 1);
  assert.throws(() => hook.current.assertLoadedForChecks([{ id: 'unread', operation: 'download', recursive: true }]), /配下を読み込む/);
});

test('search cache merges do not cancel a concurrent folder request or promote it to complete', async t => {
  const response = deferred(), hook = await mount(t, { onLoadFolder: () => response.promise });
  let loading; await change(() => { loading = hook.current.loadFolder('root'); });
  const before = hook.current.getSearchDataRevision();
  await hydrate(hook, [entry('hit')]);
  assert.equal(hook.current.getFolderLoadState('root').status, 'loading');
  assert.equal(hook.current.getSearchDataRevision(), before);
  await change(() => response.resolve([entry('hit'), entry('other')])); assert.equal(await loading, true);
  assert.equal(hook.current.getFolderLoadState('root').status, 'loaded');
  assert.ok(hook.current.getSearchDataRevision() > before);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['hit', 'other']);
});

test('search revisions reject stale edits, saves, refreshes and folder hydration while preserving partial save scope', async t => {
  const saved = [], hook = await mount(t, { initialEntries: [entry('cached')], folderLoading: { initialLoadedFolderIds: ['root'] },
    onSave: payload => { saved.push(payload); }, onRefresh: () => [entry('fresh')] });
  const initialRevision = hook.current.getSearchDataRevision();
  await change(() => hook.current.apply({ action: 'favorite', ids: ['cached'] }));
  assert.ok(hook.current.getSearchDataRevision() > initialRevision);
  assert.equal(await hydrate(hook, [entry('stale')], initialRevision), null);
  await hydrate(hook, [folder('unread'), entry('hit', 'unread')]);
  const beforeSave = hook.current.getSearchDataRevision();
  await change(() => hook.current.save());
  assert.ok(hook.current.getSearchDataRevision() > beforeSave);
  assert.deepEqual(saved[0].scope, { kind: 'partial', loadedFolderIds: ['root'] });
  assert.deepEqual(saved[0].changes.created, []); assert.equal(saved[0].changes.updated[0].id, 'cached');
  assert.equal(hook.current.getFolderLoadState('unread').status, 'unloaded');
  assert.equal(await hydrate(hook, [entry('stale')], beforeSave), null);
  const beforeFolder = hook.current.getSearchDataRevision();
  await change(() => hook.current.loadFolder('unread'));
  assert.ok(hook.current.getSearchDataRevision() > beforeFolder, 'empty folder hydration also invalidates existing search requests');
  const beforeRefresh = hook.current.getSearchDataRevision();
  await change(() => hook.current.refresh());
  assert.ok(hook.current.getSearchDataRevision() > beforeRefresh);
  assert.equal(await hydrate(hook, [entry('stale')], beforeRefresh), null);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['fresh']);
});

test('busy or unmounted drafts reject search batches before validation and complete-list mode rejects metadata hydration', async t => {
  for (const operation of ['save', 'refresh']) await t.test(operation, async subtest => {
    const pending = deferred(), hook = await mount(subtest, { initialEntries: [entry('cached')],
      onSave: () => pending.promise, onRefresh: () => pending.promise });
    await change(() => hook.current.apply({ action: 'favorite', ids: ['cached'] }));
    let task; await change(() => { task = hook.current[operation](); });
    assert.equal(await hydrate(hook, null), null);
    await change(() => pending.resolve([entry('cached')])); await task;
    const retained = hook.current; await hook.unmount();
    assert.equal(retained.hydrateSearchEntries(null, retained.getSearchDataRevision()), null);
  });
  const complete = await mount(t, { onLoadFolder: undefined });
  assert.throws(() => complete.current.hydrateSearchEntries([entry('hit')], complete.current.getSearchDataRevision()), /段階的/);
  assert.deepEqual(complete.current.entries, []);
});

test('invalid search batches do not emit cache events or advance revision and handler removal keeps lazy safety', async t => {
  const hook = await mount(t), revision = hook.current.getSearchDataRevision();
  assert.throws(() => hook.current.hydrateSearchEntries([entry('orphan', 'missing')], revision), /親フォルダ/);
  assert.deepEqual(hook.current.entries, []); assert.deepEqual(hook.events, []);
  assert.equal(hook.current.getSearchDataRevision(), revision);
  await hook.update({ onLoadFolder: undefined });
  assert.equal((await hydrate(hook, [entry('hit')])).addedCount, 1);
  assert.equal(hook.current.getFolderLoadState('root').status, 'unloaded');
});

test('synchronous cache observers may edit but cannot make the original revision valid again', async t => {
  let active;
  const hook = await mount(t, { initialEntries: [entry('cached')], onEvent: event => {
    if (event.type === 'search-hydrate') active.apply({ action: 'favorite', ids: ['cached'] });
  } });
  active = hook.current;
  const revision = active.getSearchDataRevision(), result = await hydrate(hook, [entry('hit')]);
  assert.equal(result.addedCount, 1); assert.ok(hook.current.getSearchDataRevision() > revision);
  assert.equal(hook.current.entries.some(item => item.id === 'hit'), true);
  assert.equal(hook.current.entries.find(item => item.id === 'cached').favorite, 1);
});

test('metadata accessors are rejected without invoking them or changing the cache', async t => {
  const hook = await mount(t, { initialEntries: [entry('cached')] });
  const candidate = entry('hit'); let read = false;
  Object.defineProperty(candidate, 'name', { get() {
    if (!read) { read = true; hook.current.apply({ action: 'favorite', ids: ['cached'] }); }
    return 'hit.txt';
  } });
  await assert.rejects(hydrate(hook, [candidate]), /必要な値/);
  assert.equal(read, false);
  assert.equal(hook.current.entries.length, 1); assert.equal(hook.current.entries[0].favorite, 0);
});
