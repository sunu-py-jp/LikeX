import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerFolderView } from './src/state/use-explorer-folder-view.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
  export { ExplorerHeader } from './src/ui/explorer-header.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
  export { ExplorerStatusBar } from './src/ui/explorer-status-bar.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-search-flow.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'search-flow' }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'search-flow' }));
  builder.onLoad({ filter: /.*/, namespace: 'search-flow' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
    ? 'export const createPortal = children => children;'
    : `import { createElement, cloneElement, isValidElement } from 'react';
      function family(kind) {
        return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
          'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
          ({ children, open, asChild, ...props }) => {
            if (part === 'Root' && ['dialog', 'alert'].includes(kind) && open === false) return null;
            if (['Provider', 'Portal'].includes(part) || (part === 'Root' && kind !== 'context')) return children;
            if (asChild && isValidElement(children)) return cloneElement(children, props);
            return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
          }
        ]));
      }
      export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
        Dialog = family('dialog'), AlertDialog = family('alert');`,
  }));
} }] });
const { useExplorerFolderView, useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerHeader, ExplorerFileList, ExplorerStatusBar, ExplorerSidebar } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-search-flow.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('alpha', 'Alpha.txt'), entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested.txt', 'folder')];
const ids = controller => controller.visible.map(item => item.id);
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');

async function mount(t, supplied = {}, ui = false) {
  let workspace, renderer, closed = false, child = false;
  const views = new Map();
  const events = [];
  let props = { initialEntries: initialEntries(), onSave() {}, onEvent: event => events.push(event), ...supplied };
  function Pane({ options, id }) {
    const controller = useExplorerViewController(options, workspace, id, null);
    views.set(id, controller);
    return ui && id === 'main' ? h(ExplorerProvider, { value: controller },
      h(ExplorerHeader), h(ExplorerSidebar), h(ExplorerFileList), h(ExplorerStatusBar)) : null;
  }
  function App() {
    workspace = useExplorerWorkspace(props);
    return h(StrictMode, null, h(Pane, { options: props, id: 'main' }),
      child ? h(Pane, { options: props, id: 'child' }) : null);
  }
  await change(() => { renderer = create(h(App)); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return views.get('main'); }, get child() { return views.get('child'); },
    get workspace() { return workspace; }, get root() { return renderer.root; }, events, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(App))); },
    async showChild() { child = true; await change(() => renderer.update(h(App))); },
  };
}


test('lazy first load shows loading and hydrates the cache without dirty or edit permission', async t => {
  const pending = deferred(), requests = []; let permissions = 0;
  const hook = await mount(t, { initialEntries: [], onEditRequest: () => { permissions++; return true; },
    onLoadFolder: (request, context) => { requests.push({ request, ...context }); return pending.promise; } }, true);
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].request, { folderId: 'root', path: '/' });
  assert.equal(hook.current.folderPending, true); assert.equal(hook.current.dirty, false);
  assert.match(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /フォルダを読み込んでいます/);
  assert.doesNotMatch(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /このフォルダは空です/);
  await change(() => pending.resolve([entry('folder', 'Folder', 'root', 'folder'), entry('alpha', 'Alpha.txt')]));
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']); assert.equal(hook.current.folderPending, false);
  assert.equal(hook.current.dirty, false); assert.equal(permissions, 0);
  assert.equal(hook.root.findAllByType('footer').length, 1);
  assert.match(textOf(hook.root.findByType('footer')), /2 個の項目/);
  assert.doesNotMatch(textOf(hook.root.findByType('footer')), /取得済み:|全 .* ファイル/);
  const expand = hook.root.findByProps({ 'aria-label': 'Folderを展開' });
  assert.equal(expand.props['aria-expanded'], false); assert.equal(expand.props.tabIndex, 0);
});

