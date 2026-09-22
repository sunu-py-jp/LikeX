import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: {
  contents: `export { useExplorerDraft } from './src/state/use-explorer-draft.ts';`,
  resolveDir: packageRoot, sourcefile: 'entry-permission-draft.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{
  name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  },
}] });
const { useExplorerDraft } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const entry = (id, parent, name, kind = 'file') => ({ id, parent, name, kind,
  extension: kind === 'file' ? name.split('.').at(-1) : '', size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `stored:${id}` } : null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('folder', 'root', 'Folder', 'folder'), entry('child', 'folder', 'child.txt'),
  entry('other', 'root', 'Other', 'folder'), entry('one', 'root', 'one.txt')];
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const denial = (operation, id) => error => error?.name === 'ExplorerOperationDeniedError' && error.operation === operation && error.entryId === id;
async function mount(t, supplied = {}) {
  const events = [], saves = [];
  let latest, renderer;
  let options = { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event), ...supplied };
  function Child({ effect }) { useLayoutEffect(() => { effect?.(); }, [effect]); return null; }
  function Probe({ options, effect }) { latest = useExplorerDraft(options); return createElement(Child, { effect }); }
  await change(() => { renderer = create(createElement(Probe, { options })); });
  t.after(async () => { await change(() => renderer.unmount()); });
  return { get current() { return latest; }, events, saves,
    async update(patch, effect) { options = { ...options, ...patch }; await change(() => renderer.update(createElement(Probe, { options, effect }))); },
  };
}
function conflict(callback) {
  let result;
  try { callback(); } catch (error) { result = error; }
  assert.equal(result?.name, 'ExplorerUploadConflictError');
  return result;
}

test('draft operations reject entry, descendant and destination denial atomically before starting an edit', async t => {
  const cases = [
    ['rename', 'child', { action: 'rename', ids: ['folder'], name: 'Changed' }],
    ['delete', 'child', { action: 'delete', ids: ['folder', 'one'] }],
    ['move', 'child', { action: 'move', ids: ['folder'], parent: 'other' }],
    ['copy', 'child', { action: 'copy', ids: ['folder'], parent: 'other' }],
    ['move', 'other', { action: 'move', ids: ['one'], parent: 'other' }],
    ['copy', 'other', { action: 'copy', ids: ['one'], parent: 'other' }],
    ['favorite', 'one', { action: 'favorite', ids: ['one'] }],
    ['createFile', 'other', { action: 'createFile', parent: 'other', name: 'new.txt' }],
    ['createFolder', 'other', { action: 'create', parent: 'other', name: 'New' }],
    ['createFile', 'other', { action: 'copy', ids: ['one'], parent: 'other' }],
    ['createFolder', 'other', { action: 'copy', ids: ['folder'], parent: 'other' }],
  ];
  for (const [operation, id, action] of cases) await t.test(`${action.action}:${operation}:${id}`, async subtest => {
    const hook = await mount(subtest, { getEntryPermissions: target => target.id === id ? { [operation]: false } : undefined });
    const before = hook.current.entries;
    await change(() => assert.throws(() => hook.current.apply(action), denial(operation, id)));
    assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
    assert.equal(hook.current.editMode, 'view'); assert.deepEqual(hook.events, []);
  });
});

test('retained operations read committed permissions before descendant layout effects and recheck within the same edit session', async t => {
  let locked = false;
  const hook = await mount(t, { getEntryPermissions: target => target.id === 'one' ? { rename: !locked } : undefined });
  await change(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'First.txt' }));
  locked = true;
  await change(() => assert.throws(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'Second.txt' }), denial('rename', 'one')));
  locked = false;
  const staged = hook.current.prepareAction({ action: 'rename', ids: ['one'], name: 'Retained.txt' });
  await hook.update({ getEntryPermissions: target => target.id === 'one' ? { rename: { allowed: false, message: '編集中です' } } : undefined },
    () => assert.throws(() => staged(), /編集中です/));
  assert.equal(hook.current.entries.find(item => item.id === 'one').name, 'First.txt');
  assert.equal(hook.events.filter(event => event.type === 'change').length, 1);
});

