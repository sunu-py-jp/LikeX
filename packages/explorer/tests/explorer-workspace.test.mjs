import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
      export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-workspace.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const entry = (id, name, parent = 'root', kind = 'file') => ({
  id, name, parent, kind, size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '',
  source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0,
});
const initialEntries = () => [entry('folder', '資料', 'root', 'folder'), entry('alpha', 'Alpha.txt'), entry('nested', 'Nested.txt', 'folder')];
const byId = (pane, id) => pane.entries.find(entry => entry.id === id);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function mockDocument() {
  const listeners = new Set();
  const windowListeners = new Map();
  const anchors = [];
  const observers = [];
  const element = tag => ({
    tagName: tag.toUpperCase(), style: {}, className: '', isConnected: false, children: [],
    appendChild(child) { child.isConnected = true; this.children.push(child); },
    insertBefore(child, next) { child.isConnected = true; this.children.splice(this.children.indexOf(next), 0, child); },
    setAttribute(name, value) { this[name] = value; },
    remove() { this.isConnected = false; },
    contains(target) { return target === this || this.children.includes(target); },
    closest() { return null; },
    querySelector(selector) { return selector === '[data-explorer-root]' ? this.committedRoot ?? null : null; },
    focus() {},
  });
  const document = {
    title: '', baseURI: 'https://example.test/workspace/', visibilityState: 'visible', readyState: 'complete',
    documentElement: { lang: 'ja', className: 'theme' }, head: element('head'), body: element('body'),
    addEventListener(type, handler) { if (type === 'keydown') listeners.add(handler); },
    removeEventListener(type, handler) { if (type === 'keydown') listeners.delete(handler); },
    querySelectorAll() { return []; }, getElementById() { return null; },
    createElement(tag) {
      const node = element(tag);
      node.ownerDocument = document;
      if (tag === 'a') { node.clicks = 0; node.click = () => { node.clicks++; }; anchors.push(node); }
      return node;
    },
    createComment() { return { ownerDocument: document }; },
    defaultView: {
      open() { return null; },
      addEventListener(type, handler) {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(handler);
      },
      removeEventListener(type, handler) { windowListeners.get(type)?.delete(handler); },
      MutationObserver: class {
        constructor() { this.disconnected = false; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
      },
    },
  };
  document.documentElement.ownerDocument = document;
  document.head.ownerDocument = document;
  document.body.ownerDocument = document;
  return { document, listeners, windowListeners, anchors, observers, root: document.createElement('div'),
    dispatch(type, fields = {}) {
      const event = { type, defaultPrevented: false, returnValue: undefined,
        preventDefault() { this.defaultPrevented = true; }, ...fields };
      for (const handler of [...windowListeners.get(type) ?? []]) handler(event);
      return event;
    },
  };
}

async function mountWorkspace(t, supplied = {}, { blocked = false, rendered = true, zeroViewport = false } = {}) {
  const mainDocument = mockDocument();
  const popups = [];
  const opens = [];
  const events = [];
  const saves = [];
  const reads = [];
  const panes = new Map();
  const renders = new Map();
  let hostRenders = 0;
  let nextPopupOptions;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: mainDocument.document.defaultView });
  const openWindow = (...args) => {
    opens.push(args);
    if (blocked) return null;
    const settings = { rendered, zeroViewport, ...nextPopupOptions };
    nextPopupOptions = undefined;
    const content = mockDocument();
    content.document.renderExplorer = settings.rendered;
    content.document.defaultView.open = openWindow;
    const popup = { document: content.document, opener: mainDocument.document.defaultView, closed: false, focusCount: 0,
      closeListenerCounts: [], confirmCount: 0,
      innerWidth: settings.zeroViewport ? 0 : 1100, innerHeight: settings.zeroViewport ? 0 : 760,
      addEventListener: content.document.defaultView.addEventListener,
      removeEventListener: content.document.defaultView.removeEventListener,
      confirm() { this.confirmCount++; return true; },
      focus() { this.focusCount++; },
      close() { this.closeListenerCounts.push(content.windowListeners.get('beforeunload')?.size ?? 0); this.closed = true; } };
    popups.push({ popup, ...content });
    return popup;
  };
  mainDocument.document.defaultView.open = openWindow;
  let props = {
    initialEntries: initialEntries(), onSave: payload => { saves.push(payload); },
    readFile: async id => { reads.push(id); return new Blob([id]); },
    onEvent: event => events.push(event), ...supplied,
  };
  let latest;
  let renderer;
  let unmounted = false;
  function Pane({ options, workspace, windowId, document, root }) {
    renders.set(windowId, (renders.get(windowId) ?? 0) + 1);
    const controller = useExplorerViewController(options, workspace, windowId, document);
    controller.workspaceRef.current = root;
    useLayoutEffect(() => {
      if (document.renderExplorer === false) return;
      const committedRoot = document.createElement('div');
      committedRoot.isConnected = true;
      root.committedRoot = committedRoot;
      return () => { committedRoot.isConnected = false; root.committedRoot = null; };
    }, [document, root]);
    panes.set(windowId, controller);
    return null;
  }
  function Probe({ options }) {
    hostRenders++;
    latest = useExplorerWorkspace(options);
    return [createElement(Pane, { key: 'main', options, workspace: latest, windowId: 'main', document: mainDocument.document, root: mainDocument.root }),
      ...latest.windows.map(view => createElement(Pane, { key: view.id, options, workspace: latest, windowId: view.id, document: view.container.ownerDocument, root: view.container }))];
  }
  const element = () => createElement(StrictMode, null, createElement(Probe, { options: props }));
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await change(() => renderer.unmount());
  };
  t.after(async () => {
    try {
      await unmount();
      assert.equal(mainDocument.listeners.size, 0);
      assert.ok([...mainDocument.windowListeners.values()].every(listeners => listeners.size === 0));
      assert.ok(popups.every(view => view.listeners.size === 0 && view.popup.closed));
      assert.ok(popups.every(view => [...view.windowListeners.values()].every(listeners => listeners.size === 0)));
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
    }
  });
  await change(() => { renderer = create(element()); });
  return {
    get workspace() { return latest; }, get main() { return panes.get('main'); }, pane: id => panes.get(id),
    mainDocument, popups, opens, events, saves, reads, unmount, renders,
    get hostRenders() { return hostRenders; },
    configureNextPopup(options) { nextPopupOptions = options; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(element())); },
    async detach(sourceWindowId = 'main') {
      let detached;
      await change(() => { detached = panes.get(sourceWindowId).detachTab(panes.get(sourceWindowId).activeTabId, { left: 100, top: 200 }); });
      return detached ? latest.windows.at(-1)?.id : undefined;
    },
  };
}

