import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: {
  contents: `export { useExplorerWorkspace } from './src/state/use-explorer-workspace';
    export { useExplorerViewController } from './src/state/use-explorer-controller';`,
  resolveDir: packageRoot, sourcefile: 'mouse-navigation-test.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const folder = (id, parent = 'root') => ({ id, name: id, parent, kind: 'folder', size: 0, mime: '',
  source: null, favorite: 0, createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z' });

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(event) { for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event); },
    count: () => [...listeners.values()].reduce((count, entries) => count + entries.size, 0),
  };
}
function documentMock() {
  return { ...eventTarget(), defaultView: { ...eventTarget(), closed: false,
    history: { back() { assert.fail('browser history must remain native'); }, forward() { assert.fail('browser history must remain native'); } } },
    querySelectorAll: () => [], getElementById: () => null };
}
function rootElement(document, name = 'root', parent = null) {
  const root = { nodeType: 1, tagName: 'DIV', ownerDocument: document, parentElement: parent,
    hasAttribute: name => name === 'data-explorer-root', getAttribute: attribute => attribute === 'data-explorer-root' ? name : null,
    matches: selector => selector === '[data-explorer-root]',
    closest: selector => selector === '[data-explorer-root]' ? root : null,
    contains: element => element === root || element?.ancestors?.includes(root),
  };
  return root;
}
async function mount(t, supplied = {}) {
  const doc = documentMock(), childDoc = documentMock();
  const roots = { main: rootElement(doc), child: rootElement(childDoc, 'child') };
  const views = new Map(), events = [];
  let workspace, renderer, showChild = false, closed = false;
  let props = { initialEntries: [folder('a'), folder('b', 'a')], onSave() {}, onEvent: event => events.push(event), ...supplied };
  function Pane({ id, document }) {
    const controller = useExplorerViewController(props, workspace, id, document);
    views.set(id, controller);
    return null;
  }
  function App() {
    workspace = useExplorerWorkspace(props);
    return h(StrictMode, null, h(Pane, { id: 'main', document: doc }), showChild && h(Pane, { id: 'child', document: childDoc }));
  }
  const attach = () => { for (const [id, view] of views) view.workspaceRef.current = roots[id]; };
  await change(() => { renderer = create(h(App)); }); attach();
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(async () => { await unmount(); assert.equal(doc.count() + childDoc.count(), 0); assert.equal(doc.defaultView.count() + childDoc.defaultView.count(), 0); });
  async function send(type, button, { pane = 'main', target = roots[pane], path, ...extra } = {}) {
    const document = pane === 'main' ? doc : childDoc;
    const event = { type, button, buttons: type.endsWith('down') ? 1 << (button - 0) : 0,
      target, cancelable: true, defaultPrevented: false, pointerType: 'mouse', pointerId: 1, isPrimary: true,
      composedPath: () => path ?? [target, document],
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
      ...extra };
    await change(() => document.dispatch(event));
    return event;
  }
  async function click(button, options, pointer = true) {
    const types = pointer ? ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick'] : ['mousedown', 'mouseup', 'auxclick'];
    const results = [];
    for (const type of types) results.push(await send(type, button, options));
    return results;
  }
  return { get c() { return views.get('main'); }, get child() { return views.get('child'); }, get workspace() { return workspace; },
    doc, childDoc, roots, events, send, click, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(App))); attach(); },
    async openChild() { showChild = true; await change(() => renderer.update(h(App))); attach(); },
  };
}
const cancelled = events => events.map(event => event.defaultPrevented);

test('side buttons traverse the active folder history exactly once, then leave browser fallback untouched', async t => {
  const ui = await mount(t);
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
  await change(() => { ui.c.navigate('a'); });
  await change(() => { ui.c.navigate('b'); });
  for (const destination of ['a', 'root']) {
    assert.deepEqual(cancelled(await ui.click(3)), [true, true, true, true, true]);
    assert.equal(ui.c.location, destination);
  }
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
  for (const destination of ['a', 'b']) {
    assert.deepEqual(cancelled(await ui.click(4, undefined, false)), [true, true, true]);
    assert.equal(ui.c.location, destination);
  }
  assert.deepEqual(cancelled(await ui.click(4)), [false, false, false, false, false]);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.events.filter(event => event.type === 'navigate').length, 6);
});