test('permission checks after edit grant reject newly locked targets without committing candidates', async t => {
  let locked = false;
  const events = [];
  const hook = await mount(t, { getEntryPermissions: target => target.id === 'one' ? { rename: !locked } : undefined,
    onEvent(event) { events.push(event); if (event.type === 'edit-mode' && event.reason === 'granted') locked = true; } });
  const before = hook.current.entries;
  await change(() => assert.throws(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'Locked.txt' }), denial('rename', 'one')));
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(events.filter(event => event.type === 'change').length, 0);
});

test('a resolver that synchronously edits the draft cannot make an outer candidate overwrite that edit', async t => {
  let hook, mutate = true;
  hook = await mount(t, { getEntryPermissions(target) {
    if (target.id === 'one' && mutate) { mutate = false; hook.current.apply({ action: 'rename', ids: ['child'], name: 'Nested.txt' }); }
  } });
  await change(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'Outer.txt' }));
  assert.equal(hook.current.entries.find(item => item.id === 'one').name, 'Outer.txt');
  assert.equal(hook.current.entries.find(item => item.id === 'child').name, 'Nested.txt');
});

test('a prepared recursive operation checks descendants returned by edit approval before committing', async t => {
  const fresh = [...initialEntries(), entry('new-child', 'folder', 'locked.txt')];
  const hook = await mount(t, { onEditRequest: () => ({ allowed: true, entries: fresh }),
    getEntryPermissions: target => target.id === 'new-child' ? { delete: false } : undefined });
  const prepared = hook.current.prepareAction({ action: 'delete', ids: ['folder'] });
  await change(() => assert.equal(hook.current.requestEdit({ action: 'delete', ids: ['folder'] }), true));
  const before = hook.current.entries;
  await change(() => assert.throws(() => prepared(), denial('delete', 'new-child')));
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.events.filter(event => event.type === 'change').length, 0);
});

test('upload checks existing merge folders and nearest existing destinations for newly created paths', async t => {
  for (const operation of ['upload', 'createFile', 'createFolder']) await t.test(operation, async subtest => {
    const hook = await mount(subtest, { getEntryPermissions: target => target.id === 'folder' ? { [operation]: false } : undefined });
    const file = new File(['contents'], 'new.txt');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Folder/New/deep/new.txt' });
    const before = hook.current.entries;
    await change(() => assert.throws(() => hook.current.add([new File(['allowed'], 'allowed.txt'), file], 'root'), denial(operation, 'folder')));
    assert.equal(hook.current.entries, before); assert.deepEqual(hook.events, []);
  });
});

test('prepared uploads recheck overwrite permission at commit, including overwrites with identical File content', async t => {
  let locked = false;
  const file = new File(['same'], 'one.txt', { type: 'text/plain' });
  const baseline = initialEntries().map(item => item.id === 'one' ? { ...item, source: { kind: 'local', file } } : item);
  const hook = await mount(t, { initialEntries: baseline, getEntryPermissions: target => target.id === 'one' ? { overwrite: !locked } : undefined });
  const collision = conflict(() => hook.current.prepareAdd([file], 'root'));
  const answers = [{ fileIndex: 0, action: 'overwrite', existing: collision.conflict.existing }];
  const prepared = hook.current.prepareAdd([file], 'root', answers, collision.session);
  assert.equal(prepared.changed, false); assert.equal(prepared.result.overwrittenCount, 1);
  locked = true;
  await change(() => assert.throws(() => prepared.commit(), denial('overwrite', 'one')));
  assert.equal(hook.current.dirty, false); assert.deepEqual(hook.events, []);
  const added = new File(['new'], 'added.txt');
  await change(() => assert.throws(() => hook.current.add([file, added], 'root', answers), denial('overwrite', 'one')));
  assert.equal(hook.current.entries.length, baseline.length);
});

test('asynchronous upload inspection rechecks the latest policy before publishing any files', async t => {
  const started = deferred(), metadata = deferred();
  let locked = false;
  const hook = await mount(t, { getEntryPermissions: target => target.id === 'folder' ? { upload: !locked } : undefined,
    upload: { inspectFile() { started.resolve(); return metadata.promise; } } });
  const before = hook.current.entries;
  const pending = hook.current.addAsync([new File(['video'], 'video.mp4', { type: 'video/mp4' })], 'folder');
  const rejected = assert.rejects(pending, denial('upload', 'folder'));
  await started.promise;
  locked = true;
  await change(async () => { metadata.resolve({ kind: 'video', durationSeconds: 1 }); await rejected; });
  assert.equal(hook.current.entries, before); assert.deepEqual(hook.events, []);
});

