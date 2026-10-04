import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { createDraftSnapshot, applyAction, getSavePayload, mergeExplorerFolderEntries } from './src/model-entry.ts';
`, sourcefile: 'folder-loading-tests.ts', resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useExplorerDraft, createDraftSnapshot, applyAction, getSavePayload, mergeExplorerFolderEntries } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-folder-loading-tests.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const entry = (id, parent = 'root', kind = 'file', name = kind === 'folder' ? id : `${id}.txt`) => ({ id, parent, kind, name,
  size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '', favorite: 0,
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null });
const folder = (id, parent = 'root') => entry(id, parent, 'folder');
async function mount(t, supplied = {}) {
  let current, renderer, closed = false;
  const events = [];
  let options = { initialEntries: [], onSave: () => {}, onEvent: event => events.push(event), ...supplied };
  function Probe() { current = useExplorerDraft(options); return null; }
  const tree = () => h(StrictMode, null, h(Probe));
  await change(() => { renderer = create(tree()); });
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { get current() { return current; }, events, unmount,
    async update(patch) { options = { ...options, ...patch }; await change(() => renderer.update(tree())); } };
}
async function load(hook, id, options) { let result; await change(async () => { result = await hook.current.loadFolder(id, options); }); return result; }

test('folder hydration preserves cached identity and local rename/move/delete while new reads stay out of save deltas', () => {
  const initial = [folder('target'), folder('other'), entry('renamed', 'target'), entry('moved', 'target'), entry('deleted', 'target')];
  const baseline = createDraftSnapshot(initial);
  let draft = applyAction(baseline, { action: 'rename', ids: ['renamed'], name: 'local.txt' });
  draft = applyAction(draft, { action: 'move', ids: ['moved'], parent: 'other' });
  draft = applyAction(draft, { action: 'delete', ids: ['deleted'] });
  const response = [entry('renamed', 'target', 'file', 'server.txt'), entry('moved', 'target'), entry('deleted', 'target'), entry('new', 'target')];
  const before = structuredClone(response);
  const next = mergeExplorerFolderEntries(baseline, draft, 'target', response);
  assert.equal(next.addedCount, 1);
  assert.equal(next.draft.entries.find(item => item.id === 'renamed').name, 'local.txt');
  assert.equal(next.draft.entries.find(item => item.id === 'moved').parent, 'other');
  assert.equal(next.draft.entries.some(item => item.id === 'deleted'), false);
  assert.equal(next.baseline.entries.find(item => item.id === 'renamed').name, 'renamed.txt');
  const changes = getSavePayload(next.baseline, next.draft).changes;
  assert.deepEqual(changes.created, []);
  assert.deepEqual(changes.updated.map(item => item.id), ['renamed', 'moved']);
  assert.deepEqual(changes.deleted.map(item => item.id), ['deleted']);
  assert.deepEqual(response, before);
  assert.equal(initial.length, 5);
});

test('folder responses reject grandchildren, identity conflicts and both baseline/draft name collisions atomically', () => {
  const baseline = createDraftSnapshot([folder('target'), folder('other'), entry('known', 'target'), entry('foreign', 'other')]);
  let draft = applyAction(baseline, { action: 'createFile', parent: 'target', name: 'local.txt' });
  const local = draft.entries.find(item => !baseline.entries.some(original => original.id === item.id));
  for (const invalid of [
    [folder('child', 'target'), entry('grandchild', 'child')],
    [entry('foreign', 'target')], [folder('known', 'target')], [entry(local.id, 'target')],
    [entry('new', 'target', 'file', 'known.txt')], [entry('new', 'target', 'file', 'local.txt')],
    [entry('new', 'target'), entry('new', 'target')], [entry('new', 'other')],
  ]) {
    assert.throws(() => mergeExplorerFolderEntries(baseline, draft, 'target', invalid));
    assert.equal(baseline.entries.length, 4); assert.equal(draft.entries.length, 5);
  }
  const unchanged = mergeExplorerFolderEntries(baseline, draft, 'target', []);
  assert.equal(unchanged.baseline, baseline); assert.equal(unchanged.draft, draft);
});

test('lazy read-only hydration is clean, emits load events and caches complete empty folders', async t => {
  const calls = [], dirty = [];
  const hook = await mount(t, { onSave: undefined, onDirtyChange: value => dirty.push(value), onLoadFolder: request => {
    calls.push(request); return request.folderId === 'root' ? [folder('docs'), entry('one')] : [];
  } });
  assert.equal(hook.current.folderLoadingEnabled, true);
  assert.equal(hook.current.getFolderLoadState('root').status, 'unloaded');
  assert.equal(await load(hook, 'root'), true);
  assert.equal(hook.current.dirty, false); assert.equal(hook.current.entries.length, 2);
  assert.deepEqual(calls, [{ folderId: 'root', path: '/' }]);
  assert.equal(await load(hook, 'docs'), true); assert.equal(await load(hook, 'docs'), true);
  assert.equal(calls.length, 2);
  assert.equal(hook.current.getFolderLoadState('docs').status, 'loaded');
  assert.deepEqual(hook.events.filter(event => event.type === 'folder-load').map(event => event.status), ['start', 'success', 'start', 'success']);
  assert.ok(!hook.events.some(event => event.type === 'change'));
  assert.ok(dirty.every(value => value === false));
});

test('parallel consumers share I/O and cancelling one signal preserves other leases', async t => {
  const response = deferred(); let calls = 0, signal;
  const hook = await mount(t, { onLoadFolder(_, context) { calls++; signal = context.signal; return response.promise; } });
  const first = new AbortController(), second = new AbortController(); let one, two;
  await change(() => { one = hook.current.loadFolder('root', { signal: first.signal }); two = hook.current.loadFolder('root', { signal: second.signal }); });
  assert.equal(calls, 1); assert.equal(hook.current.getFolderLoadState('root').status, 'loading');
  await change(() => first.abort()); assert.equal(await one, false); assert.equal(signal.aborted, false);
  await change(() => response.resolve([entry('one')])); assert.equal(await two, true);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['one']);
});

test('the last cancelled lease aborts, and a late response cannot replace a newer request', async t => {
  const calls = [];
  const hook = await mount(t, { onLoadFolder(_, context) { const response = deferred(); calls.push({ response, signal: context.signal }); return response.promise; } });
  const cancel = new AbortController(); let old, next;
  await change(() => { old = hook.current.loadFolder('root', { signal: cancel.signal }); });
  await change(() => cancel.abort()); assert.equal(await old, false); assert.equal(calls[0].signal.aborted, true);
  assert.equal(hook.current.getFolderLoadState('root').status, 'unloaded');
  await change(() => { next = hook.current.loadFolder('root'); });
  await change(() => calls[0].response.resolve([entry('old')]));
  assert.deepEqual(hook.current.entries, []); assert.equal(hook.current.getFolderLoadState('root').status, 'loading');
  await change(() => calls[1].response.resolve([entry('new')])); assert.equal(await next, true);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['new']);
});

test('errors are atomic and explicit retry can load the same folder successfully', async t => {
  let attempts = 0;
  const hook = await mount(t, { initialEntries: [entry('one')], onLoadFolder: () => ++attempts === 1
    ? [entry('new'), entry('duplicate', 'root', 'file', 'one.txt')] : [entry('new')] });
  assert.equal(await load(hook, 'root'), false);
  assert.equal(hook.current.getFolderLoadState('root').status, 'error');
  assert.deepEqual(hook.current.entries.map(item => item.id), ['one']); assert.equal(hook.current.dirty, false);
  assert.equal(await load(hook, 'root'), true);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['one', 'new']);
  assert.deepEqual(hook.events.filter(event => event.type === 'folder-load').map(event => event.status), ['start', 'error', 'start', 'success']);
});

test('recursive loading traverses only unloaded descendant folders and guards destructive operations', async t => {
  const calls = [];
  const hook = await mount(t, { initialEntries: [folder('a'), folder('complete')], folderLoading: { initialLoadedFolderIds: ['root', 'complete'] }, onLoadFolder: ({ folderId }) => {
    calls.push(folderId); return folderId === 'a' ? [folder('nested', 'a')] : folderId === 'nested' ? [entry('leaf', 'nested')] : [];
  } });
  assert.throws(() => hook.current.apply({ action: 'delete', ids: ['a'] }), /配下を読み込む/);
  assert.equal(await load(hook, 'root', { recursive: true }), true);
  assert.deepEqual(calls, ['a', 'nested']);
  await change(() => hook.current.apply({ action: 'copy', ids: ['a'], parent: 'root' }));
  const copy = hook.current.entries.find(item => item.kind === 'folder' && !['a', 'complete', 'nested'].includes(item.id));
  assert.equal(hook.current.getFolderLoadState(copy.id).status, 'loaded');
  await change(() => hook.current.apply({ action: 'delete', ids: ['a'] }));
  assert.equal(hook.current.entries.some(item => item.id === 'leaf'), false);
});

test('editing destinations and renamed parents require completeness; prepared commits recheck a newly lazy cache', async t => {
  const hook = await mount(t, { initialEntries: [entry('one'), folder('target')], onLoadFolder: () => [] });
  assert.throws(() => hook.current.prepareAction({ action: 'create', name: 'New' }), /配下を読み込む/);
  assert.throws(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'new.txt' }), /配下を読み込む/);
  assert.throws(() => hook.current.apply({ action: 'move', ids: ['one'], parent: 'target' }), /配下を読み込む/);
  assert.throws(() => hook.current.add([new File(['x'], 'x.txt')], 'target'), /配下を読み込む/);
  await assert.rejects(() => hook.current.addAsync([new File(['x'], 'x.txt')], 'target'), /配下を読み込む/);
  assert.equal(await load(hook, 'root'), true);
  await change(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'new.txt' }));
  const legacy = await mount(t, { initialEntries: [entry('one')] });
  const commit = legacy.current.prepareAction({ action: 'rename', ids: ['one'], name: 'two.txt' });
  await legacy.update({ onLoadFolder: () => [] });
  assert.throws(() => commit(), /配下を読み込む/);
  assert.equal(legacy.current.entries[0].name, 'one.txt');
});

test('partial save includes loaded local folders, cancels pending reads and retains completeness after persistence', async t => {
  const response = deferred(), persistence = deferred(); let signal, saved, loading;
  const hook = await mount(t, { initialEntries: [folder('remote')], folderLoading: { initialLoadedFolderIds: ['root'] },
    onLoadFolder(_, context) { signal = context.signal; return response.promise; }, onSave(payload) { saved = payload; return persistence.promise; } });
  await change(() => hook.current.apply({ action: 'create', name: 'Local' }));
  const local = hook.current.entries.find(item => item.name === 'Local');
  await change(() => hook.current.apply({ action: 'createFile', parent: local.id, name: 'local.txt' }));
  await change(() => { loading = hook.current.loadFolder('remote'); });
  let saving; await change(() => { saving = hook.current.save(); });
  assert.equal(signal.aborted, true); assert.equal(await loading, false);
  assert.deepEqual([...saved.scope.loadedFolderIds].sort(), [local.id, 'root'].sort());
  assert.equal(saved.scope.kind, 'partial'); assert.equal(saved.changes.created.length, 2);
  assert.deepEqual(hook.events.find(event => event.type === 'save' && event.status === 'start').payload.scope, saved.scope);
  await change(() => response.resolve([entry('late', 'remote')]));
  await change(() => persistence.resolve(saved.entries)); assert.equal(await saving, true);
  assert.equal(hook.current.dirty, false); assert.equal(hook.current.entries.some(item => item.id === 'late'), false);
  assert.equal(hook.current.getFolderLoadState(local.id).status, 'loaded');
  assert.equal(hook.current.getFolderLoadState('remote').status, 'unloaded');
});

test('failed persistence cannot restore a stale pre-hydration snapshot or accept an in-flight folder response', async t => {
  const response = deferred(), persistence = deferred(); let loading, saving;
  const hook = await mount(t, { initialEntries: [entry('one')], onLoadFolder: () => response.promise, onSave: () => persistence.promise });
  await change(() => hook.current.apply({ action: 'favorite', ids: ['one'] }));
  await change(() => { loading = hook.current.loadFolder('root'); });
  await change(() => { saving = hook.current.save(); });
  assert.equal(await loading, false);
  await change(() => response.resolve([entry('late')]));
  await change(() => persistence.reject(new Error('save failed'))); assert.equal(await saving, false);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['one']); assert.equal(hook.current.entries[0].favorite, 1);
  assert.equal(hook.current.dirty, true); assert.equal(hook.current.saveError, 'save failed');
});

test('refresh and authoritative edit permission replace completeness and invalidate older reads', async t => {
  for (const mode of ['refresh', 'edit']) await t.test(mode, async subtest => {
    const response = deferred(); let pending;
    const authoritative = [folder('complete'), entry('child', 'complete')];
    const hook = await mount(subtest, { onLoadFolder: () => response.promise,
      ...(mode === 'refresh' ? { onRefresh: () => authoritative } : { onEditRequest: () => ({ allowed: true, entries: authoritative }) }) });
    await change(() => { pending = hook.current.loadFolder('root'); });
    await change(async () => { assert.equal(await (mode === 'refresh' ? hook.current.refresh() : hook.current.requestEdit({ action: 'create', parent: 'root', name: 'next' })), true); });
    assert.equal(await pending, false);
    await change(() => response.resolve([entry('late')]));
    assert.deepEqual(hook.current.entries.map(item => item.id), ['complete', 'child']);
    assert.equal(hook.current.getFolderLoadState('root').status, 'loaded');
    assert.equal(hook.current.getFolderLoadState('complete').status, 'loaded');
  });
});

test('unmount settles leases immediately and handler removal cannot bypass partial-cache guards', async t => {
  const response = deferred(); let pending, signal;
  const hook = await mount(t, { onLoadFolder(_, context) { signal = context.signal; return response.promise; } });
  await change(() => { pending = hook.current.loadFolder('root'); });
  await hook.unmount(); assert.equal(await pending, false); assert.equal(signal.aborted, true);
  await change(() => response.resolve([entry('late')]));
  const next = await mount(t, { onLoadFolder: () => [] });
  await next.update({ onLoadFolder: undefined });
  assert.equal(next.current.folderLoadingEnabled, true);
  assert.throws(() => next.current.apply({ action: 'create', name: 'Unsafe' }), /配下を読み込む/);
  assert.equal(await load(next, 'root'), false); assert.equal(next.current.getFolderLoadState('root').status, 'error');
  await next.update({ onLoadFolder: () => [] }); assert.equal(await load(next, 'root'), true);
});

test('legacy complete listings retain old save payloads and need no loading callback', async t => {
  let saved;
  const hook = await mount(t, { initialEntries: [folder('a')], onSave: payload => { saved = payload; } });
  assert.equal(hook.current.folderLoadingEnabled, false); assert.equal(await load(hook, 'a', { recursive: true }), true);
  await change(() => hook.current.apply({ action: 'createFile', parent: 'a', name: 'new.txt' }));
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(saved.scope, undefined);
});

test('unmount releases edit capability before folder abort listeners can synchronously re-enter', async t => {
  const response = deferred(); let retained, pending, saves = 0, editError, saveAttempt;
  const hook = await mount(t, { initialEntries: [entry('one')],
    onSave() { saves++; },
    onLoadFolder(_, { signal }) {
      signal.addEventListener('abort', () => {
        try { retained.apply({ action: 'favorite', ids: ['one'] }); } catch (error) { editError = error; }
        saveAttempt = retained.save();
      });
      return response.promise;
    } });
  await change(() => hook.current.apply({ action: 'favorite', ids: ['one'] }));
  retained = hook.current;
  await change(() => { pending = retained.loadFolder('root'); });
  await hook.unmount();
  assert.equal(await pending, false); assert.equal(await saveAttempt, false);
  assert.equal(saves, 0); assert.equal(editError, undefined, 'unmounted apply is an inert no-op');
  assert.equal(retained.getEntries()[0].favorite, 1);
});

test('a load queued immediately before saving settles without invoking a stale handler', async t => {
  const persistence = deferred(); let pending, saving, reads = 0;
  const hook = await mount(t, { initialEntries: [entry('one')], onSave: () => persistence.promise,
    onLoadFolder() { reads++; return []; } });
  await change(() => hook.current.apply({ action: 'favorite', ids: ['one'] }));
  await change(() => { pending = hook.current.loadFolder('root'); saving = hook.current.save(); });
  assert.equal(await pending, false); assert.equal(reads, 0);
  assert.equal(hook.current.getFolderLoadState('root').status, 'unloaded');
  await change(() => persistence.resolve()); assert.equal(await saving, true);
});
