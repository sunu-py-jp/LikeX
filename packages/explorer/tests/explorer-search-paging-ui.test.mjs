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
  export { ExplorerSearch } from './src/ui/explorer-search.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-search-paging-ui.tsx' }, bundle: true,
platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'paging-ui' }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'paging-ui' }));
  builder.onLoad({ filter: /.*/, namespace: 'paging-ui' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
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
const { useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerSearch, ExplorerFileList } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-search-paging-ui.mjs').toString('base64')}`);

const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');
const entry = index => ({ id: `file-${index}`, name: `File ${String(index).padStart(4, '0')}.txt`, parent: 'root', kind: 'file',
  size: 1, mime: 'text/plain', source: { kind: 'existing', id: `body-${index}` }, favorite: 0,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' });
const page = (start, count, nextCursor) => {
  const entries = Array.from({ length: count }, (_, index) => entry(start + index));
  return { hits: entries.map(item => item.id), entries, nextCursor };
};
const ids = controller => controller.visible.map(item => item.id);

function requestQueue() {
  const calls = [];
  return { calls, onSearchRequest(request, { signal }) {
    const pending = deferred(); calls.push({ request, signal, ...pending }); return pending.promise;
  } };
}

async function mount(t, supplied = {}, dimensions = {}) {
  let workspace, renderer, controller, searchContext, closed = false, childVisible = false;
  const views = new Map(), listeners = new Map(), resizeCallbacks = new Set();
  const handle = { current: null };
  const owner = { getComputedStyle: () => ({ lineHeight: '21px' }), addEventListener() {}, removeEventListener() {},
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { resizeCallbacks.add(this.callback); }
      disconnect() { resizeCallbacks.delete(this.callback); }
    } };
  const scroll = { clientWidth: 1000, clientHeight: 600, scrollTop: 0, scrollLeft: 0, ...dimensions,
    ownerDocument: { defaultView: owner },
    get scrollHeight() { return controller?.view === 'list' ? this.clientHeight : Math.max(this.clientHeight, (controller?.visible.length ?? 0) * 36 + 32); },
    get scrollWidth() { return controller?.view === 'list'
      ? Math.max(this.clientWidth, Math.ceil((controller?.visible.length ?? 0) / Math.max(1, Math.floor((this.clientHeight - 20) / 36))) * 246)
      : this.clientWidth; },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    querySelectorAll() { return []; },
  };
  let props = { initialEntries: [], folderLoading: { initialLoadedFolderIds: ['root'] }, onLoadFolder: () => [],
    onSave() {}, ref: handle, search: { pageSize: 100 }, view: { defaultMode: 'details' },
    ui: { thumbnails: false, contextMenu: false, rowActions: false }, features: { favorites: false },
    renderSearch(context) { searchContext = context; return h('span', null, context.query); }, ...supplied };
  function Pane({ id }) {
    const view = useExplorerViewController(props, workspace, id, null);
    views.set(id, view);
    if (id !== 'main') return null;
    controller = view;
    return h(ExplorerProvider, { value: view }, h(ExplorerSearch), h(ExplorerFileList));
  }
  function App() {
    workspace = useExplorerWorkspace(props);
    return h(StrictMode, null, h(Pane, { id: 'main' }), childVisible ? h(Pane, { id: 'child' }) : null);
  }
  await change(() => { renderer = create(h(App), { createNodeMock(element) {
    return element.props['data-explorer-scroll-container'] !== undefined ? scroll : null;
  } }); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return controller; }, get child() { return views.get('child'); },
    get root() { return renderer.root; }, get workspace() { return workspace; },
    get searchContext() { return searchContext; }, handle, scroll, unmount,
    rows: () => renderer.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry'] === true),
    footer: () => renderer.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-search-paging'] !== undefined)[0],
    async scrollTo(top, left = 0) {
      scroll.scrollTop = top; scroll.scrollLeft = left;
      await change(() => { for (const callback of [...(listeners.get('scroll') ?? [])]) callback(); });
    },
    async end() { await this.scrollTo(scroll.scrollHeight - scroll.clientHeight, scroll.scrollWidth - scroll.clientWidth); },
    async resize(next) {
      Object.assign(scroll, next);
      await change(() => { for (const callback of [...resizeCallbacks]) callback(); });
    },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(App))); },
    async showChild() { childVisible = true; await change(() => renderer.update(h(App))); },
  };
}

