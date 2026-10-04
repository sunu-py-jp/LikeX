import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { FAVORITES } from './src/state/view-state.ts';
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
const { FAVORITES, useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerHeader, ExplorerFileList, ExplorerStatusBar } = await import(
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

test('built-in search applies case, full filename and RE2 flags without editing the draft', async t => {
  const hook = await mount(t, {}, true);
  await change(() => hook.current.setQuery('alpha'));
  assert.deepEqual(ids(hook.current), ['alpha']);
  await change(() => hook.current.setSearchConditions({ matchCase: true }));
  assert.deepEqual(ids(hook.current), []);
  await change(() => hook.current.setQuery('Alpha'));
  await change(() => hook.current.setSearchConditions({ wholeName: true }));
  assert.deepEqual(ids(hook.current), []);
  await change(() => hook.current.setQuery('Alpha.txt'));
  assert.deepEqual(ids(hook.current), ['alpha']);
  await change(() => { hook.current.setSearchConditions({ useRegex: true, wholeName: false }); hook.current.setQuery('^(Alpha|Nested)\\.txt$'); });
  assert.deepEqual(ids(hook.current), ['alpha', 'nested']);
  await change(() => hook.current.setQuery('['));
  assert.deepEqual(ids(hook.current), []); assert.ok(hook.current.searchError); assert.match(textOf(hook.root), /正規表現/);
  await change(() => hook.current.setQuery('(?=Alpha)'));
  assert.ok(hook.current.searchError, 'unsupported lookahead is a visible error');
  await change(() => hook.current.clearSearch());
  assert.equal(hook.current.searchError, null); assert.deepEqual(ids(hook.current), ['folder', 'alpha']);
  assert.equal(hook.current.searchConditions.useRegex, true, 'clearing text keeps chosen options');
  assert.equal(hook.current.dirty, false);
});

test('submit mode commits text and detailed flags together while draft conditions remain per tab', async t => {
  const hook = await mount(t, { search: { trigger: 'submit' } });
  await change(() => { hook.current.setQuery('alpha'); hook.current.submitSearch(); });
  await change(() => hook.current.setSelected(['alpha']));
  await change(() => hook.current.setSearchConditions({ matchCase: true, wholeName: true }));
  assert.deepEqual(ids(hook.current), ['alpha']); assert.deepEqual(hook.current.selected, ['alpha']);
  await change(() => hook.current.submitSearch());
  assert.deepEqual(ids(hook.current), []); assert.deepEqual(hook.current.selected, []);
  await change(() => hook.current.addTab());
  assert.deepEqual(hook.current.searchConditions, { matchCase: false, wholeName: false, useRegex: false });
  await change(() => hook.workspace.tabs.detachTab('tab-1', 'child'));
  await hook.showChild();
  assert.deepEqual(hook.child.searchConditions, { matchCase: true, wholeName: true, useRegex: false });
  assert.deepEqual(ids(hook.child), []);
});

test('external parameter changes auto-search in input mode, but submit mode preserves the committed snapshot', async t => {
  for (const trigger of ['input', 'submit']) await t.test(trigger, async subtest => {
    const calls = [];
    const params = { scope: 'files' };
    const onSearchRequest = request => { calls.push(request); return request.params.scope === 'files' ? ['alpha'] : ['nested']; };
    const hook = await mount(subtest, { search: { trigger, params }, onSearchRequest });
    await change(() => { hook.current.setQuery('report'); if (trigger === 'submit') hook.current.submitSearch(); });
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].params, params);
    await hook.update({ search: { trigger, params: { scope: 'all' } } });
    if (trigger === 'submit') {
      assert.equal(calls.length, 1); assert.deepEqual(ids(hook.current), ['alpha']);
      await change(() => hook.current.retrySearch());
      assert.deepEqual(calls.at(-1).params, { scope: 'files' }, 'retry uses the committed filters');
      await change(() => hook.current.submitSearch());
    }
    assert.deepEqual(calls.at(-1).params, { scope: 'all' }); assert.deepEqual(ids(hook.current), ['nested']);
    await change(() => hook.current.setSearchConditions({ useRegex: true }));
    if (trigger === 'submit') { assert.equal(calls.at(-1).conditions.useRegex, false); await change(() => hook.current.submitSearch()); }
    assert.equal(calls.at(-1).conditions.useRegex, true);
  });
});

test('IME also defers condition and host filter changes until composition ends', async t => {
  const calls = [];
  const hook = await mount(t, { search: { params: { mode: 'one' } }, onSearchRequest: request => { calls.push(request); return ['alpha']; } }, true);
  const input = () => hook.root.findByProps({ role: 'searchbox' });
  await change(() => hook.current.setQuery('before')); assert.equal(calls.length, 1);
  await change(() => input().props.onCompositionStart());
  await change(() => hook.current.setSearchConditions({ matchCase: true }));
  await hook.update({ search: { params: { mode: 'two' } } });
  assert.equal(calls.length, 1);
  await change(() => input().props.onCompositionEnd({ currentTarget: { value: '日本' } }));
  assert.equal(calls.length, 2); assert.equal(calls[1].query, '日本'); assert.equal(calls[1].conditions.matchCase, true); assert.deepEqual(calls[1].params, { mode: 'two' });
});