function dragEvent() {
  const data = new Map();
  return {
    ctrlKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
    dataTransfer: { files: [], dropEffect: 'none', effectAllowed: 'none',
      get types() { return [...data.keys()]; },
      setData(type, value) { data.set(type, value); }, getData(type) { return data.get(type) ?? ''; },
    },
  };
}

const warningCount = view => view.windowListeners.get('beforeunload')?.size ?? 0;

test('dirty changes protect parent, child and grandchild windows and cancelling native unload retains all state', async t => {
  const hook = await mountWorkspace(t);
  const guard = hook.workspace.unsavedChangesGuard;
  assert.equal(warningCount(hook.mainDocument), 0);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  assert.equal(warningCount(hook.popups[0]), 0);
  await change(() => hook.pane(childId).act('rename', ['alpha'], { name: 'Unsaved.txt' }));
  assert.equal(warningCount(hook.mainDocument), 1);
  assert.equal(warningCount(hook.popups[0]), 1);
  await change(() => hook.pane(childId).addTab());
  const grandchildId = await hook.detach(childId);
  const allViews = [hook.mainDocument, ...hook.popups];
  assert.ok(allViews.every(view => warningCount(view) === 1), 'a child opened after editing is protected immediately');
  assert.equal(hook.workspace.unsavedChangesGuard, guard, 'all renders retain the shared guard');
  const entries = hook.main.entries;
  const tabs = hook.workspace.tabs.allTabs;
  const windows = hook.workspace.windows;
  const eventCount = hook.events.length;
  await change(() => {
    for (const view of allViews) {
      const event = view.dispatch('beforeunload');
      assert.equal(event.defaultPrevented, true);
      assert.equal(event.returnValue, '');
    }
  });
  assert.equal(hook.main.entries, entries);
  assert.equal(hook.workspace.tabs.allTabs, tabs);
  assert.equal(hook.workspace.windows, windows);
  assert.equal(hook.events.length, eventCount);
  assert.equal(hook.main.dirty, true);
  assert.equal(hook.pane(grandchildId).dirty, true);
  assert.ok(hook.popups.every(view => !view.popup.closed && view.popup.confirmCount === 0));
  await change(() => hook.pane(grandchildId).saveChanges());
  assert.equal(hook.main.dirty, false);
  assert.ok(allViews.every(view => warningCount(view) === 0));
});

test('failed and pending saves keep unload warnings until a successful save', async t => {
  let pending = deferred();
  const hook = await mountWorkspace(t, { onSave: () => pending.promise });
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.main.act('rename', ['alpha'], { name: 'Pending.txt' }));
  let saving;
  await change(() => { saving = hook.pane(childId).saveChanges(); });
  assert.equal(hook.main.busy, true);
  assert.equal(warningCount(hook.mainDocument), 1);
  assert.equal(warningCount(hook.popups[0]), 1);
  await change(async () => { pending.reject(new Error('Retry saving')); await saving; });
  assert.equal(hook.main.dirty, true);
  assert.equal(warningCount(hook.mainDocument), 1);
  assert.equal(warningCount(hook.popups[0]), 1);
  pending = deferred();
  await change(() => { saving = hook.main.saveChanges(); });
  await change(async () => { pending.resolve(); await saving; });
  assert.equal(hook.main.dirty, false);
  assert.equal(warningCount(hook.mainDocument), 0);
  assert.equal(warningCount(hook.popups[0]), 0);
});

test('the warning opt-out can change dynamically without clearing the draft or other beforeunload listeners', async t => {
  const hook = await mountWorkspace(t, { warnOnUnsavedChanges: false });
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  const outside = () => {};
  const mainWindow = hook.mainDocument.document.defaultView;
  mainWindow.addEventListener('beforeunload', outside);
  try {
    await change(() => hook.main.act('rename', ['alpha'], { name: 'Still unsaved.txt' }));
    const entries = hook.main.entries;
    assert.equal(hook.main.dirty, true);
    assert.equal(warningCount(hook.mainDocument), 1);
    assert.equal(warningCount(hook.popups[0]), 0);
    await hook.update({ warnOnUnsavedChanges: true });
    assert.equal(warningCount(hook.mainDocument), 2);
    assert.equal(warningCount(hook.popups[0]), 1);
    await hook.update({ warnOnUnsavedChanges: false });
    assert.equal(warningCount(hook.mainDocument), 1);
    assert.equal(warningCount(hook.popups[0]), 0);
    assert.equal(hook.main.entries, entries);
    assert.equal(hook.pane(childId).dirty, true);
    await hook.update({ warnOnUnsavedChanges: undefined });
    assert.equal(warningCount(hook.mainDocument), 2, 'omitting the property enables protection');
    assert.equal(warningCount(hook.popups[0]), 1);
    await change(() => hook.workspace.draft.discard());
    assert.equal(hook.main.dirty, false);
    assert.equal(warningCount(hook.mainDocument), 1);
    assert.equal(warningCount(hook.popups[0]), 0);
    assert.ok(hook.mainDocument.windowListeners.get('beforeunload').has(outside));
  } finally {
    mainWindow.removeEventListener('beforeunload', outside);
  }
});

test('reattaching a dirty child removes its warning before closing and retains the shared edits', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).act('rename', ['alpha'], { name: 'Retained.txt' }));
  const entries = hook.main.entries;
  const childTab = hook.workspace.tabs.forWindow(childId).activeTab;
  assert.equal(warningCount(hook.popups[0]), 1);
  await change(() => hook.pane(childId).reattachWindow());
  assert.equal(hook.main.entries, entries);
  assert.equal(hook.main.dirty, true);
  assert.equal(hook.workspace.tabs.activeTab, childTab);
  assert.equal(warningCount(hook.mainDocument), 1);
  assert.equal(warningCount(hook.popups[0]), 0);
  assert.deepEqual(hook.popups[0].popup.closeListenerCounts, [0]);
  assert.equal(hook.popups[0].popup.confirmCount, 0);
});

test('disabling detached views keeps dirty data while releasing their native warnings before close', async t => {
  for (const feature of ['tabs', 'detachTabs']) {
    await t.test(feature, async t => {
      const hook = await mountWorkspace(t);
      await change(() => hook.main.addTab());
      const childId = await hook.detach();
      await change(() => hook.pane(childId).act('rename', ['alpha'], { name: 'Kept.txt' }));
      const entries = hook.main.entries;
      await hook.update({ features: { [feature]: false } });
      assert.deepEqual(hook.workspace.windows, []);
      assert.equal(hook.main.entries, entries);
      assert.equal(hook.main.dirty, true);
      assert.equal(warningCount(hook.mainDocument), 1);
      assert.equal(warningCount(hook.popups[0]), 0);
      assert.deepEqual(hook.popups[0].popup.closeListenerCounts, [0]);
      assert.equal(hook.popups[0].popup.confirmCount, 0);
    });
  }
});