test('scroll demand starts below virtualization and appends without resetting selection or scroll', async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.setQuery('files'));
  assert.equal(queue.calls.length, 1);
  assert.equal(queue.calls[0].request.cursor, null);
  assert.equal(queue.calls[0].request.limit, 100);
  await hook.end();
  assert.equal(queue.calls.length, 1, 'the first request owns the pending slot');
  await change(() => queue.calls[0].resolve(page(0, 100, 'page-2')));
  assert.equal(hook.rows().length, 100);
  assert.equal(hook.root.findAllByProps({ 'data-explorer-virtualized': true }).length, 0);
  assert.equal(hook.current.searchHasMore, true);
  assert.match(textOf(hook.footer()), /100/);
  await change(() => hook.current.setSelected(['file-10']));
  await hook.scrollTo(10);
  assert.equal(queue.calls.length, 1, 'scrolling away from the end does not fetch');
  await hook.end();
  assert.equal(queue.calls.length, 2);
  assert.equal(queue.calls[1].request.cursor, 'page-2');
  assert.equal(queue.calls[1].request.limit, 100);
  assert.equal(hook.current.searchLoadingMore, true);
  assert.equal(hook.rows().length, 100, 'the current page stays visible while loading');
  const top = hook.scroll.scrollTop;
  await hook.end();
  assert.equal(queue.calls.length, 2, 'repeated scroll events do not duplicate pending requests');
  await change(() => queue.calls[1].resolve(page(100, 100, 'page-3')));
  assert.equal(hook.rows().length, 200);
  assert.deepEqual(ids(hook.current), Array.from({ length: 200 }, (_, index) => `file-${index}`));
  assert.deepEqual(hook.current.selected, ['file-10']);
  assert.equal(hook.scroll.scrollTop, top);
  assert.equal(hook.current.dirty, false);
  assert.match(textOf(hook.footer()), /200/);
  assert.equal(queue.calls.length, 2, 'a taller result set is no longer near the end');
});

test('paging continues after virtualization starts and the actual final result remains reachable', async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.setQuery('files'));
  for (let index = 0; index < 5; index++) {
    if (index === 4) {
      assert.equal(hook.current.visible.length, 400);
      assert.equal(hook.root.findAllByProps({ 'data-explorer-virtualized': true }).length, 1);
      assert.ok(hook.rows().length < 100, 'paging and virtual scrolling have independent listeners');
      await change(() => hook.current.focusEntryRef.current('file-399'));
      await hook.scrollTo(0);
      assert.ok(hook.rows().some(row => row.props['data-explorer-entry-id'] === 'file-399'));
      assert.equal(queue.calls.length, 4, 'a pinned final row cannot imply that the viewport is near the end');
    }
    if (index) await hook.end();
    assert.equal(queue.calls.length, index + 1);
    await change(() => queue.calls[index].resolve(page(index * 100, 100, index === 4 ? null : `page-${index + 2}`)));
  }
  assert.equal(hook.current.visible.length, 500);
  assert.equal(hook.current.searchHasMore, false);
  assert.equal(hook.root.findAllByProps({ 'data-explorer-virtualized': true }).length, 1);
  assert.ok(hook.rows().length < 100);
  await hook.end();
  assert.ok(hook.rows().some(row => row.props['data-explorer-entry-id'] === 'file-499'));
  assert.ok(hook.rows().length < 100);
  assert.equal(queue.calls.length, 5);
  assert.equal(hook.root.findByType('table').props['aria-rowcount'], 501);
});

