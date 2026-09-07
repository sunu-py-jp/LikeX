import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
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
const { useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerHeader, ExplorerFileList, ExplorerStatusBar } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-search-flow.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('alpha', 'Alpha.txt'), entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested.txt', 'folder')];
const ids = controller => controller.visible.map(item => item.id);
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');
const enter = (extra = {}) => ({ key: 'Enter', preventDefault() {}, stopPropagation() {}, ...extra });

async function mount(t, supplied = {}, ui = false) {
  let workspace, renderer, closed = false, child = false;
  const views = new Map();
  const events = [];
  let props = { initialEntries: initialEntries(), onSave() {}, onEvent: event => events.push(event), ...supplied };
  function Pane({ options, id }) {
    const controller = useExplorerViewController(options, workspace, id, null);
    views.set(id, controller);
    return ui && id === 'main' ? h(ExplorerProvider, { value: controller },
      h(ExplorerHeader), h(ExplorerFileList), h(ExplorerStatusBar)) : null;
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

test('default search matches names across folders and never edits or reads content', async t => {
  let reads = 0, permissions = 0;
  const hook = await mount(t, { readFile() { reads++; }, onEditRequest() { permissions++; return false; } });
  await change(() => hook.current.setQuery(' NeStEd '));
  assert.equal(hook.current.searchText, ' NeStEd ');
  assert.equal(hook.current.query, 'NeStEd');
  assert.deepEqual(ids(hook.current), ['nested']);
  assert.equal(hook.current.canSort, true);
  assert.equal(hook.current.dirty, false);
  assert.equal(reads, 0);
  assert.equal(permissions, 0);
  await change(() => hook.current.setQuery('   '));
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
  assert.equal(hook.current.tabs[0].title, 'ファイル');
});

test('submit mode keeps results and selection until Enter, clears immediately, and navigates normally', async t => {
  const hook = await mount(t, { search: { trigger: 'submit' } });
  await change(() => { hook.current.setSelected(['alpha']); hook.current.setQuery('Nested'); });
  assert.equal(hook.current.query, '');
  assert.deepEqual(hook.current.selected, ['alpha']);
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
  assert.equal(hook.current.tabs[0].title, 'ファイル');
  await change(() => hook.current.submitSearch());
  assert.deepEqual(ids(hook.current), ['nested']);
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.tabs[0].title, '検索結果');
  await change(() => hook.current.setQuery('Alpha'));
  assert.deepEqual(ids(hook.current), ['nested']);
  await change(() => hook.current.clearSearch());
  assert.equal(hook.current.searchText, '');
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
  await change(() => { hook.current.setQuery('Nested'); hook.current.submitSearch(); });
  await change(() => hook.current.navigate('folder'));
  assert.equal(hook.current.query, '');
  assert.equal(hook.current.searchText, '');
  assert.deepEqual(ids(hook.current), ['nested']);
});

test('unsubmitted text and committed query stay with a detached tab and its popup searches independently', async t => {
  const calls = [];
  const hook = await mount(t, { search: { trigger: 'submit' }, onSearchRequest: request => {
    calls.push(request); return request.query === 'first' ? ['nested'] : ['alpha'];
  } });
  await change(() => { hook.current.setQuery('first'); hook.current.submitSearch(); });
  await change(() => hook.current.setQuery('unfinished'));
  await change(() => hook.current.addTab());
  assert.equal(hook.current.searchText, '');
  await change(() => hook.workspace.tabs.detachTab('tab-1', 'child'));
  await hook.showChild();
  assert.equal(hook.child.query, 'first');
  assert.equal(hook.child.searchText, 'unfinished');
  assert.deepEqual(ids(hook.child), ['nested']);
  assert.equal(calls.at(-1).windowId, 'child');
  assert.equal(calls.at(-1).tabId, 'tab-1');
  await change(() => hook.child.submitSearch());
  assert.equal(calls.at(-1).query, 'unfinished');
  assert.deepEqual(ids(hook.child), ['alpha']);
  assert.equal(hook.current.query, '');
  assert.equal(hook.current.dirty, false);
});

test('external results retain relevance across folders, deduplicate IDs and re-evaluate current draft edits', async t => {
  const calls = [];
  const hook = await mount(t, { onSearchRequest(request, { signal }) {
    calls.push({ request, signal }); return ['nested', 'alpha', 'missing', 'nested', 'folder'];
  } });
  await change(() => hook.current.setQuery('semantic text'));
  assert.deepEqual(ids(hook.current), ['nested', 'alpha', 'folder']);
  assert.equal(hook.current.canSort, false);
  await change(() => hook.current.sortBy('name'));
  assert.deepEqual(ids(hook.current), ['nested', 'alpha', 'folder']);
  assert.deepEqual(calls[0].request.location, { kind: 'folder', id: 'root', path: '/', name: 'ファイル' });
  await change(() => hook.workspace.draft.apply({ action: 'rename', ids: ['alpha'], name: 'Renamed.txt' }));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.entries.find(item => item.id === 'alpha').name, 'Renamed.txt');
  assert.equal(calls[0].signal.aborted, true);
  await change(() => hook.workspace.draft.apply({ action: 'delete', ids: ['nested'] }));
  assert.deepEqual(ids(hook.current), ['alpha', 'folder']);
  await change(() => hook.current.clearSearch());
  assert.equal(hook.current.canSort, true);
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
});

