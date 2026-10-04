import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { FAVORITES, RECENT } from './src/state/view-state.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-empty-state.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
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
const { FAVORITES, RECENT, useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerFileList } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-empty-state.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', favorite: 0 });
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');
const folderTitle = root => root.findAllByType('h3').find(node => textOf(node) === 'このフォルダは空です');

async function mount(t, supplied = {}) {
  let workspace, renderer, latest, closed = false, overrides = {};
  const events = [], pickers = [];
  let props = { initialEntries: [], onSave() {}, onEvent: event => events.push(event), ...supplied };
  function Pane() {
    latest = useExplorerViewController(props, workspace, 'main', null);
    return h(ExplorerProvider, { value: { ...latest, ...overrides } },
      h('input', { type: 'file', ref: latest.fileInput }),
      h('input', { type: 'file', webkitdirectory: '', ref: latest.folderInput }), h(ExplorerFileList));
  }
  function App() { workspace = useExplorerWorkspace(props); return h(StrictMode, null, h(Pane)); }
  await change(() => { renderer = create(h(App), { createNodeMock(element) {
    if (element.type === 'input' && element.props.type === 'file') return {
      value: '', click() { pickers.push(element.props.webkitdirectory === undefined ? 'file' : 'folder'); },
      addEventListener() {}, removeEventListener() {},
    };
    return null;
  } }); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return latest; }, get workspace() { return workspace; }, get root() { return renderer.root; },
    pickers, events, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(App))); },
    async override(patch) { overrides = patch; await change(() => renderer.update(h(App))); },
  };
}

test('empty folder provides standard content and creation actions without the old explanatory subtitle', async t => {
  const contexts = [];
  const ui = await mount(t, { rootLabel: '共有資料', renderEmptyState(context) { contexts.push(context); return undefined; } });
  const context = contexts.at(-1);
  assert.equal(context.reason, 'folder');
  assert.deepEqual(context.location, { kind: 'folder', id: 'root', path: '/', name: '共有資料' });
  assert.equal(context.query, '');
  assert.equal(context.disabled, false);
  assert.deepEqual(Object.keys(context.actions).sort(), ['addFiles', 'addFolders', 'createFolder']);
  assert.ok(context.defaultContent);
  assert.ok(folderTitle(ui.root));
  assert.equal(ui.root.findAllByType('p').length, 0);
  const add = ui.root.findAllByType('button').find(node => textOf(node) === '追加');
  assert.ok(add);
  await change(() => add.props.onClick());
  assert.deepEqual(ui.pickers, ['file']);
  assert.equal(ui.current.dirty, false);
});

test('renderers compose standard content, replace it, hide it, and fall back with null or undefined', async t => {
  const ui = await mount(t, { renderEmptyState: context => h('article', { 'data-custom': 'composed' }, context.defaultContent) });
  assert.equal(ui.root.findAllByProps({ 'data-custom': 'composed' }).length, 1);
  assert.ok(folderTitle(ui.root));
  await ui.update({ renderEmptyState: () => h('div', { 'data-custom': 'replaced' }, '必要な資料を追加してください') });
  assert.equal(folderTitle(ui.root), undefined);
  assert.equal(textOf(ui.root.findByProps({ 'data-custom': 'replaced' })), '必要な資料を追加してください');
  await ui.update({ renderEmptyState: () => false });
  assert.equal(ui.root.findAllByType('h3').length, 0);
  assert.equal(ui.root.findAll(node => Object.hasOwn(node.props, 'data-explorer-custom-empty-state')).length, 0);
  for (const fallback of [null, undefined]) {
    await ui.update({ renderEmptyState: () => fallback });
    assert.ok(folderTitle(ui.root));
  }
  await ui.update({ renderEmptyState: context => context.defaultContent });
  assert.ok(folderTitle(ui.root));
  assert.equal(ui.root.findAll(node => Object.hasOwn(node.props, 'data-explorer-custom-empty-state')).length, 0);
});

