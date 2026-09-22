import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
      export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-host-navigation.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);

const entry = (id, name, parent = 'root', kind = 'file') => ({
  id, parent, name, kind, size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z', favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
});
const initialEntries = () => [
  entry('projects', 'Projects', 'root', 'folder'),
  entry('docs', '資料', 'projects', 'folder'),
  entry('archive', 'Archive', 'root', 'folder'),
  entry('note', 'Notes.TXT', 'docs'),
  entry('second', 'Second.txt', 'docs'),
  entry('archived', 'Notes.TXT', 'archive'),
  entry('root-file', 'README.md'),
];
const change = async callback => { await act(async () => { await callback(); }); };

async function mount(t, supplied = {}) {
  const events = [], saves = [], reads = [], renders = [];
  const ref = createRef();
  const panes = new Map();
  let props = {
    ref, initialEntries: initialEntries(), onSave: payload => { saves.push(payload); },
    readFile: async request => { reads.push(request); return new Blob(['text']); },
    onEvent: event => { events.push(event); }, ...supplied,
  };
  let latestWorkspace, renderer;
  let key = 'first', paneKey = 0, windows = ['main'];
  function Pane({ options, workspace, windowId }) {
    const controller = useExplorerViewController(options, workspace, windowId, null);
    panes.set(windowId, controller);
    renders.push({ windowId, location: controller.location, selected: [...controller.selected] });
    return null;
  }
  function Probe({ options }) {
    latestWorkspace = useExplorerWorkspace(options);
    return windows.map(windowId => h(Pane, { key: `${windowId}:${paneKey}`, options, workspace: latestWorkspace, windowId }));
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props, key }));
  t.after(async () => { if (renderer) await change(() => renderer.unmount()); });
  await change(() => { renderer = create(tree()); });
  return {
    ref,
    async showPane(show) { windows = show ? ['main'] : []; await change(() => renderer.update(tree())); },
    async unmount() { await change(() => renderer.unmount()); renderer = null; },
    get current() { return panes.get('main'); },
    get workspace() { return latestWorkspace; },
    events, saves, reads, renders, panes,
    async update(patch, nextKey = key) {
      props = { ...props, ...patch }; key = nextKey;
      await change(() => renderer.update(tree()));
    },
    async remountPanes() {
      paneKey++;
      await change(() => renderer.update(tree()));
    },
    async detach(tabId) {
      await change(() => {
        assert.equal(latestWorkspace.tabs.detachTab(tabId, 'popup', 'main'), true);
        windows = ['main', 'popup'];
        renderer.update(tree());
      });
    },
  };
}
const previewEvents = hook => hook.events.filter(event => event.type === 'preview');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('ref reads isolated live metadata and edits explicit targets through the shared GUI draft', async t => {
  const hook = await mount(t);
  const api = hook.ref.current;
  const observed = api.getEntries();
  observed[0].name = 'External';
  observed.find(item => item.id === 'note').source.id = 'External';
  assert.equal(api.getEntries()[0].name, 'Projects');
  assert.equal(api.getEntries().find(item => item.id === 'note').source.id, 'content-note');
  await change(() => api.selectFiles([{ id: 'root-file' }]));
  await change(async () => {
    assert.equal(await api.execute({ action: 'delete' }), false, 'omitted IDs must not use the current selection');
    assert.equal(await api.execute({ action: 'delete', ids: 123 }), false, 'malformed JSON arguments follow the normal failure contract');
    assert.equal(await api.execute({ action: 'rename', ids: ['note'], name: 'Renamed.txt' }), true);
    assert.equal(api.getEntries().find(item => item.id === 'note').path, '/Projects/資料/Renamed.txt');
    assert.equal(await api.execute({ action: 'rename', ids: ['note'], name: 'Renamed.csv' }), false);
    assert.equal(await api.execute({ action: 'move', ids: ['note'], parent: 'archive' }), true);
    assert.equal(await api.execute({ action: 'favorite', ids: ['note'] }), true);
    assert.equal(await api.execute({ action: 'create', parent: 'docs', name: 'Created' }), true);
  });
  assert.equal(hook.current.dirty, true);
  assert.deepEqual(hook.events.filter(event => event.type === 'change').map(event => event.action), ['rename', 'move', 'favorite', 'create']);
  await change(async () => assert.equal(await api.save(), true));
  assert.equal(hook.saves.length, 1);
  assert.equal(hook.saves[0].entries.find(item => item.id === 'note').parent, 'archive');
  assert.equal(hook.current.dirty, false);
  await change(async () => {
    assert.equal(await api.execute({ action: 'delete', ids: ['note'] }), true);
    assert.equal(await api.discard(), true);
  });
  assert.ok(api.getEntries().some(item => item.id === 'note'));
  assert.equal(hook.current.dirty, false);
});