test('unmounting removes every owned unload warning before closing dirty descendant windows', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).addTab());
  const grandchildId = await hook.detach(childId);
  await change(() => hook.pane(grandchildId).act('rename', ['alpha'], { name: 'Unmounting.txt' }));
  assert.ok([hook.mainDocument, ...hook.popups].every(view => warningCount(view) === 1));
  const changes = hook.events.filter(event => event.type === 'change' || event.type === 'discard');
  await hook.unmount();
  assert.ok([hook.mainDocument, ...hook.popups].every(view => warningCount(view) === 0));
  assert.ok(hook.popups.every(view => view.popup.closed && view.popup.confirmCount === 0));
  assert.ok(hook.popups.every(view => view.popup.closeListenerCounts.every(count => count === 0)));
  assert.deepEqual(hook.events.filter(event => event.type === 'change' || event.type === 'discard'), changes,
    'cleanup does not silently change or discard file data');
  assert.deepEqual(hook.saves, []);
});

test('main and detached panes share draft edits and clipboard while navigation and selection stay independent', async t => {
  const hook = await mountWorkspace(t);
  assert.deepEqual(hook.events, []);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  assert.equal(hook.workspace.windows.length, 1);
  assert.equal(hook.pane(childId).isDetached, true);
  assert.equal(hook.main.isDetached, false);
  assert.equal(hook.opens[0][0], 'about:blank');
  assert.match(hook.opens[0][2], /left=100,top=200/);
  assert.match(hook.opens[0][2], /^popup=yes,/);
  assert.equal(hook.popups[0].popup.opener, null);
  assert.equal(hook.popups[0].popup.focusCount, 1);
  assert.equal(hook.events.find(event => event.type === 'window' && event.action === 'detach').sourceWindowId, 'main');
  await change(() => { hook.main.setSelected(['alpha']); hook.pane(childId).navigate('folder'); });
  await change(() => hook.pane(childId).setSelected(['nested']));
  assert.equal(hook.main.location, 'root');
  assert.deepEqual(hook.main.selected, ['alpha']);
  assert.equal(hook.pane(childId).location, 'folder');
  assert.deepEqual(hook.pane(childId).selected, ['nested']);
  await change(() => hook.pane(childId).act('rename', ['nested'], { name: 'Renamed.txt' }));
  assert.equal(byId(hook.main, 'nested').name, 'Renamed.txt');
  assert.equal(hook.main.entries, hook.pane(childId).entries);
  await change(() => hook.main.copyToClipboard('copy', ['alpha']));
  assert.deepEqual(hook.pane(childId).clipboard, { action: 'copy', ids: ['alpha'] });
  assert.equal(hook.pane(childId).canPaste, true);
  await change(() => hook.pane(childId).paste());
  const copy = hook.main.entries.find(entry => entry.parent === 'folder' && entry.name === 'Alpha.txt');
  assert.ok(copy && copy.id !== 'alpha');
  assert.equal(copy.source.id, 'content-alpha');
  assert.equal(hook.main.dirty, true); assert.equal(hook.pane(childId).dirty, true);
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
  const childNavigation = hook.events.find(event => event.type === 'navigate' && event.windowId === childId);
  assert.equal(childNavigation.location.id, 'folder');
  assert.ok(hook.events.some(event => event.type === 'selection' && event.windowId === childId));
  assert.ok(hook.events.some(event => event.type === 'selection' && event.windowId === undefined));
  assert.ok(hook.events.filter(event => event.type === 'change').every(event => event.windowId === undefined));
  await change(() => {
    hook.pane(childId).changeView('large'); hook.pane(childId).setQuery('Renamed');
    hook.pane(childId).copyToClipboard('copy', ['nested']);
  });
  assert.ok(hook.events.some(event => event.type === 'view' && event.windowId === childId && event.mode === 'large'));
  assert.ok(hook.events.some(event => event.type === 'clipboard' && event.windowId === childId));
  assert.deepEqual(hook.main.clipboard, { action: 'copy', ids: ['nested'] });
  assert.equal(hook.main.view, 'details'); assert.equal(hook.main.query, '');
});

test('saving from a detached pane locks edits in every pane and persists the shared draft once', async t => {
  const pending = deferred();
  const saves = [];
  const hook = await mountWorkspace(t, { onSave: payload => { saves.push(payload); return pending.promise; } });
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).act('rename', ['alpha'], { name: 'Edited.txt' }));
  let save;
  await change(() => { save = hook.pane(childId).saveChanges(); });
  assert.equal(hook.main.busy, true); assert.equal(hook.pane(childId).busy, true);
  const before = hook.main.entries;
  await change(() => {
    assert.equal(hook.main.act('delete', ['alpha']), false);
    hook.pane(childId).addLocalFiles([new File(['blocked'], 'blocked.txt')]);
  });
  await change(() => hook.main.saveChanges());
  assert.equal(saves.length, 1); assert.equal(hook.main.entries, before);
  assert.equal(saves[0].changes.updated[0].name, 'Edited.txt');
  await change(async () => { pending.resolve(); await save; });
  assert.equal(hook.main.busy, false); assert.equal(hook.pane(childId).busy, false);
  assert.equal(hook.main.dirty, false); assert.equal(hook.pane(childId).dirty, false);
  assert.deepEqual(hook.events.filter(event => event.type === 'save').map(event => event.status), ['start', 'success']);
});

test('dragging across panes accepts their shared workspace ID and rejects another workspace', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  const drag = dragEvent();
  await change(() => hook.main.startDrag(drag, byId(hook.main, 'alpha')));
  assert.equal(JSON.parse(drag.dataTransfer.getData('application/x-explorer')).instanceId, hook.workspace.workspaceId);
  await change(() => hook.pane(childId).drop(drag, 'folder'));
  assert.equal(byId(hook.main, 'alpha').parent, 'folder');
  assert.equal(byId(hook.pane(childId), 'alpha').parent, 'folder');
  const before = hook.main.entries;
  const foreign = dragEvent();
  foreign.dataTransfer.setData('application/x-explorer', JSON.stringify({ instanceId: 'different-workspace', ids: ['alpha'] }));
  await change(() => hook.pane(childId).drop(foreign, 'root'));
  assert.equal(hook.main.entries, before);
  assert.equal(hook.pane(childId).notification.kind, 'error');
});