test('opening a folder loads direct children once and preserves cached navigation and local edits', async t => {
  const requests = [];
  const hook = await mount(t, { initialEntries: initialEntries().slice(0, 2), folderLoading: { initialLoadedFolderIds: ['root'] },
    onLoadFolder: request => { requests.push(request); return [entry('nested', 'Nested.txt', 'folder')]; } }, true);
  assert.equal(requests.length, 0);
  await change(() => hook.current.navigate('folder'));
  assert.equal(requests.length, 1); assert.deepEqual(requests[0], { folderId: 'folder', path: '/Folder' });
  assert.deepEqual(ids(hook.current), ['nested']); assert.equal(hook.current.dirty, false);
  assert.ok(hook.events.some(event => event.type === 'navigate' && event.location.id === 'folder'));
  await change(() => hook.workspace.commands.handle.execute({ action: 'rename', ids: ['nested'], name: 'Edited.txt' }));
  assert.equal(hook.current.entries.find(item => item.id === 'nested').name, 'Edited.txt'); assert.equal(hook.current.dirty, true);
  await change(() => hook.current.navigate('root')); await change(() => hook.current.navigate('folder'));
  assert.equal(requests.length, 1); assert.equal(hook.current.entries.find(item => item.id === 'nested').name, 'Edited.txt');
});

test('folder failures remain errors until explicit retry, and tree expansion also requests lazy children', async t => {
  let calls = 0;
  const hook = await mount(t, { initialEntries: [entry('folder', 'Folder', 'root', 'folder')], folderLoading: { initialLoadedFolderIds: ['root'] },
    onLoadFolder: () => { calls++; if (calls === 1) throw Error('Folder unavailable'); return [entry('nested', 'Nested.txt', 'folder')]; } }, true);
  await change(() => hook.root.findByProps({ 'aria-label': 'Folderを展開' }).props.onClick());
  assert.equal(calls, 1); assert.equal(hook.current.getFolderLoadState('folder').status, 'error');
  await change(() => hook.current.navigate('folder'));
  assert.equal(calls, 1); assert.equal(hook.current.folderPending, false);
  assert.match(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /Folder unavailable/);
  assert.doesNotMatch(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /このフォルダは空です/);
  const main = hook.root.findByProps({ 'aria-label': 'ファイル一覧' });
  await change(() => main.findAllByType('button').find(button => textOf(button) === '再試行').props.onClick());
  assert.equal(calls, 2); assert.equal(hook.current.folderError, null); assert.deepEqual(ids(hook.current), ['nested']);
});

test('recursive public preparation enables subtree edits and missing descendants block downloads', async t => {
  let downloads = 0;
  const hook = await mount(t, { initialEntries: [entry('folder', 'Folder', 'root', 'folder')], folderLoading: { initialLoadedFolderIds: ['root'] },
    onLoadFolder: ({ folderId }) => folderId === 'folder' ? [entry('child', 'Child', 'folder', 'folder')] : [entry('nested', 'Nested.txt', 'child')],
    onDownloadRequest: () => { downloads++; return { status: 'handed-off' }; } }, true);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.download({ id: 'folder' }), false); }); assert.equal(downloads, 0);
  assert.equal(hook.current.dirty, false);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.execute({ action: 'delete', ids: ['folder'] }), false); });
  assert.equal(hook.current.entries.length, 1); assert.equal(hook.current.dirty, false);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.loadFolder('folder', { recursive: true }), true); });
  assert.equal(hook.current.getFolderLoadState('folder').status, 'loaded'); assert.equal(hook.current.getFolderLoadState('child').status, 'loaded');
  assert.equal(hook.current.dirty, false);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.download({ id: 'folder' }), true); }); assert.equal(downloads, 1);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.execute({ action: 'delete', ids: ['folder'] }), true); });
  assert.deepEqual(hook.current.entries, []);
});

test('loadFolder is unavailable after the main view closes and view leases cancel on unmount', async t => {
  const pending = deferred(); let signal;
  const hook = await mount(t, { initialEntries: [], onLoadFolder: (_request, context) => { signal = context.signal; return pending.promise; } });
  const api = hook.workspace.commands.handle;
  await hook.unmount(); assert.equal(signal.aborted, true); assert.equal(await api.loadFolder('root'), false);
  await change(() => pending.resolve([entry('late', 'Late.txt')]));
});

async function mountFolderView(t, load) {
  let current, renderer, ids = ['root'];
  const defaultView = new EventTarget(), states = new Map();
  const unloaded = { status: 'unloaded', error: null };
  const draft = { folderLoadingEnabled: true, folderLoadRevision: 0, saving: false, refreshing: false,
    loadFolder: load, getFolderLoadState: id => states.get(id) ?? unloaded };
  const ownerDocument = { defaultView };
  function Harness() { current = useExplorerFolderView(draft, ids, ownerDocument); return null; }
  await change(() => { renderer = create(h(StrictMode, null, h(Harness))); });
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return current; }, states, defaultView,
    async update(patch = {}, nextIds = ids) {
      Object.assign(draft, patch); ids = nextIds;
      await change(() => renderer.update(h(StrictMode, null, h(Harness))));
    } };
}

