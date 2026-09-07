import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `export { useExplorerTabs, useExplorerWindowTabs } from './src/state/use-explorer-tabs.ts';`,
    resolveDir: packageRoot, sourcefile: 'test-explorer-windows.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'shared-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    },
  }],
});
const { useExplorerTabs, useExplorerWindowTabs } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { callback(); }); };
const ids = tabs => tabs.map(tab => tab.id);

async function mountTabs(t, defaultView = 'details', initialStart) {
  let latest;
  let renderer;
  function Probe() {
    latest = useExplorerTabs(defaultView, initialStart);
    return null;
  }
  await change(() => { renderer = create(createElement(StrictMode, null, createElement(Probe))); });
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return latest; } };
}

const editedState = {
  requestedLocation: 'documents', history: ['root', 'projects', 'documents'], historyIndex: 2,
  selectedIds: ['report', 'photo'], anchor: 'report', query: '議事録',
  view: 'large', compact: true, sort: { key: 'updatedAt', asc: false },
  expanded: ['root', 'projects', 'documents'],
};

test('detaching and reattaching preserves the tab ID, full navigation history and view state', async t => {
  const hook = await mountTabs(t);
  await change(() => {
    for (const [key, value] of Object.entries(editedState)) hook.current.updateTabState(key, value);
  });
  const detachedTab = hook.current.activeTab;
  let remainingId;
  await change(() => { remainingId = hook.current.addTab(); hook.current.selectTab(detachedTab.id); });
  await change(() => { assert.equal(hook.current.detachTab(detachedTab.id, 'window-a'), true); });
  assert.deepEqual(hook.current.forWindow('window-a').activeTab, detachedTab);
  assert.equal(hook.current.activeTabId, remainingId);
  assert.deepEqual(ids(hook.current.tabs), [remainingId]);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), [detachedTab.id]);
  assert.equal(hook.current.allTabs.length, 2, 'moving a tab does not clone it');
  await change(() => hook.current.forWindow('window-a').updateTabState('query', '別窓で編集'));
  await change(() => hook.current.reattachWindow('window-a'));
  assert.deepEqual(hook.current.activeTab, { ...detachedTab, query: '別窓で編集' });
  assert.equal(hook.current.activeTabId, detachedTab.id);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  assert.deepEqual(new Set(ids(hook.current.tabs)), new Set([detachedTab.id, remainingId]));
});

test('each window has an independent active tab, including same-batch selection and functional updates', async t => {
  const hook = await mountTabs(t);
  let secondId;
  let mainId;
  await change(() => { secondId = hook.current.addTab(); mainId = hook.current.addTab(); });
  await change(() => { hook.current.detachTab('tab-1', 'window-a'); hook.current.detachTab(secondId, 'window-b'); });
  let childId;
  let newMainId;
  await change(() => {
    const main = hook.current;
    const child = hook.current.forWindow('window-a');
    childId = child.addTab();
    child.updateTabState('query', old => old + 'child');
    child.updateTabState('query', old => old + ' search');
    child.selectTab('tab-1');
    child.updateTabState('selectedIds', old => [...old, 'one']);
    child.updateTabState('selectedIds', old => [...old, 'two']);
    newMainId = main.addTab();
    main.updateTabState('query', 'main search');
    main.selectTab(mainId);
    main.updateTabState('sort', { key: 'size', asc: false });
    hook.current.forWindow('window-b').updateTabState('query', 'other window');
  });
  assert.equal(hook.current.activeTabId, mainId);
  assert.deepEqual(hook.current.activeTab.sort, { key: 'size', asc: false });
  assert.equal(hook.current.tabs.find(tab => tab.id === newMainId).query, 'main search');
  const firstWindow = hook.current.forWindow('window-a');
  assert.equal(firstWindow.activeTabId, 'tab-1');
  assert.deepEqual(firstWindow.activeTab.selectedIds, ['one', 'two']);
  assert.equal(firstWindow.tabs.find(tab => tab.id === childId).query, 'child search');
  assert.equal(hook.current.forWindow('window-b').activeTabId, secondId);
  assert.equal(hook.current.forWindow('window-b').activeTab.query, 'other window');
});

