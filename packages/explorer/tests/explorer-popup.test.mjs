import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  entryPoints: ['src/state/use-explorer-popup.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerPopupWindow } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
// Exercise the real wrapper and shared controllers; replace only DOM portals and
// the visual renderer, which react-test-renderer cannot attach to another document.
const wrapperOutput = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { ExplorerPopup } from './src/explorer-popup.tsx';
    export { getPane, getWorkspace } from 'explorer-popup-test-renderer';
  `, resolveDir: packageRoot, sourcefile: 'test-explorer-popup-wrapper.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'popup-test-renderer', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'popup-test' }));
    builder.onResolve({ filter: /^\.\/explorer$|^explorer-popup-test-renderer$/ }, () => ({ path: 'view', namespace: 'popup-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'popup-test' }, ({ path }) => ({
      resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal' ? 'export const createPortal = children => children;' : `
        import { createElement, useLayoutEffect } from 'react';
        import { useExplorerViewController } from './src/state/use-explorer-controller.ts';
        const panes = new Map();
        let currentWorkspace;
        export const getPane = (id = 'main') => panes.get(id);
        export const getWorkspace = () => currentWorkspace;
        function Pane({ props, workspace, ownerDocument, windowId, container }) {
          const controller = useExplorerViewController(props, workspace, windowId, ownerDocument);
          panes.set(windowId, controller);
          useLayoutEffect(() => {
            panes.set(windowId, controller);
            const root = ownerDocument.createElement('div');
            root.isConnected = true;
            container.committedRoot = root;
            controller.workspaceRef.current = root;
            return () => {
              root.isConnected = false;
              container.committedRoot = null;
              panes.delete(windowId);
            };
          }, [container, ownerDocument]);
          return null;
        }
        export function ExplorerWorkspaceView({ props, workspace, ownerDocument }) {
          currentWorkspace = workspace;
          return [createElement(Pane, { key: 'main', props, workspace, ownerDocument,
            windowId: 'main', container: ownerDocument.body.children.at(-1) }),
            ...workspace.windows.map(view => createElement(Pane, { key: view.id, props, workspace,
              ownerDocument: view.container.ownerDocument, windowId: view.id, container: view.container }))];
        }
      `,
    }));
  } }],
});
const { ExplorerPopup, getPane, getWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(wrapperOutput.outputFiles[0].text).toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };

function mockDocument() {
  const observers = [];
  const listeners = new Map();
  const element = tag => ({
    tagName: tag.toUpperCase(), style: {}, className: '', isConnected: false, children: [],
    appendChild(child) { child.isConnected = true; this.children.push(child); },
    insertBefore(child, next) { child.isConnected = true; this.children.splice(this.children.indexOf(next), 0, child); },
    remove() { this.isConnected = false; },
    setAttribute(name, value) { this[name] = value; },
    querySelector(selector) { return selector === '[data-explorer-root]' ? this.committedRoot ?? null : null; },
  });
  const document = {
    title: '', baseURI: 'https://example.test/workspace/', readyState: 'complete', visibilityState: 'visible',
    documentElement: { lang: 'ja', className: 'theme' }, head: element('head'), body: element('body'),
    querySelectorAll() { return []; }, getElementById() { return null; },
    addEventListener(type, handler) {
      const key = `document:${type}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(`document:${type}`)?.delete(handler); },
    createElement(tag) { return { ...element(tag), ownerDocument: document }; },
    createComment() { return { ownerDocument: document }; },
    defaultView: {
      screenX: 10, screenY: 20,
      confirmResult: true, confirmCalls: [],
      confirm(message) { this.confirmCalls.push(message); return this.confirmResult; },
      open() { return null; },
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
      MutationObserver: class {
        constructor() { this.disconnected = false; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
      },
    },
  };
  document.defaultView.document = document;
  document.head.ownerDocument = document;
  document.body.ownerDocument = document;
  return { document, observers, listeners,
    dispatch(type) {
      const event = { type, defaultPrevented: false, returnValue: undefined,
        preventDefault() { this.defaultPrevented = true; } };
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
      return event;
    },
  };
}

