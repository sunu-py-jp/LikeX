import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// These regressions observe data/persistence events; edit-mode lifecycle has its own suite.

// Keep the hook and renderer on the same React instance, including when the
// bundled TypeScript module is loaded from an in-memory data URL.
const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerDraft } from "./src/state/use-explorer-draft.ts";
      export { default as FilePreview } from "./src/ui/file-preview.tsx";
      export { readEntryFile } from "./src/model/file-content.ts";
    `,
    resolveDir: packageRoot,
    sourcefile: 'test-explorer-hook.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'external-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react-test-renderer|lucide-react)(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const { useExplorerDraft, FilePreview, readEntryFile } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const entry = (id, parent, name, kind = 'file') => ({
  id, parent, name, kind,
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).normalize('NFC').toLowerCase() : '',
  size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id: `opaque:${id}` } : null,
});
const initialEntries = () => [entry('one', 'root', 'one.txt'), entry('folder', 'root', 'Folder', 'folder')];
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
function uploadConflict(callback) {
  let caught;
  try { callback(); } catch (error) { caught = error; }
  assert.equal(caught?.name, 'ExplorerUploadConflictError');
  return caught;
}
const uploadDecision = (error, action = 'overwrite') => ({ fileIndex: error.conflict.fileIndex, existing: error.conflict.existing, action });

async function mountHook(t, options) {
  let latest;
  let renders = 0;
  let renderer;
  let unmounted = false;
  function Probe({ options }) {
    latest = useExplorerDraft(options);
    renders++;
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe, { options })); });
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => { renderer.unmount(); });
  };
  t.after(unmount);
  return {
    get current() { return latest; },
    get renders() { return renders; },
    unmount,
    async update(patch) {
      options = { ...options, ...patch };
      await act(async () => { renderer.update(createElement(Probe, { options })); });
    },
  };
}

test('hook data, save deltas and a canonical response retain filename-derived extensions across discard', async t => {
  const supplied = [{ ...entry('one', 'root', 'one.TXT'), extension: 'stale' },
    { ...entry('remove', 'root', 'remove.CSV'), extension: undefined }, entry('folder', 'root', 'Folder.PDF', 'folder')];
  const saves = [];
  const hook = await mountHook(t, { initialEntries: supplied, onSave(payload) {
    saves.push(payload);
    return payload.entries.map(item => item.id === 'one'
      ? { ...item, name: 'Canonical.PDF', extension: 'host-stale' }
      : { ...item, extension: 'host-stale' });
  } });
  assert.deepEqual(hook.current.entries.map(item => item.extension), ['txt', 'csv', '']);
  assert.equal(hook.current.dirty, false); assert.equal(supplied[0].extension, 'stale');
  const file = new File(['new body'], 'New.TAR.GZ');
  await act(async () => {
    hook.current.apply({ action: 'rename', ids: ['one'], name: 'Changed.JSON' });
    hook.current.apply({ action: 'delete', ids: ['remove'] });
    hook.current.add([file], 'folder');
  });
  assert.equal(hook.current.entries.find(item => item.id === 'one').extension, 'json');
  assert.equal(hook.current.entries.at(-1).extension, 'gz');
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saves[0].changes.updated[0].extension, 'json');
  assert.equal(saves[0].changes.deleted[0].extension, 'csv');
  assert.equal(saves[0].changes.created[0].extension, 'gz');
  assert.equal(saves[0].changes.created[0].source.file, file);
  assert.deepEqual(hook.current.entries.map(item => item.extension), ['pdf', '', 'gz']);
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Temporary.XML' }); });
  assert.equal(hook.current.entries[0].extension, 'xml');
  await act(async () => { hook.current.discard(); });
  assert.equal(hook.current.entries[0].name, 'Canonical.PDF'); assert.equal(hook.current.entries[0].extension, 'pdf');
  assert.equal(hook.current.entries.at(-1).source.file, file); assert.equal(hook.current.dirty, false);
});

test('local edits and uploads remain local, while net no-ops do not invoke saving', async t => {
  const saveCalls = [];
  const dirtyChanges = [];
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: payload => { saveCalls.push(payload); },
    onDirtyChange: dirty => { dirtyChanges.push(dirty); },
  });
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saveCalls.length, 0);
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'changed.txt' }); });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'one.txt' }); });
  assert.equal(hook.current.dirty, false);
  await act(async () => { assert.equal(await hook.current.save(), true); });
  await act(async () => {
    hook.current.apply({ action: 'move', ids: ['one'], parent: 'folder' });
    hook.current.apply({ action: 'favorite', ids: ['one'] });
    hook.current.apply({ action: 'copy', ids: ['one'], parent: 'root' });
  });
  const file = new File(['staged content'], 'new.txt', { type: 'text/plain' });
  await act(async () => { hook.current.add([file], 'folder'); });
  assert.equal(hook.current.entries.find(item => item.name === 'new.txt').source.file, file);
  assert.equal(hook.current.entries.find(item => item.id === 'one').parent, 'folder');
  assert.equal(hook.current.entries.find(item => item.id === 'one').favorite, 1);
  assert.equal(hook.current.dirty, true);
  assert.equal(saveCalls.length, 0);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(dirtyChanges, [false, true, false, true]);
  await act(async () => { hook.current.discard(); });
  assert.deepEqual(hook.current.entries, initialEntries());
  assert.equal(hook.current.dirty, false);
});

test('move-only edits preserve file and folder dates while onSave receives parent changes and ignores round trips', async t => {
  const file = new File(['local content'], 'local.txt', { type: 'text/plain' });
  const baseline = [...initialEntries(), entry('target', 'root', 'Target', 'folder'),
    entry('nested', 'folder', 'Nested', 'folder'), entry('child', 'nested', 'child.txt'),
    { ...entry('local', 'nested', 'local.txt'), source: { kind: 'local', file } }];
  const saves = [];
  const hook = await mountHook(t, { initialEntries: baseline, onSave: payload => { saves.push(payload); } });
  const move = parent => hook.current.apply({ action: 'move', ids: ['one', 'folder'], parent });
  await act(async () => { move('target'); });
  assert.equal(hook.current.dirty, true); assert.equal(saves.length, 0);
  for (const before of baseline) {
    assert.deepEqual(hook.current.entries.find(item => item.id === before.id), {
      ...before, parent: ['one', 'folder'].includes(before.id) ? 'target' : before.parent,
    });
  }
  await act(async () => { move('root'); });
  assert.equal(hook.current.dirty, false); assert.deepEqual(hook.current.entries, baseline);
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saves.length, 0);
  await act(async () => { move('target'); });
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saves.length, 1); assert.equal(hook.current.dirty, false);
  assert.deepEqual(saves[0].changes.updated.map(item => item.id), ['one', 'folder']);
  assert.deepEqual(saves[0].changes.created, []); assert.deepEqual(saves[0].changes.deleted, []);
  for (const changed of saves[0].changes.updated) {
    assert.equal(changed.parent, 'target');
    assert.equal(changed.updatedAt, baseline.find(item => item.id === changed.id).updatedAt);
  }
  assert.equal(saves[0].entries.find(item => item.id === 'local').source.file, file);
  assert.equal(hook.current.entries.find(item => item.id === 'local').source.file, file);
});

test('a rejected save keeps the draft and a successful retry establishes a clean baseline', async t => {
  let attempts = 0;
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: async () => {
      if (++attempts === 1) throw new Error('Host save failed');
    },
  });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'changed.txt' }); });
  await act(async () => { assert.equal(await hook.current.save(), false); });
  assert.equal(hook.current.entries[0].name, 'changed.txt');
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.saving, false);
  assert.equal(hook.current.saveError, 'Host save failed');
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(attempts, 2);
  assert.equal(hook.current.entries[0].name, 'changed.txt');
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.saveError, null);
});

test('saving synchronously blocks duplicate saves and edits until the captured save resolves', async t => {
  const pending = deferred();
  let calls = 0;
  let firstSave;
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: () => { calls++; return pending.promise; },
  });
  await act(async () => { hook.current.apply({ action: 'delete', ids: ['one'] }); });
  await act(async () => {
    firstSave = hook.current.save();
    assert.equal(await hook.current.save(), false);
    assert.throws(() => hook.current.apply({ action: 'create', name: 'Blocked' }), /保存/);
    assert.throws(() => hook.current.add([new File(['x'], 'blocked.txt')], 'root'), /保存/);
    assert.throws(() => hook.current.discard(), /保存/);
  });
  assert.equal(calls, 1);
  assert.equal(hook.current.saving, true);
  assert.equal(hook.current.dirty, true);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['folder']);
  await act(async () => { pending.resolve(); assert.equal(await firstSave, true); });
  assert.equal(hook.current.saving, false);
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.apply({ action: 'create', name: 'Allowed' }); });
  assert.equal(hook.current.dirty, true);
});

test('normalized host entries replace local content references and become the discard baseline', async t => {
  let returned;
  const hook = await mountHook(t, {
    initialEntries: [],
    onSave: payload => {
      returned = payload.entries.map(item => ({ ...item, source: { kind: 'existing', id: 'stored-version-2' } }));
      return returned;
    },
  });
  const file = new File(['new'], 'new.txt');
  await act(async () => { hook.current.add([file], 'root'); });
  const id = hook.current.entries[0].id;
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'stored-version-2' });
  assert.equal(hook.current.dirty, false);
  returned[0].name = 'external mutation.txt';
  returned[0].source.id = 'external mutation';
  await act(async () => { hook.current.apply({ action: 'rename', ids: [id], name: 'next.txt' }); });
  await act(async () => { hook.current.discard(); });
  assert.equal(hook.current.entries[0].name, 'new.txt');
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'stored-version-2' });
  assert.equal(hook.current.dirty, false);
});

test('mutating a save payload cannot rewrite the captured draft or the saved baseline', async t => {
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: payload => {
      payload.entries[0].name = 'host mutation.txt';
      payload.entries[0].source.id = 'host mutation';
      payload.changes.updated[0].name = 'other mutation.txt';
      payload.changes.updated[0].source.id = 'other mutation';
      payload.entries.length = 0;
    },
  });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'saved.txt' }); });
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(hook.current.entries.length, 2);
  assert.equal(hook.current.entries[0].name, 'saved.txt');
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'opaque:one' });
  await act(async () => { hook.current.apply({ action: 'delete', ids: ['one'] }); });
  await act(async () => { hook.current.discard(); });
  assert.equal(hook.current.entries[0].name, 'saved.txt');
  assert.equal(hook.current.dirty, false);
});

test('a pending save cannot rerender or notify the host after unmount', async t => {
  const pending = deferred();
  const dirtyChanges = [];
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: () => pending.promise,
    onDirtyChange: dirty => { dirtyChanges.push(dirty); },
  });
  await act(async () => { hook.current.apply({ action: 'delete', ids: ['one'] }); });
  let saved;
  await act(async () => { saved = hook.current.save(); });
  await hook.unmount();
  const renders = hook.renders;
  await act(async () => { pending.resolve(); await saved; });
  assert.equal(hook.renders, renders);
  assert.deepEqual(dirtyChanges, [false, true]);
  assert.equal(await hook.current.save(), false);
});

test('change events describe each successful command against its immediate previous draft', async t => {
  const events = [];
  let saves = 0;
  const hook = await mountHook(t, {
    initialEntries: [...initialEntries(), entry('nested', 'folder', 'nested.txt')],
    onSave: () => { saves++; },
    onEvent: event => { if (event.type !== 'edit-mode') events.push(event); },
  });
  assert.deepEqual(events, [], 'mount does not report an edit');
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Revised.TXT' }); });
  assert.deepEqual(events[0].changes, {
    created: [], deleted: [],
    updated: [{ ...hook.current.entries[0], path: '/Revised.TXT', extension: 'txt' }],
  });
  assert.equal(events[0].type, 'change');
  assert.equal(events[0].action, 'rename');
  assert.equal(events[0].entries.length, 3);
  assert.notEqual(events[0].entries[0], hook.current.entries[0]);
  assert.notEqual(events[0].entries[0].source, hook.current.entries[0].source);
  assert.notEqual(events[0].changes.updated[0].source, events[0].entries[0].source);

  await act(async () => { hook.current.apply({ action: 'move', ids: ['one'], parent: 'folder' }); });
  assert.equal(events[1].action, 'move');
  assert.deepEqual(events[1].changes.updated.map(item => [item.id, item.path]), [['one', '/Folder/Revised.TXT']]);
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['folder'], name: '記事' }); });
  assert.deepEqual(events[2].changes.updated.map(item => item.id), ['folder']);
  assert.equal(events[2].entries.find(item => item.id === 'nested').path, '/記事/nested.txt');
  assert.equal(events[2].changes.updated[0].extension, '', 'folders never have file extensions');
  await act(async () => { hook.current.apply({ action: 'create', name: 'New folder' }); });
  assert.equal(events[3].action, 'create');
  assert.deepEqual(events[3].changes.updated, [], 'an earlier rename is not repeated in later changes');
  assert.deepEqual(events[3].changes.created.map(item => item.path), ['/New folder']);
  await act(async () => { hook.current.apply({ action: 'copy', ids: ['one'], parent: 'root' }); });
  const copy = events[4].changes.created[0];
  assert.equal(events[4].action, 'copy');
  assert.notEqual(copy.id, 'one');
  assert.equal(copy.path, '/Revised.TXT');
  assert.deepEqual(copy.source, { kind: 'existing', id: 'opaque:one' });
  await act(async () => { hook.current.apply({ action: 'favorite', ids: [copy.id] }); });
  assert.equal(events[5].action, 'favorite');
  assert.equal(events[5].changes.updated[0].favorite, 1);
  await act(async () => { hook.current.apply({ action: 'delete', ids: ['folder'] }); });
  assert.equal(events[6].action, 'delete');
  assert.deepEqual(events[6].changes.deleted.map(item => item.path).sort(), [
    '/記事', '/記事/Revised.TXT', '/記事/nested.txt',
  ]);
  assert.deepEqual(events[6].changes.created, []);
  assert.deepEqual(events[6].changes.updated, []);
  assert.deepEqual(events[6].entries.map(item => item.id), hook.current.entries.map(item => item.id));
  assert.equal(saves, 0, 'change events do not save');
});

test('upload events include created folders and retain the local File in isolated descriptions', async t => {
  const events = [];
  const hook = await mountHook(t, {
    initialEntries: [], onSave: () => {}, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); },
  });
  const file = new File(['a,b'], 'data.CSV', { type: 'text/csv' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'Batch/sub/data.CSV' });
  await act(async () => { hook.current.add([file], 'root'); });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'change');
  assert.equal(events[0].action, 'upload');
  assert.deepEqual(events[0].changes.created.map(item => item.path), [
    '/Batch', '/Batch/sub', '/Batch/sub/data.CSV',
  ]);
  assert.deepEqual(events[0].changes.updated, []);
  assert.deepEqual(events[0].changes.deleted, []);
  const uploaded = events[0].changes.created.find(item => item.kind === 'file');
  assert.equal(uploaded.extension, 'csv');
  assert.equal(uploaded.source.file, file);
  assert.notEqual(uploaded.source, hook.current.entries.find(item => item.id === uploaded.id).source);
});

test('upload conflicts and explicit skips need no edit permission and leave the draft and save callback untouched', async t => {
  let permissionRequests = 0, saves = 0;
  const events = [];
  const hook = await mountHook(t, { initialEntries: initialEntries(), onSave() { saves++; },
    onEditRequest() { permissionRequests++; return false; }, onEvent: event => events.push(event) });
  const before = hook.current.entries, file = new File(['replacement'], 'ONE.TXT');
  let conflict, prepared, result;
  await act(async () => { conflict = uploadConflict(() => hook.current.prepareAdd([file], 'root')); });
  assert.equal(conflict.conflict.existing.id, 'one'); assert.equal(conflict.conflict.file, file);
  assert.equal(hook.current.entries, before); assert.equal(hook.current.editMode, 'view');
  await act(async () => { prepared = hook.current.prepareAdd([file], 'root', [uploadDecision(conflict, 'skip')], conflict.session); });
  assert.equal(prepared.result.skippedCount, 1); assert.equal(prepared.result.overwrittenCount, 0);
  await act(async () => { result = prepared.commit(); });
  assert.equal(result.skippedCount, 1); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.editMode, 'view'); assert.equal(permissionRequests, 0);
  assert.equal(events.filter(event => event.type === 'change' || event.type === 'edit-mode').length, 0);
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saves, 0);
});

test('an approved overwrite requests permission only before mutation and saves a same-ID update followed by host canonical content', async t => {
  const baseline = initialEntries(), events = [], requests = [], saves = [];
  const incoming = new File(['new content body'], 'ONE.TXT', { type: 'text/custom' });
  const reads = t.mock.method(incoming, 'arrayBuffer', () => { throw Error('Upload staging must not read or hash content'); });
  const hook = await mountHook(t, { initialEntries: baseline,
    onEditRequest(request) { requests.push(request); return true; }, onEvent: event => events.push(event),
    onSave(payload) {
      saves.push(payload);
      return payload.entries.map(item => item.id === 'one' ? { ...item, source: { kind: 'existing', id: 'stored-v2' } } : item);
    } });
  let conflict, prepared;
  await act(async () => { conflict = uploadConflict(() => hook.current.prepareAdd([incoming], 'root')); });
  await act(async () => { prepared = hook.current.prepareAdd([incoming], 'root', [uploadDecision(conflict)], conflict.session); });
  assert.deepEqual(prepared.result, { attemptedCount: 1, addedCount: 0, overwrittenCount: 1, skippedCount: 0, rejections: [] });
  assert.equal(hook.current.dirty, false); assert.equal(requests.length, 0);
  await act(async () => { assert.throws(() => prepared.commit(), /編集を開始/); });
  await act(async () => { assert.equal(hook.current.requestEdit({ action: 'upload', parent: 'root' }), true); });
  await act(async () => { assert.equal(prepared.commit().overwrittenCount, 1); assert.equal(prepared.commit(), undefined); });
  assert.equal(requests.length, 1); assert.equal(hook.current.dirty, true); assert.equal(saves.length, 0);
  assert.deepEqual(hook.current.entries[0], { ...baseline[0], size: incoming.size, mime: incoming.type, source: { kind: 'local', file: incoming } });
  const changes = events.filter(event => event.type === 'change');
  assert.equal(changes.length, 1); assert.equal(changes[0].action, 'upload');
  assert.deepEqual(changes[0].changes.updated.map(item => item.id), ['one']); assert.deepEqual(changes[0].changes.created, []);
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(saves.length, 1); assert.deepEqual(saves[0].changes.updated.map(item => item.id), ['one']);
  assert.equal(saves[0].changes.updated[0].source.file, incoming); assert.equal(saves[0].changes.updated[0].updatedAt, baseline[0].updatedAt);
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'stored-v2' }); assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.requestEdit({ action: 'delete', ids: ['one'] }); hook.current.apply({ action: 'delete', ids: ['one'] }); hook.current.discard(); });
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'stored-v2' }); assert.equal(reads.mock.callCount(), 0);
});

test('fresh entries supplied by permission approval invalidate a previously approved overwrite', async t => {
  const baseline = initialEntries();
  const fresh = baseline.map(item => item.id === 'one' ? { ...item, updatedAt: '2026-09-07T00:00:00.000Z', source: { kind: 'existing', id: 'fresh-version' } } : item);
  let requests = 0;
  const events = [], file = new File(['replacement'], 'one.txt');
  const hook = await mountHook(t, { initialEntries: baseline, onSave() {}, onEvent: event => events.push(event),
    onEditRequest() { requests++; return { allowed: true, entries: fresh }; } });
  let first, prepared, renewed;
  await act(async () => { first = uploadConflict(() => hook.current.prepareAdd([file], 'root')); });
  await act(async () => { prepared = hook.current.prepareAdd([file], 'root', [uploadDecision(first)], first.session); });
  await act(async () => { hook.current.requestEdit({ action: 'upload', parent: 'root' }); });
  await act(async () => { renewed = uploadConflict(() => prepared.commit()); });
  assert.deepEqual(renewed.conflict.existing, fresh[0]); assert.equal(renewed.conflict.file, file);
  assert.deepEqual(hook.current.entries, fresh); assert.equal(hook.current.dirty, false);
  assert.equal(events.filter(event => event.type === 'change').length, 0);
  await act(async () => { hook.current.add([file], 'root', [uploadDecision(renewed)], renewed.session); });
  assert.equal(requests, 1); assert.equal(hook.current.entries[0].source.file, file);
  assert.equal(hook.current.entries[0].updatedAt, fresh[0].updatedAt); assert.equal(hook.current.dirty, true);
});

test('prepared overwrite decisions and File arrays are isolated from caller mutation until permission is granted', async t => {
  const hook = await mountHook(t, { initialEntries: initialEntries(), onSave() {}, onEditRequest: () => true });
  const file = new File(['replacement'], 'ONE.TXT'), files = [file];
  let conflict, prepared;
  await act(async () => { conflict = uploadConflict(() => hook.current.prepareAdd(files, 'root')); });
  const decision = uploadDecision(conflict), decisions = [decision];
  await act(async () => { prepared = hook.current.prepareAdd(files, 'root', decisions, conflict.session); });
  files.length = 0; decisions.length = 0; decision.action = 'skip'; decision.existing.source.id = 'caller-mutated';
  await act(async () => { hook.current.requestEdit({ action: 'upload', parent: 'root' }); });
  await act(async () => { assert.equal(prepared.commit().overwrittenCount, 1); });
  assert.equal(hook.current.entries[0].source.file, file); assert.equal(hook.current.entries[0].id, 'one');
});

test('approving the identical local File is a no-op and never acquires edit permission', async t => {
  const file = new File(['already staged'], 'same.txt', { type: 'text/plain' });
  const baseline = [{ ...entry('one', 'root', 'same.txt'), size: file.size, source: { kind: 'local', file } }];
  let calls = 0;
  const events = [];
  const hook = await mountHook(t, { initialEntries: baseline, onSave() {}, onEvent: event => events.push(event),
    onEditRequest() { calls++; return false; } });
  const before = hook.current.entries;
  let conflict, result;
  await act(async () => { conflict = uploadConflict(() => hook.current.prepareAdd([file], 'root')); });
  await act(async () => { result = hook.current.add([file], 'root', [uploadDecision(conflict)], conflict.session); });
  assert.equal(result.overwrittenCount, 1); assert.equal(result.addedCount, 0);
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false); assert.equal(hook.current.editMode, 'view');
  assert.equal(calls, 0); assert.deepEqual(events, []);
});

test('prepared overwrites still enforce upload limits changed before commit without acquiring permission', async t => {
  const file = new File(['too large'], 'one.txt');
  let requests = 0;
  const hook = await mountHook(t, { initialEntries: initialEntries(), onSave() {}, onEditRequest() { requests++; return true; } });
  let conflict, prepared;
  await act(async () => { conflict = uploadConflict(() => hook.current.prepareAdd([file], 'root')); });
  await act(async () => { prepared = hook.current.prepareAdd([file], 'root', [uploadDecision(conflict)], conflict.session); });
  const before = hook.current.entries;
  await hook.update({ upload: { maxFileSizeBytes: 0 } });
  await act(async () => { assert.throws(() => prepared.commit(), error => error.name === 'ExplorerUploadValidationError'); });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false); assert.equal(requests, 0);
});

test('failed operations and same-value no-ops emit no data changes, while reverting a real edit still emits its change', async t => {
  const events = [];
  const hook = await mountHook(t, {
    initialEntries: initialEntries(), onSave: () => {}, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); },
  });
  await act(async () => {
    hook.current.apply({ action: 'rename', ids: ['one'], name: 'one.txt' });
    hook.current.apply({ action: 'move', ids: ['one'], parent: 'root' });
    hook.current.add([], 'root');
    hook.current.discard();
    assert.equal(await hook.current.save(), true);
    assert.throws(() => hook.current.apply({ action: 'rename', ids: ['one'], name: '' }));
    assert.throws(() => hook.current.apply({ action: 'create', name: 'Folder' }));
    assert.throws(() => hook.current.add([new File(['x'], 'new.txt')], 'missing'));
  });
  assert.deepEqual(events, []);
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'changed.txt' }); });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'one.txt' }); });
  assert.equal(events.length, 2);
  assert.equal(events[1].changes.updated[0].name, 'one.txt');
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.discard(); assert.equal(await hook.current.save(), true); });
  assert.equal(events.length, 2);
});

test('discard notifies only when restoring changes and observer mutations cannot rewrite restored entries', async t => {
  const events = [];
  const hook = await mountHook(t, {
    initialEntries: initialEntries(), onSave: () => {},
    onEvent: event => {
      if (event.type !== 'edit-mode') events.push(event);
      if (event.type === 'discard') {
        Reflect.set(event.entries[0], 'name', 'Observer.txt');
        Reflect.set(event.entries[0].source, 'id', 'observer-source');
      }
    },
  });
  await act(async () => { hook.current.apply({ action: 'move', ids: ['one'], parent: 'folder' }); });
  await act(async () => { hook.current.discard(); });
  assert.deepEqual(events.map(event => event.type), ['change', 'discard']);
  assert.equal(events[1].entries[0].path, '/one.txt');
  assert.deepEqual(hook.current.entries, initialEntries());
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.discard(); });
  assert.equal(events.length, 2);
});

test('observer payloads are separate from save payloads, the draft and the successful baseline', async t => {
  const events = [];
  let savePayload;
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onEvent: event => {
      if (event.type !== 'edit-mode') events.push(event);
      const entries = event.type === 'save' && event.status === 'start' ? event.payload.entries : event.entries;
      if (entries?.length) {
        Reflect.set(entries[0], 'name', 'Observer.txt');
        Reflect.set(entries[0].source, 'id', 'observer-content');
      }
      if (event.type === 'change') {
        Reflect.set(event.changes.updated[0], 'name', 'Observer change.txt');
        Reflect.set(event.changes.updated[0].source, 'id', 'observer-change-content');
      }
      if (event.type === 'save' && event.status === 'start') {
        Reflect.set(event.payload.changes.updated[0], 'name', 'Observer start.txt');
        event.payload.entries.length = 0;
      }
    },
    onSave: payload => {
      savePayload = payload;
      assert.equal(payload.entries[0].name, 'Saved.txt');
      assert.deepEqual(payload.entries[0].source, { kind: 'existing', id: 'opaque:one' });
      assert.equal(payload.changes.updated[0].name, 'Saved.txt');
      payload.entries[0].name = 'Save handler.txt';
      payload.entries[0].source.id = 'save-handler-content';
    },
  });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Saved.txt' }); });
  assert.equal(hook.current.entries[0].name, 'Saved.txt');
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'opaque:one' });
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.deepEqual(events.map(event => [event.type, event.status]), [
    ['change', undefined], ['save', 'start'], ['save', 'success'],
  ]);
  assert.notEqual(events[1].payload, savePayload);
  assert.notEqual(events[1].payload.changes.updated[0], savePayload.changes.updated[0]);
  assert.equal(hook.current.entries[0].name, 'Saved.txt');
  assert.deepEqual(hook.current.entries[0].source, { kind: 'existing', id: 'opaque:one' });
  assert.equal(hook.current.dirty, false);
});

test('save notifications lock reentrant saves before observers and describe normalized success entries', async t => {
  const events = [];
  const nestedSaves = [];
  const pending = deferred();
  let saves = 0;
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onEvent: event => {
      if (event.type !== 'edit-mode') events.push(event);
      if (event.type === 'save') nestedSaves.push(hook.current.save());
    },
    onSave: () => { saves++; return pending.promise; },
  });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Staged.txt' }); });
  let firstSave;
  await act(async () => { firstSave = hook.current.save(); });
  assert.equal(saves, 1);
  assert.equal(await nestedSaves[0], false);
  assert.equal(events[1].payload.entries[0].name, 'Staged.txt');
  const normalized = hook.current.entries.map(item => item.id === 'one'
    ? { ...item, name: 'Stored.TXT', source: { kind: 'existing', id: 'stored-v2' } }
    : item);
  await act(async () => { pending.resolve(normalized); assert.equal(await firstSave, true); });
  assert.equal(saves, 1, 'success observers see a clean baseline and do not persist twice');
  assert.equal(await nestedSaves[1], false, 'session completion blocks synchronous observer re-entry');
  assert.deepEqual(events.map(event => [event.type, event.status]), [
    ['change', undefined], ['save', 'start'], ['save', 'success'],
  ]);
  assert.deepEqual(events[2].entries[0], { ...normalized[0], path: '/Stored.TXT', extension: 'txt' });
  assert.notEqual(events[2].entries[0].source, normalized[0].source);
  assert.equal(hook.current.dirty, false);
});

test('observer exceptions and rejected promises do not undo changes or turn save success into failure', async t => {
  const events = [];
  let failSave = false;
  const hook = await mountHook(t, {
    initialEntries: initialEntries(),
    onSave: () => { if (failSave) throw new Error('Storage failure'); },
    onEvent: event => { if (event.type !== 'edit-mode') events.push(event); throw new Error('Sync observer failure'); },
  });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Saved.txt' }); });
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.saveError, null);
  await hook.update({ onEvent: async event => { if (event.type !== 'edit-mode') events.push(event); throw new Error('Async observer failure'); } });
  await act(async () => { hook.current.apply({ action: 'rename', ids: ['one'], name: 'Retry.txt' }); });
  failSave = true;
  await act(async () => {
    assert.equal(await hook.current.save(), false);
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(hook.current.entries[0].name, 'Retry.txt');
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.saveError, 'Storage failure');
  assert.deepEqual(events.at(-1), { type: 'save', status: 'error', message: 'Storage failure' });
  failSave = false;
  await act(async () => { assert.equal(await hook.current.save(), true); });
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.saveError, null);
  assert.deepEqual(events.filter(event => event.type === 'save').map(event => event.status), [
    'start', 'success', 'start', 'error', 'start', 'success',
  ]);
});

test('live observer changes affect pending save completion and removing the observer stops later notifications', async t => {
  const first = [];
  const second = [];
  const pending = deferred();
  const hook = await mountHook(t, {
    initialEntries: initialEntries(), onSave: () => pending.promise,
    onEvent: event => { if (event.type !== 'edit-mode') first.push(event); },
  });
  await act(async () => { hook.current.apply({ action: 'delete', ids: ['one'] }); });
  let save;
  await act(async () => { save = hook.current.save(); });
  await hook.update({ onEvent: event => { if (event.type !== 'edit-mode') second.push(event); } });
  await act(async () => { pending.resolve(); await save; });
  assert.deepEqual(first.map(event => [event.type, event.status]), [['change', undefined], ['save', 'start']]);
  assert.deepEqual(second.map(event => [event.type, event.status]), [['save', 'success']]);
  await hook.update({ onEvent: undefined });
  await act(async () => { hook.current.apply({ action: 'create', name: 'Later' }); hook.current.discard(); });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
});

test('unmounted hooks suppress change, discard and late save success or failure notifications', async t => {
  for (const reject of [false, true]) {
    await t.test(reject ? 'late save failure' : 'late save success', async t => {
      const events = [];
      const pending = deferred();
      const hook = await mountHook(t, {
        initialEntries: initialEntries(), onSave: () => pending.promise,
        onEvent: event => { if (event.type !== 'edit-mode') events.push(event); },
      });
      await act(async () => { hook.current.apply({ action: 'delete', ids: ['one'] }); });
      let saved;
      await act(async () => { saved = hook.current.save(); });
      await hook.unmount();
      await act(async () => {
        if (reject) pending.reject(new Error('Too late'));
        else pending.resolve();
        assert.equal(await saved, !reject);
        hook.current.apply({ action: 'create', name: 'After unmount' });
        hook.current.add([new File(['x'], 'late.txt')], 'root');
        hook.current.discard();
        assert.equal(await hook.current.save(), false);
      });
      assert.deepEqual(events.map(event => [event.type, event.status]), [
        ['change', undefined], ['save', 'start'],
      ]);
    });
  }
});

test('local file reads use the original File without requesting host content or using fetch', async t => {
  const file = new File(['staged'], 'new.txt');
  let reads = 0;
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const blob = await readEntryFile({ ...entry('new', 'root', file.name), source: { kind: 'local', file } }, async () => { reads++; return new Blob(); });
  assert.equal(blob, file);
  assert.equal(await blob.text(), 'staged');
  assert.equal(reads, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('existing file reads pass the opaque content ID only to the supplied reader', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const calls = [];
  const expected = new Blob(['stored']);
  const file = { ...entry('new-ui-id', 'root', 'renamed.txt'), source: { kind: 'existing', id: 'original/content#v2' } };
  const blob = await readEntryFile(file, async sourceId => { calls.push(sourceId); return expected; });
  assert.equal(blob, expected);
  assert.deepEqual(calls, ['original/content#v2']);
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(readEntryFile(file), /読み込み方法/);
  await assert.rejects(readEntryFile(entry('folder', 'root', 'Folder', 'folder')), /内容/);
});

test('PDF previews normalize generic Blob MIME and release their object URL on unmount', async t => {
  const original = new Blob(['%PDF-1.7\npreview fixture'], { type: 'application/octet-stream' });
  const previewBlobs = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', blob => { previewBlobs.push(blob); return 'blob:test-pdf'; });
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); });
  const file = { ...entry('pdf', 'root', 'report.pdf'), size: original.size, mime: original.type };
  let renderer;
  const unmount = async () => {
    if (!renderer) return;
    await act(async () => { renderer.unmount(); });
    renderer = null;
  };
  t.after(unmount);
  await act(async () => {
    renderer = create(createElement(FilePreview, { entry: file, readFile: async () => original }));
  });
  assert.equal(previewBlobs.length, 1);
  assert.equal(previewBlobs[0].type, 'application/pdf');
  assert.equal(await previewBlobs[0].text(), await original.text());
  assert.equal(original.type, 'application/octet-stream');
  assert.equal(renderer.root.findByType('iframe').props.src, 'blob:test-pdf');
  assert.deepEqual(revoked, []);
  await unmount();
  assert.deepEqual(revoked, ['blob:test-pdf']);
});