test('custom search UI can reuse or replace standard controls and reacts to a new renderer', async t => {
  let context;
  const hook = await mount(t, { renderSearch: value => { context = value; return h('div', { 'data-custom-search': true }, value.defaultInput, value.defaultOptions, h('output', {}, value.conditions.useRegex ? value.query : 'literal')); } }, true);
  assert.ok(hook.root.findByProps({ 'data-custom-search': true }));
  assert.equal(context.trigger, 'input'); assert.equal(context.error, null);
  await change(() => context.setQuery('Alpha')); assert.deepEqual(ids(hook.current), ['alpha']);
  await change(() => context.setConditions({ useRegex: true })); assert.equal(textOf(hook.root.findByType('output')), 'Alpha');
  assert.ok(hook.root.findByProps({ 'aria-label': '検索オプション' }));
  await hook.update({ renderSearch: value => { context = value; return h('input', { ...value.inputProps, 'data-replaced-search': true }); } });
  const input = hook.root.findByProps({ 'data-replaced-search': true });
  await change(() => input.props.onChange({ target: { value: '^Nested' } })); assert.deepEqual(ids(hook.current), ['nested']);
  await change(() => context.clear()); assert.equal(context.query, '');
  await hook.update({ features: { search: false } }); assert.equal(hook.root.findAllByProps({ 'data-replaced-search': true }).length, 0);
});

test('equivalent inline JSON params do not retrigger searches when a handler updates host state', async t => {
  const requests = [];
  const handler = request => { requests.push(request); return ['alpha']; };
  const hook = await mount(t, { onSearchRequest: handler, search: { params: { nested: { a: 1, b: ['x', 'y'] } } } });
  await change(() => hook.current.setQuery('alpha'));
  for (let n = 0; n < 4; n++) await hook.update({ search: { params: { nested: { b: ['x', 'y'], a: 1 } } }, onSearchRequest: request => handler(request) });
  assert.equal(requests.length, 1);
  assert.ok(Object.isFrozen(requests[0].params)); assert.ok(Object.isFrozen(requests[0].params.nested.b));
});

test('submitted filters are detached snapshots even if host-owned values later mutate', async t => {
  const params = { filters: { extension: 'txt' } }, requests = [];
  const hook = await mount(t, { search: { trigger: 'submit', params }, onSearchRequest: request => { requests.push(request); return ['alpha']; } });
  await change(() => { hook.current.setQuery('alpha'); hook.current.submitSearch(); });
  params.filters.extension = 'csv';
  await hook.update({ search: { trigger: 'submit', params } });
  await change(() => hook.current.retrySearch());
  assert.equal(requests.length, 2); assert.equal(requests[1].params.filters.extension, 'txt');
  await change(() => hook.current.submitSearch());
  assert.equal(requests[2].params.filters.extension, 'csv');
});

test('non-JSON or oversized additional filters show a search error without calling the host', async t => {
  const cycle = {}; cycle.self = cycle;
  for (const params of [cycle, { invalid: 2n }, { date: new Date() }, { tooLong: 'x'.repeat(100_000) }]) await t.test(String(Object.keys(params)), async subtest => {
    let requests = 0;
    const hook = await mount(subtest, { search: { params }, onSearchRequest: () => { requests++; return ['alpha']; } });
    await change(() => hook.current.setQuery('alpha'));
    assert.equal(requests, 0); assert.match(hook.current.searchError, /追加条件/); assert.equal(hook.current.searchPending, false);
    await hook.update({ search: { params: { valid: true } } });
    assert.equal(requests, 1); assert.equal(hook.current.searchError, null);
  });
});

test('changing from input to submit preserves the most recently applied host conditions', async t => {
  const requests = [];
  const hook = await mount(t, { search: { trigger: 'input', params: { scope: 1 } }, onSearchRequest: request => { requests.push(request); return ['alpha']; } });
  await change(() => hook.current.setQuery('alpha'));
  await hook.update({ search: { trigger: 'input', params: { scope: 2 } } });
  await hook.update({ search: { trigger: 'submit', params: { scope: 2 } } });
  await change(() => hook.current.retrySearch());
  assert.equal(requests.at(-1).params.scope, 2);
});

test('starting IME in submit mode cannot commit edited host params before Enter', async t => {
  const requests = [];
  const hook = await mount(t, { search: { trigger: 'submit', params: { scope: 'old' } }, onSearchRequest: request => { requests.push(request); return ['alpha']; } }, true);
  await change(() => { hook.current.setQuery('old'); hook.current.submitSearch(); });
  await hook.update({ search: { trigger: 'submit', params: { scope: 'new' } } });
  const input = () => hook.root.findByProps({ role: 'searchbox' });
  await change(() => input().props.onCompositionStart());
  await change(() => input().props.onChange({ target: { value: '日本' } }));
  await change(() => input().props.onCompositionEnd({ currentTarget: { value: '日本' } }));
  assert.equal(requests.length, 1); assert.equal(requests[0].params.scope, 'old');
  await change(() => hook.current.retrySearch()); assert.equal(requests.at(-1).params.scope, 'old');
  await change(() => input().props.onKeyDown(enter()));
  assert.equal(requests.at(-1).query, '日本'); assert.equal(requests.at(-1).params.scope, 'new');
});

