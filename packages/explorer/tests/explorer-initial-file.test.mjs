import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
      export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-initial-file.ts',
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
  entry('archived', 'Notes.TXT', 'archive'),
  entry('root-file', 'README.md'),
];
const change = async callback => { await act(async () => { await callback(); }); };

async function mount(t, supplied = {}) {
  const events = [], saves = [], reads = [], renders = [];
  const panes = new Map();
  let props = {
    initialEntries: initialEntries(), onSave: payload => { saves.push(payload); },
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

test('initialPath and selectedFile are reflected on every first render without preview or edit side effects', async t => {
  const requests = [];
  const hook = await mount(t, {
    initialPath: '/Projects/資料', defaultPath: '/Archive', selectedFile: 'note',
    onPreviewRequest: request => { requests.push(request); },
  });
  assert.ok(hook.renders.every(render => render.location === 'docs' && render.selected.join() === 'note'));
  assert.equal(hook.current.addressPath, '/Projects/資料');
  assert.deepEqual(hook.current.history, ['docs']);
  assert.deepEqual(hook.current.expanded, ['root', 'projects', 'docs']);
  assert.equal(hook.current.anchor, 'note');
  assert.equal(hook.current.preview, undefined);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification, null);
  assert.deepEqual(hook.events, []);
  assert.deepEqual(requests, []);
  assert.deepEqual(hook.reads, []);
  assert.deepEqual(hook.saves, []);
});

test('selectedFile alone opens its parent while new tabs retain defaultPath and no initial selection', async t => {
  const hook = await mount(t, { defaultPath: '/Archive', selectedFile: 'note' });
  const first = hook.current.activeTabId;
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, ['note']);
  await change(() => hook.current.addTab());
  assert.equal(hook.current.location, 'archive');
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.anchor, null);
  await change(() => hook.current.selectTab(first));
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, ['note']);
});

test('preview mode opens the built-in viewer once under StrictMode without reading or saving in the controller', async t => {
  const hook = await mount(t, { selectedFile: 'note', selectedFileMode: 'preview' });
  assert.equal(hook.current.preview?.id, 'note');
  assert.deepEqual(hook.current.selected, ['note']);
  assert.equal(previewEvents(hook).length, 1);
  assert.equal(previewEvents(hook)[0].external, false);
  assert.equal(previewEvents(hook)[0].request.path, '/Projects/資料/Notes.TXT');
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.reads, []);
  assert.deepEqual(hook.saves, []);
});

test('preview mode uses the existing external request and event metadata once under StrictMode', async t => {
  const requests = [];
  const hook = await mount(t, {
    selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => { requests.push(request); },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, 'note');
  assert.equal(requests[0].name, 'Notes.TXT');
  assert.equal(requests[0].extension, 'txt');
  assert.equal(requests[0].path, '/Projects/資料/Notes.TXT');
  assert.deepEqual(requests[0].source, { kind: 'existing', id: 'content-note' });
  assert.equal(previewEvents(hook).length, 1);
  assert.equal(previewEvents(hook)[0].external, true);
  assert.equal(hook.current.preview, undefined);
  assert.deepEqual(hook.current.selected, ['note']);
});

test('read-only mode permits initial selection and preview without an edit permission request', async t => {
  const requests = [], edits = [];
  const hook = await mount(t, {
    onSave: undefined, selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => { requests.push(request); },
    onEditRequest: request => { edits.push(request); return false; },
  });
  assert.equal(hook.current.readOnly, true);
  assert.deepEqual(hook.current.selected, ['note']);
  assert.equal(requests.length, 1);
  assert.deepEqual(edits, []);
  assert.equal(hook.current.dirty, false);
});

test('preview disabled still selects the initial file and never replays its request after enabling preview', async t => {
  const requests = [];
  const hook = await mount(t, {
    selectedFile: 'note', selectedFileMode: 'preview', features: { preview: false },
    onPreviewRequest: request => { requests.push(request); },
  });
  assert.deepEqual(hook.current.selected, ['note']);
  assert.equal(hook.current.preview, undefined);
  assert.deepEqual(requests, []);
  assert.deepEqual(previewEvents(hook), []);
  await hook.update({ features: { preview: true } });
  assert.deepEqual(requests, []);
  assert.deepEqual(previewEvents(hook), []);
});

test('selection mode none suppresses selection and anchor while still permitting requested preview', async t => {
  const requests = [];
  const hook = await mount(t, {
    selectedFile: 'note', selectedFileMode: 'preview', selection: { mode: 'none' },
    onPreviewRequest: request => { requests.push(request); },
  });
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.anchor, null);
  assert.equal(requests.length, 1);
  await hook.update({ selection: { mode: 'multiple' } });
  assert.deepEqual(hook.current.selected, [], 'enabling selection does not replay initialization');
});

