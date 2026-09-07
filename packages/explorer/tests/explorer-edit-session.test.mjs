import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
`, resolveDir: packageRoot, sourcefile: 'explorer-edit-session-contract.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-instance', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerDraft, useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-edit-session-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.split('.').at(-1).toLowerCase() : '',
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('folder', '資料', 'root', 'folder'), entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt')];
const renameIntent = { action: 'rename', ids: ['alpha'], windowId: 'main' };
const renameAction = { action: 'rename', ids: ['alpha'], name: 'Changed.txt' };
const addedFile = () => new File(['local'], 'Local.txt', { type: 'text/plain' });
const editEvents = hook => hook.events.filter(event => event.type === 'edit-mode');
const changes = hook => hook.events.filter(event => event.type === 'change');

function fakeDocument() {
  const listeners = new Map(), writes = [];
  const document = { listeners, writes, querySelectorAll: () => [], getElementById: () => null,
    defaultView: { navigator: { clipboard: { writeText: async text => { writes.push(text); } } }, addEventListener() {}, removeEventListener() {} },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  return document;
}

async function mount(t, supplied = {}, kind = 'draft') {
  const events = [], saves = [], dirty = [], documents = new Map(['main', 'child', 'grandchild'].map(id => [id, fakeDocument()]));
  let latest, renderer, closed = false, childVisible = true;
  let props = { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event), onDirtyChange: value => dirty.push(value), ...supplied };
  const panes = new Map();
  function Draft({ options }) { latest = useExplorerDraft(options); return null; }
  function Pane({ options, workspace, windowId }) {
    panes.set(windowId, useExplorerViewController(options, workspace, windowId, documents.get(windowId)));
    return null;
  }
  function Views({ options }) {
    const workspace = useExplorerWorkspace(options);
    latest = workspace;
    useLayoutEffect(() => {
      for (const id of ['child', 'grandchild']) { const view = workspace.tabs.forWindow(id); if (!view.tabs.length) view.addTab(); }
    }, [workspace.tabs]);
    return ['main', ...(childVisible ? ['child', 'grandchild'] : [])].map(windowId => h(Pane, { key: windowId, options, workspace, windowId }));
  }
  const tree = () => h(StrictMode, null, h(kind === 'draft' ? Draft : Views, { options: props }));
  await change(() => { renderer = create(tree()); });
  events.length = 0; dirty.length = 0;
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return kind === 'draft' ? latest : latest.draft; }, get workspace() { return latest; },
    get main() { return panes.get('main'); }, get child() { return panes.get('child'); }, get grandchild() { return panes.get('grandchild'); },
    events, saves, dirty, documents, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async removeChildren() { childVisible = false; await change(() => renderer.update(tree())); },
    async showChildren() { childVisible = true; await change(() => renderer.update(tree())); },
    async begin(callback = () => latest.requestEdit(renameIntent)) { let result; await change(() => { result = callback(); }); return { result }; },
  };
}

async function settlesSoon(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Cancelled edit request stayed pending')), 150); })]); }
  finally { clearTimeout(timer); }
}

test('mount starts in view mode without acquiring permission and default editing remains synchronous', async t => {
  const hook = await mount(t);
  assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.editError, null); assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.events, []);
  const before = hook.current.entries;
  await change(() => { assert.equal(hook.current.requestEdit(renameIntent), true); });
  assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.deepEqual(editEvents(hook).map(event => event.mode), ['edit']);
  await change(() => hook.current.endEdit());
  assert.equal(hook.current.editMode, 'view');
  await change(() => hook.current.apply(renameAction));
  assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.dirty, true);
  await change(() => hook.current.discard());
  assert.equal(hook.current.editMode, 'view');
  await change(() => hook.current.add([addedFile()], 'root'));
  assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.dirty, true); assert.deepEqual(hook.saves, []);
});

test('a configured permission callback protects raw mutations and receives a copied request without changing the draft', async t => {
  const calls = [];
  const hook = await mount(t, { onEditRequest(request, context) { calls.push({ request, context }); return true; } });
  const before = hook.current.entries;
  await change(() => {
    assert.throws(() => hook.current.apply(renameAction), /編集を開始してから変更してください/);
    assert.throws(() => hook.current.add([addedFile()], 'root'), /編集を開始してから変更してください/);
  });
  assert.equal(calls.length, 0); assert.equal(hook.current.entries, before);
  await change(() => assert.equal(hook.current.requestEdit({ action: 'move', ids: ['alpha'], parent: 'folder', windowId: 'child' }), true));
  assert.equal(calls.length, 1);
  const { request, context } = calls[0];
  assert.equal(request.action, 'move'); assert.deepEqual(request.ids, ['alpha']); assert.equal(request.windowId, 'child');
  assert.equal(request.items[0].id, 'alpha'); assert.equal(request.items[0].path, '/Alpha.txt');
  assert.equal(request.destinationId, 'folder'); assert.equal(request.destinationPath, '/資料'); assert.equal(request.destination.id, 'folder');
  assert.equal(typeof context.requestId, 'string'); assert.equal(context.signal.aborted, false);
  assert.notEqual(request.items[0], before[1]); assert.notEqual(request.items[0].source, before[1].source);
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  await change(() => hook.current.apply(renameAction));
  assert.equal(calls.length, 1); assert.equal(hook.current.dirty, true);
  await change(() => assert.throws(() => hook.current.endEdit(), /未保存の変更を保存または破棄してください/));
  assert.equal(context.signal.aborted, false); assert.equal(hook.current.editMode, 'edit');
});

test('read-only policy takes priority over permission callbacks and never acquires an edit session', async t => {
  for (const options of [{ readOnly: true }, { onSave: undefined }, { readOnly: false, onSave: undefined }]) await t.test(JSON.stringify(options), async subtest => {
    let calls = 0;
    const hook = await mount(subtest, { ...options, onEditRequest() { calls++; return true; } });
    const result = await hook.begin(); assert.equal(await result.result, false);
    assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view');
    await change(() => assert.throws(() => hook.current.apply(renameAction), /読み取り専用/));
    assert.equal(changes(hook).length, 0); assert.deepEqual(hook.saves, []);
  });
});

test('permission denial and callback failures retain the draft and allow a later retry', async t => {
  const handlers = [() => false, async () => false, () => { throw Error('Lock denied'); }, async () => { throw Error('Lock unavailable'); }];
  for (const [index, onEditRequest] of handlers.entries()) await t.test(String(index), async subtest => {
    const hook = await mount(subtest, { onEditRequest });
    const before = hook.current.entries;
    const first = await hook.begin(); await change(async () => assert.equal(await first.result, false));
    assert.equal(hook.current.entries, before); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
    assert.equal(changes(hook).length, 0); assert.deepEqual(hook.saves, []);
    await hook.update({ onEditRequest: () => ({ allowed: true }) });
    const retry = await hook.begin(); assert.equal(await retry.result, true); assert.equal(hook.current.editMode, 'edit');
  });
});

test('an in-flight request is shared across panes and rejects duplicate work instead of queuing it', async t => {
  const pending = deferred(), calls = [];
  const hook = await mount(t, { onEditRequest(request, context) { calls.push({ request, context }); return pending.promise; } }, 'views');
  const first = await hook.begin(() => hook.current.requestEdit({ ...renameIntent, windowId: 'grandchild' }));
  assert.equal(hook.current.editMode, 'requesting');
  const second = await hook.begin(() => hook.current.requestEdit({ action: 'upload', parent: 'root', windowId: 'main' }));
  assert.equal(await second.result, false); assert.equal(calls.length, 1);
  assert.equal(hook.main.editMode, 'requesting'); assert.equal(hook.child.editMode, 'requesting'); assert.equal(hook.grandchild.editMode, 'requesting');
  await change(async () => { pending.resolve(true); assert.equal(await first.result, true); });
  assert.equal(hook.current.editMode, 'edit'); assert.equal(calls.length, 1); assert.equal(hook.current.dirty, false);
  await change(() => hook.current.apply(renameAction));
  assert.equal(hook.main.entries, hook.grandchild.entries); assert.equal(hook.child.entries.find(item => item.id === 'alpha').name, 'Changed.txt');
});

test('permission may refresh the clean baseline before applying the intended local operation', async t => {
  const refreshed = [entry('folder', '最新資料', 'root', 'folder'), entry('alpha', 'Server.txt'), entry('server-added', 'Server only.txt')];
  const hook = await mount(t, { onEditRequest: () => ({ allowed: true, entries: refreshed }) });
  const start = await hook.begin(); assert.equal(await start.result, true);
  assert.deepEqual(hook.current.entries, refreshed); assert.notEqual(hook.current.entries, refreshed);
  assert.equal(hook.current.dirty, false); assert.equal(changes(hook).length, 0);
  refreshed[1].name = 'Mutated host object';
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Server.txt');
  await change(() => hook.current.apply(renameAction));
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(hook.saves.length, 1); assert.equal(hook.saves[0].changes.created.length, 0); assert.equal(hook.saves[0].changes.deleted.length, 0);
  assert.deepEqual(hook.saves[0].changes.updated.map(item => item.id), ['alpha']);
  assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
});

test('invalid refreshed entries fail atomically and malformed permission results never authorize editing', async t => {
  for (const result of [{ allowed: true, entries: [entry('alpha', 'A'), entry('alpha', 'Duplicate')] }, undefined, { allowed: false }, { allowed: 'yes' }]) {
    await t.test(JSON.stringify(result), async subtest => {
      const hook = await mount(subtest, { onEditRequest: () => result });
      const before = hook.current.entries;
      const start = await hook.begin(); await change(async () => assert.equal(await start.result, false));
      assert.equal(hook.current.entries, before); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
      assert.equal(changes(hook).length, 0);
    });
  }
});

test('successful save and discard end granted sessions, while a failed save retains permission and dirty state', async t => {
  const calls = [], contexts = [];
  let fail = true;
  const hook = await mount(t, { onEditRequest(request, context) { contexts.push(context); return true; }, onSave(payload) { calls.push(payload); if (fail) throw Error('Save failed'); } });
  await hook.begin(); await change(() => hook.current.apply(renameAction));
  await change(async () => assert.equal(await hook.current.save(), false));
  assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.dirty, true); assert.equal(hook.current.saveError, 'Save failed');
  assert.equal(contexts[0].signal.aborted, false);
  fail = false;
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(contexts[0].signal.aborted, true); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  await hook.begin(); await change(() => hook.current.add([addedFile()], 'root'));
  await change(() => hook.current.discard());
  assert.equal(contexts[1].signal.aborted, true); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Changed.txt'); assert.equal(calls.length, 2);
});

test('a session with no net changes remains active until save or explicit endEdit, without a persistence call', async t => {
  const contexts = [];
  const hook = await mount(t, { onEditRequest(request, context) { contexts.push(context); return true; } });
  await hook.begin(); assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.dirty, false);
  await change(() => hook.current.apply(renameAction));
  await change(() => hook.current.apply({ ...renameAction, name: 'Alpha.txt' }));
  assert.equal(hook.current.dirty, false); assert.equal(hook.current.editMode, 'edit'); assert.equal(contexts[0].signal.aborted, false);
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(hook.current.editMode, 'view'); assert.equal(contexts[0].signal.aborted, true); assert.deepEqual(hook.saves, []);
  await hook.begin(); await change(() => hook.current.endEdit());
  assert.equal(hook.current.editMode, 'view'); assert.equal(contexts[1].signal.aborted, true); assert.deepEqual(hook.saves, []);
});

test('pending permission is cancelled promptly by endEdit, discard, read-only, save-handler removal or unmount and late grants are ignored', async t => {
  for (const reason of ['end', 'discard', 'readOnly', 'noSave', 'unmount']) await t.test(reason, async subtest => {
    const pending = deferred(); let context;
    const hook = await mount(subtest, { onEditRequest(request, value) { context = value; return pending.promise; } });
    const before = hook.current.entries;
    const first = await hook.begin();
    if (reason === 'end') await change(() => hook.current.endEdit());
    else if (reason === 'discard') await change(() => hook.current.discard());
    else if (reason === 'readOnly') await hook.update({ readOnly: true });
    else if (reason === 'noSave') await hook.update({ onSave: undefined });
    else await hook.unmount();
    assert.equal(context.signal.aborted, true); assert.equal(await settlesSoon(first.result), false);
    const count = hook.events.length;
    await change(() => pending.resolve({ allowed: true, entries: [entry('late', 'Late.txt')] }));
    assert.equal(hook.current.entries, before); assert.equal(hook.events.length, count);
    if (reason !== 'unmount') assert.equal(hook.current.editMode, 'view');
  });
});

test('a cancelled request cannot clear or authorize a newer permission request', async t => {
  const calls = [];
  const hook = await mount(t, { onEditRequest(request, context) { const pending = deferred(); calls.push({ context, pending }); return pending.promise; } });
  const first = await hook.begin(); await change(() => hook.current.cancelEditRequest('main'));
  assert.equal(await settlesSoon(first.result), false);
  const retry = await hook.begin(); assert.notEqual(calls[0].context.requestId, calls[1].context.requestId);
  await change(() => calls[0].pending.resolve(true));
  assert.equal(hook.current.editMode, 'requesting');
  const duplicate = await hook.begin(); assert.equal(await duplicate.result, false); assert.equal(calls.length, 2);
  await change(async () => { calls[1].pending.resolve(true); assert.equal(await retry.result, true); });
  assert.equal(hook.current.editMode, 'edit');
});

test('permission observer errors and metadata mutations do not change the request or draft', async t => {
  const requests = [], observed = [];
  const hook = await mount(t, {
    onEvent(event) {
      observed.push(event);
      if (event.type === 'edit-mode' && event.request?.items[0]) {
        event.request.items[0].name = 'Observer changed'; event.request.items[0].source.id = 'observer-source';
      }
      throw Error('Observer failed');
    },
    onEditRequest(request) { requests.push({ name: request.items[0].name, source: request.items[0].source.id }); request.items[0].name = 'Handler changed'; return true; },
  });
  const start = await hook.begin(); assert.equal(await start.result, true);
  assert.deepEqual(requests, [{ name: 'Alpha.txt', source: 'content-alpha' }]);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Alpha.txt'); assert.equal(hook.current.dirty, false);
  assert.ok(observed.some(event => event.type === 'edit-mode' && event.mode === 'edit'));
});

test('permission callback replacement uses the latest committed callback without leaking a suspended render', async t => {
  let renderer, retained, updateVersion;
  const calls = [], attempts = [], never = new Promise(() => {});
  function Child({ version }) { if (version === 2) { attempts.push(version); throw never; } return h('span', { 'data-version': version }); }
  function Parent() {
    const [version, setVersion] = useState(0); updateVersion = setVersion;
    const draft = useExplorerDraft({ initialEntries: initialEntries(), onSave() {}, onEditRequest() { calls.push(version); return true; } });
    retained ??= draft;
    return h(Child, { version });
  }
  await change(() => { renderer = create(h(StrictMode, null, h(Suspense, { fallback: h('i') }, h(Parent)))); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => updateVersion(1));
  await change(() => startTransition(() => updateVersion(2)));
  assert.ok(attempts.length > 0); assert.equal(renderer.root.findByType('span').props['data-version'], 1);
  await change(() => assert.equal(retained.requestEdit(renameIntent), true));
  assert.deepEqual(calls, [1]);
});

test('a granted session is released on read-only while unsaved entries and save errors remain intact', async t => {
  let context;
  const hook = await mount(t, { onEditRequest(request, value) { context = value; return true; }, onSave() { throw Error('Persist failed'); } });
  await hook.begin(); await change(() => hook.current.apply(renameAction));
  await change(() => hook.current.save());
  const before = hook.current.entries;
  await hook.update({ readOnly: true });
  assert.equal(context.signal.aborted, true); assert.equal(hook.current.editMode, 'view');
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true); assert.equal(hook.current.saveError, 'Persist failed');
});

test('inline rename opens without permission and waits only when a changed name is committed', async t => {
  const pending = deferred(), calls = [];
  const hook = await mount(t, { onEditRequest(request, context) { calls.push({ request, context }); return pending.promise; } }, 'views');
  await change(() => hook.main.startRename(['alpha']));
  assert.equal(hook.main.renamingEntryId, 'alpha'); assert.equal(hook.main.renameValue, 'Alpha'); assert.equal(calls.length, 0);
  await change(() => hook.main.setRenameValue('Edited'));
  const started = await hook.begin(() => hook.main.commitRename('alpha'));
  assert.equal(hook.current.dirty, false); assert.equal(calls[0].request.action, 'rename');
  const refreshed = initialEntries().map(item => item.id === 'alpha' ? { ...item, name: 'Fresh.txt' } : item);
  await change(async () => { pending.resolve({ allowed: true, entries: refreshed }); assert.equal(await started.result, true); });
  assert.equal(hook.main.renamingEntryId, null); assert.equal(hook.main.entries.find(item => item.id === 'alpha').name, 'Edited.txt');
  assert.equal(calls.length, 1); assert.equal(hook.current.dirty, true);
});

test('an edit gesture is replayed once after permission and additional gestures during requesting are not queued', async t => {
  const pending = deferred(); let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return pending.promise; } }, 'views');
  const first = await hook.begin(() => hook.child.act('delete', ['alpha']));
  const second = await hook.begin(() => hook.grandchild.act('delete', ['beta']));
  assert.equal(await second.result, false); assert.equal(hook.current.entries.length, 3);
  await change(async () => { pending.resolve(true); assert.equal(await first.result, true); });
  assert.equal(hook.current.entries.some(item => item.id === 'alpha'), false); assert.equal(hook.current.entries.some(item => item.id === 'beta'), true);
  assert.equal(calls, 1); assert.equal(changes(hook).length, 1);
});

test('opening an edit modal is permission-free and its valid submission waits before creating data', async t => {
  const pending = deferred(); let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return pending.promise; } }, 'views');
  await change(() => hook.main.showModal('create', []));
  assert.equal(hook.main.modal.type, 'create'); assert.equal(hook.current.dirty, false); assert.equal(calls, 0);
  await change(() => hook.main.setName('Created'));
  const first = await hook.begin(() => hook.main.submitModal());
  assert.equal(hook.current.dirty, false); assert.equal(calls, 1);
  await change(async () => { pending.resolve(true); await first.result; });
  assert.ok(hook.current.entries.some(item => item.name === 'Created' && item.kind === 'folder'));
  assert.equal(calls, 1);
});

test('local file and folder uploads remain unstaged until permission and preserve File identity', async t => {
  for (const source of ['file', 'folder']) await t.test(source, async subtest => {
    const pending = deferred(), requests = [];
    const hook = await mount(subtest, { onEditRequest(request) { requests.push(request); return pending.promise; } }, 'views');
    const local = addedFile();
    if (source === 'folder') Object.defineProperty(local, 'webkitRelativePath', { value: 'Local folder/Local.txt' });
    const first = await hook.begin(() => hook.main.addLocalFiles([local], source, 'folder'));
    assert.equal(hook.current.dirty, false); assert.equal(hook.current.entries.length, 3);
    assert.equal(requests[0].action, 'upload'); assert.equal(requests[0].destinationPath, '/資料');
    await change(async () => { pending.resolve(true); await first.result; });
    const uploaded = hook.current.entries.find(item => item.source?.kind === 'local');
    assert.equal(uploaded.source.file, local);
    assert.equal(source === 'file' ? uploaded.parent : hook.current.entries.find(item => item.id === uploaded.parent).parent, 'folder');
    assert.equal(changes(hook).length, 1); assert.deepEqual(hook.saves, []);
  });
});

test('a refreshed missing target or disabled feature is rechecked before replaying the waiting gesture', async t => {
  for (const reason of ['missing', 'disabled', 'navigation']) await t.test(reason, async subtest => {
    const pending = deferred();
    const hook = await mount(subtest, { onEditRequest: () => pending.promise }, 'views');
    const first = await hook.begin(() => hook.main.act('delete', ['alpha']));
    if (reason === 'disabled') await hook.update({ features: { delete: false } });
    if (reason === 'navigation') await change(() => hook.main.navigate('folder'));
    await change(async () => {
      pending.resolve(reason === 'missing' ? { allowed: true, entries: initialEntries().filter(item => item.id !== 'alpha') } : true);
      assert.equal(await first.result, false);
    });
    assert.equal(changes(hook).length, 0); assert.equal(hook.current.dirty, false);
    if (reason !== 'missing') assert.equal(hook.current.entries.some(item => item.id === 'alpha'), true);
  });
});

test('closing the originating popup cancels its pending gesture and prevents a late rename UI', async t => {
  const pending = deferred(); let context;
  const hook = await mount(t, { onEditRequest(request, value) { context = value; return pending.promise; } }, 'views');
  await change(() => hook.child.startRename(['alpha']));
  await change(() => hook.child.setRenameValue('Changed'));
  const first = await hook.begin(() => hook.child.commitRename('alpha'));
  await hook.removeChildren(); assert.equal(context.signal.aborted, true); assert.equal(await settlesSoon(first.result), false);
  await change(() => pending.resolve(true));
  assert.equal(hook.current.editMode, 'view'); assert.equal(hook.main.renamingEntryId, null); assert.equal(hook.current.dirty, false);
});

test('native copy prepares clipboard data synchronously without permission and pasting waits before changing files', async t => {
  const pending = deferred(); let active = true, transferCalls = 0, calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return pending.promise; } }, 'views');
  const transfer = { clearData() { assert.equal(active, true); transferCalls++; }, setData() { assert.equal(active, true); transferCalls++; } };
  await change(() => hook.main.copyToClipboard('copy', ['alpha'], transfer));
  active = false;
  assert.deepEqual(hook.workspace.clipboard, { action: 'copy', ids: ['alpha'] });
  assert.equal(transferCalls, 2); assert.equal(hook.current.dirty, false); assert.equal(calls, 0);
  await change(() => hook.main.navigate('folder'));
  const first = await hook.begin(() => hook.main.paste());
  assert.equal(calls, 1); assert.equal(hook.current.dirty, false);
  await change(async () => { pending.resolve(true); await first.result; });
  assert.equal(transferCalls, 2);
  assert.equal(hook.current.entries.filter(item => item.parent === 'folder' && item.kind === 'file').length, 1);
});

test('viewing, navigation, selection, preview and external download do not request editing', async t => {
  let calls = 0; const previews = [], downloads = [];
  const hook = await mount(t, { onEditRequest() { calls++; return true; }, onPreviewRequest: request => previews.push(request),
    onDownloadRequest(request) { downloads.push(request); return { status: 'handed-off' }; } }, 'views');
  await change(() => hook.main.setSelected(['alpha']));
  await change(() => hook.main.setDetailId('alpha'));
  await change(() => hook.main.openEntry(hook.main.entries.find(item => item.id === 'alpha')));
  await change(() => hook.main.download({ id: 'alpha' }));
  await change(() => hook.main.navigate('folder'));
  await change(() => hook.workspace.tabs.forWindow('main').addTab());
  assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  assert.equal(previews.length, 1); assert.equal(downloads.length, 1);
});

test('closing the popup that obtained permission keeps the granted shared session available to surviving panes', async t => {
  let context, calls = 0;
  const hook = await mount(t, { onEditRequest(request, value) { context = value; calls++; return true; } }, 'views');
  await change(() => hook.child.act('rename', ['alpha'], { name: 'Child changed.txt' }));
  assert.equal(hook.current.editMode, 'edit');
  await hook.removeChildren();
  assert.equal(hook.current.editMode, 'edit'); assert.equal(context.signal.aborted, false);
  await change(() => assert.equal(hook.main.act('delete', ['beta']), true));
  assert.equal(calls, 1); assert.equal(hook.current.entries.some(item => item.id === 'beta'), false);
  await change(() => hook.current.save());
  assert.equal(hook.current.editMode, 'view'); assert.equal(context.signal.aborted, true);
});

test('a clean save cancels a pending request without calling persistence or waiting for the host', async t => {
  const pending = deferred(); let context;
  const hook = await mount(t, { onEditRequest(request, value) { context = value; return pending.promise; } });
  const first = await hook.begin();
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(await settlesSoon(first.result), false); assert.equal(context.signal.aborted, true);
  assert.equal(hook.current.editMode, 'view'); assert.deepEqual(hook.saves, []);
  await change(() => pending.resolve(true));
  assert.equal(hook.current.editMode, 'view');
});

test('committed child layout callers use the latest permission handler', async t => {
  let latest, retained, renderer;
  const calls = [];
  function Child({ version }) {
    useLayoutEffect(() => { if (version) assert.equal(retained.requestEdit(renameIntent), true); }, [version]);
    return null;
  }
  function Parent({ version }) {
    latest = useExplorerDraft({ initialEntries: initialEntries(), onSave() {}, onEditRequest() { calls.push(version); return true; } });
    retained ??= latest;
    return h(Child, { version });
  }
  const tree = version => h(StrictMode, null, h(Parent, { version }));
  await change(() => { renderer = create(tree(0)); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => renderer.update(tree(1)));
  assert.deepEqual(calls, [1]); assert.equal(latest.editMode, 'edit');
});

test('saving a dirty draft after its prior session ended requests fresh permission without replacing local changes', async t => {
  const requests = [], contexts = [];
  const hook = await mount(t, { onEditRequest(request, context) { requests.push(request); contexts.push(context); return true; } });
  await hook.begin(); await change(() => hook.current.apply(renameAction));
  await hook.update({ readOnly: true }); await hook.update({ readOnly: false });
  const before = hook.current.entries;
  await hook.update({ onEditRequest: request => { requests.push(request); return { allowed: true, entries: initialEntries() }; } });
  await change(async () => assert.equal(await hook.current.save(), false));
  assert.equal(requests.at(-1).action, 'save'); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true);
  assert.deepEqual(hook.saves, []);
  await hook.update({ onEditRequest: request => { requests.push(request); return true; } });
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(requests.at(-1).action, 'save'); assert.equal(hook.saves.length, 1); assert.equal(hook.current.dirty, false);
  assert.equal(hook.saves[0].changes.updated[0].name, 'Changed.txt'); assert.equal(contexts[0].signal.aborted, true);
});

test('save/discard completion and abort observers cannot synchronously reopen or mutate the closing session', async t => {
  for (const operation of ['save', 'discard']) await t.test(operation, async subtest => {
    const reopen = [], errors = [], ends = [], reasons = []; let hook, calls = 0;
    function attempt() {
      reopen.push(hook.current.requestEdit(renameIntent));
      try { hook.current.apply({ ...renameAction, name: 'Reentered.txt' }); } catch (error) { errors.push(error); }
      ends.push(hook.current.endEdit());
    }
    hook = await mount(subtest, {
      onEditRequest(request, context) { calls++; context.signal.addEventListener('abort', attempt); return true; },
      onEvent(event) {
        if (event.type === 'discard' || (event.type === 'save' && event.status === 'success')) attempt();
        if (event.type === 'edit-mode' && event.mode === 'view') reasons.push(event.reason);
      },
    });
    await hook.begin(); await change(() => hook.current.apply(renameAction));
    await change(() => hook.current[operation]());
    assert.equal(calls, 1); assert.deepEqual(reopen, [false, false]); assert.equal(errors.length, 2);
    assert.deepEqual(ends, [false, false]); assert.deepEqual(reasons, [operation === 'save' ? 'saved' : 'discarded']);
    assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
    const next = await hook.begin(); assert.equal(await next.result, true); assert.equal(calls, 2);
  });
});

test('read-only committed before a child layout callback blocks retained requests and aborts the previous session', async t => {
  let latest, retained, renderer, context;
  const requests = [], errors = [];
  function Child({ readOnly }) {
    useLayoutEffect(() => {
      if (!readOnly) return;
      requests.push(retained.requestEdit(renameIntent));
      try { retained.apply(renameAction); } catch (error) { errors.push(error); }
    }, [readOnly]);
    return null;
  }
  function Parent({ readOnly }) {
    latest = useExplorerDraft({ initialEntries: initialEntries(), readOnly, onSave() {}, onEditRequest(request, value) { context = value; return true; } });
    retained ??= latest;
    return h(Child, { readOnly });
  }
  const tree = readOnly => h(StrictMode, null, h(Parent, { readOnly }));
  await change(() => { renderer = create(tree(false)); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => latest.requestEdit(renameIntent));
  await change(() => renderer.update(tree(true)));
  assert.deepEqual(requests, [false]); assert.equal(errors.length, 1); assert.match(errors[0].message, /読み取り専用/);
  assert.equal(latest.editMode, 'view'); assert.equal(context.signal.aborted, true); assert.equal(latest.dirty, false);
});

test('a cancelled gesture cannot display a later request’s denial over an unrelated notification', async t => {
  const pending = deferred(); let first = true;
  const hook = await mount(t, { onEditRequest() { return first ? pending.promise : false; } }, 'views');
  const start = await hook.begin(() => hook.main.act('delete', ['alpha']));
  const unrelated = { kind: 'info', message: 'Another operation finished' };
  await change(() => {
    hook.current.cancelEditRequest('main');
    first = false;
    assert.equal(hook.main.act('delete', ['beta']), false);
    hook.main.setNotification(unrelated);
  });
  assert.equal(await start.result, false); assert.equal(hook.main.notification, unrelated);
  assert.equal(hook.current.dirty, false); assert.equal(hook.main.renamingEntryId, null);
});

test('a granted gesture cannot replay after its session ended and another session started before its continuation', async t => {
  const pending = deferred(); let first = true;
  const hook = await mount(t, { onEditRequest() { return first ? pending.promise : true; } }, 'views');
  const start = await hook.begin(() => hook.main.act('delete', ['alpha']));
  await change(async () => {
    pending.resolve(true);
    // The handler's fulfillment grants permission before the controller's
    // Promise.race continuation is scheduled, allowing this interleaving.
    await Promise.resolve();
    assert.equal(hook.current.getEditState().mode, 'edit');
    hook.current.endEdit();
    first = false;
    assert.equal(hook.current.requestEdit({ action: 'rename', ids: ['beta'] }), true);
    assert.equal(await start.result, false);
  });
  assert.equal(hook.current.editMode, 'edit'); assert.equal(hook.current.dirty, false);
  assert.ok(hook.current.entries.some(item => item.id === 'alpha'));
});

test('StrictMode cleanup keeps rendered mode and synchronous session state consistent after a one-time child layout request', async t => {
  for (const asynchronous of [false, true]) await t.test(asynchronous ? 'pending handler' : 'implicit permission', async subtest => {
    let renderer, latest, tried = false;
    const requests = [], contexts = [], waiting = [];
    function Child() {
      useLayoutEffect(() => {
        if (tried) return;
        tried = true;
        requests.push(latest.requestEdit({ action: 'create', parent: 'root' }));
      }, []);
      return null;
    }
    function Parent() {
      latest = useExplorerDraft({ initialEntries: initialEntries(), onSave() {},
        ...(asynchronous ? { onEditRequest(request, context) { const pending = deferred(); waiting.push(pending); contexts.push(context); return pending.promise; } } : {}),
      });
      return h(Child);
    }
    await change(() => { renderer = create(h(StrictMode, null, h(Parent))); });
    subtest.after(() => change(() => renderer.unmount()));
    assert.equal(requests.length, 1); assert.equal(latest.editMode, 'view'); assert.equal(latest.getEditState().mode, 'view');
    if (asynchronous) { assert.equal(contexts[0].signal.aborted, true); assert.equal(await settlesSoon(requests[0]), false); }
    let next;
    await change(() => { next = latest.requestEdit(renameIntent); });
    if (asynchronous) await change(() => waiting[1].resolve(true));
    assert.equal(await next, true); assert.equal(latest.editMode, 'edit'); assert.equal(latest.getEditState().mode, 'edit');
  });
});

test('an abandoned save cannot retain a reused hook lock or overwrite its newer draft', async t => {
  for (const failure of [false, true]) await t.test(failure ? 'late failure' : 'late success', async subtest => {
    let renderer, latest, attempted = false, saving;
    const pending = deferred(), events = [];
    function Child() {
      useLayoutEffect(() => {
        if (attempted) return;
        attempted = true;
        latest.apply(renameAction);
        saving = latest.save();
      }, []);
      return null;
    }
    function Parent() {
      latest = useExplorerDraft({ initialEntries: initialEntries(), onSave: () => pending.promise, onEvent: event => events.push(event) });
      return h(Child);
    }
    await change(() => { renderer = create(h(StrictMode, null, h(Parent))); });
    subtest.after(() => change(() => renderer.unmount()));
    assert.equal(latest.saving, false, 'effect cleanup must release a request lock before React reuses its hook state');
    await change(() => latest.apply({ ...renameAction, name: 'Newer.txt' }));
    const entries = latest.entries;
    const sessionId = latest.editRequestId;
    const eventCount = events.length;
    await change(async () => {
      if (failure) pending.reject(new Error('Old save failed'));
      else pending.resolve(initialEntries().map(item => item.id === 'alpha' ? { ...item, name: 'Old response.txt' } : item));
      assert.equal(await saving, !failure, 'the already-started host persistence result retains its return contract');
    });
    assert.equal(latest.entries, entries);
    assert.equal(latest.entries.find(item => item.id === 'alpha').name, 'Newer.txt');
    assert.equal(latest.dirty, true);
    assert.equal(latest.editRequestId, sessionId);
    assert.equal(latest.saveError, null);
    assert.equal(events.length, eventCount, 'an old response cannot notify or release the current edit session');
  });
});

test('a popup save reacquires permission with the originating window identity', async t => {
  const requests = [];
  const hook = await mount(t, { onEditRequest(request) { requests.push(request); return true; } }, 'views');
  await change(() => hook.child.act('rename', ['alpha'], { name: 'Child.txt' }));
  await hook.update({ readOnly: true }); await hook.update({ readOnly: false });
  await change(() => hook.child.saveChanges());
  assert.deepEqual(requests.map(request => [request.action, request.windowId]), [['rename', 'child'], ['save', 'child']]);
  assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false); assert.equal(hook.saves.length, 1);
});

test('permission-gated actions retain the original targets and parameters when caller-owned values change while waiting', async t => {
  for (const route of ['move', 'rename']) await t.test(route, async subtest => {
    const pending = deferred(), requests = [];
    const hook = await mount(subtest, { onEditRequest(request) { requests.push(request); return pending.promise; } }, 'views');
    const ids = ['alpha'], extra = { parent: 'folder', name: 'Renamed.txt' };
    const started = await hook.begin(() => hook.main.act(route, ids, extra));
    ids[0] = 'beta'; ids.push('folder'); extra.parent = 'root'; extra.name = 'Hijacked.txt';
    assert.deepEqual(requests[0].ids, ['alpha']);
    if (route === 'move') assert.equal(requests[0].destinationId, 'folder');
    await change(async () => { pending.resolve(true); await started.result; });
    const alpha = hook.current.entries.find(item => item.id === 'alpha');
    const beta = hook.current.entries.find(item => item.id === 'beta');
    assert.equal(beta.name, 'Beta.txt'); assert.equal(beta.parent, 'root');
    if (route === 'move') { assert.equal(alpha.parent, 'folder'); assert.equal(alpha.name, 'Alpha.txt'); }
    if (route === 'rename') { assert.equal(alpha.name, 'Renamed.txt'); assert.equal(alpha.parent, 'root'); }
  });
});

test('retained paste callbacks cannot acquire a new session or restore clipboard work after saving or ending editing', async t => {
  for (const finish of ['save', 'endEdit']) await t.test(finish, async subtest => {
    let calls = 0;
    const hook = await mount(subtest, { onEditRequest() { calls++; return true; } }, 'views');
    await change(() => hook.current.requestEdit(renameIntent));
    await change(() => hook.main.copyToClipboard('copy', ['alpha']));
    await change(() => hook.main.navigate('folder'));
    const retainedPaste = hook.main.paste;
    assert.deepEqual(hook.workspace.clipboard, { action: 'copy', ids: ['alpha'] });
    await change(() => hook.current[finish]());
    assert.equal(hook.workspace.clipboard, null); assert.equal(hook.current.editMode, 'view');
    const before = hook.current.entries, eventCount = hook.events.length;
    await change(() => retainedPaste());
    assert.equal(calls, 1); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
    assert.equal(hook.current.editMode, 'view'); assert.equal(hook.workspace.clipboard, null); assert.equal(hook.events.length, eventCount);
  });
});

test('ending and replacing an edit session in one batch hides the previous rename editor or modal', async t => {
  for (const route of ['rename', 'modal']) await t.test(route, async subtest => {
    let calls = 0;
    const hook = await mount(subtest, { onEditRequest() { calls++; return true; } }, 'views');
    const open = () => route === 'rename' ? hook.main.startRename(['alpha']) : hook.main.showModal('delete', ['alpha']);
    await change(() => hook.current.requestEdit(renameIntent));
    await change(open);
    const firstId = hook.current.getEditState().requestId;
    if (route === 'rename') assert.equal(hook.main.renamingEntryId, 'alpha');
    else assert.deepEqual(hook.main.modal.ids, ['alpha']);
    await change(() => {
      hook.current.endEdit();
      assert.equal(hook.current.requestEdit({ action: 'favorite', ids: ['alpha'] }), true);
    });
    assert.equal(hook.current.editMode, 'edit'); assert.notEqual(hook.current.getEditState().requestId, firstId);
    assert.equal(hook.main.renamingEntryId, null); assert.equal(hook.main.modal, null); assert.equal(hook.current.dirty, false);
    await change(open);
    if (route === 'rename') assert.equal(hook.main.renamingEntryId, 'alpha');
    else assert.deepEqual(hook.main.modal.ids, ['alpha']);
    assert.equal(calls, 2, 'the fresh editor belongs to the current authorized session');
  });
});

test('opening or cancelling editors and preparing copy/cut never asks for permission or enters edit mode', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return false; } }, 'views');
  await change(() => hook.main.startRename(['alpha']));
  assert.equal(hook.main.renamingEntryId, 'alpha');
  await change(() => hook.main.cancelRename());
  for (const type of ['create', 'createFile', 'move', 'copy', 'delete']) {
    await change(() => hook.main.showModal(type, ['alpha']));
    assert.equal(hook.main.modal.type, type);
    await change(() => hook.main.setModal(null));
  }
  for (const action of ['copy', 'move']) {
    await change(() => hook.main.copyToClipboard(action, ['alpha']));
    assert.deepEqual(hook.workspace.clipboard, { action, ids: ['alpha'] });
  }
  assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  assert.equal(changes(hook).length, 0); assert.equal(editEvents(hook).length, 0);
});

test('same-name rename, same-folder move and invalid commands produce no permission request', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return true; }, upload: { allowedExtensions: ['.txt'] } }, 'views');
  await change(() => hook.main.startRename(['alpha']));
  await change(async () => assert.equal(await hook.main.commitRename('alpha'), true));
  assert.equal(hook.main.renamingEntryId, null); assert.equal(calls, 0);
  await change(() => hook.main.startRename(['alpha']));
  await change(() => hook.main.setRenameValue('bad/name'));
  await change(async () => assert.equal(await hook.main.commitRename('alpha'), false));
  assert.equal(hook.main.renamingEntryId, 'alpha'); assert.equal(calls, 0);
  await change(() => hook.main.cancelRename());
  for (const [action, ids, extra] of [
    ['rename', ['alpha'], { name: 'Alpha.txt' }], ['move', ['alpha'], { parent: 'root' }],
    ['create', [], { name: '資料' }], ['create', [], { name: 'bad/name' }],
    ['createFile', [], { name: 'Alpha.txt' }], ['createFile', [], { name: 'Blocked.exe' }],
    ['delete', [], {}], ['move', ['beta'], { parent: 'alpha' }], ['copy', ['folder'], { parent: 'folder' }],
  ]) await change(() => hook.main.act(action, ids, extra));
  assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  assert.equal(changes(hook).length, 0);
});

test('invalid dialog input and unchanged move submissions need no permission', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return true; } }, 'views');
  await change(() => hook.main.showModal('create'));
  await change(() => hook.main.submitModal());
  assert.equal(hook.main.modal.type, 'create'); assert.ok(hook.main.modalError); assert.equal(calls, 0);
  await change(() => hook.main.setName('資料'));
  await change(() => hook.main.submitModal());
  assert.equal(calls, 0); assert.equal(hook.current.dirty, false);
  await change(() => hook.main.setModal(null));
  await change(() => hook.main.showModal('move', ['alpha']));
  await change(() => hook.main.setDestination('root'));
  await change(() => hook.main.submitModal());
  assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
});

test('empty, rejected and fully skipped uploads report their outcome without acquiring permission', async t => {
  for (const invalidFileBehavior of ['reject-batch', 'skip']) await t.test(invalidFileBehavior, async subtest => {
    let calls = 0;
    const hook = await mount(subtest, { onEditRequest() { calls++; return true; }, upload: { allowedExtensions: ['.txt'], invalidFileBehavior } }, 'views');
    await change(() => hook.main.addLocalFiles([]));
    assert.equal(calls, 0); assert.equal(hook.events.filter(event => event.type === 'upload').length, 0);
    await change(() => hook.main.addLocalFiles([new File(['x'], 'Blocked.exe')]));
    assert.equal(calls, 0); assert.equal(hook.current.dirty, false); assert.equal(hook.current.editMode, 'view');
    assert.deepEqual(hook.events.filter(event => event.type === 'upload').map(event => event.status), [invalidFileBehavior === 'skip' ? 'skipped' : 'rejected']);
    assert.equal(changes(hook).length, 0);
  });
});

test('permission denial preserves the edited name or dialog values and a later commit can retry', async t => {
  for (const route of ['rename', 'create', 'createFile', 'delete']) await t.test(route, async subtest => {
    let allowed = false, calls = 0;
    const hook = await mount(subtest, { onEditRequest() { calls++; return allowed; } }, 'views');
    if (route === 'rename') {
      await change(() => hook.main.startRename(['alpha'])); await change(() => hook.main.setRenameValue('Requested'));
    } else {
      await change(() => hook.main.showModal(route, ['alpha']));
      if (route !== 'delete') await change(() => hook.main.setName(route === 'createFile' ? 'Requested.txt' : 'Requested'));
    }
    const submit = () => route === 'rename' ? hook.main.commitRename('alpha') : hook.main.submitModal();
    await change(submit);
    assert.equal(calls, 1); assert.equal(hook.current.dirty, false); assert.equal(hook.current.editMode, 'view');
    if (route === 'rename') { assert.equal(hook.main.renamingEntryId, 'alpha'); assert.equal(hook.main.renameValue, 'Requested'); }
    else { assert.equal(hook.main.modal.type, route); if (route !== 'delete') assert.equal(hook.main.name, route === 'createFile' ? 'Requested.txt' : 'Requested'); }
    allowed = true; await change(submit);
    assert.equal(calls, 2); assert.equal(hook.current.dirty, true);
    assert.equal(hook.main.renamingEntryId, null); assert.equal(hook.main.modal, null);
  });
});

test('clipboard and modal preparations copy their targets before the later permission-gated commit', async t => {
  for (const route of ['clipboard', 'modal']) await t.test(route, async subtest => {
    const pending = deferred(), requests = [];
    const hook = await mount(subtest, { onEditRequest(request) { requests.push(request); return pending.promise; } }, 'views');
    const ids = ['alpha'];
    await change(() => route === 'clipboard' ? hook.main.copyToClipboard('copy', ids) : hook.main.showModal('delete', ids));
    ids[0] = 'beta'; ids.push('folder');
    assert.equal(requests.length, 0);
    const started = await hook.begin(() => route === 'clipboard' ? hook.main.paste() : hook.main.submitModal());
    assert.deepEqual(requests[0].ids, ['alpha']);
    await change(async () => { pending.resolve(true); await started.result; });
    assert.ok(hook.current.entries.some(item => item.id === 'beta')); assert.ok(hook.current.entries.some(item => item.id === 'folder'));
    if (route === 'clipboard') assert.ok(hook.current.entries.some(item => item.name === 'Alpha (2).txt'));
    else assert.equal(hook.current.entries.some(item => item.id === 'alpha'), false);
  });
});

test('hook preflight validates changes without permission and a prepared action can commit successfully only once', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return true; } });
  const before = hook.current.entries;
  let commit;
  const command = { ...renameAction, ids: ['alpha'] };
  await change(() => { commit = hook.current.prepareAction(command); });
  command.ids[0] = 'beta'; command.name = 'Caller changed.txt';
  assert.equal(calls, 0); assert.equal(hook.current.entries, before); assert.equal(hook.current.editMode, 'view');
  await change(() => assert.throws(() => commit(), /編集を開始してから変更してください/));
  await hook.begin();
  await change(() => { assert.equal(commit(), true); assert.equal(commit(), false); });
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Changed.txt');
  assert.equal(hook.current.entries.find(item => item.id === 'beta').name, 'Beta.txt');
  assert.equal(calls, 1); assert.equal(changes(hook).length, 1);
});

test('prepared imports keep their File payload and classification isolated and emit outcomes only once', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return true; }, upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  const local = addedFile(), files = [local, new File(['bad'], 'Blocked.exe')];
  let prepared;
  await change(() => { prepared = hook.current.prepareAdd(files, 'folder'); });
  assert.equal(calls, 0); assert.equal(hook.current.dirty, false); assert.equal(hook.events.length, 0);
  assert.equal(prepared.result.addedCount, 1); assert.equal(prepared.result.rejections.length, 1);
  files.length = 0; prepared.result.addedCount = 0; prepared.result.rejections.length = 0;
  await hook.begin();
  await change(() => {
    const result = prepared.commit();
    assert.equal(result.addedCount, 1); assert.equal(result.rejections.length, 1);
    assert.equal(prepared.commit(), undefined);
  });
  assert.equal(hook.current.entries.at(-1).source.file, local);
  assert.equal(changes(hook).length, 1); assert.equal(hook.events.filter(event => event.type === 'upload').length, 1); assert.equal(calls, 1);
});

test('raw no-op operations and all-skipped imports need no explicit permission even when a handler is configured', async t => {
  let calls = 0;
  const hook = await mount(t, { onEditRequest() { calls++; return false; }, upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  const before = hook.current.entries;
  await change(() => {
    assert.equal(hook.current.prepareAction({ ...renameAction, name: 'Alpha.txt' }), null);
    hook.current.apply({ action: 'move', ids: ['alpha'], parent: 'root' });
    assert.equal(hook.current.add([], 'root').addedCount, 0);
    assert.equal(hook.current.add([new File(['bad'], 'Blocked.exe')], 'root').addedCount, 0);
  });
  assert.equal(calls, 0); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.events.filter(event => event.type === 'upload').map(event => event.status), ['skipped']);
});

test('prepared work revalidates fresh baselines and changed upload restrictions before applying anything', async t => {
  const refreshed = initialEntries().filter(item => item.id !== 'alpha');
  const hook = await mount(t, { onEditRequest: () => ({ allowed: true, entries: refreshed }), upload: { allowedExtensions: ['.txt'] } });
  let rename, upload;
  await change(() => { rename = hook.current.prepareAction(renameAction); upload = hook.current.prepareAdd([addedFile()], 'root'); });
  await hook.begin();
  await hook.update({ upload: { allowedExtensions: ['.md'] } });
  await change(() => { assert.throws(() => rename()); assert.throws(() => upload.commit()); });
  assert.deepEqual(hook.current.entries, refreshed); assert.equal(hook.current.dirty, false); assert.equal(changes(hook).length, 0);
});

test('a newly mounted child can paste a clipboard prepared in the parent before any edit session exists', async t => {
  const requests = [];
  const hook = await mount(t, { onEditRequest(request) { requests.push(request); return true; } }, 'views');
  await hook.removeChildren();
  await change(() => hook.main.copyToClipboard('copy', ['alpha']));
  assert.equal(hook.current.editMode, 'view'); assert.equal(requests.length, 0);
  await hook.showChildren();
  await change(() => hook.child.navigate('folder'));
  assert.equal(hook.child.canPaste, true);
  await change(() => assert.equal(hook.child.paste(), true));
  assert.equal(requests.length, 1); assert.equal(requests[0].action, 'copy'); assert.equal(requests[0].windowId, 'child');
  assert.ok(hook.current.entries.some(item => item.parent === 'folder' && item.name === 'Alpha.txt'));
  assert.equal(changes(hook).length, 1);
});

test('closing a modal while permission is pending cancels the request and ignores late approval', async t => {
  const pending = deferred(), calls = [];
  const hook = await mount(t, { onEditRequest(request, context) { calls.push({ request, context }); return pending.promise; } }, 'views');
  await change(() => hook.main.showModal('createFile'));
  await change(() => hook.main.setName('Pending.txt'));
  const submit = await hook.begin(() => hook.main.submitModal());
  assert.equal(calls.length, 1); assert.equal(hook.current.editMode, 'requesting');
  await change(() => hook.main.setModal(null));
  assert.equal(calls[0].context.signal.aborted, true); assert.equal(hook.main.modal, null);
  await change(async () => { pending.resolve(true); await submit.result; });
  assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false); assert.equal(changes(hook).length, 0);
});

test('ending a session invalidates shared clipboard synchronously before any following retained paste in the same batch', async t => {
  for (const finish of ['discard', 'save', 'endEdit']) await t.test(finish, async subtest => {
    let calls = 0;
    const hook = await mount(subtest, { onEditRequest() { calls++; return true; } }, 'views');
    await change(() => hook.main.copyToClipboard('copy', ['alpha']));
    await change(() => hook.main.act('rename', ['beta'], { name: 'Changed beta.txt' }));
    if (finish === 'endEdit') await change(() => hook.main.act('rename', ['beta'], { name: 'Beta.txt' }));
    await change(() => hook.child.navigate('folder'));
    const retainedPaste = hook.child.paste;
    await change(async () => {
      if (finish === 'save') assert.equal(await hook.current.save(), true);
      else hook.current[finish]();
      assert.equal(retainedPaste(), false);
    });
    assert.equal(calls, 1); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
    assert.equal(hook.current.entries.filter(item => item.parent === 'folder').length, 0);
    assert.equal(hook.workspace.clipboard, null);
  });
});

test('saving or discarding from another pane closes a stale discard confirmation together with the edit session', async t => {
  for (const finish of ['save', 'discard']) await t.test(finish, async subtest => {
    const hook = await mount(subtest, {}, 'views');
    await change(() => hook.main.act('rename', ['alpha'], { name: 'Changed.txt' }));
    await change(() => hook.child.showModal('discard'));
    assert.equal(hook.child.modal.type, 'discard');
    await change(() => hook.current[finish]());
    assert.equal(hook.child.modal, null); assert.equal(hook.current.editMode, 'view'); assert.equal(hook.current.dirty, false);
  });
});
