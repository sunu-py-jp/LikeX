import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const harnessKey = '__explorerTabDragTest';
const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { ExplorerTabs } from './src/ui/explorer-tabs.tsx';
      export { ExplorerProvider } from './src/state/explorer-context.tsx';
    `,
    resolveDir: packageRoot, sourcefile: 'test-tab-drag.tsx',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'tab-ui-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^(react(\/.*)?|lucide-react|tailwind-merge)$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
      builder.onResolve({ filter: /^(react-dom|\.\/explorer-(overlays|controls|file-icon|theme|dom-context))$/ }, ({ path }) => ({ path, namespace: 'tab-drag-mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'tab-drag-mock' }, ({ path }) => {
        const state = `globalThis.${harnessKey}`;
        let contents;
        if (path === 'react-dom') contents = `export function createPortal(children, container) { ${state}.portalContainers.push(container); return children; }`;
        else if (path.endsWith('explorer-dom-context')) contents = `export function useExplorerDom() { return ${state}.environment; }`;
        else if (path.endsWith('explorer-theme')) contents = `export function useExplorerTheme() { return {'--explorer-panel':'white'}; }`;
        else if (path.endsWith('explorer-controls')) contents = `export const iconButtonClass='', menuContentClass='', menuItemClass='';`;
        else if (path.endsWith('explorer-file-icon')) contents = `export function FileIcon() { return null; }`;
        else contents = `import {createElement} from 'react'; export const ContextMenu = Object.fromEntries(['Root','Trigger','Portal','Content','Item'].map(name=>[name,props=>createElement('menu-'+name.toLowerCase(),props,props.children)]));`;
        return { contents, loader: 'js', resolveDir: packageRoot };
      });
    },
  }],
});
const { ExplorerTabs, ExplorerProvider } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { callback(); }); };

async function mountTabs(t, { count = 2, detached = false, result = true, reduced = false } = {}) {
  const sources = new Map();
  const buttons = new Map();
  const animations = [];
  const detachCalls = [];
  const returnCalls = [];
  const ghostNodes = [];
  const ownerDocument = { body: {}, defaultView: { matchMedia: () => ({ matches: reduced }) } };
  const controller = {
    tabs: Array.from({ length: count }, (_, index) => ({ id: `tab-${index + 1}`, title: `Folder ${index + 1}` })),
    tabLocations: {}, entries: [], activeTabId: 'tab-1', instanceId: 'test-explorer',
    features: { tabs: true, detachTabs: true }, uiOptions: { contextMenu: true }, isDetached: detached,
    addTab() {}, selectTab() {}, closeTab() {}, reattachWindow() { returnCalls.push(true); },
    detachTab(...args) { detachCalls.push(args); return result; },
  };
  const state = { controller, environment: { document: ownerDocument, portalContainer: ownerDocument.body }, portalContainers: [] };
  globalThis[harnessKey] = state;
  const element = () => createElement(ExplorerProvider, { value: { ...controller, features: { ...controller.features } } }, createElement(ExplorerTabs));
  let renderer;
  await change(() => {
    renderer = create(element(), {
      createNodeMock({ type, props }) {
        if (type === 'button' && props.role === 'tab') {
          const id = props.id.slice('test-explorer-tab-'.length);
          if (!sources.has(id)) sources.set(id, {
            dataset: {}, isConnected: true,
            getBoundingClientRect: () => ({ left: 20, top: 10, width: 120, height: 32 }),
          });
          if (!buttons.has(id)) {
            const captured = new Set();
            buttons.set(id, { dataset: {}, closest: () => sources.get(id),
              setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
              releasePointerCapture: id => captured.delete(id), captured,
              focus() {}, scrollIntoView() {},
            });
          }
          return buttons.get(id);
        }
        if (props['data-explorer-tab-ghost']) {
          const element = { dataset: {}, style: {}, ownerDocument,
            animate(keyframes, options) {
              const animation = { keyframes, options, onfinish: null, cancelled: false, cancel() { this.cancelled = true; } };
              animations.push(animation);
              return animation;
            },
          };
          ghostNodes.push(element);
          return element;
        }
        if (type === 'div') return { getBoundingClientRect: () => ({ left: 0, right: 600, top: 0, bottom: 40 }) };
        return null;
      },
    });
  });
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await change(() => renderer.unmount()); unmounted = true; } };
  t.after(unmount);
  const tab = () => renderer.root.findAllByProps({ role: 'tab' })[0];
  const event = (x, y) => ({ currentTarget: buttons.get('tab-1'), pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true,
    clientX: x, clientY: y, screenX: x + 100, screenY: y + 100, preventDefault() {}, stopPropagation() {} });
  const pointer = async (name, x, y) => change(() => tab().props[name](event(x, y)));
  return {
    renderer, controller, sources, buttons, animations, detachCalls, returnCalls, ghostNodes, state, pointer, tab, unmount,
    ghosts: () => renderer.root.findAllByProps({ 'data-explorer-tab-ghost': 'test-explorer' }),
    start: async () => { await pointer('onPointerDown', 40, 20); await pointer('onPointerMove', 300, 160); },
    rawPointer: (name, x, y) => tab().props[name](event(x, y)),
    update: async () => change(() => renderer.update(element())),
  };
}

test('a lone main tab has no detach menu but follows the pointer and returns asynchronously', async t => {
  const ui = await mountTabs(t, { count: 1 });
  assert.equal(ui.renderer.root.findAllByType('menu-root').length, 0);
  await ui.start();
  assert.equal(ui.ghosts().length, 1);
  assert.equal(ui.ghosts()[0].props['aria-hidden'], 'true');
  assert.equal(ui.ghostNodes.at(-1).style.transform, 'translate3d(280px, 150px, 0)');
  assert.equal(ui.sources.get('tab-1').dataset.ghostSource, 'true');
  assert.equal(ui.state.portalContainers.at(-1), ui.state.environment.document.body);
  await ui.pointer('onPointerUp', 300, 160);
  assert.equal(ui.detachCalls.length, 0);
  assert.equal(ui.ghosts().length, 1, 'release does not wait for the return animation');
  assert.equal(ui.animations[0].options.duration, 240);
  assert.equal(ui.animations[0].keyframes[1].transform, 'translate3d(20px, 10px, 0)');
  await change(() => ui.animations[0].onfinish());
  assert.equal(ui.ghosts().length, 0);
  assert.equal(ui.sources.get('tab-1').dataset.ghostSource, undefined);
});

test('a successful outside release with two tabs removes its ghost without a return animation', async t => {
  const ui = await mountTabs(t);
  await ui.start();
  await ui.pointer('onPointerUp', 300, 160);
  assert.deepEqual(ui.detachCalls, [['tab-1', {
    left: 380, top: 250,
    tabAnchor: { screenX: 400, screenY: 260, offsetX: 20, offsetY: 10 },
  }]]);
  assert.equal(ui.ghosts().length, 0);
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.buttons.get('tab-1').captured.size, 0);
});

test('blocked popups and releases inside the tab bar animate back without losing the tab', async t => {
  for (const inside of [false, true]) await t.test(inside ? 'inside' : 'blocked popup', async t => {
    const ui = await mountTabs(t, { result: false });
    await ui.start();
    await ui.pointer('onPointerUp', inside ? 80 : 300, inside ? 20 : 160);
    assert.equal(ui.detachCalls.length, inside ? 0 : 1);
    assert.equal(ui.animations.length, 1);
    assert.equal(ui.ghosts().length, 1);
  });
});

test('Escape, pointer cancellation and lost capture return the ghost without detaching', async t => {
  for (const action of ['Escape', 'onPointerCancel', 'onLostPointerCapture']) await t.test(action, async t => {
    const ui = await mountTabs(t);
    await ui.start();
    await change(() => {
      if (action === 'Escape') ui.tab().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
      else ui.tab().props[action]();
    });
    await ui.pointer('onPointerUp', 300, 160);
    assert.equal(ui.detachCalls.length, 0);
    assert.equal(ui.animations.length, 1);
    assert.equal(ui.buttons.get('tab-1').captured.size, 0);
  });
});

test('tab arrows and Escape ignore composition and extra modifiers', async t => {
  const ui = await mountTabs(t);
  const selected = [];
  ui.controller.selectTab = id => { selected.push(id); };
  await ui.update();
  const key = (name, extra = {}) => ({ key: name, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
  const ignored = [{ isComposing: true }, { keyCode: 229 }, { nativeEvent: { isComposing: true } },
    { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }];
  for (const extra of ignored) {
    const event = key('ArrowRight', extra);
    await change(() => ui.tab().props.onKeyDown(event));
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(selected, []);
  for (const [name, target] of [['ArrowRight', 'tab-2'], ['Home', 'tab-1'], ['End', 'tab-2']]) {
    const event = key(name);
    await change(() => ui.tab().props.onKeyDown(event));
    assert.equal(event.defaultPrevented, true);
    assert.equal(selected.at(-1), target);
  }
  await ui.start();
  for (const extra of ignored) {
    await change(() => ui.tab().props.onKeyDown(key('Escape', extra)));
    assert.equal(ui.animations.length, 0, 'composition cancellation does not cancel the tab drag');
  }
  await change(() => ui.tab().props.onKeyDown(key('Escape')));
  assert.equal(ui.animations.length, 1);
  assert.equal(ui.detachCalls.length, 0);
});

test('reduced motion skips the return animation', async t => {
  const ui = await mountTabs(t, { count: 1, reduced: true });
  await ui.start();
  await ui.pointer('onPointerUp', 300, 160);
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.ghosts().length, 0);
});

test('disabling detachment and unmounting clean up capture, placeholders and running animations', async t => {
  const ui = await mountTabs(t, { count: 1 });
  await ui.start();
  ui.controller.features.detachTabs = false;
  await ui.update();
  assert.equal(ui.ghosts().length, 0);
  assert.equal(ui.sources.get('tab-1').dataset.ghostSource, undefined);
  assert.equal(ui.buttons.get('tab-1').captured.size, 0);
  ui.controller.features.detachTabs = true;
  await ui.update();
  assert.equal(ui.ghosts().length, 0, 'reenabling the feature cannot resurrect an old ghost');
  await ui.start();
  await ui.pointer('onPointerUp', 300, 160);
  await ui.unmount();
  assert.equal(ui.animations[0].cancelled, true);
  assert.equal(ui.sources.get('tab-1').dataset.ghostSource, undefined);
});

test('starting another drag interrupts its previous return animation', async t => {
  const ui = await mountTabs(t, { count: 1 });
  await ui.start();
  await ui.pointer('onPointerUp', 300, 160);
  const lateFinish = ui.animations[0].onfinish;
  await change(() => {
    ui.rawPointer('onPointerDown', 40, 20);
    ui.rawPointer('onPointerMove', 300, 160);
  });
  assert.equal(ui.animations[0].cancelled, true);
  assert.equal(ui.ghosts().length, 1);
  assert.equal(ui.ghostNodes.at(-1).style.visibility, '');
  assert.equal(ui.ghostNodes.at(-1).dataset.returning, undefined);
  await change(lateFinish);
  assert.equal(ui.ghosts().length, 1, 'a late callback from the cancelled return cannot hide the new drag');
});

test('a move and release batched before the portal mounts still starts its return animation', async t => {
  const ui = await mountTabs(t, { count: 1 });
  await change(() => {
    ui.rawPointer('onPointerDown', 40, 20);
    ui.rawPointer('onPointerMove', 300, 160);
    ui.rawPointer('onPointerUp', 300, 160);
  });
  assert.equal(ui.ghosts().length, 1);
  assert.equal(ui.animations.length, 1);
  assert.equal(ui.detachCalls.length, 0);
});

test('a detached window with one tab retains only its return menu and returns its dragged ghost', async t => {
  const ui = await mountTabs(t, { count: 1, detached: true });
  assert.equal(ui.renderer.root.findAllByType('menu-root').length, 1);
  const items = ui.renderer.root.findAllByType('menu-item');
  assert.deepEqual(items.map(item => item.children.filter(child => typeof child === 'string').join('')), ['元のウィンドウに戻す']);
  await ui.start();
  assert.equal(ui.ghosts().length, 1);
  assert.equal(ui.state.portalContainers.at(-1), ui.state.environment.document.body);
  await ui.pointer('onPointerUp', 300, 160);
  assert.equal(ui.detachCalls.length, 0);
  assert.equal(ui.animations.length, 1);
  await change(() => items[0].props.onSelect());
  assert.deepEqual(ui.returnCalls, [true]);
});

test('a detached window with two tabs can detach from its menu or drag, and can still return to the main Explorer', async t => {
  const ui = await mountTabs(t, { detached: true });
  const items = ui.renderer.root.findAllByType('menu-root')[0].findAllByType('menu-item');
  assert.deepEqual(items.map(item => item.children.filter(child => typeof child === 'string').join('')), ['別ウィンドウで開く', '元のウィンドウに戻す']);
  await change(() => items[0].props.onSelect());
  assert.deepEqual(ui.detachCalls, [['tab-1']]);
  await change(() => items[1].props.onSelect());
  assert.deepEqual(ui.returnCalls, [true]);
  await ui.start();
  assert.equal(ui.ghostNodes.at(-1).ownerDocument, ui.state.environment.document);
  await ui.pointer('onPointerUp', 300, 160);
  assert.deepEqual(ui.detachCalls[1], ['tab-1', {
    left: 380, top: 250,
    tabAnchor: { screenX: 400, screenY: 260, offsetX: 20, offsetY: 10 },
  }]);
  assert.equal(ui.ghosts().length, 0);
  assert.equal(ui.animations.length, 0);
});

test('disabling detachment removes both detached-window menu actions and drag handlers', async t => {
  const ui = await mountTabs(t, { detached: true });
  ui.controller.features.detachTabs = false;
  await ui.update();
  assert.equal(ui.renderer.root.findAllByType('menu-root').length, 0);
  assert.equal(ui.tab().props.onPointerDown, undefined);
});