test('switching submit to input commits the visible draft query and detailed conditions together', async t => {
  const requests = [];
  const hook = await mount(t, { search: { trigger: 'submit', params: { scope: 1 } }, onSearchRequest: request => { requests.push(request); return request.query === 'Alpha' ? ['alpha'] : ['nested']; } });
  await change(() => { hook.current.setQuery('Alpha'); hook.current.submitSearch(); });
  await change(() => { hook.current.setQuery('Nested'); hook.current.setSearchConditions({ matchCase: true, wholeName: true }); });
  assert.equal(requests.length, 1); assert.deepEqual(ids(hook.current), ['alpha']);
  await hook.update({ search: { trigger: 'input', params: { scope: 2 } } });
  assert.equal(requests.length, 2); assert.equal(requests[1].query, 'Nested');
  assert.equal(requests[1].conditions.matchCase, true); assert.equal(requests[1].conditions.wholeName, true);
  assert.deepEqual(requests[1].params, { scope: 2 }); assert.deepEqual(ids(hook.current), ['nested']);
});

for (const mode of ['details', 'list', 'small', 'medium', 'large', 'extra-large', 'tiles', 'content']) {
  test(`${mode}: external rich hits render plain-text supplement and preserve entry operations`, async t => {
    const hook = await mount(t, { view: { defaultMode: mode }, search: { resultDetailsHeight: 96 },
      onSearchRequest: () => [{ entryId: 'alpha', snippet: '<script>plain excerpt</script>', reason: 'Customer meeting', metadata: { privateLabel: 'not automatically rendered' } }, 'nested'] }, true);
    await change(() => hook.current.setQuery('meeting'));
    const region = hook.root.findByProps({ 'data-explorer-search-result': 'alpha' });
    assert.equal(region.props.style.height, 96);
    assert.equal(region.props.tabIndex, 0); assert.equal(region.props['aria-label'], 'Alpha.txtの検索結果詳細');
    assert.equal(textOf(region), '<script>plain excerpt</script>Customer meeting');
    assert.equal(region.findAllByType('script').length, 0);
    const row = hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === 'alpha')[0];
    assert.equal(typeof row.props.onClick, 'function'); assert.equal(typeof row.props.onDoubleClick, 'function');
    assert.equal(typeof row.props.onContextMenu, 'function'); assert.equal(typeof row.props.onDragStart, 'function');
    await change(() => hook.current.setSelected(['alpha']));
    assert.deepEqual(hook.current.selected, ['alpha']);
    await change(() => hook.current.startRename(['alpha']));
    assert.equal(hook.root.findAllByProps({ 'data-explorer-rename-input': 'alpha' }).length, 1);
    assert.equal(hook.current.dirty, false);
  });
}

