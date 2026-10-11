import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/ui/spreadsheet-floating-window.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react-and-portals', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'inline-portal' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-portal' }, () => ({ contents: 'import {createElement} from "react"; export const createPortal = (children, target) => createElement("portal-root", {target}, children);', loader: 'js' }));
  } }] });
const { SpreadsheetFloatingWindow, fitSpreadsheetFloatingWindow: fit, resizeSpreadsheetFloatingWindow: resize } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function target() {
  const listeners = new Map();
  return { addEventListener(type, callback) { const callbacks = listeners.get(type) ?? new Set(); callbacks.add(callback); listeners.set(type, callbacks); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    fire(type, event = {}) { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); },
    count(type) { return listeners.get(type)?.size ?? 0; } };
}

async function mount(t, options = {}) {
  const doc = target(), view = target(), frameRef = options.frameRef ?? { current: null };
  const resizeObservers = [], mutationObservers = [];
  let closeCount = 0, restored = 0, focused = 0;
  view.ResizeObserver = class { constructor(callback) { this.callback = callback; this.observed = []; resizeObservers.push(this); } observe(element) { this.observed.push(element); } disconnect() { this.disconnected = true; } };
  view.MutationObserver = class { constructor(callback) { this.callback = callback; this.observed = []; mutationObservers.push(this); } observe(element) { this.observed.push(element); } disconnect() { this.disconnected = true; } };
  doc.documentElement = { clientWidth: options.viewport?.width ?? 1200, clientHeight: options.viewport?.height ?? 900 };
  doc.body = { parentElement: doc.documentElement };
  view.innerWidth = 1200; view.innerHeight = 900;
  doc.defaultView = view;
  const previous = { isConnected: true, focus() { restored++; doc.activeElement = previous; } };
  const input = { inside: true, focus() { focused++; doc.activeElement = input; } };
  doc.activeElement = previous;
  const panel = { ownerDocument: doc, querySelector() { return input; }, contains(element) { return !!element?.inside; }, focus() { doc.activeElement = panel; } };
  const attributes = { 'data-color-mode': options.colorMode ?? 'light' };
  const variables = { '--lxs-accent': '#217346', '--lxs-background': '#ffffff', ...options.variables };
  const computed = { getPropertyValue(name) { return variables[name] ?? ''; }, font: '13px TestFont', color: 'rgb(10, 20, 30)', colorScheme: 'light', direction: 'ltr', letterSpacing: 'normal' };
  const region = { ownerDocument: doc, clientWidth: 500, clientHeight: 360, offsetWidth: 250, offsetHeight: 180, parentElement: doc.body,
    getAttribute(name) { return attributes[name] ?? null; },
    getBoundingClientRect() { return { left: 120, top: 60, width: this.clientWidth, height: this.clientHeight, right: 120 + this.clientWidth, bottom: 60 + this.clientHeight }; } };
  view.getComputedStyle = element => { assert.equal(element, region); return computed; };
  let renderer, mounted = true;
  await act(async () => { renderer = create(h(SpreadsheetFloatingWindow, { title: '検索', frameRef, onClose() { closeCount++; },
    children: h('input'), actions: h('button', null, '検索') }), { createNodeMock(element) {
    if (element.type === 'span') return { closest() { return region; } };
    if (element.props.role === 'dialog') return panel;
    return null;
  } }); });
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { doc, view, region, frameRef, input, renderer, unmount,
    get dialog() { return renderer.root.findByProps({ role: 'dialog' }); },
    get closed() { return closeCount; }, get restored() { return restored; }, get focused() { return focused; },
    get observersDisconnected() { return [...resizeObservers, ...mutationObservers].every(observer => observer.disconnected); },
    get themeObservedElements() { return mutationObservers.flatMap(observer => observer.observed); },
    async updateTheme(patch, colorMode) {
      Object.assign(variables, patch); attributes['data-color-mode'] = colorMode;
      computed.colorScheme = colorMode;
      await act(async () => { for (const observer of mutationObservers) observer.callback([{ target: doc.body, type: 'attributes', attributeName: 'class' }]); });
    },
    async resize(width, height) { doc.documentElement.clientWidth = width; doc.documentElement.clientHeight = height; await act(async () => view.fire('resize')); },
    async resizeRegion(width, height) {
      region.clientWidth = width; region.clientHeight = height;
      await act(async () => { for (const observer of resizeObservers) if (observer.observed.includes(region)) observer.callback(); });
    },
    async begin(edge) {
      const capture = target(); let captured;
      capture.setPointerCapture = id => { captured = id; }; capture.hasPointerCapture = id => id === captured;
      capture.releasePointerCapture = () => { captured = undefined; };
      const node = edge ? renderer.root.findByProps({ className: `lxs-floating-window-resize lxs-floating-window-resize-${edge}` }) : renderer.root.findByProps({ className: 'lxs-form-dialog-heading lxs-floating-window-heading' });
      await act(async () => node.props.onPointerDown({ button: 0, pointerId: 7, clientX: 100, clientY: 100, currentTarget: capture,
        target: { closest() { return null; } }, preventDefault() {}, stopPropagation() {} }));
      return capture;
    },
    async move(x, y, pointerId = 7) { await act(async () => doc.fire('pointermove', { pointerId, clientX: x, clientY: y, preventDefault() {} })); },
  };
}