test('list view requests its next page from horizontal scroll position', async t => {
  const queue = requestQueue(), hook = await mount(t, { ...queue, view: { defaultMode: 'list' } });
  await change(() => hook.current.setQuery('files'));
  await change(() => queue.calls[0].resolve(page(0, 100, 'page-2')));
  assert.ok(hook.scroll.scrollWidth > hook.scroll.clientWidth);
  await hook.scrollTo(1_000_000, 0);
  assert.equal(queue.calls.length, 1, 'vertical coordinates do not advance a horizontal list');
  await hook.scrollTo(0, hook.scroll.scrollWidth - hook.scroll.clientWidth);
  assert.equal(queue.calls.length, 2);
  const left = hook.scroll.scrollLeft;
  await change(() => queue.calls[1].resolve(page(100, 100, null)));
  assert.equal(hook.scroll.scrollLeft, left);
  assert.equal(hook.current.visible.length, 200);
});

test('short first pages fill the viewport, but an empty continuation waits for an explicit demand', async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.setQuery('files'));
  await change(() => queue.calls[0].resolve(page(0, 1, 'page-2')));
  assert.equal(queue.calls.length, 2, 'a short first page starts filling the viewport without scrolling');
  await change(() => queue.calls[1].resolve(page(1, 1, 'page-3')));
  assert.equal(queue.calls.length, 3, 'new results can keep filling an undersized viewport');
  await change(() => queue.calls[2].resolve(page(2, 0, 'page-4')));
  assert.equal(queue.calls.length, 3, 'empty pages must not drain an unbounded cursor sequence');
  assert.equal(hook.current.searchHasMore, true);
  await change(() => { assert.equal(hook.current.loadMoreSearchResults(), true); });
  assert.equal(queue.calls.length, 4);
  assert.equal(queue.calls[3].request.cursor, 'page-4');
  await change(() => queue.calls[3].resolve(page(2, 100, null)));
  assert.equal(hook.current.visible.length, 102);
});

test('a hidden viewport does not automatically demand pages until it has measurable height', async t => {
  const queue = requestQueue(), hook = await mount(t, queue, { clientHeight: 0 });
  await change(() => hook.current.setQuery('files'));
  await change(() => queue.calls[0].resolve(page(0, 1, 'page-2')));
  await hook.end();
  assert.equal(queue.calls.length, 1);
  await hook.resize({ clientHeight: 600 });
  assert.equal(queue.calls.length, 2);
  await change(() => queue.calls[1].resolve(page(1, 100, null)));
});

test('continuation errors retain rows and selection until the paging footer explicitly retries', async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.setQuery('files'));
  await change(() => queue.calls[0].resolve(page(0, 100, 'page-2')));
  await change(() => hook.current.setSelected(['file-10']));
  await hook.end();
  await change(() => queue.calls[1].reject(new Error('Network unavailable')));
  assert.equal(hook.rows().length, 100);
  assert.deepEqual(hook.current.selected, ['file-10']);
  assert.equal(hook.current.searchPending, false);
  assert.equal(hook.current.searchError, null);
  assert.match(hook.current.searchLoadMoreError, /Network unavailable/);
  assert.match(textOf(hook.footer()), /100/);
  assert.match(textOf(hook.footer()), /Network unavailable/);
  await hook.end();
  await hook.resize({ clientWidth: 900 });
  assert.equal(queue.calls.length, 2, 'scroll and resize do not automatically retry failures');
  const retry = hook.footer().findAllByType('button').find(button => /再試行/.test(textOf(button)));
  assert.ok(retry, 'the footer exposes an explicit retry control');
  await change(() => retry.props.onClick());
  assert.equal(queue.calls.length, 3);
  assert.equal(queue.calls[2].request.cursor, 'page-2', 'retry requests the failed cursor again');
  await change(() => queue.calls[2].resolve(page(100, 100, null)));
  assert.equal(hook.current.searchLoadMoreError, null);
  assert.equal(hook.current.visible.length, 200);
  assert.deepEqual(hook.current.selected, ['file-10']);
});