test('the final main tab cannot detach, retaining its state and the next tab ID', async t => {
  const start = { location: 'docs', expanded: ['root', 'projects', 'docs'] };
  const hook = await mountTabs(t, 'large', start);
  await change(() => {
    hook.current.updateTabState('requestedLocation', 'archive');
    hook.current.updateTabState('query', 'keep this');
    hook.current.updateTabState('selectedIds', ['report']);
  });
  const previous = hook.current.activeTab;
  const originalTabs = hook.current.allTabs;
  await change(() => {
    assert.equal(hook.current.detachTab('tab-1', 'window-a'), false);
    assert.equal(hook.current.detachTab('tab-1', 'window-b'), false);
  });
  assert.equal(hook.current.allTabs, originalTabs);
  assert.equal(hook.current.activeTab, previous);
  assert.equal(hook.current.activeTabId, 'tab-1');
  assert.deepEqual(hook.current.getWindowTabIds('main'), ['tab-1']);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  let nextId;
  await change(() => { nextId = hook.current.addTab(); });
  assert.equal(nextId, 'tab-2', 'rejected detaches do not consume IDs');
  assert.equal(hook.current.activeTab.requestedLocation, 'docs');
  assert.deepEqual(hook.current.activeTab.expanded, start.expanded);
  await change(() => { assert.equal(hook.current.detachTab('tab-1', 'window-a'), true); });
  assert.deepEqual(hook.current.forWindow('window-a').activeTab, previous);
  assert.equal(hook.current.forWindow('window-a').activeTabId, 'tab-1');
  assert.equal(hook.current.activeTabId, 'tab-2');
  const withChild = hook.current.allTabs;
  await change(() => { assert.equal(hook.current.detachTab('tab-2', 'window-b'), false); });
  assert.equal(hook.current.allTabs, withChild, 'a child window does not count as a spare main tab');
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), []);
});

test('all tabs created in a child window return with their state and its active tab preserved', async t => {
  const hook = await mountTabs(t, 'details', { location: 'docs', expanded: ['root', 'docs'] });
  await change(() => hook.current.addTab());
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  let secondId;
  let thirdId;
  await change(() => {
    const child = hook.current.forWindow('window-a');
    child.updateTabState('query', 'first');
    secondId = child.addTab({ location: 'archive', expanded: ['root', 'archive'] });
    child.updateTabState('query', 'second');
    child.updateTabState('history', ['archive', 'history-folder']);
    child.updateTabState('historyIndex', 1);
    thirdId = child.addTab();
    child.updateTabState('query', 'third');
    child.selectTab(secondId);
  });
  const before = hook.current.allTabs;
  const childIds = hook.current.getWindowTabIds('window-a');
  assert.deepEqual(childIds, ['tab-1', secondId, thirdId]);
  assert.equal(hook.current.forWindow('window-a').tabs.find(tab => tab.id === thirdId).requestedLocation, 'docs');
  await change(() => hook.current.reattachWindow('window-a'));
  assert.deepEqual(hook.current.allTabs, before);
  assert.deepEqual(hook.current.tabs, before);
  assert.equal(hook.current.activeTabId, secondId);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  assert.equal(new Set(ids(hook.current.allTabs)).size, before.length);
});

test('closing tabs uses neighbors in the same window and cannot close its final tab', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  const mainId = hook.current.activeTabId;
  let secondId;
  let thirdId;
  await change(() => { const child = hook.current.forWindow('window-a'); secondId = child.addTab(); thirdId = child.addTab(); child.selectTab(secondId); });
  await change(() => hook.current.forWindow('window-a').closeTab(secondId));
  assert.equal(hook.current.forWindow('window-a').activeTabId, thirdId);
  assert.equal(hook.current.activeTabId, mainId);
  await change(() => hook.current.forWindow('window-a').closeTab(thirdId));
  assert.equal(hook.current.forWindow('window-a').activeTabId, 'tab-1');
  await change(() => { hook.current.forWindow('window-a').closeTab('tab-1'); hook.current.closeTab(mainId); });
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), ['tab-1']);
  assert.deepEqual(ids(hook.current.tabs), [mainId]);
});