test('floating window bounds and all resize edges preserve minimum dimensions and remain inside a small viewport', () => {
  const size = { width: 900, height: 700 }, start = { x: 150, y: 100, width: 400, height: 350 };
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const delta of [-5000, 5000]) {
      const next = resize(start, edge, delta, delta, size);
      assert.ok(next.x >= 8 && next.y >= 8); assert.ok(next.x + next.width <= 892 && next.y + next.height <= 692);
      assert.ok(next.width >= 340 && next.height >= 220);
    }
  }
  assert.deepEqual(resize(start, 'nw', 20, 30, size), { x: 170, y: 130, width: 380, height: 320 });
  assert.deepEqual(fit(start, { width: 250, height: 180 }), { x: 8, y: 8, width: 234, height: 164 });
  assert.deepEqual(fit(start, { width: 20, height: 20 }), { x: 0, y: 0, width: 20, height: 20 });
});

test('modeless window has no backdrop or Tab trap and isolates clipboard and input shortcuts', async t => {
  const app = await mount(t), dialog = app.dialog;
  assert.equal(app.renderer.root.findByType('portal-root').props.target, app.doc.body);
  assert.equal(dialog.props['aria-modal'], 'false'); assert.equal(app.focused, 1);
  assert.equal(app.renderer.root.findAll(node => node.props.className?.includes('backdrop')).length, 0);
  const key = extra => { const event = { key: 'Tab', nativeEvent: {}, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; dialog.props.onKeyDown(event); return event; };
  assert.equal(key().prevented, undefined); assert.equal(key().stopped, true);
  assert.equal(key({ key: 's', ctrlKey: true }).prevented, true);
  key({ key: 'Escape', nativeEvent: { isComposing: true } }); assert.equal(app.closed, 0);
  key({ key: 'Escape', keyCode: 229 }); assert.equal(app.closed, 0);
  assert.equal(key({ key: 'Escape' }).prevented, true); assert.equal(app.closed, 1);
  for (const handler of ['onCopy', 'onCut', 'onPaste', 'onContextMenu', 'onPointerDown']) {
    let stopped = false; dialog.props[handler]({ stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
  }
});

test('the initial window position follows the spreadsheet screen bounds and is only constrained by the viewport', async t => {
  const app = await mount(t);
  assert.deepEqual(app.frameRef.current, { x: 90, y: 8, width: 560, height: 520 });
  assert.ok(app.frameRef.current.width > app.region.clientWidth);
  assert.ok(app.frameRef.current.height > app.region.clientHeight);
});

test('focus returns on internal close but external close leaves the active sheet or host control alone', async t => {
  const inside = await mount(t); await inside.unmount(); assert.equal(inside.restored, 1);
  const outside = await mount(t); outside.doc.activeElement = { inside: false }; await outside.unmount(); assert.equal(outside.restored, 0);
});

test('drag and resize use viewport coordinates beyond the transformed parent and clean up owner-document listeners', async t => {
  const app = await mount(t, { frameRef: { current: { x: 100, y: 100, width: 400, height: 300 } } }), start = { ...app.frameRef.current };
  const capture = await app.begin(); await app.move(300, 200, 99); assert.deepEqual(app.frameRef.current, start);
  await app.move(700, 400); assert.deepEqual(app.frameRef.current, { ...start, x: 700, y: 400 });
  assert.ok(app.frameRef.current.x > app.region.getBoundingClientRect().right, 'the whole window can leave the embedded spreadsheet');
  app.doc.fire('pointercancel', { pointerId: 7 }); assert.equal(app.doc.count('pointermove'), 0); assert.equal(capture.hasPointerCapture(7), false);
  const moved = { ...app.frameRef.current }; await app.begin('se'); await app.move(150, 150);
  assert.equal(app.frameRef.current.width, moved.width + 50); assert.equal(app.frameRef.current.height, moved.height + 50);
  app.view.fire('blur'); assert.equal(app.doc.count('pointermove'), 0);
  await app.begin(); await app.move(5000, 5000);
  assert.equal(app.frameRef.current.x + app.frameRef.current.width, 1192); assert.equal(app.frameRef.current.y + app.frameRef.current.height, 892);
  await app.unmount(); assert.equal(app.doc.count('pointermove'), 0); assert.equal(app.doc.count('pointerup'), 0);
  assert.equal(app.view.count('resize'), 0); assert.equal(app.observersDisconnected, true);
});

test('parent resizing does not move the window; viewport resize constrains it and frameRef survives remount', async t => {
  const frameRef = { current: { x: 300, y: 200, width: 620, height: 560 } }, first = await mount(t, { frameRef });
  assert.deepEqual(frameRef.current, { x: 300, y: 200, width: 620, height: 560 });
  await first.resizeRegion(280, 260); assert.deepEqual(frameRef.current, { x: 300, y: 200, width: 620, height: 560 });
  await first.begin(); await first.resize(300, 200); assert.equal(first.doc.count('pointermove'), 0);
  assert.deepEqual(frameRef.current, { x: 8, y: 8, width: 284, height: 184 });
  await first.unmount(); const retained = { ...frameRef.current }; await mount(t, { frameRef });
  // A larger viewport restores the normal minimum size without forgetting the retained position.
  assert.deepEqual(frameRef.current, { ...retained, width: 340, height: 220 });
});

test('viewport dimensions fall back to the owning window when documentElement has no layout size', async t => {
  const app = await mount(t, { viewport: { width: 0, height: 0 }, frameRef: { current: { x: 900, y: 600, width: 560, height: 520 } } });
  assert.deepEqual(app.frameRef.current, { x: 632, y: 372, width: 560, height: 520 });
});

test('body portals retain instance theme and typography, synchronize ancestor changes and disconnect on unmount', async t => {
  const app = await mount(t, { variables: { '--lxs-accent': '  #cc6633  ' } });
  const layer = () => app.renderer.root.findByProps({ className: 'lxs-root lxs-floating-layer' });
  assert.equal(layer().props.style['--lxs-accent'], '#cc6633');
  assert.equal(layer().props.style.font, '13px TestFont'); assert.equal(layer().props.style.color, 'rgb(10, 20, 30)');
  assert.equal(layer().props.style.direction, 'ltr'); assert.equal(layer().props.style.letterSpacing, 'normal');
  assert.equal(layer().props['data-color-mode'], 'light');
  assert.deepEqual(app.themeObservedElements, [app.region, app.doc.body, app.doc.documentElement]);
  await app.updateTheme({ '--lxs-accent': '#99aaff', '--lxs-background': '#101820' }, 'dark');
  assert.equal(layer().props['data-color-mode'], 'dark'); assert.equal(layer().props.style.colorScheme, 'dark');
  assert.equal(layer().props.style['--lxs-accent'], '#99aaff'); assert.equal(layer().props.style['--lxs-background'], '#101820');
  assert.equal(app.focused, 1, 'theme updates do not refocus search or steal focus');
  const other = await mount(t);
  assert.equal(other.renderer.root.findByProps({ className: 'lxs-root lxs-floating-layer' }).props.style['--lxs-accent'], '#217346');
  await app.unmount(); assert.equal(app.observersDisconnected, true); assert.equal(app.view.count('resize'), 0);
});