test('folder downloads in a detached pane emit folder metadata and create its ZIP in that document', async t => {
  const blobs = [];
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:workspace-zip'; });
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).download(byId(hook.pane(childId), 'folder')));
  const downloads = hook.events.filter(event => event.type === 'download');
  assert.deepEqual(downloads.map(event => event.status), ['start', 'success']);
  assert.ok(downloads.every(event => event.windowId === childId && event.request.kind === 'folder' && event.request.path === '/資料'));
  assert.deepEqual(hook.reads, ['content-nested']);
  assert.equal(blobs[0].type, 'application/zip');
  assert.equal(new DataView(await blobs[0].arrayBuffer()).getUint32(0, true), 0x04034b50);
  assert.equal(hook.mainDocument.anchors.length, 0);
  assert.equal(hook.popups[0].anchors[0].download, '資料.zip');
  assert.equal(hook.popups[0].anchors[0].clicks, 1);
  await hook.update({ features: { download: false } });
  await change(() => hook.pane(childId).download(byId(hook.pane(childId), 'folder')));
  assert.equal(hook.events.filter(event => event.type === 'download').length, 2);
  assert.equal(blobs.length, 1);
});

test('a folder read failure emits an error and never starts a partial ZIP download', async t => {
  const objectURL = t.mock.method(URL, 'createObjectURL', () => { throw Error('No partial ZIP'); });
  const hook = await mountWorkspace(t, { readFile: async () => { throw Error('Offline'); } });
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).download(byId(hook.pane(childId), 'folder')));
  const downloads = hook.events.filter(event => event.type === 'download');
  assert.deepEqual(downloads.map(event => event.status), ['start', 'error']);
  assert.match(downloads[1].message, /Offline/);
  assert.equal(downloads[1].windowId, childId);
  assert.equal(objectURL.mock.callCount(), 0);
  assert.equal(hook.popups[0].anchors.length, 0);
});

test('blocked popups retain the original tab and report the failure without reading or saving', async t => {
  const hook = await mountWorkspace(t, {}, { blocked: true });
  await change(() => hook.main.addTab());
  const original = hook.workspace.tabs.allTabs;
  assert.equal(await hook.detach(), undefined);
  assert.deepEqual(hook.workspace.tabs.allTabs, original);
  assert.deepEqual(hook.workspace.windows, []);
  assert.equal(hook.main.notification.kind, 'error');
  assert.deepEqual(hook.events.filter(event => event.type === 'window').map(event => event.action), ['blocked']);
  assert.equal(hook.events.find(event => event.type === 'window').sourceWindowId, 'main');
  assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []);
});

test('a nonnull child popup that closes before displaying restores its tab to the child and reports a startup failure', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const sourceId = await hook.detach();
  assert.equal(hook.workspace.windows[0].phase, 'ready');
  await change(() => hook.pane(sourceId).addTab());
  await change(() => hook.pane(sourceId).navigate('folder'));
  await change(() => {
    hook.pane(sourceId).setSelected(['nested']);
    hook.pane(sourceId).setQuery('Nested');
    hook.pane(sourceId).changeView('large');
  });
  const movingTab = hook.workspace.tabs.forWindow(sourceId).activeTab;
  const sourceIds = hook.workspace.tabs.getWindowTabIds(sourceId);
  const mainTab = hook.workspace.tabs.activeTab;
  hook.configureNextPopup({ zeroViewport: true });
  const pendingId = await hook.detach(sourceId);
  assert.equal(hook.workspace.windows.find(view => view.id === pendingId).phase, 'opening');
  assert.equal(hook.events.some(event => event.type === 'window' && event.windowId === pendingId), false);
  hook.popups[1].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows.map(view => view.id), [sourceId]);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds(sourceId), sourceIds);
  assert.deepEqual(hook.workspace.tabs.forWindow(sourceId).activeTab, movingTab);
  assert.equal(hook.workspace.tabs.activeTab, mainTab);
  assert.equal(hook.pane(sourceId).notification.kind, 'error');
  assert.match(hook.pane(sourceId).notification.message, /タブを復元/);
  const events = hook.events.filter(event => event.type === 'window' && event.windowId === pendingId);
  assert.deepEqual(events.map(event => event.action), ['blocked']);
  assert.equal(events[0].sourceWindowId, sourceId);
  assert.deepEqual(events[0].tabIds, [movingTab.id]);
  assert.equal(hook.popups[1].listeners.size, 0);
});

test('a positive popup viewport without a committed Explorer root cannot complete opening and times out safely', async t => {
  const hook = await mountWorkspace(t, {}, { rendered: false });
  await change(() => hook.main.addTab());
  await change(() => { hook.main.navigate('folder'); hook.main.setQuery('Nested'); });
  const originalTab = hook.workspace.tabs.activeTab;
  const originalIds = hook.workspace.tabs.getWindowTabIds('main');
  const pendingId = await hook.detach();
  const pending = hook.workspace.windows[0];
  assert.equal(pending.phase, 'opening');
  assert.equal(pending.window.innerWidth > 0 && pending.window.innerHeight > 0, true);
  assert.equal(pending.container.querySelector('[data-explorer-root]'), null);
  assert.deepEqual(hook.events.filter(event => event.type === 'window'), []);
  t.mock.method(Date, 'now', () => pending.openedAt + 5001);
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds('main'), originalIds);
  assert.deepEqual(hook.workspace.tabs.activeTab, originalTab);
  assert.equal(hook.popups[0].popup.closed, true);
  assert.equal(hook.main.notification.kind, 'error');
  const events = hook.events.filter(event => event.type === 'window');
  assert.deepEqual(events.map(event => event.action), ['blocked']);
  assert.equal(events[0].windowId, pendingId);
});

test('a popup that becomes visible after opening commits once and its later manual close does not restore tabs', async t => {
  const hook = await mountWorkspace(t, {}, { zeroViewport: true });
  await change(() => hook.main.addTab());
  const movingId = hook.main.activeTabId;
  const pendingId = await hook.detach();
  assert.equal(hook.workspace.windows[0].phase, 'opening');
  assert.equal(hook.workspace.windows[0].container.querySelector('[data-explorer-root]').isConnected, true);
  assert.deepEqual(hook.events.filter(event => event.type === 'window'), []);
  Object.assign(hook.popups[0].popup, { innerWidth: 1100, innerHeight: 760 });
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.equal(hook.workspace.windows[0].phase, 'ready');
  assert.deepEqual(hook.events.filter(event => event.type === 'window').map(event => event.action), ['detach']);
  hook.popups[0].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds('main'), ['tab-1']);
  assert.equal(hook.workspace.tabs.allTabs.some(tab => tab.id === movingId), false);
  const events = hook.events.filter(event => event.type === 'window');
  assert.deepEqual(events.map(event => event.action), ['detach', 'close']);
  assert.ok(events.every(event => event.windowId === pendingId));
});