test('feature off, outside targets, nested panes, other buttons and uncancellable events keep native behavior', async t => {
  const ui = await mount(t);
  await change(() => ui.c.navigate('a'));
  const outer = { nodeType: 1, tagName: 'DIV', closest: () => null };
  const nested = rootElement(ui.doc, 'nested', ui.roots.main);
  const ignored = [
    [3, { target: outer }], [3, { target: nested, path: [nested, ui.roots.main, ui.doc] }],
    [0], [1], [2], [3, { cancelable: false }], [3, { defaultPrevented: true }],
  ];
  for (const [button, options] of ignored) {
    const sequence = await ui.click(button, options);
    assert.ok(sequence.every(event => event.defaultPrevented === !!options?.defaultPrevented));
    assert.equal(ui.c.location, 'a');
  }
  await ui.update({ features: { mouseNavigation: false } });
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
  await ui.update({ features: { mouseNavigation: true }, onSave: undefined });
  assert.deepEqual(cancelled(await ui.click(3)), [true, true, true, true, true]);
  assert.equal(ui.c.location, 'root', 'read-only does not disable browsing');
});

test('a consumed gesture stays cancelled through release even after its last history entry or a feature/tab change', async t => {
  const ui = await mount(t);
  await change(() => ui.c.navigate('a'));
  assert.equal((await ui.send('pointerdown', 3)).defaultPrevented, true);
  assert.equal(ui.c.location, 'root');
  await change(() => ui.c.addTab());
  await ui.update({ features: { mouseNavigation: false } });
  for (const type of ['mousedown', 'pointerup', 'mouseup', 'auxclick']) assert.equal((await ui.send(type, 3)).defaultPrevented, true);
  assert.equal(ui.c.location, 'root');
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
});

test('an endpoint press is not captured later if navigation or feature state changes before release', async t => {
  const ui = await mount(t);
  assert.equal((await ui.send('pointerdown', 3)).defaultPrevented, false);
  await change(() => ui.c.navigate('a'));
  for (const type of ['mousedown', 'pointerup', 'mouseup', 'auxclick']) assert.equal((await ui.send(type, 3)).defaultPrevented, false);
  assert.equal(ui.c.location, 'a');
  for (const type of ['pointerup', 'mouseup', 'auxclick']) assert.equal((await ui.send(type, 3)).defaultPrevented, false);
});

test('tabs and detached windows use their own folder history and remove listeners when unmounted', async t => {
  const ui = await mount(t);
  await change(() => ui.c.navigate('a'));
  const firstTab = ui.c.activeTabId;
  await change(() => ui.c.addTab());
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
  await change(() => ui.workspace.tabs.detachTab(firstTab, 'child'));
  await ui.openChild();
  assert.equal(ui.child.location, 'a');
  assert.deepEqual(cancelled(await ui.click(3, { pane: 'child' })), [true, true, true, true, true]);
  assert.equal(ui.child.location, 'root');
  assert.equal(ui.c.location, 'root');
  assert.deepEqual(cancelled(await ui.click(4)), [false, false, false, false, false]);
  assert.deepEqual(cancelled(await ui.click(4, { pane: 'child' })), [true, true, true, true, true]);
  assert.equal(ui.child.location, 'a');
  await ui.unmount();
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
});

test('side buttons do not change a folder behind an open creation dialog', async t => {
  const ui = await mount(t);
  await change(() => ui.c.navigate('a'));
  await change(() => ui.c.showModal('create'));
  assert.ok(ui.c.modal);
  assert.deepEqual(cancelled(await ui.click(3)), [false, false, false, false, false]);
  assert.equal(ui.c.location, 'a');
  await change(() => ui.c.setModal(null));
  assert.deepEqual(cancelled(await ui.click(3)), [true, true, true, true, true]);
  assert.equal(ui.c.location, 'root');
});