test('retained edit refs respect updated feature, read-only, permission and active-view gates', async t => {
  const permission = deferred();
  const requests = [];
  const hook = await mount(t, { onEditRequest: request => { requests.push(request); return permission.promise; } });
  const api = hook.ref.current;
  await hook.update({ features: { rename: false } });
  await change(async () => assert.equal(await api.execute({ action: 'rename', ids: ['note'], name: 'Blocked.txt' }), false));
  assert.equal(requests.length, 0);
  await hook.update({ features: { rename: true } });
  let pending;
  await change(() => { pending = api.execute({ action: 'rename', ids: ['note'], name: 'Stale.txt' }); });
  assert.equal(requests.length, 1);
  await change(() => api.navigate('/Archive'));
  await change(async () => { permission.resolve(true); assert.equal(await pending, false); });
  assert.equal(api.getEntries().find(item => item.id === 'note').name, 'Notes.TXT');
  await hook.update({ onEditRequest: undefined, readOnly: true });
  await change(async () => {
    assert.equal(await api.execute({ action: 'delete', ids: ['note'] }), false);
    assert.equal(await api.upload([new File(['x'], 'new.txt')], 'root'), false);
    assert.equal(await api.save(), false);
    assert.equal(await api.discard(), false);
  });
  assert.equal(hook.current.dirty, false);
});

test('save locks all ref mutations and closed panes never queue retained commands', async t => {
  const saving = deferred();
  const hook = await mount(t, { onSave: () => saving.promise });
  const api = hook.ref.current;
  await change(() => api.execute({ action: 'rename', ids: ['note'], name: 'Saved.txt' }));
  let pending;
  await change(() => { pending = api.save(); });
  await change(async () => {
    assert.equal(await api.execute({ action: 'delete', ids: ['note'] }), false);
    assert.equal(await api.upload([new File(['x'], 'new.txt')], 'root'), false);
    assert.equal(await api.discard(), false);
    assert.equal(await api.refresh(), false);
  });
  await change(async () => { saving.resolve(); assert.equal(await pending, true); });
  await hook.showPane(false);
  assert.equal(api.getEntries(), null);
  assert.equal(await api.execute({ action: 'delete', ids: ['note'] }), false);
  assert.equal(await api.upload([new File(['x'], 'new.txt')], 'root'), false);
  assert.equal(await api.save(), false);
  assert.equal(await api.discard(), false);
  assert.equal(await api.download({ id: 'note' }), false);
  await hook.showPane(true);
  assert.equal(api.getEntries().find(item => item.id === 'note').name, 'Saved.txt');
  await hook.unmount();
  assert.equal(api.getEntries(), null);
  assert.equal(await api.execute({ action: 'delete', ids: ['note'] }), false);
});

test('ref upload shares conflict confirmation, validation, cancellation and feature gates', async t => {
  const hook = await mount(t);
  const api = hook.ref.current;
  const replacement = new File(['replacement'], 'Notes.TXT', { type: 'text/plain' });
  let pending;
  await change(() => { pending = api.upload([replacement], 'docs'); });
  assert.equal(hook.current.uploadPrompt.conflict.existing.id, 'note');
  assert.equal(hook.current.dirty, false);
  await change(async () => { await hook.current.answerUploadConflict('overwrite', false); assert.equal(await pending, true); });
  assert.equal(api.getEntries().find(item => item.id === 'note').source.file, replacement);
  await change(() => { pending = api.upload([replacement], 'docs'); });
  await change(async () => { hook.current.cancelUpload(); assert.equal(await pending, false); });
  await hook.update({ upload: { allowedExtensions: ['.txt'] } });
  await change(async () => assert.equal(await api.upload([new File(['x'], 'blocked.csv')], 'root'), false));
  assert.equal(api.getEntries().some(item => item.name === 'blocked.csv'), false);
  await hook.update({ features: { uploadFiles: false } });
  await change(async () => assert.equal(await api.upload([new File(['x'], 'blocked.txt')], 'root'), false));
  assert.equal(api.getEntries().some(item => item.name === 'blocked.txt'), false);
});