test('unknown and foreign tab operations are rejected without changing ownership or consuming IDs', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  const original = hook.current.allTabs;
  await change(() => {
    assert.equal(hook.current.detachTab('missing', 'window-a'), false);
    assert.equal(hook.current.detachTab('tab-1', 'main'), false);
    assert.equal(hook.current.detachTab('tab-1', ''), false);
    hook.current.selectTab('missing'); hook.current.closeTab('missing');
    hook.current.reattachWindow('missing'); hook.current.reattachWindow('main');
  });
  assert.deepEqual(hook.current.allTabs, original);
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  assert.equal(hook.current.activeTabId, 'tab-2');
  const before = hook.current.allTabs;
  await change(() => {
    assert.equal(hook.current.detachTab('tab-1', 'window-b'), false);
    hook.current.selectTab('tab-1'); hook.current.closeTab('tab-1');
    const child = hook.current.forWindow('window-a');
    child.selectTab('tab-2'); child.closeTab('tab-2');
    child.selectTab('missing'); child.closeTab('missing');
    hook.current.reattachWindow('missing');
  });
  assert.deepEqual(hook.current.allTabs, before);
  assert.equal(hook.current.activeTabId, 'tab-2');
  assert.equal(hook.current.forWindow('window-a').activeTabId, 'tab-1');
  let next;
  await change(() => { next = hook.current.forWindow('window-a').addTab(); });
  assert.equal(next, 'tab-3');
});

test('returning one window leaves other windows intact and repeated returns are harmless', async t => {
  const hook = await mountTabs(t);
  let secondId;
  await change(() => { secondId = hook.current.addTab(); hook.current.addTab(); });
  await change(() => { hook.current.detachTab('tab-1', 'window-a'); hook.current.detachTab(secondId, 'window-b'); });
  await change(() => hook.current.forWindow('window-b').updateTabState('query', 'still detached'));
  const otherWindow = hook.current.forWindow('window-b').activeTab;
  const copiedIds = hook.current.getWindowTabIds('window-b');
  copiedIds.push('not-a-real-tab');
  await change(() => hook.current.reattachWindow('window-a'));
  assert.deepEqual(hook.current.forWindow('window-b').activeTab, otherWindow);
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), [secondId]);
  const mainActive = hook.current.activeTabId;
  const allTabs = hook.current.allTabs;
  await change(() => hook.current.reattachWindow('window-a'));
  assert.equal(hook.current.activeTabId, mainActive);
  assert.deepEqual(hook.current.allTabs, allTabs);
});

