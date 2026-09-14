import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: {
  contents: `export { useExplorerMouseNavigation } from './src/state/use-explorer-mouse-navigation';`,
  resolveDir: packageRoot, sourcefile: 'mouse-navigation-lifecycle-test.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^react$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerMouseNavigation } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

function pane(document) {
  const root = { hasAttribute: name => name === 'data-explorer-root' };
  const calls = [];
  return { rootRef: { current: root }, ownerDocument: document, enabled: true,
    canGoBack: true, canGoForward: true, travel: direction => calls.push(direction), calls };
}
function documentTarget() {
  return Object.assign(new EventTarget(), { defaultView: new EventTarget() });
}
async function mount(t, panes) {
  function Probe({ options }) { useExplorerMouseNavigation(options); return null; }
  const tree = () => panes.map((options, index) => createElement(Probe, { key: index, options }));
  let renderer;
  await act(async () => { renderer = create(tree()); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return async (index, patch) => {
    panes[index] = { ...panes[index], ...patch };
    await act(async () => renderer.update(tree()));
  };
}
async function send(document, type, path, { button = 3, pointerId = 1 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: button }, pointerId: { value: pointerId }, composedPath: { value: () => path },
  });
  await act(async () => document.dispatchEvent(event));
  return event.defaultPrevented;
}

test('canceled pointer presses still finish when compatibility mouse events are absent', async t => {
  const document = documentTarget(), view = pane(document);
  const update = await mount(t, [view]);
  const path = [view.rootRef.current, document];
  assert.equal(await send(document, 'pointerdown', path), true);
  await update(0, { canGoBack: false });
  assert.equal(await send(document, 'pointerup', path), true);
  assert.equal(await send(document, 'auxclick', path), true);
  assert.deepEqual(view.calls, [-1]);
  for (const type of ['pointerdown', 'pointerup', 'auxclick']) {
    assert.equal(await send(document, type, path), false);
  }
});

test('a browser without auxclick can start another independent mouse-only gesture', async t => {
  const document = documentTarget(), view = pane(document);
  const update = await mount(t, [view]);
  const path = [view.rootRef.current, document];
  assert.equal(await send(document, 'mousedown', path), true);
  assert.equal(await send(document, 'mouseup', path), true);
  await update(0, { canGoBack: false });
  assert.equal(await send(document, 'mousedown', path), false);
  assert.equal(await send(document, 'mouseup', path), false);
  assert.deepEqual(view.calls, [-1]);
});

test('pointer cancellation preserves a consumed gesture tail and the next press is independent', async t => {
  const document = documentTarget(), view = pane(document);
  const update = await mount(t, [view]);
  const path = [view.rootRef.current, document];
  assert.equal(await send(document, 'pointerdown', path), true);
  await update(0, { enabled: false });
  await send(document, 'pointercancel', path, { button: -1 });
  for (const type of ['pointerup', 'mouseup', 'auxclick']) {
    assert.equal(await send(document, type, path), true);
  }
  assert.equal(await send(document, 'pointerdown', path), false);
  assert.equal(await send(document, 'mousedown', path), false);
  assert.deepEqual(view.calls, [-1]);
});

test('window blur drops an interrupted gesture and does not misclassify a later mouse press', async t => {
  const document = documentTarget(), view = pane(document);
  const update = await mount(t, [view]);
  const path = [view.rootRef.current, document];
  assert.equal(await send(document, 'pointerdown', path), true);
  await update(0, { canGoBack: false });
  document.defaultView.dispatchEvent(new Event('blur'));
  for (const type of ['mousedown', 'mouseup', 'auxclick']) {
    assert.equal(await send(document, type, path), false);
  }
  assert.deepEqual(view.calls, [-1]);
});

test('same-document siblings and nested panes assign each gesture to the nearest pane', async t => {
  const document = documentTarget(), outer = pane(document), sibling = pane(document), inner = pane(document);
  const update = await mount(t, [outer, sibling, inner]);
  const outerRoot = outer.rootRef.current, siblingRoot = sibling.rootRef.current, innerRoot = inner.rootRef.current;
  const click = async path => {
    const canceled = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) {
      canceled.push(await send(document, type, path));
    }
    return canceled;
  };
  assert.deepEqual(await click([siblingRoot, document]), [true, true, true, true, true]);
  assert.deepEqual(outer.calls, []);
  assert.deepEqual(sibling.calls, [-1]);
  assert.deepEqual(inner.calls, []);
  assert.deepEqual(await click([innerRoot, outerRoot, document]), [true, true, true, true, true]);
  assert.deepEqual(outer.calls, []);
  assert.deepEqual(inner.calls, [-1]);
  await update(2, { enabled: false });
  assert.deepEqual(await click([innerRoot, outerRoot, document]), [false, false, false, false, false]);
  assert.deepEqual(outer.calls, []);
  assert.deepEqual(inner.calls, [-1]);
  // A menu portal is physically outside all panes even if it was rendered by
  // one of their React subtrees, and must not borrow any folder history.
  assert.deepEqual(await click([{ hasAttribute: () => false }, document]), [false, false, false, false, false]);
});