test('changing initial props, adding tabs, or remounting panes never replays the initial preview', async t => {
  const requests = [], replacementRequests = [];
  const hook = await mount(t, {
    initialPath: '/Projects/資料', defaultPath: '/Archive', selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => { requests.push(request); },
  });
  const first = hook.current.activeTabId;
  await hook.update({ initialPath: '/', selectedFile: 'root-file', onPreviewRequest: request => { replacementRequests.push(request); } });
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.selected, ['note']);
  await hook.remountPanes();
  assert.deepEqual(hook.current.selected, ['note']);
  await change(() => hook.current.addTab());
  assert.equal(hook.current.location, 'archive');
  assert.deepEqual(hook.current.selected, []);
  await change(() => hook.current.selectTab(first));
  assert.deepEqual(hook.current.selected, ['note']);
  await hook.detach(first);
  assert.equal(hook.panes.get('popup').location, 'docs');
  assert.deepEqual(hook.panes.get('popup').selected, ['note']);
  await hook.remountPanes();
  assert.equal(requests.length, 1);
  assert.deepEqual(replacementRequests, []);
  assert.equal(previewEvents(hook).length, 1);
});

test('a new workspace key applies the new initial path, file, and preview request exactly once', async t => {
  const requests = [];
  const hook = await mount(t, {
    selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => { requests.push(request); },
  });
  await change(() => hook.current.navigate('archive'));
  await hook.update({ initialPath: '/', selectedFile: 'root-file' }, 'second');
  assert.equal(hook.current.location, 'root');
  assert.deepEqual(hook.current.selected, ['root-file']);
  assert.deepEqual(requests.map(request => request.id), ['note', 'root-file']);
  assert.equal(previewEvents(hook).length, 2);
  assert.deepEqual(hook.current.history, ['root']);
});

test('explicit path mismatch reports an error and never selects or previews a file from another folder', async t => {
  const requests = [];
  const hook = await mount(t, {
    initialPath: '/Archive', selectedFile: 'note', selectedFileMode: 'preview',
    onPreviewRequest: request => { requests.push(request); },
  });
  assert.equal(hook.current.location, 'archive');
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.preview, undefined);
  assert.equal(hook.current.notification?.kind, 'error');
  assert.match(hook.current.notification?.description ?? hook.current.notification?.message, /初期フォルダにありません/);
  assert.deepEqual(requests, []);
  assert.deepEqual(previewEvents(hook), []);
});

test('unknown IDs, folder IDs and invalid paths do not emit preview requests', async t => {
  for (const options of [
    { initialPath: '/Archive', selectedFile: 'missing', location: 'archive' },
    { initialPath: '/Archive', selectedFile: 'docs', location: 'archive' },
    { initialPath: '/missing', selectedFile: 'note', location: 'root' },
  ]) {
    await t.test(JSON.stringify(options), async t => {
      const requests = [];
      const { location, ...props } = options;
      const hook = await mount(t, { ...props, selectedFileMode: 'preview', onPreviewRequest: request => { requests.push(request); } });
      assert.equal(hook.current.location, location);
      assert.deepEqual(hook.current.selected, []);
      assert.equal(hook.current.notification?.kind, 'error');
      assert.deepEqual(requests, []);
    });
  }
});