test('an opening popup whose source has already closed restores its surviving tab to main', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const sourceId = await hook.detach();
  await change(() => hook.pane(sourceId).addTab());
  await change(() => { hook.pane(sourceId).navigate('folder'); hook.pane(sourceId).setQuery('Nested'); });
  const movingTab = hook.workspace.tabs.forWindow(sourceId).activeTab;
  hook.configureNextPopup({ zeroViewport: true });
  const pendingId = await hook.detach(sourceId);
  hook.popups[0].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows.map(view => view.id), [pendingId]);
  assert.equal(hook.workspace.windows[0].phase, 'opening');
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds(sourceId), []);
  hook.popups[1].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.activeTab, movingTab);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds('main'), ['tab-1', movingTab.id]);
  const events = hook.events.filter(event => event.type === 'window' && event.windowId === pendingId);
  assert.deepEqual(events.map(event => event.action), ['blocked']);
  assert.equal(events[0].sourceWindowId, sourceId);
});

test('replacement of the initial popup document before readiness restores its tab instead of treating it as a normal close', async t => {
  const hook = await mountWorkspace(t, {}, { zeroViewport: true });
  await change(() => hook.main.addTab());
  const movingTab = hook.workspace.tabs.activeTab;
  const pendingId = await hook.detach();
  const replacement = mockDocument();
  hook.popups[0].popup.document = replacement.document;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.activeTab, movingTab);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds('main'), ['tab-1', movingTab.id]);
  assert.equal(replacement.listeners.size, 0);
  assert.equal(hook.popups[0].popup.closed, true);
  const events = hook.events.filter(event => event.type === 'window' && event.windowId === pendingId);
  assert.deepEqual(events.map(event => event.action), ['blocked']);
});

test('a single main tab cannot open a popup or emit a blocked event, and keeps its state and ID', async t => {
  const hook = await mountWorkspace(t, { defaultPath: '/資料' });
  await change(() => { hook.main.setQuery('Nested'); hook.main.setSelected(['nested']); hook.main.changeView('large'); });
  const before = hook.workspace.tabs.allTabs;
  const activeId = hook.main.activeTabId;
  const events = [...hook.events];
  const notification = hook.main.notification;
  await change(() => {
    assert.equal(hook.main.detachTab(activeId, { left: 10, top: 20 }), false);
    assert.equal(hook.workspace.detachTab(activeId, hook.mainDocument.document), false);
  });
  assert.equal(hook.workspace.tabs.allTabs, before);
  assert.equal(hook.main.activeTabId, activeId);
  assert.equal(hook.main.location, 'folder'); assert.equal(hook.main.query, 'Nested');
  assert.deepEqual(hook.main.selected, ['nested']); assert.equal(hook.main.view, 'large');
  assert.deepEqual(hook.opens, []); assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.events, events); assert.equal(hook.main.notification, notification);
  assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []);
  await change(() => { assert.equal(hook.main.addTab(), 'tab-2'); });
  await change(() => hook.main.selectTab(activeId));
  const childId = await hook.detach();
  assert.equal(hook.opens.length, 1);
  assert.deepEqual(hook.workspace.tabs.forWindow(childId).activeTab, before[0]);
  assert.equal(hook.main.activeTabId, 'tab-2');
  const after = hook.workspace.tabs.allTabs;
  await change(() => { assert.equal(hook.main.detachTab('tab-2'), false); });
  assert.equal(hook.opens.length, 1, 'an existing child window does not permit detaching the last main tab');
  assert.equal(hook.workspace.tabs.allTabs, after);
  assert.equal(hook.events.filter(event => event.type === 'window' && event.action === 'blocked').length, 0);
});

test('closing a popup removes its tabs but keeps staged edits, local files and clipboard available for saving in main', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.main.navigate('folder'));
  await change(() => { hook.main.setSelected(['nested']); hook.main.setQuery('Nested'); hook.main.changeView('large'); });
  const mainTab = hook.workspace.tabs.activeTab;
  await change(() => hook.pane(childId).addTab());
  await change(() => hook.pane(childId).navigate('folder'));
  const localFile = new File(['content staged by child'], 'Child.txt', { type: 'text/plain' });
  await change(() => {
    hook.pane(childId).act('rename', ['alpha'], { name: 'Edited in child.txt' });
    hook.pane(childId).addLocalFiles([localFile]);
    hook.pane(childId).copyToClipboard('copy', ['alpha']);
  });
  const childTabs = hook.workspace.tabs.getWindowTabIds(childId);
  const sharedEntries = hook.main.entries;
  const uploaded = sharedEntries.find(item => item.name === 'Child.txt');
  assert.equal(uploaded.source.file, localFile);
  hook.popups[0].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.allTabs, [mainTab]);
  assert.deepEqual(hook.workspace.tabs.activeTab, mainTab);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds(childId), []);
  assert.equal(hook.main.entries, sharedEntries);
  assert.equal(hook.main.dirty, true); assert.deepEqual(hook.main.clipboard, { action: 'copy', ids: ['alpha'] });
  assert.equal(byId(hook.main, uploaded.id).source.file, localFile);
  const closed = hook.events.filter(event => event.type === 'window' && event.action === 'close');
  assert.deepEqual(closed, [{ type: 'window', action: 'close', windowId: childId, tabIds: childTabs }]);
  assert.equal(hook.events.some(event => event.type === 'window' && event.action === 'reattach'), false);
  assert.equal(hook.popups[0].listeners.size, 0);
  assert.ok(hook.mainDocument.observers.every(observer => observer.disconnected));
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
  await change(() => hook.main.saveChanges());
  assert.equal(hook.saves.length, 1); assert.equal(hook.main.dirty, false);
  assert.equal(hook.saves[0].changes.updated.find(item => item.id === 'alpha').name, 'Edited in child.txt');
  assert.equal(hook.saves[0].changes.created.find(item => item.id === uploaded.id).source.file, localFile);
  assert.equal(await hook.saves[0].entries.find(item => item.id === uploaded.id).source.file.text(), 'content staged by child');
});

test('closing the initiating child window does not interrupt its shared save or unlock edits early', async t => {
  const pending = deferred(); const saves = [];
  const hook = await mountWorkspace(t, { onSave: payload => { saves.push(payload); return pending.promise; } });
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).act('rename', ['alpha'], { name: 'Saving from child.txt' }));
  let save;
  await change(() => { save = hook.pane(childId).saveChanges(); });
  hook.popups[0].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.equal(hook.main.busy, true); assert.equal(hook.main.dirty, true);
  assert.equal(hook.workspace.tabs.allTabs.length, 1);
  await change(() => { assert.equal(hook.main.act('delete', ['alpha']), false); });
  await change(() => hook.main.saveChanges());
  assert.equal(saves.length, 1);
  await change(async () => { pending.resolve(); await save; });
  assert.equal(hook.main.busy, false); assert.equal(hook.main.dirty, false);
  assert.equal(byId(hook.main, 'alpha').name, 'Saving from child.txt');
  assert.deepEqual(hook.events.filter(event => event.type === 'save').map(event => event.status), ['start', 'success']);
});