async function mountPopup(t, supplied = {}, settings = {}) {
  const host = mockDocument();
  const popups = [];
  const opens = [];
  const changes = [];
  const events = [];
  const beforeCloses = [];
  const intervals = new Map();
  let intervalId = 0;
  let clock = Date.now();
  let nextSettings;
  let handlingGesture = false;
  let mounted = true;
  let latest;
  let renderer;
  let props = {
    options: undefined,
    onOpenChange: value => changes.push(value),
    onBeforeClose: () => beforeCloses.push(popups.at(-1)?.window.closed),
    onEvent: event => events.push(event),
    ...supplied,
  };
  const originals = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: host.document.defaultView });
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: host.document });
  t.mock.method(globalThis, 'setInterval', (callback) => { intervals.set(++intervalId, callback); return intervalId; });
  t.mock.method(globalThis, 'clearInterval', id => intervals.delete(id));
  t.mock.method(Date, 'now', () => clock);
  const openWindow = function (...args) {
    opens.push({ args, source: this, duringGesture: handlingGesture });
    const options = { ...settings, ...nextSettings };
    nextSettings = undefined;
    if (options.blocked) return null;
    if (options.throws) throw new Error('Host denied window creation');
    const content = mockDocument();
    content.document.renderExplorer = options.rendered !== false;
    const window = content.document.defaultView;
    Object.assign(window, {
      opener: host.document.defaultView, closed: false, focusCount: 0, closeCount: 0,
      confirmResult: options.confirmResult ?? true, beforeUnloadListenersAtClose: [],
      innerWidth: options.zeroViewport ? 0 : 1100, innerHeight: options.zeroViewport ? 0 : 760,
      focus() { this.focusCount++; },
      close() {
        this.beforeUnloadListenersAtClose.push(content.listeners.get('beforeunload')?.size ?? 0);
        this.closed = true;
        this.closeCount++;
      },
      open: openWindow,
    });
    if (options.hidden) content.document.visibilityState = 'hidden';
    if (options.loading) content.document.readyState = 'loading';
    popups.push({ ...content, window });
    return window;
  };
  host.document.defaultView.open = openWindow;
  function Contents({ view }) {
    useLayoutEffect(() => {
      if (!view.document.renderExplorer) return;
      const root = view.document.createElement('div');
      root.isConnected = true;
      view.container.committedRoot = root;
      return () => { root.isConnected = false; view.container.committedRoot = null; };
    }, [view]);
    return null;
  }
  function Probe({ options }) {
    latest = useExplorerPopupWindow(options.options, options.onOpenChange, options.onBeforeClose, options.onEvent, options.unsavedChangesGuard);
    return latest.view ? createElement(Contents, { view: latest.view }) : null;
  }
  const tree = () => createElement(StrictMode, null, settings.wrapper
    ? createElement(ExplorerPopup, { ...props, windowOptions: props.options,
      renderTrigger: controls => { latest = controls; return null; } })
    : createElement(Probe, { options: props }));
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await change(() => renderer.unmount());
  };
  t.after(async () => {
    try {
      await unmount();
      assert.equal(intervals.size, 0, 'unmount clears popup polling');
      assert.ok(popups.every(popup => popup.window.closed), 'all owned windows close on unmount');
      assert.ok(host.observers.every(observer => observer.disconnected), 'host style observers disconnect');
      assert.ok([...host.listeners.values()].every(handlers => handlers.size === 0), 'host lifecycle listeners clear');
      assert.ok(popups.every(popup => [...popup.listeners.values()].every(handlers => handlers.size === 0)), 'popup handlers clear');
    } finally {
      for (const [key, original] of originals) {
        if (original) Object.defineProperty(globalThis, key, original);
        else delete globalThis[key];
      }
    }
  });
  await change(() => { renderer = create(tree()); });
  return {
    get popup() { return latest; }, get pane() { return getPane(); }, get workspace() { return getWorkspace(); },
    paneFor: getPane, host, popups, opens, changes, events, beforeCloses, unmount,
    configureNextPopup(options) { nextSettings = options; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async advance(milliseconds = 300) {
      clock += milliseconds;
      await change(() => { for (const callback of [...intervals.values()]) callback(); });
    },
    async open(event = { currentTarget: { ownerDocument: host.document } }) {
      let result;
      await change(() => {
        handlingGesture = true;
        try { result = latest.open(event); }
        finally { handlingGesture = false; }
      });
      return result;
    },
  };
}