test('search, favorites and recent expose accurate empty context without creation actions', async t => {
  const contexts = [];
  const ui = await mount(t, { renderEmptyState: context => { contexts.push(context); return null; } });
  await change(() => ui.current.setQuery('  nonexistent  '));
  assert.equal(contexts.at(-1).reason, 'search');
  assert.equal(contexts.at(-1).query, 'nonexistent');
  assert.deepEqual(contexts.at(-1).actions, {});
  assert.ok(textOf(ui.root).includes('一致するファイルがありません'));
  await change(() => ui.current.navigate(FAVORITES));
  assert.equal(contexts.at(-1).reason, 'favorites');
  assert.equal(contexts.at(-1).location.kind, 'favorites');
  assert.equal(contexts.at(-1).query, '');
  assert.deepEqual(contexts.at(-1).actions, {});
  await change(() => ui.current.navigate(RECENT));
  assert.equal(contexts.at(-1).reason, 'recent');
  assert.equal(contexts.at(-1).location.kind, 'recent');
  assert.deepEqual(contexts.at(-1).actions, {});
  assert.ok(textOf(ui.root).includes('最近更新した項目はありません'));
});

test('nonempty listings and provisional import locations do not invoke the empty renderer', async t => {
  let calls = 0;
  const ui = await mount(t, { initialEntries: [entry('existing', 'Existing.txt')], renderEmptyState() { calls++; return null; } });
  assert.equal(calls, 0);
  await ui.override({ visible: [], pendingImportEntries: [], provisionalLocation: true });
  assert.equal(calls, 0);
  assert.equal(ui.root.findAllByType('h3').length, 0);
  await ui.override({ visible: [], pendingImportEntries: [{
    entry: entry('pending-1', 'Reading.txt'), relativePath: 'Reading.txt',
  }], provisionalLocation: false });
  assert.equal(calls, 0);
});

test('folder loading and errors retain status and retry controls without invoking custom empty content', async t => {
  const first = deferred(), second = deferred();
  let calls = 0, requests = 0;
  const ui = await mount(t, { onLoadFolder() { return ++requests === 1 ? first.promise : second.promise; },
    renderEmptyState() { calls++; return h('p', null, 'custom'); } });
  assert.equal(ui.current.folderPending, true);
  assert.equal(calls, 0);
  assert.ok(ui.root.findAllByProps({ role: 'status' }).some(node => textOf(node).includes('フォルダを読み込んでいます')));
  await change(() => first.reject(new Error('フォルダ取得失敗')));
  assert.equal(calls, 0);
  assert.ok(ui.root.findAllByProps({ role: 'alert' }).some(node => textOf(node).includes('フォルダ取得失敗')));
  const retry = ui.root.findAllByType('button').find(node => textOf(node) === '再試行');
  await change(() => { retry.props.onClick(); });
  assert.equal(requests, 2);
  assert.equal(calls, 0);
  await change(() => second.resolve([]));
  assert.ok(calls > 0);
  assert.ok(textOf(ui.root).includes('custom'));
});

test('search loading and errors cannot be replaced by empty renderers', async t => {
  const result = deferred();
  let calls = 0;
  const ui = await mount(t, { initialEntries: [entry('existing', 'Existing.txt')],
    onSearchRequest: () => result.promise, renderEmptyState() { calls++; return false; } });
  await change(() => ui.current.setQuery('semantic'));
  assert.equal(ui.current.searchPending, true);
  assert.equal(calls, 0);
  assert.ok(textOf(ui.root).includes('検索しています'));
  await change(() => result.reject(new Error('検索取得失敗')));
  assert.equal(calls, 0);
  assert.ok(textOf(ui.root).includes('検索取得失敗'));
  assert.ok(ui.root.findAllByType('button').some(node => textOf(node) === '再試行'));
});

test('provided actions use existing folder creation and native file/folder selection paths', async t => {
  let context;
  const ui = await mount(t, { renderEmptyState(value) { context = value; return null; } });
  await change(() => context.actions.addFolders());
  assert.deepEqual(ui.pickers, ['folder']);
  await change(() => ui.current.acceptChosenFiles([], 'folder'));
  await change(() => context.actions.addFiles());
  assert.deepEqual(ui.pickers, ['folder', 'file']);
  await change(() => ui.current.acceptChosenFiles([], 'file'));
  await change(() => context.actions.createFolder());
  assert.equal(ui.current.modal?.type, 'create');
  assert.equal(ui.current.dirty, false);
  assert.deepEqual(ui.current.entries, []);
});

