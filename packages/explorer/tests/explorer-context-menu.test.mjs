import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, Activity, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
`, resolveDir: packageRoot, sourcefile: 'explorer-context-menu-contract.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-instance', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerDraft, useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-context-menu-contract.mjs').toString('base64')}`
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
  let latest, renderer, closed = false, childVisible = true, activityVisible = true;
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
  const tree = () => h(Activity, { mode: activityVisible ? 'visible' : 'hidden' }, h(StrictMode, null, h(kind === 'draft' ? Draft : Views, { options: props })));
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
    async setVisible(value) { activityVisible = value; await change(() => renderer.update(tree())); },
    async begin(callback = () => latest.requestEdit(renameIntent)) { let result; await change(() => { result = callback(); }); return { result }; },
  };
}

async function settlesSoon(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Cancelled edit request stayed pending')), 150); })]); }
  finally { clearTimeout(timer); }
}

const uploadResult = (name = 'Generated.txt', parentId = 'root') => ({
  change: { type: 'upload', files: [new File(['generated'], name, { type: 'text/plain' })], parentId },
  description: `${name} を追加`,
});
function provider(handler) {
  return context => context.target.kind === 'entry' && context.target.entry.kind === 'file'
    ? [{ id: 'generate', label: 'AIに指示', onSelect: handler }] : [];
}
function menuFor(view, id = 'alpha') { return view.getCustomContextMenu(view.entries.find(entry => entry.id === id)); }

