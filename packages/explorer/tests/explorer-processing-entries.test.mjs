import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { FileIcon, FileThumbnail } from './src/ui/explorer-file-icon.tsx';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController, ExplorerProvider, FileIcon, FileThumbnail } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, parent = 'root', kind = 'file') => ({ id, parent, kind,
  name: kind === 'file' ? `${id}.txt` : id, extension: kind === 'file' ? 'txt' : '', size: 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id } : null,
  createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', favorite: 0 });
const initialEntries = [entry('a', 'root', 'folder'), entry('b', 'a', 'folder'), entry('c', 'root', 'folder'),
  entry('one', 'b'), entry('two', 'b'), entry('three')];
const windowIds = ['main', 'child', 'grandchild'];

async function mount(t, supplied = {}) {
  const panes = new Map(), events = [], saves = [];
  let workspace, renderer;
  let props = { initialEntries, onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event), ...supplied };
  function Pane({ options, shared, id }) {
    const pane = useExplorerViewController(options, shared, id, null);
    panes.set(id, pane);
    return h(ExplorerProvider, { value: pane }, pane.entries.map(item => h('div', { key: item.id, 'data-icon': `${id}:${item.id}` },
      h(FileIcon, { entry: item }), h(FileThumbnail, { entry: item }))));
  }
  function Probe({ options }) {
    const shared = useExplorerWorkspace(options);
    workspace = shared;
    useLayoutEffect(() => {
      for (const id of windowIds.slice(1)) {
        const tabs = shared.tabs.forWindow(id);
        if (!tabs.tabs.length) tabs.addTab();
      }
    }, [shared.tabs]);
    return windowIds.map(id => h(Pane, { key: id, options, shared, id }));
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  return { get main() { return panes.get('main'); }, get workspace() { return workspace; }, events, saves,
    pane: id => panes.get(id),
    spinners: (id, windowId = 'main') => renderer.root.findByProps({ 'data-icon': `${windowId}:${id}` })
      .findAllByProps({ 'data-explorer-processing-icon': true }),
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
  };
}

test('live host IDs drive file, thumbnail and ancestor indicators in every pane without changing the draft', async t => {
  const app = await mount(t, { renderIcon: ({ entry }) => h('span', { 'data-host-icon': entry.id }, 'custom') });
  const before = app.main.entries;
  assert.equal(app.main.processingEntryIds.size, 0);
  await change(() => app.main.navigate('b'));
  await change(() => app.main.setSelected(['one']));
  const selectedEvents = app.events.length;
  await app.update({ processingEntryIds: Object.freeze(['one', 'two', 'one', 'unknown']) });
  for (const windowId of windowIds) {
    assert.deepEqual(app.pane(windowId).processingEntryIds, new Set(['one', 'two', 'b', 'a', 'root']));
    for (const id of ['one', 'two', 'a', 'b']) {
      const spinners = app.spinners(id, windowId);
      assert.equal(spinners.length, 2);
      assert.ok(spinners.every(icon => icon.findAllByProps({ 'data-host-icon': id }).length === 1));
    }
    for (const id of ['three', 'c']) assert.equal(app.spinners(id, windowId).length, 0);
  }
  await app.update({ processingEntryIds: ['two'] });
  assert.equal(app.spinners('one').length, 0);
  assert.equal(app.spinners('b').length, 2, 'one unfinished descendant keeps its ancestors spinning');
  await app.update({ processingEntryIds: undefined });
  assert.equal(app.main.processingEntryIds.size, 0);
  assert.equal(app.spinners('b').length, 0);
  assert.equal(app.main.entries, before);
  assert.equal(app.main.dirty, false);
  assert.equal(app.main.editMode, 'view');
  assert.deepEqual(app.main.selected, ['one']);
  assert.equal(app.events.length, selectedEvents, 'presentation updates emit no operation events');
});

test('processing follows current parents after moves, deletes and discard without blocking navigation or editing', async t => {
  const app = await mount(t, { processingEntryIds: ['one'] });
  await change(() => app.main.navigate('b'));
  assert.equal(app.main.currentParent, 'b');
  await change(() => app.main.act('move', ['one'], { parent: 'c' }));
  assert.deepEqual(app.main.processingEntryIds, new Set(['one', 'c', 'root']));
  assert.equal(app.spinners('b').length, 0);
  await change(() => app.main.act('delete', ['one']));
  assert.equal(app.main.processingEntryIds.size, 0, 'a removed ID is ignored while the host catches up');
  await change(() => app.workspace.draft.discard());
  assert.deepEqual(app.main.processingEntryIds, new Set(['one', 'b', 'a', 'root']));
});

test('read-only views accept folder/root IDs without marking descendants or creating changes', async t => {
  const app = await mount(t, { onSave: undefined, processingEntryIds: ['b'] });
  assert.equal(app.main.readOnly, true);
  assert.deepEqual(app.main.processingEntryIds, new Set(['b', 'a', 'root']));
  assert.equal(app.spinners('one').length, 0);
  await app.update({ processingEntryIds: ['root', 'missing'] });
  assert.deepEqual(app.main.processingEntryIds, new Set(['root']));
  await app.update({ processingEntryIds: ['missing'] });
  assert.equal(app.main.processingEntryIds.size, 0);
  assert.equal(app.main.dirty, false);
});

test('host indicators survive saving and do not enter the save payload or dirty tracking', async t => {
  const saved = deferred(), payloads = [];
  const app = await mount(t, { processingEntryIds: ['one'], onSave: payload => { payloads.push(payload); return saved.promise; } });
  await change(() => app.main.act('favorite', ['one']));
  const before = app.main.entries;
  let saving;
  await change(() => { saving = app.workspace.draft.save(); });
  assert.equal(app.main.saving, true);
  await app.update({ processingEntryIds: ['one', 'three'] });
  assert.equal(app.spinners('one').length, 2);
  assert.equal(app.spinners('three').length, 2);
  assert.deepEqual(payloads[0].entries, before, 'save contains the exact draft entries, without processing flags');
  assert.equal('processingEntryIds' in payloads[0], false);
  await change(async () => { saved.resolve(); await saving; });
  assert.equal(app.main.dirty, false);
  assert.deepEqual(app.main.processingEntryIds, new Set(['one', 'three', 'b', 'a', 'root']));
});

test('refreshing re-evaluates host IDs against the newly loaded hierarchy', async t => {
  const refreshed = deferred();
  const app = await mount(t, { processingEntryIds: ['one'], onRefresh: () => refreshed.promise });
  let refreshing;
  await change(() => { refreshing = app.workspace.draft.refresh(); });
  assert.equal(app.main.refreshing, true);
  assert.equal(app.spinners('one').length, 2);
  await change(async () => {
    refreshed.resolve(initialEntries.map(item => item.id === 'one' ? { ...item, parent: 'c' } : item));
    await refreshing;
  });
  assert.deepEqual(app.main.processingEntryIds, new Set(['one', 'c', 'root']));
  assert.equal(app.main.dirty, false);
});