for (const action of ['query', 'navigation', 'unmount']) test(`${action} discards a late continuation and its metadata`, async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.setQuery('first'));
  await change(() => queue.calls[0].resolve(page(0, 100, 'page-2')));
  await hook.end();
  const draft = hook.workspace.draft, pending = queue.calls[1];
  if (action === 'query') await change(() => hook.current.setQuery('second'));
  else if (action === 'navigation') await change(() => hook.current.navigate('root'));
  else await hook.unmount();
  assert.equal(pending.signal.aborted, true);
  await change(() => pending.resolve(page(100, 100, 'stale-next')));
  assert.equal(draft.getEntries().some(item => item.id === 'file-100'), false);
  if (action === 'query') {
    assert.equal(queue.calls[2].request.cursor, null);
    await change(() => queue.calls[2].resolve(page(500, 1, null)));
    assert.deepEqual(ids(hook.current), ['file-500']);
  } else if (action === 'navigation') {
    assert.equal(hook.current.query, '');
    assert.equal(hook.current.searchHasMore, false);
    assert.equal(hook.current.loadMoreSearchResults(), false);
  }
});

test('renderSearch and the mounted public handle expose the same guarded continuation operation', async t => {
  const queue = requestQueue(), hook = await mount(t, { ...queue, readOnly: true });
  assert.equal(hook.searchContext.hasMore, false);
  assert.equal(hook.searchContext.loadingMore, false);
  assert.equal(hook.searchContext.loadMoreError, null);
  assert.equal(hook.handle.current.loadMoreSearchResults(), false);
  await change(() => hook.searchContext.setQuery('files'));
  await change(() => queue.calls[0].resolve(page(0, 100, 'page-2')));
  assert.equal(hook.searchContext.hasMore, true);
  await change(() => {
    assert.equal(hook.handle.current.loadMoreSearchResults(), true, 'read-only browsing can fetch another page');
    assert.equal(hook.searchContext.loadMoreSearchResults(), false, 'renderer and handle share one pending slot');
  });
  assert.equal(hook.searchContext.loadingMore, true);
  assert.equal(queue.calls.length, 2);
  await change(() => queue.calls[1].reject(new Error('Try again')));
  assert.match(hook.searchContext.loadMoreError, /Try again/);
  await change(() => { assert.equal(hook.searchContext.loadMoreSearchResults(), true); });
  await change(() => queue.calls[2].resolve(page(100, 100, null)));
  assert.equal(hook.searchContext.hasMore, false);
  assert.equal(hook.searchContext.loadingMore, false);
  assert.equal(hook.searchContext.loadMoreError, null);
  assert.equal(hook.handle.current.loadMoreSearchResults(), false);
});

test('the public continuation handle follows the main pane while detached searches stay independent', async t => {
  const queue = requestQueue(), hook = await mount(t, queue);
  await change(() => hook.current.addTab());
  await change(() => hook.workspace.tabs.detachTab('tab-1', 'child'));
  await hook.showChild();
  await change(() => hook.current.setQuery('main'));
  await change(() => hook.child.setQuery('detached'));
  await change(() => queue.calls[0].resolve(page(0, 100, 'main-next')));
  await change(() => queue.calls[1].resolve(page(100, 100, 'child-next')));
  await change(() => { assert.equal(hook.handle.current.loadMoreSearchResults(), true); });
  assert.equal(queue.calls[2].request.query, 'main');
  assert.equal(queue.calls[2].request.cursor, 'main-next');
  assert.equal(queue.calls[2].request.windowId, 'main');
  assert.equal(hook.child.searchLoadingMore, false);
  await change(() => queue.calls[2].resolve(page(200, 100, null)));
  assert.equal(hook.current.visible.length, 200);
  assert.equal(hook.child.visible.length, 100);
  assert.equal(hook.child.searchHasMore, true);
});