test('explicit reattachment returns all child tabs and their active state to main', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => hook.pane(childId).addTab());
  await change(() => { hook.pane(childId).navigate('folder'); hook.pane(childId).setQuery('Nested'); });
  const before = hook.workspace.tabs.allTabs;
  const active = hook.workspace.tabs.forWindow(childId).activeTab;
  const childTabs = hook.workspace.tabs.getWindowTabIds(childId);
  await change(() => hook.pane(childId).reattachWindow());
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.allTabs, before);
  assert.deepEqual(hook.workspace.tabs.activeTab, active);
  assert.equal(hook.popups[0].popup.closed, true);
  assert.deepEqual(hook.events.filter(event => event.type === 'window').map(event => event.action), ['detach', 'reattach']);
  assert.deepEqual(hook.events.find(event => event.type === 'window' && event.action === 'reattach').tabIds, childTabs);
});

test('child-origin detachment opens synchronously in the source window and preserves its tab and shared draft after the source closes', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const sourceId = await hook.detach();
  await change(() => hook.main.setSelected(['alpha']));
  await change(() => hook.pane(sourceId).addTab());
  await change(() => hook.pane(sourceId).navigate('folder'));
  await change(() => { hook.pane(sourceId).setQuery('Nested'); hook.pane(sourceId).setSelected(['nested']); hook.pane(sourceId).changeView('large'); });
  const movingTab = hook.workspace.tabs.forWindow(sourceId).activeTab;
  const mainTab = hook.workspace.tabs.activeTab;
  const childWindow = hook.popups[0].document.defaultView;
  const openWindow = childWindow.open;
  let handlingGesture = false;
  const childOpen = t.mock.method(childWindow, 'open', function (...args) {
    assert.equal(handlingGesture, true, 'opening must not be deferred past the source gesture');
    return openWindow(...args);
  });
  // The main window has no user activation when the user clicks in a child.
  const mainOpen = t.mock.method(hook.mainDocument.document.defaultView, 'open', () => null);
  await change(() => {
    handlingGesture = true;
    try { assert.equal(hook.pane(sourceId).detachTab(movingTab.id), true); }
    finally { handlingGesture = false; }
  });
  const derivedId = hook.workspace.windows.at(-1)?.id;
  assert.ok(derivedId && derivedId !== sourceId);
  assert.equal(childOpen.mock.callCount(), 1);
  assert.equal(mainOpen.mock.callCount(), 0);
  assert.equal(childOpen.mock.calls[0].this, childWindow);
  assert.match(childOpen.mock.calls[0].arguments[2], /^popup=yes,/);
  assert.deepEqual(hook.workspace.tabs.forWindow(derivedId).activeTab, movingTab);
  assert.equal(hook.workspace.tabs.activeTab, mainTab);
  assert.equal(hook.pane(sourceId).location, 'root'); assert.deepEqual(hook.pane(sourceId).selected, []);
  assert.equal(hook.pane(derivedId).location, 'folder'); assert.deepEqual(hook.pane(derivedId).selected, ['nested']);
  assert.deepEqual(hook.main.selected, ['alpha']);
  const detached = hook.events.find(event => event.type === 'window' && event.action === 'detach' && event.windowId === derivedId);
  assert.equal(detached.sourceWindowId, sourceId); assert.deepEqual(detached.tabIds, [movingTab.id]);
  assert.equal(hook.popups[1].popup.focusCount, 1);
  assert.equal(hook.popups[1].popup.opener, null);
  assert.equal(hook.mainDocument.observers.filter(observer => !observer.disconnected).length, 1, 'windows share their source style observer');
  assert.equal(hook.popups[0].observers.length, 0, 'derived windows mirror CSS from the main document');
  const localFile = new File(['from derived child'], 'Derived.txt');
  await change(() => {
    hook.pane(derivedId).addLocalFiles([localFile]);
    hook.pane(sourceId).act('rename', ['alpha'], { name: 'Source child edit.txt' });
    hook.pane(derivedId).copyToClipboard('copy', ['nested']);
  });
  const shared = hook.main.entries;
  const sourceTabs = hook.workspace.tabs.getWindowTabIds(sourceId);
  hook.popups[0].popup.closed = true;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows.map(view => view.id), [derivedId]);
  assert.equal(hook.popups[1].popup.closed, false);
  assert.equal(hook.mainDocument.observers.filter(observer => !observer.disconnected).length, 1, 'derived CSS mirroring survives closing its source window');
  assert.equal(hook.main.entries, shared); assert.equal(hook.pane(derivedId).entries, shared);
  assert.equal(hook.workspace.tabs.activeTab, mainTab);
  assert.ok(sourceTabs.every(id => !hook.workspace.tabs.allTabs.some(tab => tab.id === id)));
  assert.deepEqual(hook.main.clipboard, { action: 'copy', ids: ['nested'] });
  assert.equal(shared.find(item => item.name === 'Derived.txt').source.file, localFile);
  assert.equal(byId(hook.main, 'alpha').name, 'Source child edit.txt');
  assert.equal(hook.pane(derivedId).dirty, true);
  await change(() => hook.pane(derivedId).setQuery('Derived'));
  assert.ok(hook.events.some(event => event.type === 'view' && event.windowId === derivedId && event.query === 'Derived'));
  assert.equal(hook.main.query, '');
  await change(() => hook.pane(derivedId).saveChanges());
  assert.equal(hook.saves.length, 1); assert.equal(hook.main.dirty, false);
  assert.equal(hook.saves[0].changes.created.find(item => item.name === 'Derived.txt').source.file, localFile);
  const savedTab = hook.workspace.tabs.forWindow(derivedId).activeTab;
  await change(() => hook.pane(derivedId).reattachWindow());
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.activeTab, savedTab);
  assert.equal(hook.popups[1].popup.closed, true);
});