test('closing a child window removes all of its tabs without changing main or other windows', async t => {
  const hook = await mountTabs(t);
  let secondId;
  await change(() => { secondId = hook.current.addTab(); hook.current.addTab(); });
  await change(() => { hook.current.detachTab('tab-1', 'window-a'); hook.current.detachTab(secondId, 'window-b'); });
  let added;
  await change(() => {
    for (const [key, value] of Object.entries(editedState)) hook.current.updateTabState(key, value);
    added = hook.current.forWindow('window-a').addTab();
    hook.current.forWindow('window-a').updateTabState('query', 'removed with window');
    hook.current.forWindow('window-b').updateTabState('query', 'still open');
  });
  const main = hook.current.activeTab;
  const other = hook.current.forWindow('window-b').activeTab;
  const childAction = hook.current.forWindow('window-a');
  await change(() => hook.current.closeWindow('window-a'));
  assert.equal(hook.current.activeTab, main);
  assert.equal(hook.current.forWindow('window-b').activeTab, other);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  assert.equal(hook.current.allTabs.some(tab => tab.id === 'tab-1' || tab.id === added), false);
  const before = hook.current.allTabs;
  await change(() => {
    hook.current.closeWindow('main'); hook.current.closeWindow('missing'); hook.current.closeWindow('');
    hook.current.closeWindow('window-a'); hook.current.reattachWindow('window-a');
    childAction.updateTabState('query', 'stale event'); childAction.selectTab(added); childAction.closeTab(added);
  });
  assert.deepEqual(hook.current.allTabs, before);
  assert.equal(hook.current.activeTab, main);
  assert.equal(hook.current.forWindow('window-b').activeTab, other);
  let nextId;
  await change(() => { nextId = hook.current.addTab(); });
  assert.equal(nextId, 'tab-5', 'closing tabs does not recycle their identities');
  await change(() => hook.current.closeWindow('window-b'));
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), []);
  assert.equal(hook.current.activeTabId, nextId);
});

test('a child tab can detach again with its state intact and survives closing its source window', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  await change(() => { assert.equal(hook.current.detachTab('tab-1', 'window-a'), true); });
  const initial = hook.current.allTabs;
  await change(() => { assert.equal(hook.current.detachTab('tab-1', 'window-b', 'window-a'), false); });
  assert.equal(hook.current.allTabs, initial);
  let childTabId;
  await change(() => {
    childTabId = hook.current.forWindow('window-a').addTab();
    for (const [key, value] of Object.entries(editedState)) hook.current.forWindow('window-a').updateTabState(key, value);
  });
  const childTab = hook.current.forWindow('window-a').activeTab;
  const mainTab = hook.current.activeTab;
  await change(() => { assert.equal(hook.current.detachTab(childTabId, 'window-b', 'window-a'), true); });
  assert.equal(hook.current.forWindow('window-b').activeTab, childTab);
  assert.equal(hook.current.forWindow('window-a').activeTabId, 'tab-1');
  assert.equal(hook.current.activeTab, mainTab);
  const beforeRejected = hook.current.allTabs;
  await change(() => {
    assert.equal(hook.current.detachTab('tab-1', 'window-c', 'window-a'), false);
    assert.equal(hook.current.detachTab(childTabId, 'window-c', 'window-a'), false);
    assert.equal(hook.current.detachTab(childTabId, 'window-c', 'missing'), false);
  });
  assert.equal(hook.current.allTabs, beforeRejected);
  await change(() => hook.current.closeWindow('window-a'));
  assert.equal(hook.current.forWindow('window-b').activeTab, childTab);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  assert.equal(hook.current.activeTab, mainTab);
  await change(() => hook.current.forWindow('window-b').updateTabState('query', 'still usable'));
  await change(() => hook.current.reattachWindow('window-b'));
  assert.equal(hook.current.activeTabId, childTabId);
  assert.deepEqual(hook.current.activeTab, { ...childTab, query: 'still usable' });
  assert.deepEqual(hook.current.getWindowTabIds('main'), [mainTab.id, childTabId]);
});

test('explicitly returning a derived window always targets main while its source stays open', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  let derived;
  await change(() => { derived = hook.current.forWindow('window-a').addTab(); });
  await change(() => { assert.equal(hook.current.detachTab(derived, 'window-b', 'window-a'), true); });
  const source = hook.current.forWindow('window-a').activeTab;
  await change(() => hook.current.reattachWindow('window-b'));
  assert.equal(hook.current.activeTabId, derived);
  assert.equal(hook.current.forWindow('window-a').activeTab, source);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), ['tab-1']);
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), []);
});

