import test from 'node:test';
import assert from 'node:assert/strict';
import { openContextMenu } from '../src/browser/context-menu.ts';

class Events {
  listeners = new Map();
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  dispatch(name, values = {}) {
    const event = { target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event);
    return event;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0); }
}

class Element extends Events {
  children = []; parent = null; style = {}; dataset = {}; attributes = new Map(); disabled = false; ownText = '';
  constructor(doc, tag) { super(); this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.tabIndex = tag === 'button' || tag === 'input' ? 0 : -1; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parent?.isConnected; }
  set textContent(value) { this.ownText = value; this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest() { return this.hasAttribute('data-color-mode') || this.hasAttribute('data-theme') ? this : this.parent?.closest() ?? null; }
  focus(options) {
    if (this.throwOnFocus) throw new Error('focus failed');
    if (!this.isConnected || this.disabled || this.tabIndex < 0 && !this.hasAttribute('tabindex') && this.getAttribute('role') !== 'menu' && this.tagName !== 'BUTTON') return;
    this.ownerDocument.activeElement?.dispatch('blur'); this.ownerDocument.activeElement = this; this.focusOptions = options; this.dispatch('focus');
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  scrollIntoView() { this.ownerDocument.dispatch('scroll', { target: this.parent }); }
  getBoundingClientRect() {
    if (this.bounds) return this.bounds;
    const width = Math.min(280, Number.parseFloat(this.style.maxWidth) || 280), height = Math.min(this.children.length * 34 + 10, Number.parseFloat(this.style.maxHeight) || 400);
    return { left: Number.parseFloat(this.style.left) || 0, top: Number.parseFloat(this.style.top) || 0, width, height, right: width, bottom: height };
  }
}

function environment({ width = 600, height = 400, color = 'rgb(20, 30, 40)', mode, visual } = {}) {
  const doc = new Events(), win = new Events(), observers = new Set();
  doc.body = new Element(doc, 'body'); doc.activeElement = doc.body; doc.defaultView = win;
  doc.createElement = tag => new Element(doc, tag);
  Object.assign(win, { innerWidth: width, innerHeight: height, getComputedStyle: () => ({ color, colorScheme: 'normal' }) });
  if (visual) win.visualViewport = Object.assign(new Events(), visual);
  win.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  const root = doc.createElement('section'), anchor = doc.createElement('article'), previous = doc.createElement('input');
  if (mode) root.setAttribute('data-color-mode', mode);
  anchor.bounds = { left: 40, top: 40, right: 160, bottom: 80, width: 120, height: 40 };
  root.append(anchor, previous); doc.body.append(root);
  const current = () => doc.body.children.find(child => child.getAttribute('role') === 'menu');
  return { doc, win, root, anchor, previous, observers, current,
    buttons: () => current()?.children.filter(child => child.tagName === 'BUTTON') ?? [],
    key: key => doc.dispatch('keydown', { key, target: doc.activeElement }),
    mutations: () => { for (const observer of [...observers]) observer.callback(); },
    cleanup: () => { assert.equal(current(), undefined); assert.equal(doc.listenerCount, 0); assert.equal(win.listenerCount, 0); assert.equal(win.visualViewport?.listenerCount ?? 0, 0); assert.equal(observers.size, 0); },
  };
}
const actions = () => [{ id: 'a', label: 'Alpha', onSelect() {} }, { id: 'disabled', label: 'Blocked', disabled: true, onSelect() { throw new Error('Disabled action ran'); } }, { id: 'c', label: 'Charlie', onSelect() {} }];
const flush = () => new Promise(resolve => setImmediate(resolve));

test('menus use the anchor document, skip disabled actions, and support keyboard activation and focus restoration', () => {
  const env = environment(); env.previous.focus(); let selected = 0;
  const items = actions(); items[2].onSelect = () => selected++;
  openContextMenu({ anchor: env.anchor, items }); const buttons = env.buttons();
  assert.equal(env.doc.activeElement, buttons[0]); assert.equal(env.current().getAttribute('aria-label'), '操作メニュー');
  env.key('ArrowDown'); assert.equal(env.doc.activeElement, buttons[2]);
  env.key('ArrowDown'); assert.equal(env.doc.activeElement, buttons[0]);
  env.key('ArrowUp'); assert.equal(env.doc.activeElement, buttons[2]);
  env.key('Home'); assert.equal(env.doc.activeElement, buttons[0]); env.key('End'); assert.equal(env.doc.activeElement, buttons[2]);
  assert.equal(env.key('Enter').defaultPrevented, true); assert.equal(selected, 1); assert.equal(env.doc.activeElement, env.previous);
  assert.deepEqual(env.previous.focusOptions, { preventScroll: true }); env.cleanup();
});

test('disabled actions cannot run, including programmatic clicks; all-disabled menus consume navigation', () => {
  const env = environment(); let calls = 0;
  openContextMenu({ anchor: env.anchor, items: [{ id: 'blocked', label: 'Blocked', disabled: true, onSelect: () => calls++ }] });
  env.buttons()[0].dispatch('click'); assert.equal(calls, 0); assert.equal(env.doc.activeElement, env.current());
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ']) { const event = env.key(key); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); }
  env.key('Escape'); assert.equal(calls, 0); assert.equal(env.doc.activeElement, env.anchor); assert.equal(env.anchor.hasAttribute('tabindex'), false); env.cleanup();
});

test('ArrowUp from the menu focuses its last action and repeated typeahead cycles matching labels', () => {
  const env = environment();
  const close = openContextMenu({ anchor: env.anchor, items: [{ id: 'copy', label: 'Copy', onSelect() {} }, { id: 'cut', label: 'Cut', onSelect() {} }, { id: 'delete', label: 'Delete', onSelect() {} }] });
  env.current().focus(); env.key('ArrowUp'); assert.equal(env.doc.activeElement.dataset.menuId, 'delete');
  env.key('c'); assert.equal(env.doc.activeElement.dataset.menuId, 'copy'); env.key('c'); assert.equal(env.doc.activeElement.dataset.menuId, 'cut');
  assert.equal(env.key('Tab').defaultPrevented, false); env.cleanup(); close(); env.cleanup();
});

test('scrolling inside the menu preserves it, while outside scroll, resize, blur, and pointer actions clean up', () => {
  for (const dismiss of ['scroll', 'resize', 'blur', 'pointerdown', 'contextmenu']) {
    const env = environment(); let closed = 0;
    openContextMenu({ anchor: env.anchor, items: actions(), onClose: () => closed++ });
    env.doc.dispatch('scroll', { target: env.current() }); env.doc.dispatch('scroll', { target: env.buttons()[0] });
    env.doc.dispatch('pointerdown', { target: env.buttons()[0] }); assert.ok(env.current());
    if (dismiss === 'resize' || dismiss === 'blur') env.win.dispatch(dismiss); else env.doc.dispatch(dismiss, { target: env.anchor });
    assert.equal(closed, 1); env.cleanup();
  }
});

test('removing an anchor or disposing a menu cleans listeners once and prevents retained actions', () => {
  for (const method of ['removed', 'menu-removed', 'dispose']) {
    const env = environment(); let calls = 0, closed = 0;
    const dispose = openContextMenu({ anchor: env.anchor, items: [{ id: 'run', label: 'Run', onSelect: () => calls++ }], onClose: () => closed++ });
    const button = env.buttons()[0];
    if (method === 'removed') { env.anchor.remove(); env.mutations(); } else if (method === 'menu-removed') { env.current().remove(); env.mutations(); } else dispose();
    button.dispatch('click'); dispose(); assert.equal(calls, 0); assert.equal(closed, 1); env.cleanup();
  }
  const env = environment(); let calls = 0;
  openContextMenu({ anchor: env.anchor, items: [{ id: 'run', label: 'Run', onSelect: () => calls++ }] });
  const button = env.buttons()[0]; env.anchor.remove(); button.dispatch('click'); assert.equal(calls, 0); env.cleanup();
});

test('there is at most one menu per document, while independent documents keep independent menus', () => {
  const first = environment(), second = environment(); let closed = 0;
  const disposeOld = openContextMenu({ anchor: first.anchor, items: actions(), onClose: () => closed++ });
  const old = first.current(); const disposeNew = openContextMenu({ anchor: first.anchor, items: actions() });
  assert.notEqual(first.current(), old); assert.equal(old.isConnected, false); assert.equal(closed, 1); disposeOld(); assert.ok(first.current());
  const disposeSecond = openContextMenu({ anchor: second.anchor, items: actions() });
  disposeNew(); first.cleanup(); assert.ok(second.current()); disposeSecond(); second.cleanup();
});

test('small and visual viewports clamp dimensions and position; keyboard and invalid coordinates use the anchor', () => {
  const env = environment({ width: 180, height: 140 });
  const close = openContextMenu({ anchor: env.anchor, x: 900, y: 700, items: actions() });
  assert.equal(env.current().style.minWidth, '164px'); assert.equal(env.current().style.maxWidth, '164px');
  assert.equal(env.current().style.left, '8px'); assert.equal(env.current().style.top, '20px'); close();
  openContextMenu({ anchor: env.anchor, x: 0, y: 0, items: [actions()[0]] }); assert.equal(env.current().style.top, '80px'); env.key('Escape');
  openContextMenu({ anchor: env.anchor, x: NaN, y: 100, items: [actions()[0]] }); assert.equal(env.current().style.left.includes('NaN'), false); env.key('Escape'); env.cleanup();
  const visual = environment({ visual: { width: 160, height: 120, offsetLeft: 30, offsetTop: 50 } });
  openContextMenu({ anchor: visual.anchor, x: 900, y: 900, items: actions() });
  assert.equal(visual.current().style.left, '38px'); assert.equal(visual.current().style.top, '58px');
  visual.win.visualViewport.dispatch('scroll'); visual.cleanup();
});

test('explicit dark/light themes and modern computed colors select a readable menu palette', () => {
  for (const [options, expected] of [[{ mode: 'dark', color: 'rgb(0, 0, 0)' }, 'dark'], [{ mode: 'light', color: 'rgb(255, 255, 255)' }, 'light'], [{ color: 'color(srgb 0.95 0.95 0.95)' }, 'dark'], [{ color: 'rgb(90% 90% 90%)' }, 'dark']]) {
    const env = environment(options); const close = openContextMenu({ anchor: env.anchor, items: actions() });
    assert.equal(env.current().style.colorScheme, expected); close(); env.cleanup();
  }
});

test('close, focus, action and error-observer exceptions cannot prevent cleanup or become unhandled rejections', async () => {
  for (const asyncAction of [false, true]) {
    const env = environment(); let ran = 0; const errors = [];
    env.previous.focus(); env.previous.throwOnFocus = true;
    openContextMenu({ anchor: env.anchor, items: [{ id: 'run', label: 'Run', onSelect: () => { ran++; if (asyncAction) return Promise.reject(new Error('action failed')); throw new Error('action failed'); } }], onClose: () => { throw new Error('close failed'); }, onError: error => { errors.push(error.message); throw new Error('observer failed'); } });
    env.buttons()[0].click(); await flush(); assert.equal(ran, 1); assert.deepEqual(errors, ['focus failed', 'close failed', 'action failed']); env.cleanup();
  }
});

test('empty, detached, or windowless anchors do not create a menu or listeners', () => {
  const env = environment(); openContextMenu({ anchor: env.anchor, items: [] }); env.cleanup();
  env.anchor.remove(); openContextMenu({ anchor: env.anchor, items: actions() }); env.cleanup();
  env.root.append(env.anchor); env.doc.defaultView = null; openContextMenu({ anchor: env.anchor, items: actions() }); env.cleanup();
});

test('rejected asynchronous close and error observers are observed without blocking the selected action', async () => {
  const env = environment(); let ran = 0; const errors = [];
  openContextMenu({ anchor: env.anchor, items: [{ id: 'run', label: 'Run', onSelect: () => { ran++; } }], onClose: async () => { throw new Error('async close'); }, onError: async error => { errors.push(error.message); throw new Error('async observer'); } });
  env.buttons()[0].click(); await flush(); assert.equal(ran, 1); assert.deepEqual(errors, ['async close']); env.cleanup();
});