test('single-tab or unregistered child detachment does not call open, while a blocked child popup identifies its source', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const sourceId = await hook.detach();
  const sourceTab = hook.workspace.tabs.forWindow(sourceId).activeTab;
  const before = hook.workspace.tabs.allTabs;
  const events = [...hook.events];
  await change(() => { assert.equal(hook.pane(sourceId).detachTab(sourceTab.id), false); });
  assert.equal(hook.opens.length, 1); assert.equal(hook.workspace.tabs.allTabs, before);
  assert.deepEqual(hook.events, events);
  let orphanId;
  await change(() => {
    orphanId = hook.workspace.tabs.forWindow('unregistered').addTab();
    hook.workspace.tabs.forWindow('unregistered').addTab();
  });
  await change(() => { assert.equal(hook.workspace.detachTab(orphanId, hook.mainDocument.document, undefined, 'unregistered'), false); });
  assert.equal(hook.opens.length, 1); assert.deepEqual(hook.events, events);
  await change(() => hook.workspace.tabs.closeWindow('unregistered'));
  await change(() => hook.pane(sourceId).addTab());
  const childTabs = hook.workspace.tabs.getWindowTabIds(sourceId);
  const previous = hook.workspace.tabs.allTabs;
  let calls = 0;
  hook.popups[0].document.defaultView.open = () => { calls++; return null; };
  const mainOpen = t.mock.method(hook.mainDocument.document.defaultView, 'open');
  await change(() => { assert.equal(hook.pane(sourceId).detachTab(childTabs[1]), false); });
  assert.equal(calls, 1); assert.equal(hook.workspace.tabs.allTabs, previous);
  assert.equal(mainOpen.mock.callCount(), 0, 'do not retry in a different window without its own gesture');
  assert.deepEqual(hook.workspace.windows.map(view => view.id), [sourceId]);
  assert.equal(hook.pane(sourceId).notification.kind, 'error');
  const blocked = hook.events.filter(event => event.type === 'window' && event.action === 'blocked');
  assert.equal(blocked.length, 1); assert.equal(blocked[0].sourceWindowId, sourceId);
  assert.deepEqual(blocked[0].tabIds, [childTabs[1]]);
});

test('context-menu windows start near their source window', async t => {
  const hook = await mountWorkspace(t);
  Object.assign(hook.mainDocument.document.defaultView, { screenX: -1200, screenY: -200 });
  await change(() => hook.main.addTab());
  await change(() => { assert.equal(hook.main.detachTab(hook.main.activeTabId), true); });
  const sourceId = hook.workspace.windows[0].id;
  assert.match(hook.opens[0][2], /left=-1160,top=-160/);
  Object.assign(hook.popups[0].document.defaultView, { screenX: 600, screenY: 300 });
  await change(() => hook.pane(sourceId).addTab());
  await change(() => { assert.equal(hook.pane(sourceId).detachTab(hook.pane(sourceId).activeTabId), true); });
  assert.match(hook.opens[1][2], /left=640,top=340/);
  assert.ok(hook.popups.every(view => view.popup.opener === null && view.popup.focusCount === 1));
  await change(() => hook.main.setQuery('rerender'));
  assert.ok(hook.popups.every(view => view.popup.focusCount === 1));
});

test('drag placement waits for the rendered tab and corrects the grabbed point exactly once', async t => {
  const hook = await mountWorkspace(t);
  const frames = new Map(); let nextFrame = 0;
  const host = hook.mainDocument.document.defaultView;
  host.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  host.cancelAnimationFrame = id => frames.delete(id);
  const flushFrame = async () => change(() => {
    const current = [...frames.entries()];
    for (const [id, callback] of current) { frames.delete(id); callback(0); }
  });
  await change(() => hook.main.addTab());
  await change(() => hook.main.detachTab(hook.main.activeTabId, {
    left: 900, top: 500, tabAnchor: { screenX: 1000, screenY: 600, offsetX: 120, offsetY: 15 },
  }));
  const view = hook.workspace.windows[0]; const popup = hook.popups[0].popup; const moves = [];
  Object.assign(popup, { screenX: 900, screenY: 500, outerWidth: 1200, outerHeight: 800, innerWidth: 1180, innerHeight: 700,
    moveTo(left, top) { moves.push({ left, top }); this.screenX = left; this.screenY = top; },
  });
  let measuredTab = null;
  view.container.querySelector = selector => { assert.equal(selector, '[data-explorer-tab]'); return measuredTab; };
  assert.equal(frames.size, 1);
  await flushFrame();
  assert.deepEqual(moves, []); assert.equal(frames.size, 1, 'retry until the portal renders its tab');
  measuredTab = { getBoundingClientRect() { return { left: 24, top: 10 }; } };
  await flushFrame();
  assert.deepEqual(moves, [{ left: 846, top: 485 }]); assert.equal(frames.size, 0);
  assert.equal(popup.focusCount, 1);
  await change(() => hook.main.addTab());
  await hook.detach();
  assert.equal(hook.workspace.windows.length, 2);
  assert.equal(frames.size, 0, 'adding another window must not realign one already placed');
  assert.deepEqual(moves, [{ left: 846, top: 485 }]);
  await hook.unmount();
  assert.equal(frames.size, 0);
});

test('pagehide closes every detached tab while retaining main state for BFCache restoration', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const first = await hook.detach();
  await change(() => hook.pane(first).addTab());
  const second = await hook.detach(first);
  assert.equal(hook.workspace.windows.length, 2);
  await change(() => {
    hook.pane(first).navigate('folder'); hook.pane(first).setQuery('Nested');
    hook.pane(second).changeView('large'); hook.main.navigate('folder');
  });
  await change(() => hook.main.setSelected(['nested']));
  const mainTab = hook.workspace.tabs.activeTab;
  const closedIds = [first, second].map(id => hook.workspace.tabs.getWindowTabIds(id));
  assert.equal(hook.mainDocument.windowListeners.get('pagehide').size, 4, 'workspace closes child views and the pane cancels downloads, pending edit permission and pending upload confirmations');
  await change(() => hook.mainDocument.dispatch('pagehide'));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.allTabs, [mainTab]);
  assert.deepEqual(hook.workspace.tabs.activeTab, mainTab);
  assert.ok(hook.popups.every(view => view.popup.closed && view.listeners.size === 0));
  assert.ok(hook.mainDocument.observers.every(observer => observer.disconnected));
  const closes = hook.events.filter(event => event.type === 'window' && event.action === 'close');
  assert.deepEqual(closes.map(event => event.windowId), [first, second]);
  assert.deepEqual(closes.map(event => event.tabIds), closedIds);
  assert.equal(hook.events.some(event => event.type === 'window' && event.action === 'reattach'), false);
  await change(() => hook.main.act('rename', ['nested'], { name: 'After restore.txt' }));
  assert.equal(byId(hook.main, 'nested').name, 'After restore.txt');
  assert.deepEqual(hook.saves, []);
});

test('replacing a popup document closes its tabs without reading the replacement document', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => { hook.pane(childId).navigate('folder'); hook.pane(childId).setQuery('Nested'); });
  const childTabs = hook.workspace.tabs.getWindowTabIds(childId);
  const replacement = mockDocument();
  hook.popups[0].popup.document = replacement.document;
  // Any render before the polling interval must continue using the retained
  // container's document, as the replacement is no longer an Explorer view.
  await change(() => hook.main.setQuery('main update'));
  const mainTab = hook.workspace.tabs.activeTab;
  assert.equal(replacement.listeners.size, 0);
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.allTabs, [mainTab]);
  assert.deepEqual(hook.workspace.tabs.activeTab, mainTab);
  assert.equal(hook.popups[0].popup.closed, true);
  assert.equal(hook.popups[0].listeners.size, 0);
  assert.equal(replacement.listeners.size, 0);
  assert.deepEqual(hook.events.find(event => event.type === 'window' && event.action === 'close').tabIds, childTabs);
  assert.ok(hook.mainDocument.observers.every(observer => observer.disconnected));
});