test('StrictMode mount does not open a window; a direct user action opens exactly one ready popup', async t => {
  const hook = await mountPopup(t);
  assert.deepEqual(hook.opens, []);
  assert.equal(hook.popup.view, null);
  assert.equal(hook.popup.isOpen, false);
  assert.equal(hook.popup.isOpening, false);
  assert.equal(hook.popup.error, null);
  assert.deepEqual(hook.changes, []);
  assert.equal(await hook.open(), true);
  assert.equal(hook.opens.length, 1);
  assert.equal(hook.opens[0].duringGesture, true, 'window.open remains inside the input handler');
  assert.equal(hook.opens[0].source, hook.host.document.defaultView);
  assert.equal(hook.opens[0].args[0], 'about:blank');
  assert.match(hook.opens[0].args[2], /^popup=yes,/);
  assert.equal(hook.popups[0].window.opener, null);
  assert.equal(hook.popup.isOpen, true);
  assert.equal(hook.popup.isOpening, false);
  assert.deepEqual(hook.changes, [true]);
  assert.equal(hook.popup.view.container.ownerDocument, hook.popups[0].document);
  assert.equal(hook.popup.view.container.style.height, '100dvh');
  assert.equal(hook.popups[0].document.documentElement.className, 'theme');
});

test('repeated open requests focus the current popup instead of opening another window', async t => {
  const hook = await mountPopup(t, {}, { zeroViewport: true });
  await hook.open();
  const first = hook.popup.view;
  assert.equal(hook.popup.isOpening, true);
  assert.equal(hook.popup.isOpen, false);
  assert.deepEqual(hook.changes, []);
  await hook.open();
  assert.equal(hook.opens.length, 1);
  assert.equal(hook.popup.view, first);
  hook.popups[0].window.innerWidth = 1100;
  hook.popups[0].window.innerHeight = 760;
  await hook.advance();
  assert.equal(hook.popup.isOpen, true);
  await hook.open();
  assert.equal(hook.opens.length, 1);
  assert.equal(hook.popups[0].window.focusCount, 3);
  assert.deepEqual(hook.changes, [true]);
});

test('opening uses the trigger document user activation and latest window options', async t => {
  const hook = await mountPopup(t, { options: { width: 900, height: 640, left: -100, top: 50 } });
  const alternate = mockDocument();
  alternate.document.defaultView.open = hook.host.document.defaultView.open;
  await hook.open({ currentTarget: { ownerDocument: alternate.document } });
  assert.equal(hook.opens[0].source, alternate.document.defaultView);
  assert.match(hook.opens[0].args[2], /width=900,height=640/);
  assert.match(hook.opens[0].args[2], /left=-100,top=50/);
  await change(() => hook.popup.close());
  await hook.update({ options: { width: 1000, height: 700, left: 20, top: 30 } });
  await hook.open();
  assert.match(hook.opens[1].args[2], /width=1000,height=700/);
  assert.match(hook.opens[1].args[2], /left=20,top=30/);
});

for (const denial of ['blocked', 'throws']) {
  test(`a host that ${denial} opening preserves the launcher and reports failure without an open callback`, async t => {
    const hook = await mountPopup(t, {}, { [denial]: true });
    assert.equal(await hook.open(), false);
    assert.equal(hook.popup.isOpen, false);
    assert.equal(hook.popup.isOpening, false);
    assert.equal(hook.popup.view, null);
    assert.ok(hook.popup.error);
    assert.deepEqual(hook.changes, []);
    assert.deepEqual(hook.events.map(event => event.action), ['blocked']);
    hook.configureNextPopup({ blocked: false, throws: false });
    assert.equal(await hook.open(), true);
    assert.equal(hook.popup.error, null);
    assert.deepEqual(hook.changes, [true]);
  });
}

test('a hidden or loading zero-viewport popup reports ready only after the rendered document becomes visible', async t => {
  const hook = await mountPopup(t, {}, { zeroViewport: true, hidden: true, loading: true });
  await hook.open();
  const popup = hook.popups[0];
  assert.equal(hook.popup.isOpening, true);
  popup.window.innerWidth = 1100;
  popup.window.innerHeight = 760;
  await hook.advance();
  assert.deepEqual(hook.changes, []);
  popup.document.visibilityState = 'visible';
  await hook.advance();
  assert.deepEqual(hook.changes, []);
  popup.document.readyState = 'complete';
  await hook.advance();
  assert.deepEqual(hook.changes, [true]);
  await hook.advance();
  assert.deepEqual(hook.changes, [true], 'readiness is announced once');
});