test('ref refresh preserves dirty data until the shared confirmation succeeds', async t => {
  let calls = 0;
  const hook = await mount(t, { onRefresh: () => { calls++; return initialEntries(); } });
  const api = hook.ref.current;
  await change(async () => {
    assert.equal(await api.execute({ action: 'rename', ids: ['note'], name: 'Dirty.txt' }), true);
    assert.equal(await api.refresh(), false, 'same-tick edits must still require discard confirmation');
  });
  assert.equal(calls, 0);
  assert.equal(hook.current.modal.type, 'refresh');
  assert.equal(api.getEntries().find(item => item.id === 'note').name, 'Dirty.txt');
  await change(async () => assert.equal(await hook.current.submitModal(), true));
  assert.equal(calls, 1);
  assert.equal(hook.current.dirty, false);
});

test('ref download resolves current file/folder targets and shares the GUI host lifecycle', async t => {
  const requests = [];
  const hook = await mount(t, { onDownloadRequest: (request, context) => {
    requests.push({ request, context }); return { status: 'completed' };
  } });
  const api = hook.ref.current;
  await change(async () => {
    assert.equal(await api.execute({ action: 'rename', ids: ['note'], name: 'Current.txt' }), true);
    assert.equal(await api.download({ path: '/Projects/資料/Current.txt' }), true);
    assert.equal(await api.download({ id: 'docs' }), true);
  });
  assert.equal(requests[0].request.name, 'Current.txt');
  assert.equal(requests[1].request.kind, 'folder');
  assert.equal(requests[1].context.items.some(item => item.name === 'Current.txt'), true);
  await hook.update({ features: { download: false } });
  assert.equal(await api.download({ id: 'note' }), false);
  assert.equal(requests.length, 2);
});

test('selectEntries supports folders and mixed-parent search results without changing the search', async t => {
  const hook = await mount(t);
  const api = hook.ref.current;
  await change(() => assert.equal(api.selectEntries([{ id: 'docs' }]).ok, true));
  assert.equal(hook.current.location, 'projects');
  assert.deepEqual(hook.current.selected, ['docs']);
  await change(() => hook.current.setQuery('Notes'));
  await change(() => assert.equal(api.selectEntries([{ id: 'note' }, { id: 'archived' }]).ok, true));
  assert.equal(hook.current.query, 'Notes');
  assert.deepEqual(hook.current.selected, ['note', 'archived']);
  await change(() => {
    api.navigate('/');
    assert.equal(api.selectEntries([{ id: 'note' }, { id: 'archived' }]).code, 'not-visible', 'stale search results cannot authorize an invisible selection');
  });
  assert.deepEqual(hook.current.selected, []);
  await hook.update({ selection: { mode: 'none' } });
  await change(() => assert.equal(api.previewFile({ id: 'note' }).ok, true));
  assert.equal(hook.current.preview.id, 'note');
  assert.deepEqual(hook.current.selected, []);
});

test('ref navigates and selects by ID or path without resetting the dirty draft', async t => {
  const hook = await mount(t);
  await change(() => hook.workspace.draft.apply({ action: 'rename', ids: ['root-file'], name: 'Draft.md' }));
  const entries = hook.workspace.draft.getEntries();
  await change(() => assert.deepEqual(hook.ref.current.navigate('/Projects/資料'), { ok: true }));
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, []);
  assert.deepEqual(hook.current.history, ['root', 'docs']);
  await change(() => assert.deepEqual(hook.ref.current.selectFiles([{ id: 'note' }, { path: '/Projects/資料/Second.txt' }]), { ok: true }));
  assert.deepEqual(hook.current.selected, ['note', 'second']);
  assert.equal(hook.current.anchor, 'note');
  assert.deepEqual(hook.current.history, ['root', 'docs'], 'selection in the same folder creates no extra history');
  assert.equal(hook.current.revealRequest.id, 'note');
  assert.equal(hook.workspace.draft.getEntries(), entries);
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.events.filter(event => event.type === 'navigate').length, 1);
  assert.equal(hook.events.filter(event => event.type === 'selection').length, 1);
  assert.deepEqual(hook.saves, []);
});