test('cross-origin popup navigation safely closes its tabs when document access throws', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const childId = await hook.detach();
  await change(() => { hook.pane(childId).navigate('folder'); hook.pane(childId).setSelected(['nested']); });
  const childTabs = hook.workspace.tabs.getWindowTabIds(childId);
  Object.defineProperty(hook.popups[0].popup, 'document', {
    configurable: true,
    get() { throw new DOMException('Blocked cross-origin document access', 'SecurityError'); },
  });
  await change(() => hook.main.setQuery('rerender before polling'));
  const mainTab = hook.workspace.tabs.activeTab;
  await change(() => new Promise(resolve => setTimeout(resolve, 350)));
  assert.deepEqual(hook.workspace.windows, []);
  assert.deepEqual(hook.workspace.tabs.allTabs, [mainTab]);
  assert.deepEqual(hook.workspace.tabs.activeTab, mainTab);
  assert.deepEqual(hook.main.selected, []);
  assert.equal(hook.popups[0].popup.closed, true);
  assert.equal(hook.popups[0].listeners.size, 0);
  const closed = hook.events.filter(event => event.type === 'window' && event.action === 'close');
  assert.deepEqual(closed, [{ type: 'window', action: 'close', windowId: childId, tabIds: childTabs }]);
});

test('disabling tabs or detachment closes child tabs and prevents new popups', async t => {
  for (const feature of ['tabs', 'detachTabs']) {
    await t.test(feature, async t => {
      const hook = await mountWorkspace(t);
      await change(() => hook.main.addTab());
      const childId = await hook.detach();
      await change(() => hook.pane(childId).setQuery('child query'));
      const mainTab = hook.workspace.tabs.activeTab;
      const childTabs = hook.workspace.tabs.getWindowTabIds(childId);
      await hook.update({ features: { [feature]: false } });
      assert.deepEqual(hook.workspace.windows, []);
      assert.equal(hook.popups[0].popup.closed, true);
      assert.deepEqual(hook.workspace.tabs.allTabs, [mainTab]);
      assert.deepEqual(hook.workspace.tabs.activeTab, mainTab);
      assert.deepEqual(hook.events.find(event => event.type === 'window' && event.action === 'close').tabIds, childTabs);
      const calls = hook.opens.length;
      await change(() => hook.main.detachTab(hook.main.activeTabId));
      assert.equal(hook.opens.length, calls);
    });
  }
});

test('unmount closes owned popup windows and removes document listeners and stylesheet observers', async t => {
  const hook = await mountWorkspace(t);
  await change(() => hook.main.addTab());
  const first = await hook.detach();
  await change(() => hook.pane(first).addTab());
  await hook.detach(first);
  assert.equal(hook.popups.length, 2);
  assert.ok(hook.popups.every(view => !view.popup.closed));
  await hook.unmount();
  assert.equal(hook.mainDocument.listeners.size, 0);
  assert.ok(hook.popups.every(view => view.popup.closed && view.listeners.size === 0));
  assert.ok(hook.mainDocument.observers.every(observer => observer.disconnected));
  assert.ok(hook.popups.every(view => view.observers.every(observer => observer.disconnected)));
});

test('local search and selection do not rerender the workspace or other windows, while file edits remain shared', async t => {
  const hook = await mountWorkspace(t);
  await change(() => { hook.main.addTab(); hook.main.addTab(); });
  const first = await hook.detach();
  const second = await hook.detach();
  const mainRenders = hook.renders.get('main');
  const secondRenders = hook.renders.get(second);
  const hostRenders = hook.hostRenders;
  await change(() => {
    hook.pane(first).setQuery('Alpha');
    hook.pane(first).setSelected(['alpha']);
    hook.pane(first).changeView('large');
  });
  assert.equal(hook.hostRenders, hostRenders);
  assert.equal(hook.renders.get('main'), mainRenders);
  assert.equal(hook.renders.get(second), secondRenders);
  assert.equal(hook.pane(first).query, 'Alpha');
  assert.deepEqual(hook.pane(first).selected, ['alpha']);
  assert.equal(hook.pane(first).view, 'large');
  assert.equal(hook.main.query, '');
  await change(() => hook.pane(first).act('rename', ['alpha'], { name: 'Shared rename.txt' }));
  assert.equal(byId(hook.main, 'alpha').name, 'Shared rename.txt');
  assert.equal(byId(hook.pane(second), 'alpha').name, 'Shared rename.txt');
  assert.equal(hook.main.entries, hook.pane(second).entries);
});

test('successful saves refresh cached existing content while failed saves and local view changes retain it', async t => {
  let version = 1;
  let reads = 0;
  let failSave = true;
  const readFile = async () => { reads++; return new Blob([`version-${version}`]); };
  const hook = await mountWorkspace(t, { readFile, onSave: () => {
    if (failSave) throw new Error('Retry saving');
    version++;
  } });
  const cache = hook.workspace.mediaCache;
  const source = byId(hook.main, 'alpha').source;
  const initial = cache.acquire(source, readFile);
  const initialBlob = await initial.promise;
  initial.release();
  await change(() => {
    hook.main.setQuery('Alpha');
    hook.main.act('rename', ['alpha'], { name: 'Renamed.txt' });
  });
  const unchanged = cache.acquire(source, readFile);
  assert.equal(await unchanged.promise, initialBlob);
  unchanged.release();
  assert.equal(reads, 1);
  const file = new File(['local'], 'Local.txt');
  const local = cache.acquire({ kind: 'local', file });
  await local.promise;
  local.release();
  await change(() => hook.main.saveChanges());
  assert.equal(hook.main.dirty, true);
  assert.equal(cache.getRevision(), 0);
  const afterFailure = cache.acquire(source, readFile);
  assert.equal(await afterFailure.promise, initialBlob);
  afterFailure.release();
  failSave = false;
  await change(() => hook.main.saveChanges());
  assert.equal(hook.main.dirty, false);
  assert.equal(cache.getRevision(), 1);
  const refreshed = cache.acquire(source, readFile);
  assert.equal(await (await refreshed.promise).text(), 'version-2');
  refreshed.release();
  assert.equal(reads, 2);
  const localAgain = cache.acquire({ kind: 'local', file });
  assert.equal(localAgain.promise, local.promise, 'remote invalidation preserves cached local File objects');
  localAgain.release();
});