test('result slot observes committed hits and query, selection and renderer changes without reopening search', async t => {
  const calls = [], contexts = [];
  const handler = request => { calls.push(request); return [{ entryId: 'alpha', snippet: request.query, reason: 'reason', metadata: { customer: request.params.customer } }, 'nested']; };
  const renderSearchResult = context => { contexts.push(context); return h('aside', { 'data-result-custom': context.entry.id }, context.defaultContent, String(context.hit.metadata?.customer ?? 'ID only')); };
  const hook = await mount(t, { search: { trigger: 'submit', params: { customer: 'One' } }, onSearchRequest: handler, renderSearchResult }, true);
  assert.equal(contexts.length, 0);
  await change(() => { hook.current.setQuery('confirmed'); hook.current.submitSearch(); });
  assert.equal(hook.root.findAllByProps({ 'data-result-custom': 'alpha' }).length, 1);
  const rich = contexts.filter(context => context.entry.id === 'alpha').at(-1), plain = contexts.filter(context => context.entry.id === 'nested').at(-1);
  assert.equal(rich.query, 'confirmed'); assert.equal(rich.entry.path, '/Alpha.txt'); assert.deepEqual(plain.hit, { entryId: 'nested' });
  await change(() => { hook.current.setQuery('draft'); hook.current.setSearchConditions({ matchCase: true }); });
  await hook.update({ search: { trigger: 'submit', params: { customer: 'Two' } } });
  assert.equal(calls.length, 1); assert.equal(textOf(hook.root.findByProps({ 'data-result-custom': 'alpha' })), 'confirmedreasonOne');
  await change(() => hook.current.setSelected(['alpha']));
  assert.equal(contexts.filter(context => context.entry.id === 'alpha').at(-1).selected, true);
  assert.equal(contexts.filter(context => context.entry.id === 'alpha').at(-1).query, 'confirmed');
  await hook.update({ renderSearchResult: () => false });
  assert.equal(textOf(hook.root.findByProps({ 'data-explorer-search-result': 'alpha' })), ''); assert.equal(calls.length, 1);
  assert.equal(hook.root.findByProps({ 'data-explorer-search-result': 'alpha' }).props.tabIndex, undefined);
  await hook.update({ renderSearchResult: () => null });
  assert.equal(textOf(hook.root.findByProps({ 'data-explorer-search-result': 'alpha' })), 'confirmedreason');
  await change(() => hook.current.submitSearch());
  assert.equal(calls.length, 2); assert.equal(hook.current.searchResultHits[0].metadata.customer, 'Two');
  await change(() => hook.current.clearSearch());
  assert.equal(hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-search-result']).length, 0);
  await hook.update({ onSearchRequest: undefined, renderSearchResult });
  const before = contexts.length;
  await change(() => { hook.current.setQuery('Alpha'); hook.current.submitSearch(); });
  assert.equal(contexts.length, before);
});

test('ID-only search preserves compact rows without a renderer and clamps custom supplement heights', async t => {
  const hook = await mount(t, { view: { defaultMode: 'list' }, onSearchRequest: () => ['alpha'] }, true);
  await change(() => hook.current.setQuery('alpha'));
  assert.equal(hook.root.findAllByProps({ 'data-explorer-search-result': 'alpha' }).length, 0);
  for (const [requested, expected] of [[-1, 24], [999, 480], [NaN, 72], [Infinity, 72]]) {
    await hook.update({ renderSearchResult: ({ defaultContent }) => defaultContent, search: { resultDetailsHeight: requested } });
    assert.equal(hook.root.findByProps({ 'data-explorer-search-result': 'alpha' }).props.style.height, expected);
  }
});


test('result supplement preserves native text selection and isolates custom controls from row events', async t => {
  const hook = await mount(t, { onSearchRequest: () => [{ entryId: 'alpha', snippet: 'Selectable excerpt' }],
    renderSearchResult: ({ defaultContent }) => h('div', null, defaultContent, h('button', { type: 'button' }, 'Details')) }, true);
  await change(() => hook.current.setQuery('external'));
  const region = hook.root.findByProps({ 'data-explorer-search-result': 'alpha' });
  let stopped = 0;
  const ancestorRow = {}, control = {}, event = target => ({ target: { closest: () => target }, currentTarget: { contains: candidate => candidate === control }, stopPropagation() { stopped++; } });
  region.props.onClick(event(ancestorRow)); assert.equal(stopped, 0, 'plain-text click can still select its row');
  region.props.onClick(event(control)); assert.equal(stopped, 1);
  region.props.onDoubleClick(event(null)); assert.equal(stopped, 2, 'double-click text selects a word rather than opening the file');
  region.props.onDragStart(event(control)); assert.equal(stopped, 3);
  region.props.onKeyDown(event(null)); assert.equal(stopped, 4, 'keyboard scrolling/copying does not trigger row shortcuts');
  region.props.onCopy(event(null)); region.props.onCut(event(null)); assert.equal(stopped, 6);
  assert.equal(hook.current.preview, undefined);
});

for (const mode of ['details', 'content']) test(`${mode}: streamed batches stay visible and selectable until the final result`, async t => {
  const second = deferred(), done = deferred();
  const hook = await mount(t, { view: { defaultMode: mode }, onSearchRequest: async function* () {
    yield [{ entryId: 'alpha', snippet: 'First result' }];
    await second.promise;
    yield [{ entryId: 'nested', snippet: 'Second result' }];
    await done.promise;
  } }, true);
  const rows = () => hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry'] === true);
  const footerText = () => textOf(hook.root.findByType('footer'));
  await change(() => hook.current.setQuery('stream'));
  assert.equal(hook.current.searchPending, true); assert.deepEqual(rows().map(row => row.props['data-explorer-entry-id']), ['alpha']);
  assert.match(footerText(), /検索中… 1 件取得/);
  assert.equal(hook.root.findByProps({ 'aria-label': 'ファイル一覧' }).props['aria-busy'], true);
  await change(() => hook.current.setSelected(['alpha']));
  assert.deepEqual(hook.current.selected, ['alpha']);
  assert.equal(typeof rows()[0].props.onDoubleClick, 'function'); assert.equal(typeof rows()[0].props.onDragStart, 'function');
  await change(() => second.resolve());
  assert.deepEqual(rows().map(row => row.props['data-explorer-entry-id']), ['alpha', 'nested']);
  assert.deepEqual(hook.current.selected, ['alpha']); assert.match(footerText(), /検索中… 2 件取得/);
  assert.equal(textOf(hook.root.findByProps({ 'data-explorer-search-result': 'nested' })), 'Second result');
  await change(() => done.resolve());
  assert.equal(hook.current.searchPending, false); assert.match(footerText(), /2 個の項目/); assert.doesNotMatch(footerText(), /検索中/);
  assert.equal(hook.root.findByProps({ 'aria-label': 'ファイル一覧' }).props['aria-busy'], false);
});

test('partial stream failure preserves accepted rows and exposes retry outside the scrolling region', async t => {
  const fail = deferred(); let calls = 0;
  const hook = await mount(t, { onSearchRequest: async function* () {
    calls++;
    if (calls > 1) { yield [{ entryId: 'nested', reason: 'Retry result' }]; return; }
    yield [{ entryId: 'alpha', snippet: 'Accepted result' }];
    await fail.promise;
    throw new Error('Connection interrupted');
  } }, true);
  await change(() => hook.current.setQuery('stream'));
  await change(() => hook.current.setSelected(['alpha']));
  await change(() => fail.resolve());
  assert.equal(hook.current.searchPending, false); assert.deepEqual(ids(hook.current), ['alpha']);
  assert.deepEqual(hook.current.selected, ['alpha']);
  const alert = hook.root.findByProps({ role: 'alert' });
  assert.match(textOf(alert), /Connection interrupted/); assert.match(textOf(alert), /取得済みの1件/);
  const scroller = hook.root.findByProps({ 'data-explorer-drag-scroll': 'both' });
  assert.equal(scroller.findAllByProps({ role: 'alert' }).length, 0);
  assert.equal(scroller.findAllByProps({ 'data-explorer-search-result': 'alpha' }).length, 1);
  assert.match(textOf(hook.root.findByType('footer')), /検索が途中で終了しました · 1 件取得/);
  await change(() => alert.findByType('button').props.onClick());
  assert.equal(calls, 2); assert.deepEqual(ids(hook.current), ['nested']);
  assert.equal(hook.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('new streamed conditions discard earlier rows immediately while zero-result streams retain loading and empty states', async t => {
  const oldFinish = deferred(), nextBatch = deferred(), nextFinish = deferred(), requests = [];
  const hook = await mount(t, { onSearchRequest: async function* (request, { signal }) {
    requests.push({ request, signal });
    if (request.query === 'first') { yield ['alpha']; await oldFinish.promise; yield ['nested']; return; }
    await nextBatch.promise; yield []; await nextFinish.promise;
  } }, true);
  await change(() => hook.current.setQuery('first')); assert.deepEqual(ids(hook.current), ['alpha']);
  await change(() => hook.current.setQuery('second'));
  assert.equal(requests[0].signal.aborted, true); assert.equal(hook.current.searchPending, true);
  assert.equal(hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry']).length, 0);
  assert.match(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' }).findByProps({ role: 'status' })), /検索しています/);
  await change(() => oldFinish.resolve()); assert.deepEqual(ids(hook.current), []);
  await change(() => nextBatch.resolve()); assert.equal(hook.current.searchPending, true); assert.deepEqual(ids(hook.current), []);
  await change(() => nextFinish.resolve()); assert.equal(hook.current.searchPending, false);
  assert.match(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /一致するファイルがありません/);
});

const lazySearchProps = () => ({ initialEntries: [], folderLoading: { initialLoadedFolderIds: ['root'] }, onLoadFolder: () => [] });

test('external batches hydrate unknown files and ancestors, display rich hits, and retain a clean cache after clearing', async t => {
  let calls = 0, reads = 0;
  const hook = await mount(t, { ...lazySearchProps(), onSearchRequest: () => {
    calls++; return { hits: [{ entryId: 'remote', snippet: 'Decision: phased rollout', reason: 'Customer meeting' }],
      entries: [entry('remote', 'Meeting.txt', 'customer'), entry('customer', 'Customer', 'root', 'folder')] };
  }, readFile: () => { reads++; return new File(['Meeting'], 'Meeting.txt'); } }, true);
  await change(() => hook.current.setQuery('rollout'));
  assert.equal(calls, 1); assert.deepEqual(ids(hook.current), ['remote']);
  assert.equal(hook.current.dirty, false); assert.equal(reads, 0);
  assert.match(textOf(hook.root.findByProps({ 'aria-label': 'ファイル一覧' })), /Decision: phased rollout/);
  assert.equal(hook.current.entries.find(item => item.id === 'remote').source.id, 'body-remote');
  assert.equal(hook.current.getFolderLoadState('customer').status, 'unloaded', 'search hits do not imply a complete folder');
  assert.ok(hook.events.some(event => event.type === 'search-hydrate' && event.addedCount === 2));
  await change(() => hook.current.clearSearch());
  assert.deepEqual(ids(hook.current), ['customer']);
  assert.equal(hook.current.entries.length, 2); assert.equal(hook.current.dirty, false); assert.equal(calls, 1);
});

test('streamed metadata batches are atomic, keep earlier accepted hits on failure, and never mark a dirty edit', async t => {
  const next = deferred();
  const hook = await mount(t, { ...lazySearchProps(), onSearchRequest: async function* () {
    yield { hits: ['first'], entries: [entry('first', 'First.txt')] };
    await next.promise;
    yield { hits: [{ entryId: 'second', metadata: { invalid: new Date() } }], entries: [entry('second', 'Second.txt')] };
  } });
  await change(() => hook.current.setQuery('notes'));
  assert.deepEqual(ids(hook.current), ['first']); assert.equal(hook.current.searchPending, true);
  await change(() => next.resolve());
  assert.deepEqual(ids(hook.current), ['first']); assert.equal(hook.current.searchPending, false);
  assert.match(hook.current.searchError, /metadata/);
  assert.deepEqual(hook.current.entries.map(item => item.id), ['first']); assert.equal(hook.current.dirty, false);
});

test('an invalid metadata tree cannot add cache entries or publish its hits', async t => {
  const hook = await mount(t, { ...lazySearchProps(), onSearchRequest: () => ({ hits: ['remote'],
    entries: [entry('valid', 'Valid.txt'), entry('remote', 'Remote.txt', 'missing-parent')] }) });
  await change(() => hook.current.setQuery('remote'));
  assert.deepEqual(ids(hook.current), []); assert.deepEqual(hook.current.entries, []);
  assert.ok(hook.current.searchError); assert.equal(hook.current.dirty, false);
});

test('a non-lazy explorer rejects entry hydration instead of inserting external edits', async t => {
  const hook = await mount(t, { initialEntries: [], onSearchRequest: () => ({ hits: ['remote'], entries: [entry('remote', 'Remote.txt')] }) });
  await change(() => hook.current.setQuery('remote'));
  assert.deepEqual(hook.current.entries, []); assert.deepEqual(ids(hook.current), []);
  assert.ok(hook.current.searchError); assert.equal(hook.current.dirty, false);
});

test('search hydration shared by views does not restart either search and ID-only batches use the latest cache', async t => {
  const requests = [];
  const hook = await mount(t, { ...lazySearchProps(), onSearchRequest: (request, context) => {
    const pending = deferred(); requests.push({ ...pending, request, ...context }); return pending.promise;
  } });
  await change(() => hook.current.addTab());
  await change(() => hook.workspace.tabs.detachTab('tab-1', 'child'));
  await hook.showChild();
  await change(() => hook.current.setQuery('main'));
  await change(() => hook.child.setQuery('child'));
  assert.equal(requests.length, 2);
  await change(async () => {
    requests[0].resolve({ hits: ['remote'], entries: [entry('remote', 'Remote.txt')] });
    await Promise.resolve(); await Promise.resolve();
    requests[1].resolve(['remote']);
  });
  assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, false); assert.equal(requests[1].signal.aborted, false);
  assert.deepEqual(ids(hook.current), ['remote']); assert.deepEqual(ids(hook.child), ['remote']);
  assert.equal(hook.current.dirty, false);
});

test('local edits restart a search while incoming known metadata preserves the local filename', async t => {
  const requests = [];
  const hook = await mount(t, { ...lazySearchProps(), onSearchRequest: (request, context) => {
    const pending = deferred(); requests.push({ ...pending, request, ...context }); return pending.promise;
  } });
  await change(() => hook.current.setQuery('remote'));
  await change(() => requests[0].resolve({ hits: ['remote'], entries: [entry('remote', 'Remote.txt')] }));
  assert.equal(requests.length, 1);
  await change(async () => { assert.equal(await hook.workspace.commands.handle.execute({ action: 'rename', ids: ['remote'], name: 'Local.txt' }), true); });
  assert.ok(requests.length >= 2); const latest = requests.at(-1);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(latest.request.entries.find(item => item.id === 'remote').name, 'Local.txt');
  await change(() => latest.resolve({ hits: ['remote', 'new'], entries: [entry('remote', 'Remote.txt'), entry('new', 'New.txt')] }));
  assert.deepEqual(ids(hook.current), ['remote', 'new']);
  assert.equal(hook.current.entries.find(item => item.id === 'remote').name, 'Local.txt'); assert.equal(hook.current.dirty, true);
});

test('query changes and unmount discard late metadata before it can populate the cache', async t => {
  for (const action of ['query', 'unmount']) await t.test(action, async subtest => {
    const requests = [];
    const hook = await mount(subtest, { ...lazySearchProps(), onSearchRequest: (request, context) => {
      const pending = deferred(); requests.push({ ...pending, request, ...context }); return pending.promise;
    } });
    await change(() => hook.current.setQuery('first'));
    const draft = hook.workspace.draft;
    if (action === 'query') await change(() => hook.current.setQuery('second'));
    else await hook.unmount();
    assert.equal(requests[0].signal.aborted, true);
    await change(() => requests[0].resolve({ hits: ['stale'], entries: [entry('stale', 'Stale.txt')] }));
    assert.deepEqual(draft.getEntries(), []);
    if (action === 'query') {
      await change(() => requests[1].resolve({ hits: ['fresh'], entries: [entry('fresh', 'Fresh.txt')] }));
      assert.deepEqual(ids(hook.current), ['fresh']); assert.equal(hook.current.entries.length, 1);
    }
  });
});

test('saving suspends external search and resumes using the saved cache without accepting old batches', async t => {
  const save = deferred(), requests = [];
  const hook = await mount(t, { ...lazySearchProps(), initialEntries: [entry('alpha', 'Alpha.txt')],
    onSave: () => save.promise, onSearchRequest: (request, context) => {
      const pending = deferred(); requests.push({ ...pending, request, ...context }); return pending.promise;
    } });
  await change(async () => { assert.equal(await hook.workspace.commands.handle.execute({ action: 'rename', ids: ['alpha'], name: 'Edited.txt' }), true); });
  await change(() => hook.current.setQuery('remote'));
  let saving;
  await change(() => { saving = hook.workspace.commands.handle.save(); });
  assert.equal(hook.current.saving, true); assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, true);
  await change(() => requests[0].resolve({ hits: ['stale'], entries: [entry('stale', 'Stale.txt')] }));
  assert.equal(hook.current.entries.some(item => item.id === 'stale'), false);
  await change(async () => { save.resolve(); await saving; });
  assert.equal(hook.current.saving, false); assert.equal(requests.length, 2);
  await change(() => requests[1].resolve({ hits: ['fresh'], entries: [entry('fresh', 'Fresh.txt')] }));
  assert.deepEqual(ids(hook.current), ['fresh']); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Edited.txt');
});

test('opening a containing folder in the same location creates history and restores local search selection', async t => {
  const hook = await mount(t, { readOnly: true });
  await change(() => hook.current.setQuery('.txt'));
  await change(() => hook.current.setSelected(['alpha', 'nested']));
  assert.deepEqual(ids(hook.current), ['alpha', 'nested']);
  await change(() => hook.current.openContainingFolder(hook.current.entries.find(item => item.id === 'alpha')));
  assert.equal(hook.current.location, 'root'); assert.equal(hook.current.query, '');
  assert.deepEqual(hook.current.history, ['root', 'root']); assert.deepEqual(hook.current.selected, ['alpha']);
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.query, '.txt'); assert.deepEqual(hook.current.selected, ['alpha', 'nested']);
  assert.deepEqual(ids(hook.current), ['alpha', 'nested']); assert.equal(hook.current.historyIndex, 0);
  await change(() => hook.current.travel(1));
  assert.equal(hook.current.query, ''); assert.deepEqual(hook.current.selected, ['alpha']);
  assert.equal(hook.current.historyIndex, 1); assert.equal(hook.current.dirty, false);
});

test('history restores submitted query, committed and draft conditions, draft text and captured parameters', async t => {
  const requests = [];
  const hook = await mount(t, { search: { trigger: 'submit', params: { customer: 'old' } }, onSearchRequest: request => {
    requests.push(request); return ['alpha', 'nested'];
  } });
  await change(() => { hook.current.setQuery('committed'); hook.current.setSearchConditions({ matchCase: true }); hook.current.submitSearch(); });
  await change(() => { hook.current.setSelected(['alpha', 'nested']); hook.current.setQuery('unfinished'); hook.current.setSearchConditions({ wholeName: true }); });
  await hook.update({ search: { trigger: 'submit', params: { customer: 'new' } } });
  await change(() => hook.current.openContainingFolder(hook.current.entries.find(item => item.id === 'nested')));
  assert.equal(hook.current.location, 'folder'); assert.equal(hook.current.query, '');
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.query, 'committed'); assert.equal(hook.current.searchText, 'unfinished');
  assert.deepEqual(hook.current.searchConditions, { matchCase: true, wholeName: true, useRegex: false });
  assert.deepEqual(requests.at(-1).conditions, { matchCase: true, wholeName: false, useRegex: false });
  assert.deepEqual(requests.at(-1).params, { customer: 'old' }); assert.deepEqual(hook.current.selected, ['alpha', 'nested']);
  await change(() => hook.current.submitSearch());
  assert.equal(requests.at(-1).query, 'unfinished'); assert.equal(requests.at(-1).conditions.wholeName, true);
  assert.deepEqual(requests.at(-1).params, { customer: 'new' });
});

test('input history reuses captured params until new input or host conditions change', async t => {
  const requests = [];
  const hook = await mount(t, { search: { params: { customer: 'old' } }, onSearchRequest: request => { requests.push(request); return ['alpha']; } });
  await change(() => hook.current.setQuery('old-query'));
  await change(() => hook.current.openContainingFolder(hook.current.entries.find(item => item.id === 'alpha')));
  await hook.update({ search: { params: { customer: 'new' } } });
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.query, 'old-query'); assert.deepEqual(requests.at(-1).params, { customer: 'old' });
  const count = requests.length;
  await hook.update({ search: { params: { customer: 'new' } } });
  assert.equal(requests.length, count, 'equal host values do not override the restored query');
  await change(() => hook.current.setQuery('edited-query'));
  assert.deepEqual(requests.at(-1).params, { customer: 'new' });
  await change(() => hook.current.travel(1)); await change(() => hook.current.travel(-1));
  assert.equal(hook.current.query, 'edited-query');
  await hook.update({ search: { params: { customer: 'latest' } } });
  assert.deepEqual(requests.at(-1).params, { customer: 'latest' });
});

test('branching after returning to search drops forward views and separate tabs retain independent history', async t => {
  const hook = await mount(t);
  await change(() => hook.current.setQuery('Nested'));
  await change(() => hook.current.openContainingFolder(hook.current.entries.find(item => item.id === 'nested')));
  await change(() => hook.current.navigate('root'));
  assert.deepEqual(hook.current.history, ['root', 'folder', 'root']);
  await change(() => hook.current.travel(-1)); await change(() => hook.current.travel(-1));
  assert.equal(hook.current.query, 'Nested');
  await change(() => hook.current.navigate('root'));
  assert.deepEqual(hook.current.history, ['root', 'root']); assert.equal(hook.current.historyIndex, 1);
  await change(() => hook.current.travel(1)); assert.equal(hook.current.historyIndex, 1);
  await change(() => hook.current.addTab());
  await change(() => hook.workspace.tabs.detachTab('tab-1', 'child')); await hook.showChild();
  await change(() => hook.child.travel(-1));
  assert.equal(hook.child.query, 'Nested'); assert.deepEqual(ids(hook.child), ['nested']);
  assert.equal(hook.current.query, ''); assert.deepEqual(hook.current.history, ['root']);
});

test('opening an uncached search parent keeps the target selected after the full folder loads', async t => {
  const folder = deferred();
  const hook = await mount(t, { ...lazySearchProps(), onLoadFolder: () => folder.promise,
    onSearchRequest: () => ({ hits: ['remote'], entries: [entry('remote', 'Remote.txt', 'customer'), entry('customer', 'Customer', 'root', 'folder')] }) });
  await change(() => hook.current.setQuery('remote'));
  await change(() => hook.current.openContainingFolder(hook.current.entries.find(item => item.id === 'remote')));
  assert.equal(hook.current.query, ''); assert.equal(hook.current.folderPending, true);
  assert.deepEqual(hook.current.selected, ['remote']);
  const contents = [entry('remote', 'Remote.txt', 'customer'), ...Array.from({ length: 320 }, (_, index) => entry(`other-${index}`, `Other-${index}.txt`, 'customer'))];
  await change(() => folder.resolve(contents));
  assert.equal(hook.current.folderPending, false); assert.equal(ids(hook.current).length, 321);
  assert.deepEqual(hook.current.selected, ['remote']); assert.equal(hook.current.dirty, false);
});


const detailHeaderLabels = root => root.findByType('table').findAllByType('th').map(textOf)
  .filter(label => ['名前', '場所', '更新日時', '拡張子', 'サイズ'].includes(label));
const detailRow = (root, id) => root.findAll(node => node.type === 'tr' && node.props['data-explorer-entry-id'] === id)[0];

test('detail search adds the location column after name and shows absolute parent paths without duplicate name captions', async t => {
  const supplied = [entry('root-file', 'Find-root.txt'), entry('parent', 'Find親', 'root', 'folder'),
    entry('child', 'Find子', 'parent', 'folder'), entry('nested-file', 'Find-nested.txt', 'child')];
  const hook = await mount(t, { initialEntries: supplied, readOnly: true }, true);
  assert.deepEqual(detailHeaderLabels(hook.root), ['名前', '更新日時', '拡張子', 'サイズ']);
  await change(() => hook.current.setQuery('Find'));
  assert.deepEqual(detailHeaderLabels(hook.root), ['名前', '場所', '更新日時', '拡張子', 'サイズ']);
  for (const [id, path] of [['root-file', '/'], ['parent', '/'], ['child', '/Find親'], ['nested-file', '/Find親/Find子']]) {
    const row = detailRow(hook.root, id), cells = row.findAllByType('td');
    assert.equal(textOf(cells[2]), path, 'location follows checkbox and name');
    assert.ok(cells[2].findAll(node => typeof node.type === 'string' && node.props.title === path).length || cells[2].props.title === path);
    assert.equal(cells[1].findAllByType('small').length, 0, 'name no longer repeats the parent caption');
    assert.match(cells[2].props.className, /truncate/);
  }
  const locationHeader = hook.root.findByType('table').findAllByType('th').find(th => textOf(th) === '場所');
  assert.equal(locationHeader.props['aria-sort'], undefined);
  assert.equal(locationHeader.findAllByType('button').length, 0, 'location has no sort action');
  await change(() => hook.current.clearSearch());
  assert.deepEqual(detailHeaderLabels(hook.root), ['名前', '更新日時', '拡張子', 'サイズ']);
  assert.equal(hook.current.dirty, false);
});

test('remote search location cells use hydrated ancestors and preserve external ranking', async t => {
  const hook = await mount(t, { ...lazySearchProps(), readOnly: true, selection: { mode: 'none' }, ui: { rowActions: false },
    onSearchRequest: () => ({ hits: ['remote-child', 'remote-root', 'year'], entries: [
      entry('remote-child', 'Architecture.txt', 'year'), entry('remote-root', 'Root.txt'),
      entry('year', '2026年度', 'development', 'folder'), entry('development', '開発資料', 'root', 'folder'),
    ] }) }, true);
  await change(() => hook.current.setQuery('architecture'));
  assert.deepEqual(ids(hook.current), ['remote-child', 'remote-root', 'year']);
  assert.deepEqual(detailHeaderLabels(hook.root), ['名前', '場所', '更新日時', '拡張子', 'サイズ']);
  const table = hook.root.findByType('table');
  assert.equal(table.findAllByType('col').length, 5); assert.equal(table.findAllByType('th').length, 5);
  for (const [id, path] of [['remote-child', '/開発資料/2026年度'], ['remote-root', '/'], ['year', '/開発資料']]) {
    const cells = detailRow(hook.root, id).findAllByType('td');
    assert.equal(cells.length, 5); assert.equal(textOf(cells[1]), path);
  }
  assert.equal(hook.current.dirty, false); assert.equal(hook.current.getFolderLoadState('year').status, 'unloaded');
});

for (const auxiliary of [true, false]) test(`virtual detail search keeps column spans and one-line row geometry (auxiliary columns ${auxiliary})`, async t => {
  const supplied = [entry('folder', '資料', 'root', 'folder'), ...Array.from({ length: 350 }, (_, index) => entry(`file-${index}`, `File-${index}.txt`, 'folder'))];
  const ranked = supplied.slice(1).map(item => item.id).reverse();
  const hook = await mount(t, { initialEntries: supplied,
    ...(auxiliary ? {} : { readOnly: true, selection: { mode: 'none' }, ui: { rowActions: false } }),
    onSearchRequest: () => ranked }, true);
  await change(() => hook.current.setQuery('File'));
  const table = hook.root.findByType('table'), columns = auxiliary ? 7 : 5;
  assert.equal(table.props['aria-rowcount'], 351); assert.equal(table.findAllByType('col').length, columns);
  assert.equal(table.findAllByType('th').length, columns);
  const rows = table.findAll(node => node.type === 'tr' && node.props['data-explorer-entry-id']);
  assert.ok(rows.length > 0 && rows.length < 350); assert.equal(rows[0].props['data-explorer-entry-id'], 'file-349');
  for (const row of rows) { assert.equal(row.findAllByType('td').length, columns); assert.equal(row.props.style.height, 36); }
  const gaps = table.findAllByType('td').filter(cell => cell.props.colSpan !== undefined);
  assert.ok(gaps.length > 0); for (const cell of gaps) assert.equal(cell.props.colSpan, columns);
  assert.equal(gaps.reduce((total, cell) => total + cell.props.style.height, 0) + rows.length * 36, 350 * 36);
});

test('favorite detail captions and non-detail search cards retain their existing presentation', async t => {
  const supplied = initialEntries().map(item => item.id === 'nested' ? { ...item, favorite: 1 } : item);
  const hook = await mount(t, { initialEntries: supplied, readOnly: true }, true);
  await change(() => hook.current.navigate(FAVORITES));
  assert.deepEqual(detailHeaderLabels(hook.root), ['名前', '更新日時', '拡張子', 'サイズ']);
  assert.deepEqual(detailRow(hook.root, 'nested').findAllByType('small').map(textOf), ['Folder']);
  await change(() => hook.current.changeView('content'));
  await change(() => hook.current.setQuery('Nested'));
  assert.equal(hook.root.findAllByType('table').length, 0); assert.deepEqual(ids(hook.current), ['nested']);
  assert.ok(hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === 'nested').length);
});
