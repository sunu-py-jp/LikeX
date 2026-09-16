import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, useEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { FileIcon, FileThumbnail } from './src/ui/explorer-file-icon.tsx';
  export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController, ExplorerProvider, FileIcon, FileThumbnail, ExplorerSidebar } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, parent = 'root', kind = 'file') => ({ id, parent, kind,
  name: kind === 'file' ? `${id}.txt` : id, extension: kind === 'file' ? 'txt' : '', size: 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id } : null,
  createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', favorite: 0 });
const initialEntries = [entry('a', 'root', 'folder'), entry('b', 'a', 'folder'), entry('c', 'root', 'folder'), entry('one', 'b')];

async function mount(t, supplied = {}) {
  let workspace, pane, renderer;
  let options = { initialEntries, onSave() {}, ...supplied };
  function Probe() {
    workspace = useExplorerWorkspace(options);
    pane = useExplorerViewController(options, workspace, 'main', null);
    return h(ExplorerProvider, { value: pane }, h(ExplorerSidebar), pane.entries.map(item =>
      h('div', { key: item.id, 'data-icon': item.id }, h(FileIcon, { entry: item }), h(FileThumbnail, { entry: item }))));
  }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  return { get draft() { return workspace.draft; }, get pane() { return pane; },
    icon: id => renderer.root.findByProps({ 'data-icon': id }),
    badges: id => renderer.root.findByProps({ 'data-icon': id }).findAllByProps({ 'data-explorer-pending-upload-icon': true }),
    get sidebar() { return renderer.root.findByType('aside'); },
    async update(patch) { options = { ...options, ...patch }; await change(() => renderer.update(h(Probe))); },
  };
}

async function overwrite(app, file, action = 'overwrite') {
  let conflict;
  try { app.draft.prepareAdd([file], 'b'); } catch (error) { conflict = error; }
  assert.equal(conflict?.name, 'ExplorerUploadConflictError');
  await change(() => app.draft.add([file], 'b', [{ fileIndex: conflict.conflict.fileIndex,
    existing: conflict.conflict.existing, action }], conflict.session));
}

test('new content marks icons, thumbnails and current ancestors while navigation and metadata changes alone do not', async t => {
  const app = await mount(t);
  await change(() => app.pane.act('move', ['one'], { parent: 'c' }));
  await change(() => app.pane.act('rename', ['one'], { name: 'renamed.txt' }));
  await change(() => app.pane.act('favorite', ['one']));
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  await change(() => app.draft.discard());
  const file = new File(['new'], 'new.txt');
  const read = t.mock.method(file, 'arrayBuffer', () => { throw Error('Badge detection must not read file contents'); });
  await change(() => app.draft.add([file], 'b'));
  const id = app.draft.entries.find(item => item.name === 'new.txt').id;
  assert.deepEqual(app.pane.pendingUploadEntryIds, new Set([id, 'b', 'a', 'root']));
  for (const marked of [id, 'b', 'a']) assert.equal(app.badges(marked).length, 2);
  assert.equal(app.badges('one').length, 0);
  assert.equal(app.badges('c').length, 0);
  assert.equal(app.sidebar.findAllByProps({ 'data-explorer-pending-upload-icon': true }).length, 3,
    'both virtual root icons and the visible ancestor folder are marked');
  const statuses = app.pane.pendingUploadEntryIds;
  await change(() => app.pane.navigate('b'));
  assert.equal(app.pane.pendingUploadEntryIds, statuses, 'navigation does not rebuild upload status');
  await change(() => app.pane.act('move', [id], { parent: 'c' }));
  assert.deepEqual(app.pane.pendingUploadEntryIds, new Set([id, 'c', 'root']));
  await change(() => app.pane.act('delete', [id]));
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  assert.equal(read.mock.callCount(), 0);
});

test('overwrite badges coexist with processing and custom icons; rejected/skipped uploads add no badge', async t => {
  const app = await mount(t, { processingEntryIds: ['one'], renderIcon: ({ entry }) => h('span', { 'data-host-icon': entry.id }, 'icon'),
    upload: { allowedExtensions: ['.txt'] } });
  await change(() => assert.throws(() => app.draft.add([new File(['x'], 'bad.exe')], 'b')));
  await overwrite(app, new File(['x'], 'one.txt'), 'skip');
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  await overwrite(app, new File(['replacement'], 'one.txt'));
  assert.deepEqual(app.pane.pendingUploadEntryIds, new Set(['one', 'b', 'a', 'root']));
  assert.equal(app.badges('one').length, 2);
  for (const badge of app.badges('one')) {
    assert.equal(badge.findAllByProps({ 'data-host-icon': 'one' }).length, 1);
    assert.equal(badge.findAllByProps({ 'data-explorer-processing-icon': true }).length, 1);
  }
  await change(() => app.draft.discard());
  assert.equal(app.badges('one').length, 0);
  assert.equal(app.icon('one').findAllByProps({ 'data-explorer-processing-icon': true }).length, 2);
});

test('save pending/failure retains badges; success clears even when the saved source remains local', async t => {
  const first = deferred(), second = deferred(), payloads = [];
  const app = await mount(t, { onSave: payload => { payloads.push(payload); return payloads.length === 1 ? first.promise : second.promise; } });
  await overwrite(app, new File(['replacement'], 'one.txt'));
  const statuses = app.pane.pendingUploadEntryIds;
  let saving;
  await change(() => { saving = app.draft.save(); });
  assert.equal(app.pane.pendingUploadEntryIds, statuses);
  assert.equal(app.badges('one').length, 2);
  assert.equal('pendingUploadEntryIds' in payloads[0], false);
  await change(async () => { first.reject(Error('offline')); assert.equal(await saving, false); });
  assert.equal(app.badges('one').length, 2);
  await change(() => { saving = app.draft.save(); });
  await change(async () => { second.resolve(); assert.equal(await saving, true); });
  assert.equal(app.draft.entries.find(item => item.id === 'one').source.kind, 'local');
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  await change(() => app.pane.act('rename', ['one'], { name: 'renamed.txt' }));
  assert.equal(app.pane.pendingUploadEntryIds.size, 0, 'saved local content is not pending just because its metadata changes');
});

test('canonical saves and refresh establish clean baselines; local create/copy are marked but existing-only copies are not', async t => {
  const app = await mount(t, { onSave: payload => payload.entries.map(item => item.kind === 'file'
    ? { ...item, source: { kind: 'existing', id: item.id } } : item), onRefresh: () => initialEntries });
  await change(() => app.draft.apply({ action: 'createFile', parent: 'b', name: 'created.txt' }));
  const created = app.draft.entries.find(item => item.name === 'created.txt');
  assert.ok(app.pane.pendingUploadEntryIds.has(created.id));
  await change(() => app.draft.apply({ action: 'copy', ids: [created.id], parent: 'c' }));
  const copied = app.draft.entries.find(item => item.parent === 'c');
  assert.ok(app.pane.pendingUploadEntryIds.has(copied.id));
  await change(() => app.draft.save());
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  await change(() => app.draft.apply({ action: 'copy', ids: ['one'], parent: 'root' }));
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  await overwrite(app, new File(['more'], 'one.txt'));
  await change(() => app.draft.refresh());
  assert.equal(app.pane.pendingUploadEntryIds.size, 0);
  assert.equal(app.draft.dirty, false);
});

test('changing only upload status preserves mounted custom icon and thumbnail content', async t => {
  let mounts = 0, unmounts = 0;
  function HostIcon({ id }) {
    useEffect(() => {
      if (id === 'one') mounts++;
      return () => { if (id === 'one') unmounts++; };
    }, [id]);
    return h('svg', { 'data-host-icon': id });
  }
  const app = await mount(t, { renderIcon: ({ entry }) => h(HostIcon, { id: entry.id }) });
  assert.equal(mounts, 2);
  await overwrite(app, new File(['replacement'], 'one.txt'));
  assert.equal(app.badges('one').length, 2);
  await change(() => app.draft.save());
  assert.equal(app.badges('one').length, 0);
  assert.equal(mounts, 2);
  assert.equal(unmounts, 0, 'saving must not recreate unchanged icon/thumbnail content');
});