test('read-only and disabled features omit actions and invalidate previously captured callbacks', async t => {
  let context;
  const ui = await mount(t, { renderEmptyState(value) { context = value; return null; } });
  const captured = context.actions;
  await ui.update({ readOnly: true });
  assert.deepEqual(context.actions, {});
  await change(() => { captured.addFiles(); captured.addFolders(); captured.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await ui.update({ readOnly: false, features: { uploadFiles: false, uploadFolders: false, createFolder: false } });
  assert.deepEqual(context.actions, {});
  await change(() => { captured.addFiles(); captured.addFolders(); captured.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await ui.update({ features: { uploadFiles: false, uploadFolders: true, createFolder: false } });
  assert.deepEqual(Object.keys(context.actions), ['addFolders']);
  assert.ok(ui.root.findAllByType('button').some(node => textOf(node) === 'フォルダを追加'));
  await ui.update({ features: { uploadFiles: false, uploadFolders: false, createFolder: true } });
  assert.deepEqual(Object.keys(context.actions), ['createFolder']);
  assert.ok(ui.root.findAllByType('button').some(node => textOf(node) === 'フォルダを作成'));
});

test('captured actions cannot operate after navigation, query changes, tab changes, deletion or unmount', async t => {
  let context;
  const ui = await mount(t, { initialEntries: [entry('folder', 'Empty', 'root', 'folder')],
    renderEmptyState(value) { context = value; return null; } });
  await change(() => ui.current.navigate('folder'));
  const old = context.actions;
  await change(() => ui.current.navigate('root'));
  await change(() => { old.addFiles(); old.addFolders(); old.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await change(() => ui.current.navigate('folder'));
  const beforeSearch = context.actions;
  await change(() => ui.current.setQuery('nothing'));
  await change(() => { beforeSearch.addFiles(); beforeSearch.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await change(() => ui.current.clearSearch());
  const beforeTab = context.actions;
  await change(() => ui.current.addTab());
  await change(() => { beforeTab.addFiles(); beforeTab.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await change(() => ui.current.navigate('folder'));
  const beforeDelete = context.actions;
  await change(() => {
    ui.workspace.draft.apply({ action: 'delete', ids: ['folder'] });
    beforeDelete.addFiles(); beforeDelete.createFolder();
  });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  await ui.unmount();
  beforeDelete.addFiles(); beforeDelete.createFolder();
  assert.deepEqual(ui.pickers, []);
});

test('busy save disables standard controls and both old and current actions without losing edits', async t => {
  const saved = deferred();
  let context, completion;
  const ui = await mount(t, { initialEntries: [entry('folder', 'Empty', 'root', 'folder')], onSave: () => saved.promise,
    renderEmptyState(value) { context = value; return null; } });
  await change(() => ui.current.navigate('folder'));
  const old = context.actions;
  await change(() => ui.workspace.draft.apply({ action: 'favorite', ids: ['folder'] }));
  await change(() => { completion = ui.workspace.draft.save(); });
  assert.equal(context.disabled, true);
  assert.equal(ui.root.findAllByType('button').find(node => textOf(node) === '追加').props.disabled, true);
  await change(() => { old.addFiles(); old.createFolder(); context.actions.addFolders(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  assert.equal(ui.current.dirty, true);
  await change(async () => { saved.resolve(); await completion; });
  assert.equal(context.disabled, false);
});

test('permission changes and synchronous navigation during permission resolution cannot open an obsolete target', async t => {
  let context;
  const ui = await mount(t, { initialEntries: [entry('folder', 'Empty', 'root', 'folder')],
    renderEmptyState(value) { context = value; return null; } });
  await change(() => ui.current.navigate('folder'));
  const old = context.actions;
  await ui.update({ getEntryPermissions: () => ({ upload: false, createFolder: false }) });
  await change(() => { old.addFiles(); old.createFolder(); });
  assert.deepEqual(ui.pickers, []);
  assert.equal(ui.current.modal, null);
  assert.equal(ui.current.notification?.kind, 'error');
  await ui.update({ getEntryPermissions() { ui.current.navigate('root'); return {}; } });
  await change(() => context.actions.addFiles());
  assert.equal(ui.current.currentParent, 'root');
  assert.deepEqual(ui.pickers, []);
});

test('custom empty content isolates parent interactions without cancelling native input or clipboard behavior', async t => {
  const ui = await mount(t, { renderEmptyState: () => h('textarea', { 'aria-label': '案内コメント' }) });
  const wrapper = ui.root.findByProps({ 'data-explorer-custom-empty-state': true });
  let stopped = 0, prevented = 0;
  for (const handler of ['onClick', 'onKeyDown', 'onCopy', 'onCut', 'onPaste', 'onContextMenu']) {
    wrapper.props[handler]({ stopPropagation() { stopped++; }, preventDefault() { prevented++; } });
  }
  assert.equal(stopped, 6);
  assert.equal(prevented, 0);
  assert.equal(ui.current.modal, null);
  assert.equal(ui.current.dirty, false);
});