test('an accepted identical overwrite cannot hide behind another rejected input with the same File reference', async t => {
  const file = new File(['same'], 'one.txt', { type: 'text/plain' });
  const baseline = initialEntries().map(item => item.id === 'one' ? { ...item, source: { kind: 'local', file } } : item);
  const hook = await mount(t, { initialEntries: baseline,
    upload: { maxFilesPerUpload: 2, invalidFileBehavior: 'skip' },
    getEntryPermissions: target => target.id === 'one' ? { overwrite: false } : undefined });
  const before = hook.current.entries;
  const existing = before.find(item => item.id === 'one');
  const answers = [1, 2].map(fileIndex => ({ fileIndex, action: 'overwrite', existing }));
  await change(() => assert.throws(() => hook.current.add([new File(['new'], 'new.txt'), file, file], 'root', answers), denial('overwrite', 'one')));
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false); assert.deepEqual(hook.events, []);
});

test('quota-rejected identical overwrites do not prohibit an otherwise permitted skip batch', async t => {
  const file = new File(['same'], 'one.txt', { type: 'text/plain' });
  const baseline = initialEntries().map(item => item.id === 'one' ? { ...item, source: { kind: 'local', file } } : item);
  const hook = await mount(t, { initialEntries: baseline,
    upload: { maxFilesPerUpload: 1, invalidFileBehavior: 'skip' },
    getEntryPermissions: target => target.id === 'one' ? { overwrite: false } : undefined });
  const existing = hook.current.entries.find(item => item.id === 'one');
  let result;
  await change(() => { result = hook.current.add([new File(['new'], 'new.txt'), file], 'root', [{ fileIndex: 1, action: 'overwrite', existing }]); });
  assert.equal(result.addedCount, 1); assert.equal(result.overwrittenCount, 0); assert.equal(result.rejections.length, 1);
  assert.equal(hook.current.entries.find(item => item.id === 'one').source.file, file);
  assert.equal(hook.current.entries.at(-1).name, 'new.txt');
});

test('save rechecks pending changes and save permission, retains the draft on denial, and permits discard and refresh', async t => {
  for (const operation of ['rename', 'save']) await t.test(operation, async subtest => {
    let locked = false;
    const hook = await mount(subtest, { getEntryPermissions: target => target.id === 'one' && locked ? { [operation]: { allowed: false, message: '保存ロック' } } : undefined,
      onRefresh: () => initialEntries() });
    await change(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'Pending.txt' }));
    const before = hook.current.entries;
    locked = true;
    await change(async () => assert.equal(await hook.current.save(), false));
    assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true); assert.equal(hook.current.saveError, '保存ロック');
    assert.equal(hook.current.saving, false); assert.deepEqual(hook.saves, []);
    assert.deepEqual(hook.events.filter(event => event.type === 'save').map(event => event.status), ['start', 'error']);
    await change(() => hook.current.discard());
    assert.equal(hook.current.dirty, false);
    await change(async () => assert.equal(await hook.current.refresh(), true));
  });
});

test('save permission applies to deleted and newly created entries and is checked after the start observer', async t => {
  for (const action of [{ action: 'delete', ids: ['one'] }, { action: 'createFile', name: 'new.txt', parent: 'folder' }]) await t.test(action.action, async subtest => {
    let locked = false;
    const hook = await mount(subtest, { getEntryPermissions: target => locked && (target.id === 'one' || target.id === 'folder') ? { save: false } : undefined,
      onEvent(event) { if (event.type === 'save' && event.status === 'start') locked = true; } });
    await change(() => hook.current.apply(action));
    const before = hook.current.entries;
    await change(async () => assert.equal(await hook.current.save(), false));
    assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true); assert.deepEqual(hook.saves, []);
  });
});

test('unsupported asynchronous permission resolvers fail closed while true no-ops retain their synchronous behavior', async t => {
  const hook = await mount(t, { getEntryPermissions: async () => ({ rename: true }) });
  await change(() => {
    assert.equal(hook.current.apply({ action: 'rename', ids: ['one'], name: 'one.txt' }), undefined);
    assert.throws(() => hook.current.apply({ action: 'rename', ids: ['one'], name: 'Changed.txt' }), denial('rename', 'one'));
  });
  assert.equal(hook.current.dirty, false); assert.deepEqual(hook.events, []);
});