test('failure to display a rendered Explorer before the deadline closes the empty window and permits retry', async t => {
  const hook = await mountPopup(t, {}, { rendered: false });
  await hook.open();
  assert.equal(hook.popup.isOpening, true);
  await hook.advance(5001);
  assert.equal(hook.popup.view, null);
  assert.equal(hook.popup.isOpen, false);
  assert.equal(hook.popup.isOpening, false);
  assert.ok(hook.popup.error);
  assert.equal(hook.popups[0].window.closed, true);
  assert.deepEqual(hook.changes, []);
  assert.deepEqual(hook.events.map(event => event.action), ['blocked']);
  assert.ok(hook.host.observers.every(observer => observer.disconnected));
  hook.configureNextPopup({ rendered: true });
  await hook.open();
  assert.deepEqual(hook.changes, [true]);
  assert.equal(hook.popup.error, null);
});

test('intentional close during opening cancels readiness without a blocked error or spurious open change', async t => {
  const hook = await mountPopup(t, {}, { zeroViewport: true });
  await hook.open();
  await change(() => hook.popup.close());
  assert.equal(hook.popup.view, null);
  assert.equal(hook.popup.isOpening, false);
  assert.equal(hook.popup.error, null);
  assert.deepEqual(hook.changes, []);
  assert.ok(hook.events.every(event => event.action !== 'blocked'));
  assert.deepEqual(hook.beforeCloses, [false], 'workspace cleanup runs before the popup document closes');
  await hook.advance(6000);
  assert.deepEqual(hook.changes, []);
  assert.equal(hook.popup.error, null);
});

test('native closure before readiness is a recoverable failure instead of a successful open and close', async t => {
  const hook = await mountPopup(t, {}, { zeroViewport: true });
  await hook.open();
  hook.popups[0].window.closed = true;
  await hook.advance();
  assert.equal(hook.popup.view, null);
  assert.ok(hook.popup.error);
  assert.deepEqual(hook.changes, []);
  assert.deepEqual(hook.events.map(event => event.action), ['blocked']);
});

test('closing a ready popup uses current callbacks once and reopening creates a fresh owned document', async t => {
  const hook = await mountPopup(t);
  await hook.open();
  const initial = hook.popup.view;
  const newerChanges = [];
  const newerBeforeCloses = [];
  await hook.update({
    onOpenChange: value => newerChanges.push(value),
    onBeforeClose: () => newerBeforeCloses.push(initial.window.closed),
  });
  await change(() => { hook.popup.close(); hook.popup.close(); });
  assert.deepEqual(hook.changes, [true]);
  assert.deepEqual(newerChanges, [false]);
  assert.deepEqual(newerBeforeCloses, [false]);
  assert.equal(initial.window.closeCount, 1);
  assert.equal(hook.popup.view, null);
  assert.equal(hook.popup.error, null);
  await hook.open();
  assert.equal(hook.opens.length, 2);
  assert.notEqual(hook.popup.view.container, initial.container);
  assert.deepEqual(newerChanges, [false, true]);
});

test('native close and navigation release resources and notify closure after readiness', async t => {
  const hook = await mountPopup(t);
  await hook.open();
  hook.popups[0].window.closed = true;
  await hook.advance();
  assert.equal(hook.popup.view, null);
  assert.deepEqual(hook.changes, [true, false]);
  assert.equal(hook.popup.error, null);
  await hook.open();
  hook.popups[1].window.document = mockDocument().document;
  await hook.advance();
  assert.equal(hook.popup.view, null);
  assert.deepEqual(hook.changes, [true, false, true, false]);
  assert.equal(hook.popups[1].window.closed, true);
  assert.ok(hook.host.observers.every(observer => observer.disconnected));
});

test('unmount closes the window and detaches resources without post-unmount callbacks', async t => {
  const hook = await mountPopup(t);
  await hook.open();
  await hook.unmount();
  assert.equal(hook.popups[0].window.closed, true);
  assert.ok(hook.host.observers.every(observer => observer.disconnected));
  const changes = [...hook.changes];
  await hook.advance(6000);
  assert.deepEqual(hook.changes, changes);
});