test('restoring a failed derived window returns every tab to its source in its original order with complete view state', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  let first;
  let second;
  await change(() => {
    const source = hook.current.forWindow('window-a');
    first = source.addTab();
    for (const [key, value] of Object.entries(editedState)) source.updateTabState(key, value);
    second = source.addTab();
    source.updateTabState('query', 'second pending tab');
  });
  const originalOrder = hook.current.getWindowTabIds('window-a');
  const originalTabs = hook.current.allTabs;
  const main = hook.current.activeTab;
  const restoreWindow = hook.current.restoreWindow;
  await change(() => {
    assert.equal(hook.current.detachTab(first, 'window-b', 'window-a'), true);
    assert.equal(hook.current.detachTab(second, 'window-b', 'window-a'), true);
  });
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), ['tab-1']);
  assert.equal(hook.current.restoreWindow, restoreWindow, 'restoration stays stable across renders');
  await change(() => hook.current.restoreWindow('window-b', 'window-a'));
  assert.equal(hook.current.allTabs, originalTabs, 'restoration only changes ownership and active-tab state');
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), originalOrder);
  assert.equal(hook.current.forWindow('window-a').activeTabId, second);
  assert.deepEqual(hook.current.forWindow('window-a').tabs.find(tab => tab.id === first), { id: first, ...editedState });
  assert.equal(hook.current.activeTab, main);
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), []);
});

test('restoring an opening window after its source closes recovers its tab in main without resetting navigation', async t => {
  const hook = await mountTabs(t);
  await change(() => hook.current.addTab());
  await change(() => hook.current.detachTab('tab-1', 'window-a'));
  let derived;
  await change(() => {
    const source = hook.current.forWindow('window-a');
    derived = source.addTab();
    for (const [key, value] of Object.entries(editedState)) source.updateTabState(key, value);
  });
  const pendingTab = hook.current.forWindow('window-a').activeTab;
  await change(() => hook.current.detachTab(derived, 'window-b', 'window-a'));
  await change(() => hook.current.closeWindow('window-a'));
  const remainingTabs = hook.current.allTabs;
  await change(() => hook.current.restoreWindow('window-b', 'window-a'));
  assert.equal(hook.current.allTabs, remainingTabs);
  assert.equal(hook.current.activeTab, pendingTab);
  assert.deepEqual(hook.current.getWindowTabIds('main'), ['tab-2', derived]);
  assert.deepEqual(hook.current.getWindowTabIds('window-a'), []);
  assert.deepEqual(hook.current.getWindowTabIds('window-b'), []);
});

test('restoration defaults to main for a missing or self destination and repeated recovery is harmless', async t => {
  for (const sourceWindowId of ['missing', 'window-a']) {
    const hook = await mountTabs(t);
    await change(() => hook.current.addTab());
    await change(() => hook.current.detachTab('tab-1', 'window-a'));
    const originalTabs = hook.current.allTabs;
    await change(() => hook.current.restoreWindow('window-a', sourceWindowId));
    assert.equal(hook.current.allTabs, originalTabs);
    assert.equal(hook.current.activeTabId, 'tab-1');
    assert.deepEqual(hook.current.getWindowTabIds('main'), ['tab-1', 'tab-2']);
    await change(() => {
      hook.current.restoreWindow('window-a', sourceWindowId);
      hook.current.restoreWindow('main', sourceWindowId);
    });
    assert.equal(hook.current.allTabs, originalTabs);
    assert.equal(hook.current.activeTabId, 'tab-1');
  }
});