test('a retained handle sees same-tick renames, moves, navigation and previews', async t => {
  const requests = [];
  const hook = await mount(t, { onPreviewRequest: request => requests.push(request) });
  const api = hook.ref.current;
  await change(() => {
    hook.workspace.draft.apply({ action: 'rename', ids: ['note'], name: 'New.txt' });
    hook.workspace.draft.apply({ action: 'move', ids: ['note'], parent: 'archive' });
    assert.deepEqual(api.navigate('/Projects'), { ok: true });
    assert.deepEqual(api.showFile({ path: '/Archive/New.txt' }, { mode: 'preview' }), { ok: true });
  });
  assert.equal(hook.current.location, 'archive');
  assert.deepEqual(hook.current.selected, ['note']);
  assert.deepEqual(hook.current.history, ['root', 'projects', 'archive']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/Archive/New.txt');
  assert.equal(requests[0].name, 'New.txt');
  await hook.update({ onPreviewRequest: request => requests.push({ ...request, replaced: true }) });
  await change(() => api.showFile({ id: 'note' }, { mode: 'preview' }));
  assert.equal(requests[1].replaced, true);
});

test('invalid targets and mixed folders do not change the location, selection, search, or open preview', async t => {
  const hook = await mount(t);
  await change(() => hook.ref.current.showFile({ id: 'note' }, { mode: 'preview' }));
  await change(() => hook.current.setQuery('Notes'));
  const before = hook.workspace.tabs.activeTab;
  const preview = hook.current.previewId;
  const cases = [
    [() => hook.ref.current.navigate('/missing'), 'not-found'],
    [() => hook.ref.current.navigate('/Projects/資料/Notes.TXT'), 'not-folder'],
    [() => hook.ref.current.selectFiles([{ id: 'note' }, { id: 'archived' }]), 'different-folders'],
    [() => hook.ref.current.selectFiles([{ id: 'note' }, { id: 'missing' }]), 'not-found'],
    [() => hook.ref.current.showFile({ id: 'docs' }), 'not-file'],
    [() => hook.ref.current.showFile({ id: 'note' }, { mode: 'invalid' }), 'invalid-mode'],
  ];
  for (const [call, code] of cases) await change(() => {
    const result = call();
    assert.equal(result.ok, false); assert.equal(result.code, code);
  });
  assert.equal(hook.workspace.tabs.activeTab, before);
  assert.equal(hook.current.previewId, preview);
});

test('host navigation clears search and preserves back/forward history; empty targets only clear selection', async t => {
  const hook = await mount(t);
  await change(() => hook.current.setQuery('no result'));
  await change(() => hook.ref.current.showFile({ id: 'note' }));
  assert.equal(hook.current.query, '');
  assert.equal(hook.current.searchText, '');
  assert.deepEqual(hook.current.selected, ['note']);
  await change(() => hook.ref.current.navigate('/Archive'));
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.location, 'docs');
  await change(() => hook.ref.current.showFile({ id: 'note' }));
  assert.deepEqual(hook.current.history, ['root', 'docs', 'archive']);
  await change(() => hook.ref.current.selectFiles([]));
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.anchor, null);
  await change(() => hook.current.travel(1));
  assert.equal(hook.current.location, 'archive');
});

test('clearing the selection leaves an open preview and search in place', async t => {
  const hook = await mount(t);
  await change(() => hook.ref.current.showFile({ id: 'note' }, { mode: 'preview' }));
  await change(() => hook.current.setQuery('Notes'));
  await change(() => hook.current.setSelected(['note']));
  const history = hook.current.history;
  await change(() => assert.equal(hook.ref.current.selectFiles([]).ok, true));
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.query, 'Notes');
  assert.equal(hook.current.preview.id, 'note');
  assert.equal(hook.current.history, history);
  await hook.update({ selection: { mode: 'none' } });
  await change(() => assert.equal(hook.ref.current.selectFiles([]).ok, true));
});