test('host pagehide closes its popup and stops pending visibility checks', async t => {
  const hook = await mountPopup(t);
  await hook.open();
  await change(() => hook.host.dispatch('pagehide'));
  assert.equal(hook.popup.isOpen, false);
  assert.equal(hook.popup.view, null);
  assert.equal(hook.popups[0].window.closed, true);
  assert.deepEqual(hook.changes, [true, false]);
  assert.deepEqual(hook.beforeCloses, [false]);
  await hook.advance(6000);
  assert.deepEqual(hook.changes, [true, false]);
});

const initialEntries = () => [{
  id: 'alpha', name: 'Alpha.txt', parent: 'root', kind: 'file', size: 4, mime: 'text/plain',
  source: { kind: 'existing', id: 'content-alpha' },
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0,
}];

test('ExplorerPopup launches with a single tab even when tabs and detaching are disabled', async t => {
  const hook = await mountPopup(t, {
    initialEntries: initialEntries(), onSave() {}, features: { tabs: false, detachTabs: false },
  }, { wrapper: true });
  assert.deepEqual(hook.opens, []);
  assert.equal(await hook.open(), true);
  assert.equal(hook.popup.isOpen, true);
  assert.equal(hook.pane.features.tabs, false);
  assert.equal(hook.pane.features.detachTabs, false);
  assert.equal(hook.pane.isDetached, false);
  assert.equal(hook.workspace.tabs.allTabs.length, 1);
  assert.deepEqual(hook.changes, [true]);
});

test('ExplorerPopup preserves unsaved edits, uploaded File references and navigation across close and reopen', async t => {
  const saves = [];
  const hook = await mountPopup(t, { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); } }, { wrapper: true });
  await hook.open();
  const file = new File(['uploaded before closing'], 'Staged.txt', { type: 'text/plain' });
  await change(() => {
    hook.pane.act('rename', ['alpha'], { name: 'Renamed.txt' });
    hook.pane.addLocalFiles([file]);
    hook.pane.changeView('large');
    hook.pane.setQuery('Renamed');
    hook.pane.setSelected(['alpha']);
  });
  const entries = hook.pane.entries;
  assert.equal(hook.pane.dirty, true);
  await change(() => hook.popup.close());
  assert.equal(hook.pane, undefined);
  assert.deepEqual(saves, []);
  assert.equal(hook.popup.isOpen, false);
  await hook.open();
  assert.equal(hook.pane.entries, entries);
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Renamed.txt');
  assert.equal(hook.pane.entries.find(item => item.name === 'Staged.txt').source.file, file);
  assert.deepEqual(hook.pane.selected, ['alpha']);
  assert.equal(hook.pane.view, 'large');
  assert.equal(hook.pane.query, 'Renamed');
  assert.equal(hook.pane.dirty, true);
  await change(() => hook.pane.saveChanges());
  assert.equal(saves.length, 1);
  assert.equal(saves[0].changes.created.find(item => item.name === 'Staged.txt').source.file, file);
  assert.equal(saves[0].changes.updated.find(item => item.id === 'alpha').name, 'Renamed.txt');
  assert.equal(hook.pane.dirty, false);
});

test('detached children share the popup workspace and close with the root without discarding their edits', async t => {
  const hook = await mountPopup(t, { initialEntries: initialEntries(), onSave() {} }, { wrapper: true });
  await hook.open();
  assert.equal(hook.pane.detachTab(hook.pane.activeTabId), false, 'the last tab stays in the root popup');
  await change(() => hook.pane.addTab());
  await change(() => { assert.equal(hook.pane.detachTab(hook.pane.activeTabId), true); });
  const child = hook.workspace.windows[0];
  assert.ok(child);
  assert.equal(hook.opens.length, 2);
  assert.equal(hook.opens[1].source, hook.popups[0].window);
  assert.equal(hook.paneFor(child.id).isDetached, true);
  await change(() => hook.paneFor(child.id).act('rename', ['alpha'], { name: 'Child edit.txt' }));
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Child edit.txt');
  hook.popups[0].window.closed = true;
  await hook.advance();
  assert.equal(hook.popup.isOpen, false);
  assert.equal(hook.popups[1].window.closed, true);
  assert.equal(hook.paneFor(child.id), undefined);
  await hook.open();
  assert.equal(hook.workspace.windows.length, 0);
  assert.equal(hook.workspace.tabs.allTabs.length, 1);
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Child edit.txt');
  assert.equal(hook.pane.dirty, true);
});