test('feature off cancels a pending request and restores local browsing without late response changes', async t => {
  const result = deferred();
  let signal;
  const hook = await mount(t, { onSearchRequest(_, context) { signal = context.signal; return result.promise; } });
  await change(() => hook.current.setQuery('query'));
  assert.equal(hook.current.searchPending, true);
  await hook.update({ features: { search: false } });
  assert.equal(signal.aborted, true);
  assert.equal(hook.current.searchPending, false);
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
  await change(() => result.resolve(['nested']));
  assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
});

test('search input handles IME composition, native composing Enter and submit button', async t => {
  const calls = [];
  const hook = await mount(t, { search: { trigger: 'submit' }, onSearchRequest(request) { calls.push(request.query); return []; } }, true);
  const input = () => hook.root.findByProps({ role: 'searchbox' });
  await change(() => input().props.onCompositionStart());
  await change(() => input().props.onChange({ target: { value: '日本語' } }));
  await change(() => input().props.onKeyDown(enter({ nativeEvent: { isComposing: true } })));
  await change(() => input().props.onKeyDown(enter({ keyCode: 229 })));
  await change(() => input().props.onCompositionEnd({ currentTarget: { value: '日本語' } }));
  assert.deepEqual(calls, []);
  await change(() => input().props.onKeyDown(enter()));
  assert.deepEqual(calls, ['日本語']);
  await change(() => input().props.onChange({ target: { value: 'other' } }));
  assert.deepEqual(calls, ['日本語']);
  await change(() => hook.root.findByProps({ 'aria-label': '検索を実行' }).props.onClick());
  assert.deepEqual(calls, ['日本語', 'other']);
  await change(() => hook.root.findByProps({ 'aria-label': '検索をクリア' }).props.onClick());
  assert.equal(input().props.value, '');
});

test('input mode waits for Japanese composition completion', async t => {
  const calls = [];
  const hook = await mount(t, { onSearchRequest: request => { calls.push(request.query); return []; } }, true);
  const input = () => hook.root.findByProps({ role: 'searchbox' });
  await change(() => input().props.onCompositionStart());
  await change(() => input().props.onChange({ target: { value: 'にほ' } }));
  assert.deepEqual(calls, []);
  await change(() => input().props.onCompositionEnd({ currentTarget: { value: '日本' } }));
  assert.deepEqual(calls, ['日本']);
});

test('UI distinguishes loading, error, retry and empty results and hides sort during ranked search', async t => {
  const first = deferred();
  let calls = 0;
  const hook = await mount(t, { onSearchRequest() { calls++; return calls === 1 ? first.promise : []; } }, true);
  const input = () => hook.root.findByProps({ role: 'searchbox' });
  assert.ok(hook.root.findAllByType('button').some(node => textOf(node) === '並べ替え'));
  await change(() => input().props.onChange({ target: { value: 'content' } }));
  assert.match(textOf(hook.root), /検索しています/);
  assert.doesNotMatch(textOf(hook.root), /一致するファイルがありません|0 個の項目/);
  assert.equal(hook.root.findAllByType('button').filter(node => textOf(node) === '並べ替え').length, 0);
  await change(() => first.reject(new Error('検索サービスに接続できません')));
  assert.match(textOf(hook.root), /検索に失敗しました/);
  assert.doesNotMatch(textOf(hook.root), /一致するファイルがありません/);
  const retry = hook.root.findAllByType('button').find(node => textOf(node) === '再試行');
  assert.ok(retry);
  await change(() => retry.props.onClick());
  assert.equal(calls, 2);
  assert.match(textOf(hook.root), /一致するファイルがありません/);
  await change(() => hook.current.clearSearch());
  assert.ok(hook.root.findAllByType('th').some(node => node.props['aria-sort'] === 'ascending'));
  await hook.update({ features: { search: false } });
  assert.equal(hook.root.findAllByProps({ role: 'searchbox' }).length, 0);
});

test('ranked result rows have no misleading column sort state or actions', async t => {
  const hook = await mount(t, { onSearchRequest: () => ['nested', 'alpha'] }, true);
  await change(() => hook.current.setQuery('semantic'));
  assert.deepEqual(ids(hook.current), ['nested', 'alpha']);
  const headers = hook.root.findAllByType('th');
  assert.ok(headers.length > 0);
  assert.ok(headers.every(node => node.props['aria-sort'] === undefined));
  assert.equal(headers.flatMap(node => node.findAllByType('button')).length, 0);
});

test('retry repeats the failed query without submitting unfinished text in submit mode', async t => {
  const queries = [];
  const hook = await mount(t, { search: { trigger: 'submit' }, onSearchRequest: request => {
    queries.push(request.query);
    if (queries.length === 1) throw new Error('retry needed');
    return ['alpha'];
  } }, true);
  await change(() => { hook.current.setQuery('original'); hook.current.submitSearch(); });
  await change(() => hook.current.setQuery('unfinished'));
  const retry = hook.root.findAllByType('button').find(node => textOf(node) === '再試行');
  assert.ok(retry);
  await change(() => retry.props.onClick());
  assert.deepEqual(queries, ['original', 'original']);
  assert.equal(hook.current.searchText, 'unfinished');
  assert.equal(hook.current.query, 'original');
  assert.deepEqual(ids(hook.current), ['alpha']);
});