test('main active tab is targeted even with detached panes; other tabs retain state', async t => {
  const hook = await mount(t);
  const first = hook.current.activeTabId;
  await change(() => hook.current.addTab());
  const second = hook.current.activeTabId;
  await change(() => hook.ref.current.showFile({ id: 'note' }));
  await hook.detach(second);
  await change(() => hook.ref.current.showFile({ id: 'archived' }));
  assert.equal(hook.current.activeTabId, first);
  assert.equal(hook.current.location, 'archive');
  assert.deepEqual(hook.current.selected, ['archived']);
  assert.equal(hook.panes.get('popup').location, 'docs');
  assert.deepEqual(hook.panes.get('popup').selected, ['note']);
});

test('a closed pane and a stale unmounted ref return not-ready without queuing commands', async t => {
  const hook = await mount(t);
  const api = hook.ref.current;
  await hook.showPane(false);
  assert.equal(api.navigate('/Projects').code, 'not-ready');
  assert.equal(api.selectFiles([{ id: 'note' }]).code, 'not-ready');
  assert.equal(api.showFile({ id: 'note' }).code, 'not-ready');
  await hook.showPane(true);
  assert.equal(hook.current.location, 'root');
  await change(() => api.showFile({ id: 'note' }));
  assert.equal(hook.current.location, 'docs');
  await hook.unmount();
  assert.equal(hook.ref.current, null);
  assert.equal(api.navigate('/').code, 'not-ready');
});

test('read-only mode and disabled address editing still permit navigation without edit permission', async t => {
  const requests = [], edits = [];
  const hook = await mount(t, { onSave: undefined, features: { pathInput: false },
    onPreviewRequest: request => requests.push(request), onEditRequest: request => { edits.push(request); return false; } });
  await change(() => {
    assert.equal(hook.ref.current.navigate('/Projects').ok, true);
    assert.equal(hook.ref.current.showFile({ id: 'note' }, { mode: 'preview' }).ok, true);
  });
  assert.equal(hook.current.readOnly, true);
  assert.equal(hook.current.dirty, false);
  assert.equal(requests.length, 1);
  assert.equal(edits.length, 0);
});

test('selection and preview policies reject the whole command and use updated props', async t => {
  const hook = await mount(t, { selection: { mode: 'none' } });
  const api = hook.ref.current;
  await change(() => assert.deepEqual(api.showFile({ id: 'note' }, { mode: 'preview' }), { ok: true }));
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.preview.id, 'note');
  assert.equal(api.selectFiles([{ id: 'note' }]).code, 'selection-disabled');
  assert.equal(hook.current.location, 'docs');
  await hook.update({ selection: { mode: 'single' } });
  assert.equal(api.selectFiles([{ id: 'note' }, { id: 'second' }]).code, 'selection-limit');
  await change(() => assert.equal(api.selectFiles([{ id: 'note' }, { path: '/Projects/資料/Notes.TXT' }]).ok, true));
  assert.deepEqual(hook.current.selected, ['note']);
  await hook.update({ features: { preview: false } });
  assert.equal(api.showFile({ id: 'root-file' }, { mode: 'preview' }).code, 'preview-disabled');
  assert.equal(hook.current.location, 'docs');
  await change(() => assert.equal(api.showFile({ id: 'root-file' }).ok, true));
  assert.equal(hook.current.location, 'root');
});

test('built-in previews open once and external preview failures use existing notifications', async t => {
  const hook = await mount(t);
  await change(() => hook.ref.current.showFile({ id: 'note' }, { mode: 'preview' }));
  assert.equal(hook.current.preview.id, 'note');
  assert.equal(previewEvents(hook).length, 1);
  await hook.update({ onPreviewRequest: async () => { throw new Error('Preview failed'); } });
  await change(() => assert.equal(hook.ref.current.showFile({ id: 'root-file' }, { mode: 'preview' }).ok, true));
  assert.equal(hook.current.notification.message, 'Preview failed');
  assert.equal(hook.current.preview, undefined);
  assert.deepEqual(hook.current.selected, ['root-file']);
  assert.equal(previewEvents(hook).length, 2);
});

test('an explicit request from the mounted ref supersedes a pending initial preview', async t => {
  const requests = [];
  const hook = await mount(t, { selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => requests.push(request),
    ref: api => { if (api) assert.equal(api.showFile({ id: 'root-file' }, { mode: 'preview' }).ok, true); },
  });
  assert.equal(hook.current.location, 'root');
  assert.deepEqual(hook.current.selected, ['root-file']);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.id === 'root-file'));
});