test('closing and reopening during save preserves the workspace save lock and completion', async t => {
  let resolveSave;
  const completion = new Promise(resolve => { resolveSave = resolve; });
  const saves = [];
  const hook = await mountPopup(t, {
    initialEntries: initialEntries(), onSave: payload => { saves.push(payload); return completion; },
  }, { wrapper: true });
  await hook.open();
  await change(() => hook.pane.act('rename', ['alpha'], { name: 'Saving.txt' }));
  let saving;
  await change(() => { saving = hook.pane.saveChanges(); });
  assert.equal(hook.pane.busy, true);
  await change(() => hook.popup.close());
  await hook.open();
  assert.equal(hook.pane.busy, true);
  assert.equal(hook.pane.dirty, true);
  await change(() => { assert.equal(hook.pane.act('delete', ['alpha']), false); });
  await change(() => hook.pane.saveChanges());
  assert.equal(saves.length, 1);
  await change(async () => { resolveSave(); await saving; });
  assert.equal(hook.pane.busy, false);
  assert.equal(hook.pane.dirty, false);
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Saving.txt');
});

test('declining popup close preserves every portal, child tab, shared edit and uploaded File', async t => {
  const hook = await mountPopup(t, { initialEntries: initialEntries(), onSave() {} }, { wrapper: true });
  await hook.open();
  await change(() => hook.pane.addTab());
  await change(() => { assert.equal(hook.pane.detachTab(hook.pane.activeTabId), true); });
  const child = hook.workspace.windows[0];
  const rootPopup = hook.popups[0];
  const childPopup = hook.popups[1];
  const rootContainer = rootPopup.document.body.children.at(-1);
  const file = new File(['keep this staged content'], 'Staged.txt', { type: 'text/plain' });
  await change(() => {
    hook.paneFor(child.id).act('rename', ['alpha'], { name: 'Shared edit.txt' });
    hook.paneFor(child.id).addLocalFiles([file]);
  });
  const entries = hook.pane.entries;
  const childTabIds = hook.workspace.tabs.getWindowTabIds(child.id);
  rootPopup.window.confirmResult = false;
  await change(() => hook.popup.close());
  assert.equal(rootPopup.window.confirmCalls.length, 1);
  assert.match(rootPopup.window.confirmCalls[0], /未保存の変更/);
  assert.match(rootPopup.window.confirmCalls[0], /親画面に保持/);
  assert.equal(hook.popup.isOpen, true);
  assert.equal(rootContainer.isConnected, true);
  assert.ok(rootContainer.committedRoot?.isConnected);
  assert.ok(child.container.committedRoot?.isConnected);
  assert.equal(hook.pane.entries, entries);
  assert.equal(hook.pane.dirty, true);
  assert.equal(hook.pane.entries.find(item => item.name === 'Staged.txt').source.file, file);
  assert.deepEqual(hook.workspace.tabs.getWindowTabIds(child.id), childTabIds);
  assert.deepEqual(hook.changes, [true]);
  assert.equal(rootPopup.window.closeCount, 0);
  assert.equal(childPopup.window.closeCount, 0);

  // Native beforeunload requests a browser confirmation without mutating the
  // workspace. Cancelling that confirmation does not close the native window.
  assert.equal(rootPopup.dispatch('beforeunload').defaultPrevented, true);
  assert.equal(childPopup.dispatch('beforeunload').defaultPrevented, true);
  await hook.advance();
  assert.equal(hook.popup.isOpen, true);
  assert.equal(hook.pane.entries, entries);
  assert.ok(rootContainer.committedRoot?.isConnected);
  assert.ok(child.container.committedRoot?.isConnected);
  assert.equal(rootPopup.window.confirmCalls.length, 1, 'native handlers leave the dialog to the browser');

  rootPopup.window.confirmResult = true;
  await change(() => { hook.popup.close(); hook.popup.close(); });
  assert.equal(rootPopup.window.confirmCalls.length, 2, 'one explicit confirmation per attempted close');
  assert.equal(rootPopup.window.closeCount, 1);
  assert.equal(childPopup.window.closeCount, 1);
  assert.deepEqual(rootPopup.window.beforeUnloadListenersAtClose, [0], 'no second native prompt after explicit confirmation');
  assert.deepEqual(childPopup.window.beforeUnloadListenersAtClose, [0], 'dependent windows close without another prompt');
  assert.deepEqual(hook.changes, [true, false]);
  assert.equal(hook.pane, undefined);
  await hook.open();
  assert.equal(hook.pane.entries, entries);
  assert.equal(hook.pane.dirty, true);
  assert.equal(hook.pane.entries.find(item => item.name === 'Staged.txt').source.file, file);
  assert.equal(hook.workspace.windows.length, 0);
  assert.equal(hook.popups[2].listeners.get('beforeunload')?.size, 1, 'reopened dirty workspace is protected');
});

