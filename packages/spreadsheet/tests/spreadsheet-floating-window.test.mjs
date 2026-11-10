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
  const listeners = new Map(), capture = new Map();
  return { addEventListener(type, callback, options) { const callbacks = listeners.get(type) ?? new Set(); callbacks.add(callback); listeners.set(type, callbacks); capture.set(callback, options === true || options?.capture === true); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); capture.delete(callback); },
    fire(type, event = {}) { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); },
    count(type) { return listeners.get(type)?.size ?? 0; },
    captures(type) { return [...(listeners.get(type) ?? [])].map(callback => capture.get(callback)); } };
}

function dialogTarget(parentElement, ariaModal = null) {
  return { parentElement, getAttribute(name) { return name === 'aria-modal' ? ariaModal : null; } };
}

async function mount(t, options = {}) {
  const doc = target(), view = target(), frameRef = options.frameRef ?? { current: null };
  const resizeObservers = [], mutationObservers = [];
  let closeCount = 0, restored = 0, focused = 0, hidden = false, shown = 0, dismissed = 0, open = false;
  view.ResizeObserver = class { constructor(callback) { this.callback = callback; this.observed = []; resizeObservers.push(this); } observe(element) { this.observed.push(element); } disconnect() { this.disconnected = true; } };
  view.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.observed = []; this.active = new Map(); mutationObservers.push(this); }
    observe(element, options) { this.disconnected = false; this.observed.push(element); this.active.set(element, options); }
    disconnect() { this.disconnected = true; this.active.clear(); }
  };
  doc.documentElement = { clientWidth: options.viewport?.width ?? 1200, clientHeight: options.viewport?.height ?? 900 };
  doc.body = { parentElement: doc.documentElement, closest() { return null; } };
  const ownerDialog = options.dialog ? dialogTarget(doc.body, 'true') : null;
  view.innerWidth = 1200; view.innerHeight = 900;
  doc.defaultView = view;
  const previous = { isConnected: true, closest() { return ownerDialog; }, focus() { restored++; doc.activeElement = previous; } };
  const input = { inside: true, closest() { return panel; }, focus() { focused++; doc.activeElement = input; } };
  doc.activeElement = previous;
  const panel = { ownerDocument: doc, inside: true, closest() { return panel; }, querySelector() { return input; }, contains(element) { return !!element?.inside; }, focus() { doc.activeElement = panel; } };
  const attributes = { 'data-color-mode': options.colorMode ?? 'light' };
  const variables = { '--lxs-accent': '#217346', '--lxs-background': '#ffffff', ...options.variables };
  const computed = { getPropertyValue(name) { return variables[name] ?? ''; }, font: '13px TestFont', color: 'rgb(10, 20, 30)', colorScheme: 'light', direction: 'ltr', letterSpacing: 'normal' };
  const region = { ownerDocument: doc, clientWidth: options.region?.width ?? 500, clientHeight: options.region?.height ?? 360,
    offsetWidth: 250, offsetHeight: 180, parentElement: ownerDialog ?? doc.body,
    closest(selector) {
      if (selector === 'dialog, [role="dialog"], [role="alertdialog"]') return ownerDialog;
      assert.equal(selector, '[inert], [aria-hidden="true"], [hidden], dialog:not([open])');
      return hidden ? ownerDialog : null;
    },
    ...(options.popover === false ? {} : { showPopover() {} }),
    getAttribute(name) { return attributes[name] ?? null; },
    getBoundingClientRect() { const scale = options.scale ?? 1; return { left: 120, top: 60, width: this.clientWidth * scale, height: this.clientHeight * scale,
      right: 120 + this.clientWidth * scale, bottom: 60 + this.clientHeight * scale }; } };
  const layer = { contains(element) { return !!element?.inside; }, matches(selector) { assert.equal(selector, ':popover-open'); return open; },
    showPopover() { shown++; if (options.popoverThrows) throw new Error('Popover unavailable'); open = true; },
    hidePopover() { dismissed++; open = false; } };
  view.getComputedStyle = element => { assert.equal(element, region); return computed; };
  let renderer, mounted = true;
  await act(async () => { renderer = create(h(SpreadsheetFloatingWindow, { title: '検索', frameRef, onClose() { closeCount++; },
    children: h('input'), actions: h('button', null, '検索') }), { createNodeMock(element) {
    if (element.type === 'span') return { closest() { return region; } };
    if (element.props.role === 'dialog') return panel;
    if (element.props.className === 'lxs-root lxs-floating-layer') return layer;
    return null;
  } }); });
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } };
  const mutate = (target, type, attributeName) => {
    for (const observer of mutationObservers) {
      const options = observer.active.get(target);
      if (options?.[type] && (!attributeName || !options.attributeFilter || options.attributeFilter.includes(attributeName)))
        observer.callback([{ target, type, attributeName }]);
    }
  };
  t.after(unmount);
  return { doc, view, region, ownerDialog, frameRef, input, renderer, unmount,
    get dialog() { return renderer.root.findByProps({ role: 'dialog' }); },
    get layer() { return renderer.root.findByProps({ className: 'lxs-root lxs-floating-layer' }); },
    get portal() { return renderer.root.findByType('portal-root').props.target; },
    get popover() { return { open, shown, dismissed }; },
    get closed() { return closeCount; }, get restored() { return restored; }, get focused() { return focused; },
    get observersDisconnected() { return [...resizeObservers, ...mutationObservers].every(observer => observer.disconnected); },
    get themeObservedElements() { return mutationObservers.flatMap(observer => observer.observed); },
    get foregroundObservedElements() { return mutationObservers.flatMap(observer => [...observer.active].filter(([, options]) => options.childList).map(([element]) => element)); },
    get foregroundObservedOptions() { return mutationObservers.flatMap(observer => [...observer.active.values()].filter(options => options.childList)); },
    async updateTheme(patch, colorMode) {
      Object.assign(variables, patch); attributes['data-color-mode'] = colorMode;
      computed.colorScheme = colorMode;
      await act(async () => mutate(doc.body, 'attributes', 'class'));
    },
    async resize(width, height) { doc.documentElement.clientWidth = width; doc.documentElement.clientHeight = height; await act(async () => view.fire('resize')); },
    async setHidden(next) { hidden = next; await act(async () => mutate(region, 'attributes', 'hidden')); },
    async focusDialog(dialog) { await act(async () => { doc.activeElement = { closest() { return dialog; } }; doc.fire('focusin', { target: doc.activeElement }); }); },
    async removeDialog(dialog) { const parent = dialog.parentElement; dialog.parentElement = null; doc.activeElement = doc.body; await act(async () => mutate(parent, 'childList')); },
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
  assert.equal(key().prevented, undefined); assert.equal(key().stopped, undefined, 'Tab reaches the enclosing dialog focus scope');
  assert.equal(key({ shiftKey: true }).stopped, undefined, 'Shift+Tab reaches the enclosing dialog focus scope');
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

test('dialog embedding keeps the search in its owning focus scope while using viewport geometry', async t => {
  const app = await mount(t, { dialog: true });
  assert.equal(app.portal, app.ownerDialog, 'the input must remain inside the parent dialog DOM');
  assert.equal(app.layer.props.popover, 'manual');
  assert.equal(app.layer.props['data-contained'], undefined);
  assert.deepEqual(app.popover, { open: true, shown: 1, dismissed: 0 });
  assert.equal(app.doc.activeElement, app.input);
  assert.deepEqual(app.frameRef.current, { x: 90, y: 8, width: 560, height: 520 });
  await app.begin(); await app.move(700, 400);
  assert.ok(app.frameRef.current.x > app.region.getBoundingClientRect().right, 'top-layer search can move beyond the embedding sheet');
  await app.unmount();
  assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
  assert.equal(app.view.count('keydown'), 0); assert.equal(app.observersDisconnected, true);
});

test('a newer modal hides the top-layer search, and releasing the modal restores it without stealing focus', async t => {
  const app = await mount(t, { dialog: true }), focusCount = app.focused;
  const frame = { ...app.frameRef.current };
  await app.setHidden(true);
  assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
  await app.setHidden(true);
  assert.equal(app.popover.dismissed, 1, 'repeated attribute notifications do not hide a closed popover');
  await app.setHidden(false);
  assert.deepEqual(app.popover, { open: true, shown: 2, dismissed: 1 });
  assert.equal(app.focused, focusCount);
  assert.deepEqual(app.frameRef.current, frame);
  await app.unmount();
  assert.deepEqual(app.popover, { open: false, shown: 2, dismissed: 2 });
  await app.setHidden(false);
  assert.equal(app.popover.shown, 2, 'unmounted observers cannot reopen search');
});

test('focus moving to another dialog hides search even when the owner itself has no aria-hidden attribute', async t => {
  const app = await mount(t, { dialog: true }), focusCount = app.focused;
  assert.equal(app.doc.count('focusin'), 1);
  await app.focusDialog(dialogTarget(app.doc.body));
  assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
  assert.equal(app.focused, focusCount, 'search never steals focus from the new dialog');
  await app.focusDialog(app.ownerDialog);
  assert.deepEqual(app.popover, { open: true, shown: 2, dismissed: 1 });
  await act(async () => { app.doc.activeElement = app.input; app.doc.fire('focusin', { target: app.input }); });
  assert.equal(app.popover.open, true, 'the search dialog itself remains usable');
  await app.focusDialog({ inside: true });
  assert.equal(app.popover.open, true, 'a custom dialog inside search remains part of its own layer');
  await app.focusDialog(null);
  assert.equal(app.popover.open, true, 'ordinary controls outside a dialog do not suspend the search');
  await app.unmount();
  assert.equal(app.doc.count('focusin'), 0);
});

test('removing the foreground dialog restores search without relying on another focus event', async t => {
  const app = await mount(t, { dialog: true }), focusCount = app.focused;
  const foregroundParent = { parentElement: app.doc.body }, foreground = dialogTarget(foregroundParent);
  assert.deepEqual(app.foregroundObservedElements, []);
  await app.focusDialog(foreground);
  assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
  assert.deepEqual(app.foregroundObservedElements, [foregroundParent, app.doc.body, app.doc.documentElement]);
  assert.ok(app.foregroundObservedOptions.every(options => options.childList === true && !options.subtree), 'ancestor observation never scans the entire document subtree');
  await app.removeDialog(foreground);
  assert.equal(app.doc.activeElement, app.doc.body, 'DOM removal can leave focus on body without focusin');
  assert.deepEqual(app.popover, { open: true, shown: 2, dismissed: 1 });
  assert.equal(app.focused, focusCount, 'restoring the window does not move keyboard focus');
  assert.deepEqual(app.foregroundObservedElements, [], 'foreground child-list observation ends when the dialog is gone');
  await app.unmount();
  assert.equal(app.observersDisconnected, true);
});

test('other modeless dialogs coexist with search instead of being treated as a foreground modal', async t => {
  const app = await mount(t, { dialog: true }), focusCount = app.focused;
  const modeless = dialogTarget(app.ownerDialog, 'false');
  await app.focusDialog(modeless);
  assert.deepEqual(app.popover, { open: true, shown: 1, dismissed: 0 });
  assert.deepEqual(app.foregroundObservedElements, [], 'a modeless window needs no suspension observer');
  await app.focusDialog(dialogTarget(app.doc.body, 'true'));
  assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
  await app.focusDialog(modeless);
  assert.deepEqual(app.popover, { open: true, shown: 2, dismissed: 1 });
  assert.deepEqual(app.foregroundObservedElements, [], 'leaving a modal also releases its observers');
  assert.equal(app.focused, focusCount, 'coexistence never steals focus from the other window');
});

test('removing a foreground portal wrapper restores search without a focus event', async t => {
  for (const removedLevel of ['inner', 'outer']) {
    const app = await mount(t, { dialog: true }), focusCount = app.focused;
    const outer = { parentElement: app.doc.body }, inner = { parentElement: outer };
    const foreground = dialogTarget(inner, 'true');
    await app.focusDialog(foreground);
    assert.deepEqual(app.popover, { open: false, shown: 1, dismissed: 1 });
    assert.deepEqual(app.foregroundObservedElements, [inner, outer, app.doc.body, app.doc.documentElement]);
    assert.ok(app.foregroundObservedOptions.every(options => options.childList === true && !options.subtree));
    await app.removeDialog(removedLevel === 'inner' ? inner : outer);
    assert.equal(app.doc.activeElement, app.doc.body);
    assert.deepEqual(app.popover, { open: true, shown: 2, dismissed: 1 });
    assert.equal(app.focused, focusCount);
    assert.deepEqual(app.foregroundObservedElements, []);
    await app.unmount();
    assert.equal(app.observersDisconnected, true);
  }
});

test('unsupported or rejected popovers fall back inside the sheet, keeping search reachable in a dialog', async t => {
  for (const capability of [{ popover: false }, { popoverThrows: true }]) {
    const app = await mount(t, { dialog: true, ...capability });
    assert.equal(app.portal, app.region);
    assert.equal(app.layer.props.popover, undefined);
    assert.equal(app.layer.props['data-contained'], true);
    assert.equal(app.popover.open, false);
    assert.equal(app.doc.activeElement, app.input);
    assert.deepEqual(app.frameRef.current, { x: 8, y: 8, width: 484, height: 344 });
    await app.resizeRegion(280, 180);
    assert.deepEqual(app.frameRef.current, { x: 8, y: 8, width: 264, height: 164 });
    await app.unmount();
    assert.equal(app.observersDisconnected, true);
  }
});

test('contained fallback compensates scaled parent coordinates during drag and resize', async t => {
  const app = await mount(t, { dialog: true, popover: false, scale: 2, region: { width: 1000, height: 800 },
    frameRef: { current: { x: 100, y: 100, width: 400, height: 300 } } });
  await app.begin(); await app.move(300, 200);
  assert.deepEqual(app.frameRef.current, { x: 200, y: 150, width: 400, height: 300 });
  app.doc.fire('pointerup', { pointerId: 7 });
  await app.begin('se'); await app.move(300, 200);
  assert.deepEqual(app.frameRef.current, { x: 200, y: 150, width: 500, height: 350 });
  await app.resizeRegion(300, 200);
  assert.deepEqual(app.frameRef.current, { x: 8, y: 8, width: 284, height: 184 });
  assert.equal(app.doc.count('pointermove'), 0, 'resizing the containing sheet ends an in-progress drag');
});

test('Escape is consumed before parent document capture, scoped to search, and respects composition', async t => {
  const app = await mount(t, { dialog: true });
  assert.deepEqual(app.view.captures('keydown'), [true]);
  let parentDismissed = 0;
  app.doc.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) parentDismissed++; }, true);
  const dispatch = async overrides => {
    const event = { key: 'Escape', target: app.input, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
    await act(async () => { app.view.fire('keydown', event); if (!event.stopped) app.doc.fire('keydown', event); });
    return event;
  };
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = await dispatch(composition);
    assert.equal(event.stopped, true); assert.equal(event.defaultPrevented, false);
    assert.equal(app.closed, 0); assert.equal(parentDismissed, 0);
  }
  await dispatch({ defaultPrevented: true }); assert.equal(app.closed, 0);
  await dispatch({ key: 'Tab' }); assert.equal(app.closed, 0);
  await app.begin();
  const escape = await dispatch();
  assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
  assert.equal(app.closed, 1); assert.equal(parentDismissed, 0);
  assert.equal(app.doc.count('pointermove'), 0);
  await dispatch({ target: { inside: false } });
  assert.equal(app.closed, 1); assert.equal(parentDismissed, 1, 'unrelated host controls retain their own Escape behavior');
  await app.unmount(); assert.equal(app.view.count('keydown'), 0);
});