test('block protects every shared view and retained raw commands, then applies to captured folder', async t => {
  const pending = deferred(); let signal;
  const hook = await mount(t, { getContextMenuItems: provider((_, operation) => { signal = operation.signal; return pending.promise; }), onRefresh: () => { throw Error('must not refresh'); } }, 'views');
  let prepared;
  await change(() => { prepared = hook.current.prepareAction(renameAction); });
  let running;
  const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  assert.equal(hook.main.busy, true); assert.equal(hook.child.busy, true);
  assert.equal(hook.current.mutationBlocked, true);
  await change(() => {
    assert.throws(() => hook.current.apply(renameAction), /メニュー/);
    assert.throws(prepared, /メニュー/);
    assert.throws(() => hook.current.add([addedFile()], 'root'), /メニュー/);
    assert.equal(hook.child.act('delete', ['beta']), false);
  });
  assert.equal(await hook.current.save(), false); assert.equal(await hook.current.refresh(), false);
  await change(() => hook.main.navigate('folder'));
  await change(async () => { pending.resolve(uploadResult()); await running; });
  assert.equal(hook.current.entries.find(item => item.name === 'Generated.txt').parent, 'root');
  assert.equal(hook.main.location, 'folder'); assert.equal(hook.current.mutationBlocked, false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(hook.events.filter(event => event.type === 'context-menu').map(event => event.status), ['start', 'success']);
});

test('confirm permits changes, isolates the prepared plan and waits for explicit approval', async t => {
  const pending = deferred(); const result = uploadResult('Result.txt');
  const hook = await mount(t, { contextMenuExecutionMode: 'confirm', getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  assert.equal(hook.main.busy, false);
  await change(() => hook.child.act('rename', ['beta'], { name: 'Changed.txt' }));
  await change(async () => { pending.resolve(result); await running; });
  assert.equal(hook.main.customContextMenuState.phase, 'confirming');
  assert.equal(hook.current.entries.length, 3);
  result.change.files.length = 0; result.change.parentId = 'missing';
  await change(() => hook.main.confirmCustomContextMenu());
  assert.equal(hook.current.entries.find(item => item.name === 'Result.txt').parent, 'root');
  assert.equal(hook.current.entries.find(item => item.id === 'beta').name, 'Changed.txt');
  assert.equal(hook.main.customContextMenuState.phase, 'idle');
});

test('reject-if-changed never applies a stale result, even when another popup made the change', async t => {
  const pending = deferred();
  const hook = await mount(t, { contextMenuExecutionMode: 'reject-if-changed', getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  await change(() => hook.child.act('rename', ['beta'], { name: 'Changed.txt' }));
  await change(async () => { pending.resolve(uploadResult()); await running; });
  assert.equal(hook.current.entries.length, 3);
  assert.equal(hook.main.customContextMenuState.phase, 'idle');
  assert.equal(hook.events.filter(event => event.type === 'context-menu').at(-1).status, 'error');
});

test('confirm refuses deleted captured targets rather than redirecting to current selection', async t => {
  const pending = deferred();
  const hook = await mount(t, { contextMenuExecutionMode: 'confirm', getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  await change(() => hook.main.act('delete', ['alpha']));
  await change(async () => { pending.resolve(uploadResult()); await running; });
  assert.equal(hook.main.customContextMenuState.phase, 'idle');
  assert.equal(hook.current.entries.length, 2);
  assert.match(hook.main.customContextMenuState.error, /対象/);
});

test('cancel promptly releases the workspace even when the host ignores its AbortSignal', async t => {
  const pending = deferred();
  const hook = await mount(t, { getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.child);
  await change(() => { running = hook.child.runCustomContextMenu(menu, menu.items[0]); });
  await change(() => hook.child.cancelCustomContextMenu());
  await settlesSoon(running);
  assert.equal(hook.current.mutationBlocked, false);
  await change(() => hook.main.act('rename', ['alpha'], { name: 'Changed.txt' }));
  await change(() => pending.resolve(uploadResult()));
  assert.equal(hook.current.entries.length, 3);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Changed.txt');
});

test('removing the originating popup cancels a custom action and leaves sibling views usable', async t => {
  const pending = deferred();
  const hook = await mount(t, { getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.child);
  await change(() => { running = hook.child.runCustomContextMenu(menu, menu.items[0]); });
  await hook.removeChildren(); await settlesSoon(running);
  assert.equal(hook.current.mutationBlocked, false);
  await change(() => pending.resolve(uploadResult()));
  assert.equal(hook.current.entries.length, 3);
});

test('custom uploads await overwrite answers and keep the existing ID', async t => {
  const hook = await mount(t, { getContextMenuItems: provider(() => uploadResult('Alpha.txt')) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  assert.equal(hook.main.customContextMenuState.phase, 'applying');
  assert.equal(hook.main.uploadPrompt.conflict.existing.id, 'alpha');
  assert.equal(hook.current.mutationBlocked, true);
  await change(async () => { await hook.main.answerUploadConflict('overwrite', false); await running; });
  const file = hook.current.entries.find(item => item.name === 'Alpha.txt');
  assert.equal(file.id, 'alpha'); assert.equal(await file.source.file.text(), 'generated');
  assert.equal(hook.main.customContextMenuState.phase, 'idle');
});

test('cancel during overwrite confirmation never leaves a pending plan or lock', async t => {
  const hook = await mount(t, { getContextMenuItems: provider(() => uploadResult('Alpha.txt')) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  await change(() => hook.main.cancelCustomContextMenu());
  await settlesSoon(running);
  assert.equal(hook.main.uploadPrompt, null); assert.equal(hook.current.mutationBlocked, false);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').source.kind, 'existing');
});

test('normal upload restrictions and edit denial also apply to custom plans', async t => {
  for (const options of [{ upload: { allowedExtensions: ['.csv'] } }, { onEditRequest: () => false }, { features: { uploadFiles: false } }]) {
    await t.test(JSON.stringify(options), async t => {
      const hook = await mount(t, { getContextMenuItems: provider(() => uploadResult()), ...options }, 'views');
      const menu = menuFor(hook.main);
      await change(() => hook.main.runCustomContextMenu(menu, menu.items[0]));
      assert.equal(hook.current.entries.length, 3);
      assert.equal(hook.current.mutationBlocked, false);
      assert.equal(hook.events.filter(event => event.type === 'context-menu').at(-1).status, 'error');
    });
  }
});

test('policy is rechecked after async permission and navigation preserves its original target', async t => {
  const permit = deferred();
  const hook = await mount(t, { getContextMenuItems: provider(() => uploadResult()), onEditRequest: () => permit.promise }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  assert.equal(hook.current.editMode, 'requesting');
  await change(() => hook.main.navigate('folder'));
  await change(async () => { permit.resolve(true); await running; });
  assert.equal(hook.current.entries.find(item => item.name === 'Generated.txt').parent, 'root');
});

test('captured context reads original data and preserves multi-selection around the right-click target', async t => {
  const hook = await mount(t, { getContextMenuItems: provider(() => undefined), readFile: async id => new Blob([id]) }, 'views');
  await change(() => hook.main.setSelected(['alpha', 'beta']));
  const group = menuFor(hook.main);
  assert.deepEqual(group.context.selectedEntries.map(item => item.id), ['alpha', 'beta']);
  await change(() => hook.main.setSelected(['beta']));
  const single = menuFor(hook.main);
  assert.deepEqual(single.context.selectedEntries.map(item => item.id), ['alpha']);
  await change(() => hook.main.act('rename', ['alpha'], { name: 'Changed.txt' }));
  assert.equal(group.context.getEntries().find(item => item.id === 'alpha').name, 'Alpha.txt');
  assert.equal(await (await group.context.readFile('alpha')).text(), 'content-alpha');
  assert.throws(() => { group.context.target.entry.name = 'Tampered.txt'; }, TypeError);
});

test('folder-only custom upload obeys uploadFolders independently of uploadFiles', async t => {
  function folderResult() {
    const file = new File(['folder content'], 'Note.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Generated/Note.txt' });
    return { change: { type: 'upload', files: [file], parentId: 'root' } };
  }
  for (const allowed of [false, true]) await t.test(String(allowed), async t => {
    const hook = await mount(t, { features: { uploadFiles: !allowed, uploadFolders: allowed }, getContextMenuItems: provider(folderResult) }, 'views');
    const menu = menuFor(hook.main);
    await change(() => hook.main.runCustomContextMenu(menu, menu.items[0]));
    assert.equal(hook.current.entries.some(item => item.name === 'Generated'), allowed);
  });
});

test('custom rename permits the same extension and rejects extension changes', async t => {
  for (const name of ['Renamed.txt', 'Renamed.csv']) await t.test(name, async t => {
    const hook = await mount(t, { getContextMenuItems: provider(() => ({ change: { type: 'action', action: { action: 'rename', ids: ['alpha'], name } } })) }, 'views');
    const menu = menuFor(hook.main);
    await change(() => hook.main.runCustomContextMenu(menu, menu.items[0]));
    assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, name.endsWith('.txt') ? name : 'Alpha.txt');
  });
});

test('a revoked feature during permission never commits the prepared upload', async t => {
  const permit = deferred();
  const hook = await mount(t, { getContextMenuItems: provider(() => uploadResult()), onEditRequest: () => permit.promise }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  await hook.update({ features: { uploadFiles: false } });
  await change(async () => { permit.resolve(true); await running; });
  assert.equal(hook.current.entries.length, 3); assert.equal(hook.current.mutationBlocked, false);
});

test('Activity hide cancels work and reconnect never restores a stale operation lock', async t => {
  const pending = deferred();
  const hook = await mount(t, { getContextMenuItems: provider(() => pending.promise) }, 'views');
  let running; const menu = menuFor(hook.main);
  await change(() => { running = hook.main.runCustomContextMenu(menu, menu.items[0]); });
  await hook.setVisible(false); await settlesSoon(running);
  await hook.setVisible(true);
  assert.equal(hook.current.mutationBlocked, false);
  assert.equal(hook.current.contextMenuBusy, false);
  assert.equal(hook.main.customContextMenuState.phase, 'idle');
  await change(() => hook.main.act('rename', ['beta'], { name: 'Resumed.txt' }));
  await change(() => pending.resolve(uploadResult()));
  assert.equal(hook.current.entries.length, 3);
  assert.equal(hook.current.entries.find(item => item.id === 'beta').name, 'Resumed.txt');
});
