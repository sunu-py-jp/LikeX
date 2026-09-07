import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Load TypeScript without a second React instance inside the bundle.
const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerTabs } from './src/state/use-explorer-tabs.ts';
      export { useExplorerController } from './src/state/use-explorer-controller.ts';
    `,
    resolveDir: packageRoot,
    sourcefile: 'test-explorer-tabs.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'external-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react-test-renderer|lucide-react)(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const { useExplorerTabs, useExplorerController } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mountHook(t, useHook = useExplorerTabs) {
  let latest;
  let renderer;
  let unmounted = false;
  function Probe() {
    latest = useHook();
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => { renderer.unmount(); });
  };
  t.after(unmount);
  return { get current() { return latest; }, unmount };
}

const rootTab = id => ({
  id,
  requestedLocation: 'root',
  history: ['root'],
  historyIndex: 0,
  selectedIds: [],
  anchor: null,
  query: '',
  searchText: '',
  searchRevision: 0,
  view: 'details',
  compact: false,
  sort: { key: 'name', asc: true },
  expanded: ['root'],
});

test('adding a tab starts at root and retains the previous tab state', async t => {
  const hook = await mountHook(t);
  assert.equal(hook.current.activeTabId, 'tab-1');
  assert.deepEqual(hook.current.tabs, [rootTab('tab-1')]);

  await act(async () => {
    hook.current.updateTabState('requestedLocation', 'documents');
    hook.current.updateTabState('query', 'invoice');
    hook.current.updateTabState('selectedIds', ['invoice-2026']);
  });
  const previous = hook.current.activeTab;
  let added;
  await act(async () => { added = hook.current.addTab(); });

  assert.equal(added, 'tab-2');
  assert.equal(hook.current.activeTabId, added);
  assert.deepEqual(hook.current.activeTab, rootTab(added));
  assert.deepEqual(hook.current.tabs.find(tab => tab.id === 'tab-1'), previous);
  await act(async () => { hook.current.selectTab('tab-1'); });
  assert.deepEqual(hook.current.activeTab, previous);
});

test('navigation, history, selection, search, sorting and layout are independent per tab', async t => {
  const hook = await mountHook(t);
  const recent = Symbol('recent');
  const firstState = {
    requestedLocation: 'projects',
    history: ['root', 'documents', 'projects'],
    historyIndex: 2,
    selectedIds: ['report', 'photo'],
    anchor: 'report',
    query: 'draft',
    searchText: 'draft next',
    searchRevision: 2,
    view: 'large',
    compact: true,
    sort: { key: 'updatedAt', asc: false },
    expanded: ['root', 'documents', 'projects'],
  };
  await act(async () => {
    for (const [key, value] of Object.entries(firstState)) hook.current.updateTabState(key, value);
  });
  let secondId;
  await act(async () => { secondId = hook.current.addTab(); });
  const secondState = {
    requestedLocation: recent,
    history: ['root', recent],
    historyIndex: 1,
    selectedIds: ['video'],
    anchor: 'video',
    query: 'launch',
    searchText: 'launch next',
    searchRevision: 3,
    view: 'content',
    compact: false,
    sort: { key: 'size', asc: true },
    expanded: ['root', 'media'],
  };
  await act(async () => {
    for (const [key, value] of Object.entries(secondState)) hook.current.updateTabState(key, value);
  });
  assert.deepEqual(hook.current.activeTab, { id: secondId, ...secondState });
  await act(async () => { hook.current.selectTab('tab-1'); });
  assert.deepEqual(hook.current.activeTab, { id: 'tab-1', ...firstState });
  await act(async () => { hook.current.selectTab(secondId); });
  assert.deepEqual(hook.current.activeTab, { id: secondId, ...secondState });
});

test('consecutive functional updates compose before React rerenders', async t => {
  const hook = await mountHook(t);
  const update = hook.current.updateTabState;
  await act(async () => {
    update('query', previous => previous + 'a');
    update('query', previous => previous + 'b');
    update('selectedIds', previous => [...previous, 'one']);
    update('selectedIds', previous => [...previous, 'two']);
    update('history', previous => [...previous, 'folder']);
    update('historyIndex', previous => previous + 1);
    update('sort', previous => ({ ...previous, key: 'size' }));
    update('sort', previous => ({ ...previous, asc: !previous.asc }));
  });
  assert.equal(hook.current.activeTab.query, 'ab');
  assert.deepEqual(hook.current.activeTab.selectedIds, ['one', 'two']);
  assert.deepEqual(hook.current.activeTab.history, ['root', 'folder']);
  assert.equal(hook.current.activeTab.historyIndex, 1);
  assert.deepEqual(hook.current.activeTab.sort, { key: 'size', asc: false });
});

test('updates after adding or selecting in the same batch target the current tab', async t => {
  const hook = await mountHook(t);
  let secondId;
  await act(async () => {
    const actions = hook.current;
    actions.updateTabState('query', 'first');
    secondId = actions.addTab();
    actions.updateTabState('query', previous => previous + 'second');
    actions.selectTab('tab-1');
    actions.updateTabState('query', previous => previous + ' updated');
  });
  assert.equal(hook.current.activeTabId, 'tab-1');
  assert.equal(hook.current.activeTab.query, 'first updated');
  assert.equal(hook.current.tabs.find(tab => tab.id === secondId).query, 'second');
});

test('closing an active tab chooses its right neighbor, then its left neighbor', async t => {
  const hook = await mountHook(t);
  let secondId;
  let thirdId;
  await act(async () => {
    secondId = hook.current.addTab();
    thirdId = hook.current.addTab();
  });
  await act(async () => { hook.current.selectTab(secondId); });
  await act(async () => { hook.current.closeTab(secondId); });
  assert.equal(hook.current.activeTabId, thirdId);
  assert.deepEqual(hook.current.tabs.map(tab => tab.id), ['tab-1', thirdId]);
  await act(async () => { hook.current.closeTab(thirdId); });
  assert.equal(hook.current.activeTabId, 'tab-1');
  assert.deepEqual(hook.current.tabs, [rootTab('tab-1')]);
});

test('closing inactive or missing tabs preserves the active tab and the last tab remains open', async t => {
  const hook = await mountHook(t);
  let secondId;
  await act(async () => { secondId = hook.current.addTab(); });
  await act(async () => { hook.current.updateTabState('query', 'keep me'); });
  const active = hook.current.activeTab;
  await act(async () => {
    hook.current.closeTab('tab-1');
    hook.current.selectTab('missing');
    hook.current.closeTab('missing');
    hook.current.closeTab(secondId);
  });
  assert.equal(hook.current.activeTabId, secondId);
  assert.deepEqual(hook.current.tabs, [active]);
  assert.deepEqual(hook.current.activeTab, active);
});

test('closed tab IDs are not reused, including several additions in one render batch', async t => {
  const hook = await mountHook(t);
  const ids = [];
  await act(async () => {
    ids.push(hook.current.addTab());
    ids.push(hook.current.addTab());
    hook.current.closeTab(ids[1]);
    ids.push(hook.current.addTab());
    hook.current.closeTab(ids[0]);
    ids.push(hook.current.addTab());
  });
  assert.deepEqual(ids, ['tab-2', 'tab-3', 'tab-4', 'tab-5']);
  assert.equal(new Set(hook.current.tabs.map(tab => tab.id)).size, hook.current.tabs.length);
  assert.deepEqual(hook.current.tabs.map(tab => tab.id), ['tab-1', 'tab-4', 'tab-5']);
  assert.equal(hook.current.activeTabId, 'tab-5');
});

test('tab operations keep the controller draft and clipboard shared without reading or saving content', async t => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (_event, handler) => listeners.add(handler),
      removeEventListener: (_event, handler) => listeners.delete(handler),
    },
  });
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  const saves = [];
  let reads = 0;
  const options = {
    initialEntries: [],
    onSave: payload => { saves.push(payload); },
    readFile: async () => { reads++; return new Blob(); },
  };
  let hook;
  try {
    hook = await mountHook(t, () => useExplorerController(options));
    const file = new File(['unsaved tab content'], 'local.txt', { type: 'text/plain' });
    await act(async () => { hook.current.addLocalFiles([file]); });
    const entryId = hook.current.entries[0].id;
    await act(async () => { hook.current.copyToClipboard('copy', [entryId]); });
    const clipboard = hook.current.clipboard;
    const firstId = hook.current.activeTabId;
    let secondId;
    await act(async () => { secondId = hook.current.addTab(); });
    assert.equal(hook.current.entries[0].source.file, file);
    assert.deepEqual(hook.current.clipboard, clipboard);
    assert.equal(hook.current.dirty, true);
    await act(async () => { hook.current.selectTab(firstId); });
    await act(async () => { hook.current.closeTab(secondId); });
    assert.equal(hook.current.entries[0].source.file, file);
    assert.deepEqual(hook.current.clipboard, clipboard);
    assert.equal(hook.current.dirty, true);
    assert.equal(saves.length, 0);
    assert.equal(reads, 0);
    assert.equal(network.mock.callCount(), 0);

    await act(async () => { await hook.current.saveChanges(); });
    assert.equal(saves.length, 1);
    assert.equal(saves[0].entries[0].source.file, file);
    assert.equal(hook.current.dirty, false);
  } finally {
    await hook?.unmount();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
  assert.equal(listeners.size, 0);
});

const pathFolder = (id, name, parent = 'root') => ({
  id, name, parent, kind: 'folder', size: 0, mime: '', favorite: 0,
  createdAt: '2026-09-06T01:00:00Z', updatedAt: '2026-09-06T01:00:00Z', source: null,
});
const pathEntries = () => [
  pathFolder('projects', 'Projects'),
  pathFolder('docs', '資料', 'projects'),
  pathFolder('archive', 'Archive'),
  {
    ...pathFolder('note', 'Notes.txt', 'docs'), kind: 'file', size: 3,
    mime: 'text/plain', source: { kind: 'existing', id: 'note-content' },
  },
];
const change = async callback => { await act(async () => { await callback(); }); };

async function mountPathController(t, overrides = {}) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (_event, handler) => listeners.add(handler),
      removeEventListener: (_event, handler) => listeners.delete(handler),
      querySelectorAll: () => [], getElementById: () => null,
    },
  });
  const events = [];
  const saves = [];
  const reads = [];
  const renders = [];
  let props = {
    initialEntries: pathEntries(), defaultPath: '/Projects/資料',
    onSave: payload => { saves.push(payload); },
    readFile: async id => { reads.push(id); return new Blob(['abc']); },
    onEvent: event => events.push(event), ...overrides,
  };
  let latest;
  let renderer;
  let key = 'first';
  let unmounted = false;
  function Probe({ options }) {
    latest = useExplorerController(options);
    renders.push(latest.location);
    return null;
  }
  const element = () => createElement(StrictMode, null, createElement(Probe, { options: props, key }));
  const unmount = async () => {
    if (renderer && !unmounted) { unmounted = true; await change(() => renderer.unmount()); }
  };
  t.after(async () => {
    try {
      await unmount();
      assert.equal(listeners.size, 0);
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
    }
  });
  await change(() => { renderer = create(element()); });
  return {
    get current() { return latest; }, events, saves, reads, renders,
    async update(patch, nextKey = key) {
      props = { ...props, ...patch }; key = nextKey;
      await change(() => renderer.update(element()));
    },
  };
}

test('defaultPath opens its folder on the first render with one history entry and no operation events', async t => {
  const hook = await mountPathController(t);
  assert.ok(hook.renders.every(location => location === 'docs'), 'never render an intermediate root tab');
  assert.equal(hook.current.addressPath, '/Projects/資料');
  assert.equal(hook.current.title, '資料');
  assert.deepEqual(hook.current.visible.map(entry => entry.id), ['note']);
  assert.deepEqual(hook.current.history, ['docs']);
  assert.equal(hook.current.historyIndex, 0);
  assert.deepEqual(hook.current.expanded, ['root', 'projects', 'docs']);
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.notification, null);
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.events, []);
  assert.deepEqual(hook.saves, []);
  assert.deepEqual(hook.reads, []);
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.location, 'docs');
  await change(() => hook.current.navigate('archive'));
  assert.deepEqual(hook.current.history, ['docs', 'archive']);
  await change(() => hook.current.travel(-1));
  assert.equal(hook.current.location, 'docs');
  await change(() => hook.current.travel(1));
  assert.equal(hook.current.location, 'archive');
});

test('omitted, empty and root default paths preserve the existing root start', async t => {
  for (const defaultPath of [undefined, '', ' \t ', '/', '\\']) {
    await t.test(String(defaultPath), async t => {
      const hook = await mountPathController(t, { defaultPath });
      assert.equal(hook.current.location, 'root');
      assert.deepEqual(hook.current.history, ['root']);
      assert.equal(hook.current.notification, null);
      assert.deepEqual(hook.events, []);
    });
  }
});

test('defaultPath uses the address bar resolver with root-relative paths and custom root aliases', async t => {
  for (const defaultPath of ['projects/資料', './Projects/資料/', 'Projects\\資料', '記事一覧/Projects/資料']) {
    await t.test(defaultPath, async t => {
      const hook = await mountPathController(t, { defaultPath, rootLabel: '記事一覧' });
      assert.equal(hook.current.location, 'docs');
      assert.equal(hook.current.addressPath, '/Projects/資料');
      assert.equal(hook.current.notification, null);
    });
  }
});

test('defaultPath prop updates do not navigate and new tabs use the initially resolved folder', async t => {
  const hook = await mountPathController(t);
  const firstId = hook.current.activeTabId;
  await change(() => hook.current.navigate('archive'));
  await change(() => hook.current.setQuery('keep this search'));
  const previousEvents = hook.events.length;
  await hook.update({ defaultPath: '/Archive', rootLabel: '別の表示名' });
  assert.equal(hook.current.location, 'archive');
  assert.equal(hook.current.query, 'keep this search');
  assert.equal(hook.events.length, previousEvents);
  let secondId;
  await change(() => { secondId = hook.current.addTab(); });
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.current.history, ['docs']);
  assert.equal(hook.current.query, '');
  assert.deepEqual(hook.current.expanded, ['root', 'projects', 'docs']);
  assert.equal(hook.current.tabLocations[secondId], 'docs');
  await change(() => hook.current.selectTab(firstId));
  assert.equal(hook.current.location, 'archive');
  assert.equal(hook.current.query, 'keep this search');
});

test('new tabs follow the default folder ID after rename and move, with its current ancestor chain', async t => {
  const hook = await mountPathController(t);
  await change(() => hook.current.act('rename', ['docs'], { name: '設計' }));
  await change(() => hook.current.act('move', ['docs'], { parent: 'archive' }));
  await change(() => hook.current.navigate('root'));
  await change(() => hook.current.addTab());
  assert.equal(hook.current.location, 'docs');
  assert.equal(hook.current.addressPath, '/Archive/設計');
  assert.equal(hook.current.title, '設計');
  assert.deepEqual(hook.current.expanded, ['root', 'archive', 'docs']);
  assert.deepEqual(hook.current.history, ['docs']);
  assert.deepEqual(hook.current.entries.find(entry => entry.id === 'note').source, { kind: 'existing', id: 'note-content' });
});

test('deleting the default folder makes new tabs start at root even if the same path is recreated', async t => {
  const hook = await mountPathController(t);
  await change(() => hook.current.act('delete', ['docs']));
  await change(() => hook.current.act('create', [], { name: '資料', parent: 'projects' }));
  await change(() => hook.current.setNotification(null));
  await change(() => hook.current.addTab());
  assert.equal(hook.current.location, 'root');
  assert.deepEqual(hook.current.history, ['root']);
  assert.deepEqual(hook.current.expanded, ['root']);
  assert.equal(hook.current.notification, null);
});

test('invalid default paths show one initial error and never read files or open previews', async t => {
  for (const defaultPath of ['/Missing', '/Projects/資料/Notes.txt', 'https://example.com/folder', 'C:\\folder', '//server/share']) {
    await t.test(defaultPath, async t => {
      const hook = await mountPathController(t, { defaultPath });
      assert.ok(hook.renders.every(location => location === 'root'));
      assert.equal(hook.current.notification?.kind, 'error');
      assert.match(hook.current.notification?.message, /初期.*フォルダ/);
      assert.ok(hook.current.notification?.description);
      assert.deepEqual(hook.events, []);
      assert.deepEqual(hook.reads, []);
      assert.equal(hook.current.preview, undefined);
      await change(() => hook.current.setNotification(null));
      await hook.update({ defaultPath: '/Projects/資料' });
      await change(() => hook.current.addTab());
      assert.equal(hook.current.location, 'root');
      assert.equal(hook.current.notification, null, 'do not replay the initialization error');
    });
  }
});

test('defaultPath is independent of path editing and tabs feature flags', async t => {
  const hook = await mountPathController(t, { features: { pathInput: false, tabs: false } });
  assert.equal(hook.current.location, 'docs');
  assert.equal(hook.current.addressPath, '/Projects/資料');
  await change(() => hook.current.navigatePath('/Archive'));
  await change(() => hook.current.addTab());
  assert.equal(hook.current.location, 'docs');
  assert.deepEqual(hook.events, []);
  await change(() => hook.current.navigate('root'));
  assert.equal(hook.current.location, 'root', 'the default folder does not constrain navigation');
});

test('uploads inside the default folder use its parent ID and save only real changes', async t => {
  const hook = await mountPathController(t);
  const file = new File(['new'], 'New.txt', { type: 'text/plain' });
  await change(() => hook.current.addLocalFiles([file]));
  assert.equal(hook.current.entries.find(entry => entry.source?.kind === 'local').parent, 'docs');
  await change(() => hook.current.saveChanges());
  assert.equal(hook.saves.length, 1);
  assert.equal(hook.saves[0].changes.created.length, 1);
  assert.equal(hook.saves[0].changes.created[0].source.file, file);
  assert.deepEqual(hook.saves[0].changes.updated, []);
  assert.deepEqual(hook.saves[0].changes.deleted, []);
});

test('a changed React key resolves defaultPath against the replacement workspace', async t => {
  const hook = await mountPathController(t);
  const replacement = [pathFolder('new-archive', 'Archive')];
  await hook.update({ initialEntries: replacement, defaultPath: '/Archive' });
  assert.equal(hook.current.location, 'docs');
  await hook.update({}, 'second');
  assert.equal(hook.current.location, 'new-archive');
  assert.deepEqual(hook.current.history, ['new-archive']);
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.events, []);
});