test('popup warning listeners follow failed and successful saves and live warnOnUnsavedChanges settings', async t => {
  const hook = await mountPopup(t, {
    initialEntries: initialEntries(), onSave() { throw new Error('Save unavailable'); },
  }, { wrapper: true });
  await hook.open();
  const popup = hook.popups[0];
  const listenerCount = target => target.listeners.get('beforeunload')?.size ?? 0;
  assert.equal(listenerCount(popup), 0, 'clean popup does not register beforeunload');
  await change(() => hook.pane.act('rename', ['alpha'], { name: 'Pending.txt' }));
  assert.equal(listenerCount(popup), 1);
  assert.equal(listenerCount(hook.host), 1, 'the launcher also guards the shared draft');
  await change(() => hook.pane.saveChanges());
  assert.equal(hook.pane.dirty, true);
  assert.equal(listenerCount(popup), 1, 'a failed save keeps the warning active');
  await hook.update({ warnOnUnsavedChanges: false });
  assert.equal(listenerCount(popup), 0);
  assert.equal(listenerCount(hook.host), 0);
  assert.equal(popup.dispatch('beforeunload').defaultPrevented, false);
  await hook.update({ warnOnUnsavedChanges: true });
  assert.equal(listenerCount(popup), 1);
  await hook.update({ onSave() {} });
  await change(() => hook.pane.saveChanges());
  assert.equal(hook.pane.dirty, false);
  assert.equal(listenerCount(popup), 0, 'successful save removes the listener');
  assert.equal(listenerCount(hook.host), 0);

  await change(() => hook.pane.act('rename', ['alpha'], { name: 'Retained.txt' }));
  await hook.update({ warnOnUnsavedChanges: false });
  popup.window.confirmResult = false;
  await change(() => hook.popup.close());
  assert.equal(hook.popup.isOpen, false, 'opting out skips the explicit close warning too');
  assert.deepEqual(popup.window.confirmCalls, []);
  await hook.open();
  assert.equal(hook.pane.dirty, true);
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Retained.txt');
  assert.equal(listenerCount(hook.popups[1]), 0);
  await hook.update({ warnOnUnsavedChanges: true });
  assert.equal(listenerCount(hook.popups[1]), 1);
});

test('confirmed host pagehide and unmount clean dirty popup listeners without another close confirmation', async t => {
  const hook = await mountPopup(t, { initialEntries: initialEntries(), onSave() {} }, { wrapper: true });
  await hook.open();
  await change(() => hook.pane.act('rename', ['alpha'], { name: 'Retained.txt' }));
  const popup = hook.popups[0];
  popup.window.confirmResult = false;
  await change(() => hook.host.dispatch('pagehide'));
  assert.equal(hook.popup.isOpen, false);
  assert.equal(popup.window.closeCount, 1);
  assert.deepEqual(popup.window.confirmCalls, []);
  assert.equal(popup.listeners.get('beforeunload')?.size, 0);
  assert.deepEqual(popup.window.beforeUnloadListenersAtClose, [0]);
  await hook.open();
  assert.equal(hook.pane.dirty, true);
  assert.equal(hook.pane.entries.find(item => item.id === 'alpha').name, 'Retained.txt');
  const reopened = hook.popups[1];
  reopened.window.confirmResult = false;
  await hook.unmount();
  assert.deepEqual(reopened.window.confirmCalls, []);
  assert.equal(reopened.listeners.get('beforeunload')?.size, 0);
  assert.deepEqual(reopened.window.beforeUnloadListenersAtClose, [0]);
});
