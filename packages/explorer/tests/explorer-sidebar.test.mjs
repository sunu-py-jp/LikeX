import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { ExplorerSidebarResizer, useExplorerSidebarResize } from './src/ui/explorer-sidebar-resizer.tsx';
      export * from './src/model/sidebar-size.ts';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-sidebar.tsx',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'shared-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const {
  ExplorerSidebarResizer, useExplorerSidebarResize,
  clampSidebarWidth, sidebarLimits,
} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const change = async callback => { await act(async () => { await callback(); }); };

async function mount(t, initialWidth = 1000) {
  const observers = new Set();
  const frames = new Map();
  const listeners = new Map();
  let frameId = 0;
  const ownerWindow = {
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(element) { this.element = element; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
  };
  const container = { clientWidth: initialWidth, ownerDocument: { defaultView: ownerWindow } };
  const containerRef = { current: container };
  const captures = new Set();
  const node = {
    dataset: {}, focused: false,
    focus() { this.focused = true; },
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  let enabled = true;
  let resize;
  let renderer;
  let closed = false;
  function Probe() {
    resize = useExplorerSidebarResize(enabled, containerRef);
    return h(ExplorerSidebarResizer, { resize, controlsId: 'navigation' });
  }
  const element = () => h(StrictMode, null, h(Probe));
  const unmount = async () => {
    if (closed) return;
    closed = true;
    await change(() => renderer.unmount());
  };
  t.after(unmount);
  await change(() => { renderer = create(element()); });
  await change(() => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  });
  return {
    get value() { return resize; }, node, captures, observers, listeners,
    get grip() { return renderer.root.findByProps({ role: 'separator' }); },
    hasGrip() { return renderer.root.findAllByProps({ role: 'separator' }).length > 0; },
    unmount,
    async enable(value) { enabled = value; await change(() => renderer.update(element())); },
    async resizeContainer(width) {
      container.clientWidth = width;
      await change(() => { for (const observer of observers) observer.callback(); });
    },
    async pointer(handler, extra = {}) {
      const event = {
        currentTarget: node, button: 0, isPrimary: true, pointerId: 1, clientX: 208,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        ...extra,
      };
      await change(() => resize[handler](event));
      return event;
    },
    async key(key, shiftKey = false, extra = {}) {
      const event = {
        key, shiftKey, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        ...extra,
      };
      await change(() => resize.onKeyDown(event));
      return event;
    },
  };
}

test('sidebar bounds preserve the file list and keyboard controls expose accessible values', async t => {
  assert.deepEqual(sidebarLimits(1000), { min: 160, max: 400 });
  assert.deepEqual(sidebarLimits(720), { min: 160, max: 394 });
  assert.equal(720 - clampSidebarWidth(400, 720) - 6, 320);
  assert.equal(clampSidebarWidth(100, 1000), 160);
  const view = await mount(t);
  assert.equal(view.value.width, 208);
  assert.equal(view.grip.props['aria-orientation'], 'vertical');
  assert.equal(view.grip.props['aria-controls'], 'navigation');
  assert.equal(view.grip.props['aria-valuenow'], 208);
  assert.match(view.grip.props.className, /lxe:hidden.*lxe:@\[720px\]\/explorer:flex/);
  for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    assert.equal((await view.key('ArrowRight', false, extra)).prevented, false);
    assert.equal(view.value.width, 208, 'composition and navigation shortcuts do not resize the sidebar');
  }
  assert.equal((await view.key('ArrowRight')).prevented, true);
  assert.equal(view.value.width, 218);
  await view.key('ArrowRight', true);
  assert.equal(view.value.width, 268);
  await view.key('Home');
  assert.equal(view.value.width, 160);
  await view.key('ArrowLeft');
  assert.equal(view.value.width, 160);
  await view.key('End');
  assert.equal(view.value.width, 400);
  await view.resizeContainer(720);
  assert.equal(view.value.width, 394);
  assert.equal(view.grip.props['aria-valuemax'], 394);
  assert.equal((await view.key('a')).prevented, false);
  await change(() => view.value.onDoubleClick());
  assert.equal(view.value.width, 208);
});

test('mouse and touch dragging capture one pointer and release it on end or cancel', async t => {
  const view = await mount(t);
  const down = await view.pointer('onPointerDown');
  assert.equal(down.prevented, true);
  assert.equal(view.node.focused, true);
  assert.equal(view.captures.has(1), true);
  await view.pointer('onPointerMove', { clientX: 310, pointerId: 2 });
  assert.equal(view.value.width, 208);
  await view.pointer('onPointerMove', { clientX: 310 });
  assert.equal(view.value.width, 310);
  await view.pointer('onPointerUp');
  assert.equal(view.captures.size, 0);
  assert.equal(view.node.dataset.resizing, undefined);
  await view.pointer('onPointerMove', { clientX: 350 });
  assert.equal(view.value.width, 310);
  await view.pointer('onPointerDown', { pointerType: 'touch', clientX: 310 });
  await view.pointer('onPointerMove', { pointerType: 'touch', clientX: -100 });
  assert.equal(view.value.width, 160);
  await view.pointer('onPointerCancel');
  assert.equal(view.captures.size, 0);
  await view.pointer('onPointerDown', { button: 2 });
  assert.equal(view.captures.size, 0);
});

test('disabling resize hides the grip, resets width, and ends active pointer capture', async t => {
  const view = await mount(t);
  await view.pointer('onPointerDown');
  await view.pointer('onPointerMove', { clientX: 340 });
  assert.equal(view.value.width, 340);
  await view.enable(false);
  assert.equal(view.hasGrip(), false);
  assert.equal(view.value.width, 208);
  assert.equal(view.captures.size, 0);
  await view.key('End');
  await view.pointer('onPointerDown');
  assert.equal(view.value.width, 208);
  assert.equal(view.captures.size, 0);
  await view.enable(true);
  assert.equal(view.value.width, 208);
  assert.equal(view.hasGrip(), true);
});

test('each instance observes its own window and mobile or unmount ends resizing', async t => {
  const first = await mount(t, 1000);
  const second = await mount(t, 720);
  await first.key('End');
  assert.equal(first.value.width, 400);
  assert.equal(second.value.width, 208);
  await second.key('End');
  assert.equal(second.value.width, 394);
  assert.equal(first.observers.size, 1);
  assert.equal(second.observers.size, 1);
  await first.pointer('onPointerDown');
  await first.resizeContainer(640);
  assert.equal(first.captures.size, 0);
  await first.pointer('onPointerDown');
  assert.equal(first.captures.size, 0);
  await second.pointer('onPointerDown');
  await second.unmount();
  assert.equal(second.captures.size, 0);
  assert.equal(second.observers.size, 0);
  assert.equal(second.listeners.size, 0);
});