test('an unloaded false result stops automatic retries and permits explicit retry', async t => {
  let calls = 0;
  const hook = await mountFolderView(t, async () => { calls++; return false; });
  // StrictMode may initially cancel one probe lease; count only settled initial attempts.
  const settledCalls = calls;
  assert.equal(hook.current.getFolderLoadState('root').status, 'error');
  await hook.update({ folderLoadRevision: 1 }); await hook.update({ folderLoadRevision: 2 });
  assert.equal(calls, settledCalls);
  await change(async () => { assert.equal(await hook.current.loadFolder('root'), false); });
  assert.equal(calls, settledCalls + 1);
  assert.equal(hook.current.getFolderLoadState('root').status, 'error');
});

test('a load interrupted by saving retries once after the draft returns to idle', async t => {
  const requests = [];
  const hook = await mountFolderView(t, (_id, options) => {
    const pending = deferred(); requests.push({ ...pending, ...options });
    options.signal.addEventListener('abort', () => pending.resolve(false), { once: true });
    return pending.promise;
  });
  const active = requests.at(-1), firstCount = requests.length;
  await hook.update({ saving: true });
  await change(() => active.resolve(false));
  assert.equal(requests.length, firstCount);
  await hook.update({ saving: false });
  assert.equal(requests.length, firstCount + 1);
  hook.states.set('root', { status: 'loaded', error: null });
  await change(() => requests.at(-1).resolve(true));
  assert.equal(hook.current.getFolderLoadState('root').status, 'loaded');
});

test('BFCache restoration resumes wanted folders and target changes cancel obsolete view leases', async t => {
  const requests = [];
  const hook = await mountFolderView(t, (id, options) => {
    const pending = deferred(); requests.push({ id, ...pending, ...options });
    options.signal.addEventListener('abort', () => pending.resolve(false), { once: true });
    return pending.promise;
  });
  const initial = requests.at(-1), firstCount = requests.length;
  await change(() => hook.defaultView.dispatchEvent(new Event('pagehide')));
  assert.equal(initial.signal.aborted, true); assert.equal(requests.length, firstCount);
  await change(() => hook.defaultView.dispatchEvent(new Event('pageshow')));
  assert.equal(requests.length, firstCount + 1); assert.equal(requests.at(-1).id, 'root');
  const restored = requests.at(-1);
  await hook.update({}, ['child']);
  assert.equal(restored.signal.aborted, true); assert.equal(requests.at(-1).id, 'child');
  hook.states.set('child', { status: 'loaded', error: null });
  await change(() => requests.at(-1).resolve(true));
});


test('cached rows remain usable while folder loading fails and retries outside the scroll container', async t => {
  const pending = deferred();
  const hook = await mount(t, { initialEntries: [entry('alpha', 'Alpha.txt')], onLoadFolder: () => pending.promise }, true);
  const list = () => hook.root.findByProps({ 'aria-label': 'ファイル一覧' });
  assert.deepEqual(ids(hook.current), ['alpha']); assert.equal(list().props['aria-busy'], true);
  const row = () => list().findByProps({ 'data-explorer-entry-id': 'alpha' });
  assert.ok(row());
  await change(() => hook.current.setSelected(['alpha']));
  await change(() => pending.reject(Error('Network interrupted')));
  assert.deepEqual(hook.current.selected, ['alpha']); assert.ok(row());
  const alert = list().findByProps({ role: 'alert' });
  assert.match(textOf(alert), /取得済みの1件/); assert.match(textOf(alert), /Network interrupted/);
  let ancestor = alert.parent;
  while (ancestor && ancestor !== list()) { assert.equal(ancestor.props['data-explorer-drag-scroll'], undefined); ancestor = ancestor.parent; }
  await hook.update({ onLoadFolder: () => [entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt')] });
  assert.equal(hook.current.folderError, 'Network interrupted');
  await change(() => alert.findByType('button').props.onClick());
  assert.equal(hook.current.folderError, null); assert.deepEqual(ids(hook.current), ['alpha', 'beta']);
  assert.deepEqual(hook.current.selected, ['alpha']);
});