async function mountWindowSubscribers(t) {
  const renders = { host: 0, main: 0, a: 0, b: 0 };
  const snapshots = new Map();
  let tabs;
  let renderer;
  function Window({ store, id }) {
    snapshots.set(id, useExplorerWindowTabs(store, id));
    renders[id]++;
    return null;
  }
  function Host() {
    tabs = useExplorerTabs('details', undefined, false);
    renders.host++;
    return ['main', 'a', 'b'].map(id => createElement(Window, { key: id, store: tabs, id }));
  }
  await change(() => { renderer = create(createElement(StrictMode, null, createElement(Host))); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => {
    tabs.addTab(); tabs.addTab();
    tabs.detachTab('tab-1', 'a'); tabs.detachTab('tab-2', 'b');
  });
  return { tabs, renders, snapshots };
}

test('window-specific tab subscriptions skip unrelated panes and preserve their snapshot and action identity', async t => {
  const hook = await mountWindowSubscribers(t);
  const before = { ...hook.renders };
  const a = hook.tabs.forWindow('a');
  const b = hook.tabs.forWindow('b');
  const main = hook.tabs.forWindow('main');
  await change(() => hook.tabs.updateTabState('query', 'local search'));
  assert.ok(hook.renders.main > before.main);
  assert.equal(hook.renders.host, before.host);
  assert.equal(hook.renders.a, before.a);
  assert.equal(hook.renders.b, before.b);
  assert.equal(hook.tabs.forWindow('a'), a);
  assert.equal(hook.tabs.forWindow('b'), b);
  assert.equal(hook.tabs.forWindow('main').updateTabState, main.updateTabState);
  assert.equal(hook.snapshots.get('main').activeTab.query, 'local search');
  const afterMain = { ...hook.renders };
  await change(() => a.patchTabState({ query: 'child search', selectedIds: ['report'], view: 'large' }));
  assert.equal(hook.renders.main, afterMain.main);
  assert.equal(hook.renders.b, afterMain.b);
  assert.ok(hook.renders.a > afterMain.a);
});

test('equivalent scalar, array and sort updates do not publish or allocate another window snapshot', async t => {
  const hook = await mountWindowSubscribers(t);
  const before = hook.tabs.forWindow('a');
  const renders = { ...hook.renders };
  const allTabs = hook.tabs.allTabs;
  await change(() => {
    before.updateTabState('query', '');
    before.updateTabState('query', previous => previous);
    before.updateTabState('selectedIds', []);
    before.updateTabState('sort', { key: 'name', asc: true });
    before.selectTab(before.activeTabId);
    before.patchTabState({ compact: false, expanded: ['root'] });
  });
  assert.equal(hook.tabs.forWindow('a'), before);
  assert.equal(hook.tabs.allTabs, allTabs);
  assert.deepEqual(hook.renders, renders);
});

test('multi-field patches and batched operations compose synchronously with one subscriber notification', async t => {
  const hook = await mountWindowSubscribers(t);
  let notifications = 0;
  const unsubscribe = hook.tabs.subscribe(() => notifications++);
  t.after(unsubscribe);
  await change(() => hook.tabs.batch(() => {
    const pane = hook.tabs.forWindow('a');
    pane.patchTabState(previous => ({ history: [...previous.history, 'docs'], historyIndex: previous.historyIndex + 1, requestedLocation: 'docs' }));
    pane.updateTabState('query', previous => `${previous}a`);
    pane.updateTabState('query', previous => `${previous}b`);
    assert.equal(hook.tabs.forWindow('a').activeTab.query, 'ab');
    assert.deepEqual(hook.tabs.forWindow('a').activeTab.history, ['root', 'docs']);
  }));
  assert.equal(notifications, 1);
  assert.equal(hook.snapshots.get('a').activeTab.historyIndex, 1);
});

test('closing several windows publishes once and leaves the main window snapshot intact', async t => {
  const hook = await mountWindowSubscribers(t);
  const main = hook.tabs.forWindow('main');
  const before = hook.renders.main;
  let notifications = 0;
  const unsubscribe = hook.tabs.subscribe(() => notifications++);
  t.after(unsubscribe);
  await change(() => hook.tabs.closeWindows(['a', 'main', 'b', 'a', 'missing']));
  assert.equal(notifications, 1);
  assert.equal(hook.tabs.forWindow('main'), main);
  assert.equal(hook.renders.main, before);
  assert.deepEqual(hook.tabs.allTabs, main.tabs);
  assert.deepEqual(hook.tabs.getWindowTabIds('a'), []);
  assert.deepEqual(hook.tabs.getWindowTabIds('b'), []);
});
