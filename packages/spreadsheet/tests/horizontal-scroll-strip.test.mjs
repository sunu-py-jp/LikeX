import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: {
  contents: 'export * from "./src/ui/horizontal-scroll"; export * from "./src/ui/horizontal-scroll-strip";',
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { HorizontalScrollStrip, horizontalScrollState, horizontalScrollTarget } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const metrics = (scrollLeft = 0, scrollWidth = 900, clientWidth = 300) => ({ scrollLeft, scrollWidth, clientWidth });

test('overflow controls follow both scroll boundaries, tolerate rounding, and release reserved arrow width', () => {
  assert.deepEqual(horizontalScrollState(metrics(0, 300)), { overflow: false, previous: false, next: false });
  assert.deepEqual(horizontalScrollState(metrics(0, 300.5)), { overflow: false, previous: false, next: false });
  assert.deepEqual(horizontalScrollState(metrics(0)), { overflow: true, previous: false, next: true });
  assert.deepEqual(horizontalScrollState(metrics(300)), { overflow: true, previous: true, next: true });
  assert.deepEqual(horizontalScrollState(metrics(600)), { overflow: true, previous: true, next: false });
  assert.deepEqual(horizontalScrollState(metrics(-10)), { overflow: true, previous: false, next: true });
  assert.deepEqual(horizontalScrollState(metrics(605)), { overflow: true, previous: true, next: false });
  assert.deepEqual(horizontalScrollState(metrics(0, 290, 256), 300), { overflow: false, previous: false, next: false });
  assert.deepEqual(horizontalScrollState(metrics(0, 0, 0)), { overflow: false, previous: false, next: false });
});

test('arrow navigation reveals the next clipped item while respecting gaps and content boundaries', () => {
  const items = [{ start: 0, end: 120 }, { start: 150, end: 360 }, { start: 390, end: 580 }];
  assert.equal(horizontalScrollTarget(metrics(0, 580), items, 'next'), 60);
  assert.equal(horizontalScrollTarget(metrics(60, 580), items, 'previous'), 0);
  assert.equal(horizontalScrollTarget(metrics(60, 580), items, 'next'), 280);
  assert.equal(horizontalScrollTarget(metrics(280, 580), items, 'next'), 280);
  assert.equal(horizontalScrollTarget(metrics(0, 580), items, 'previous'), 0);
});

test('oversized items and missing item geometry still allow bounded progress in either direction', () => {
  const items = [{ start: 0, end: 1000 }];
  assert.equal(horizontalScrollTarget(metrics(0, 1000), items, 'next'), 300);
  assert.equal(horizontalScrollTarget(metrics(300, 1000), items, 'next'), 600);
  assert.equal(horizontalScrollTarget(metrics(600, 1000), items, 'next'), 700);
  assert.equal(horizontalScrollTarget(metrics(700, 1000), items, 'previous'), 400);
  for (const direction of ['previous', 'next']) {
    const target = horizontalScrollTarget(metrics(350, 1000), [], direction);
    assert.ok(target >= 0 && target <= 700);
    assert.ok(direction === 'previous' ? target < 350 : target > 350);
  }
});

test('new arrow space affects reveal distance without changing which clipped item is chosen', () => {
  const items = [{ start: 0, end: 180 }, { start: 180, end: 360 }, { start: 360, end: 600 }];
  assert.equal(horizontalScrollTarget(metrics(0, 600, 276), items, 'next', 252), 108);
  assert.equal(horizontalScrollTarget(metrics(108, 600, 252), items, 'next', 276), 324);
});

test('small edge padding does not require an extra click after the first or last item is revealed', () => {
  const items = [{ start: 4, end: 184 }, { start: 184, end: 364 }, { start: 364, end: 600 }];
  assert.equal(horizontalScrollTarget(metrics(112, 604, 252), items, 'next'), 352);
  assert.equal(horizontalScrollTarget(metrics(112, 604, 252), items, 'next', 276), 328);
  assert.equal(horizontalScrollTarget(metrics(112, 604, 252), items, 'previous'), 0);
  assert.equal(horizontalScrollTarget(metrics(112, 612, 252), items, 'next'), 348, 'larger trailing content is not treated as padding');
  assert.equal(horizontalScrollTarget(metrics(0, 1004), [{ start: 0, end: 1000 }], 'next'), 300, 'a wide item still advances one page');
  assert.equal(horizontalScrollTarget(metrics(396, 1000), [{ start: 0, end: 1000 }], 'next'), 696, 'near-end content is not mistaken for trailing padding');
  assert.equal(horizontalScrollTarget(metrics(304, 1000), [{ start: 0, end: 1000 }], 'previous'), 4, 'near-start content is not mistaken for leading padding');
  assert.equal(horizontalScrollTarget(metrics(600, 1004), [{ start: 0, end: 1000 }], 'next'), 704);
});

function eventTarget(extra = {}) {
  const listeners = new Map();
  return { ...extra, listeners,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name, event = {}) { for (const fn of [...(listeners.get(name) ?? [])]) fn(event); },
    listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
}

async function mount(t, { width = 300, contentWidth = 600, reducedMotion = false, props = {} } = {}) {
  let renderer, unmounted = false, frameId = 0;
  const dimensions = { width, contentWidth, scrollLeft: 0, reducedMotion };
  const frames = new Map(), observers = [], scrolls = [], selectedItems = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(target, options) { this.disconnected = false; this.targets.add(target); this.options = options; }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  }
  const view = eventTarget({ ResizeObserver: class extends Observer {}, MutationObserver: class extends Observer {},
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: dimensions.reducedMotion }; },
    getComputedStyle() { return { direction: 'ltr', display: dimensions.width ? 'flex' : 'none' }; },
  });
  let resolveFonts;
  const fonts = eventTarget({ ready: new Promise(resolve => { resolveFonts = resolve; }) });
  const doc = eventTarget({ defaultView: view, fonts });
  const ancestor = { ownerDocument: doc, parentElement: null, getAttribute: () => null };
  doc.documentElement = ancestor;
  const wrapper = { ownerDocument: doc, parentElement: ancestor, getAttribute: () => null,
    get clientWidth() { return dimensions.width; }, getBoundingClientRect: () => ({ left: 10, right: 10 + dimensions.width, width: dimensions.width }) };
  const slots = () => renderer?.root.findAll(node => typeof node.type === 'string' && node.props.className?.split(' ').includes('lxs-horizontal-scroll-slot')) ?? [];
  const reservedWidth = () => slots().reduce((sum, slot) => sum + (slot.props.hidden ? 0 : 24), 0);
  const viewport = eventTarget({ ownerDocument: doc, parentElement: wrapper, clientLeft: 0, isConnected: true,
    getAttribute: () => null, closest: () => ancestor,
    querySelectorAll(selector) { assert.equal(selector, '.item'); return selectedItems; },
    getBoundingClientRect() { return { left: 10, right: 10 + this.clientWidth, width: this.clientWidth, top: 0, bottom: 36, height: 36 }; },
    getClientRects() { return dimensions.width ? [this.getBoundingClientRect()] : []; },
    scrollTo(options) { scrolls.push(options); dimensions.scrollLeft = Math.max(0, Math.min(options.left, this.scrollWidth - this.clientWidth)); },
  });
  // Preserve live layout getters: eventTarget's object spread intentionally copies only ordinary methods.
  Object.defineProperties(viewport, {
    clientWidth: { get: () => Math.max(0, dimensions.width - reservedWidth()) },
    scrollWidth: { get: () => dimensions.width ? Math.max(dimensions.contentWidth, viewport.clientWidth) : 0 },
    scrollLeft: { get: () => Math.max(0, Math.min(dimensions.scrollLeft, viewport.scrollWidth - viewport.clientWidth)), set: value => { dimensions.scrollLeft = value; } },
    children: { get: () => selectedItems },
  });
  const setItems = edges => {
    selectedItems.splice(0, selectedItems.length, ...edges.map(([start, end]) => ({ ownerDocument: doc, parentElement: viewport,
      getBoundingClientRect: () => ({ left: 10 + start - viewport.scrollLeft, right: 10 + end - viewport.scrollLeft, width: end - start }),
      getClientRects: () => dimensions.width ? [{}] : [],
    })));
  };
  setItems([[0, 180], [180, 360], [360, 600]]);
  let supplied = { className: 'test-viewport', role: 'tablist', 'aria-label': 'Test tabs', itemSelector: '.item',
    previousLabel: 'Previous items', nextLabel: 'Next items', wrapperClassName: 'test-wrapper',
    children: createElement('span', { className: 'item' }, 'Tabs'), ...props };
  let slotIndex = 0;
  function node(element) {
    if (element.props.className?.split(' ').includes('lxs-horizontal-scroll-viewport')) return viewport;
    if (element.props.className?.split(' ').includes('lxs-horizontal-scroll-strip')) return wrapper;
    if (element.props.className?.split(' ').includes('lxs-horizontal-scroll-slot')) {
      const index = slotIndex++;
      return { ownerDocument: doc, get offsetWidth() { return slots()[index]?.props.hidden ? 0 : 24; },
        getBoundingClientRect() { return { width: this.offsetWidth }; } };
    }
    return null;
  }
  async function flush() {
    let count = 0;
    while (frames.size && count++ < 20) {
      const batch = [...frames.values()]; frames.clear();
      await act(async () => { for (const callback of batch) callback(); });
    }
    assert.ok(count < 20, 'layout measurements must settle instead of toggling arrow slots forever');
  }
  await act(async () => { renderer = create(createElement(HorizontalScrollStrip, supplied), { createNodeMock: node }); });
  await flush();
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { dimensions, viewport, wrapper, ancestor, doc, view, fonts, observers, frames, scrolls, setItems, flush, unmount,
    async finishFonts() { await act(async () => resolveFonts(fonts)); },
    get root() { return renderer.root; },
    host() { return renderer.root.find(node => typeof node.type === 'string' && node.props.className?.split(' ').includes('lxs-horizontal-scroll-viewport')); },
    arrow(direction) { return renderer.root.findAllByProps({ 'data-lxs-scroll-direction': direction }).find(node => !node.props.hidden); },
    slots,
    async fireScroll() { await act(async () => { viewport.dispatch('scroll', { currentTarget: viewport }); renderer.root.findAll(node => typeof node.type === 'string' && node.props.className?.split(' ').includes('lxs-horizontal-scroll-viewport'))[0]?.props.onScroll?.({ currentTarget: viewport }); }); await flush(); },
    async notify() { await act(async () => { for (const observer of observers) if (!observer.disconnected) observer.callback([
      { type: 'childList', target: viewport }, { type: 'attributes', target: ancestor, attributeName: 'hidden' },
    ]); }); await flush(); },
    async resize() { await act(async () => view.dispatch('resize')); await flush(); },
    async update(patch) { supplied = { ...supplied, ...patch }; await act(async () => renderer.update(createElement(HorizontalScrollStrip, supplied))); await flush(); },
    async click(direction) { await act(async () => this.arrow(direction).props.onClick({ currentTarget: {}, preventDefault() {} })); await this.fireScroll(); },
  };
}

test('the viewport retains consumer semantics and native scroll events update arrow visibility', async t => {
  let delivered = 0;
  const ui = await mount(t, { props: { id: 'tabs', onScroll: () => { delivered++; }, onDragOver: () => 'drag' } });
  assert.equal(ui.host().props.id, 'tabs');
  assert.equal(ui.host().props.role, 'tablist');
  assert.equal(ui.host().props['aria-label'], 'Test tabs');
  assert.equal(ui.host().props.onDragOver(), 'drag');
  assert.match(ui.host().props.className, /test-viewport/);
  assert.equal(ui.arrow('previous'), undefined);
  assert.ok(ui.arrow('next'));
  assert.deepEqual(ui.slots().map(slot => slot.props.hidden), [true, false]);
  assert.equal(ui.viewport.clientWidth, 276, 'only the usable direction consumes width at the start');
  ui.dimensions.scrollLeft = 100;
  await ui.fireScroll();
  assert.equal(delivered, 1);
  assert.ok(ui.arrow('previous'));
  assert.equal(ui.viewport.clientWidth, 252, 'both directions are available in the middle');
  ui.dimensions.scrollLeft = ui.viewport.scrollWidth - ui.viewport.clientWidth;
  await ui.fireScroll();
  assert.equal(ui.arrow('next'), undefined);
  assert.deepEqual(ui.slots().map(slot => slot.props.hidden), [false, true]);
  assert.equal(ui.viewport.clientWidth, 276, 'the unavailable direction leaves no empty gutter at the end');
});

test('clicks reveal clipped items smoothly and reduced motion switches to immediate scrolling', async t => {
  const ui = await mount(t);
  await ui.click('next');
  assert.equal(ui.scrolls.at(-1).behavior, 'smooth');
  assert.equal(ui.scrolls.at(-1).left, 360 - ui.viewport.clientWidth);
  ui.dimensions.reducedMotion = true;
  await ui.click('previous');
  assert.equal(ui.scrolls.at(-1).behavior, 'auto');
  assert.equal(ui.scrolls.at(-1).left, 0);
});

test('successive clicks reach both ends without a remaining clipped item or empty arrow gutter', async t => {
  const ui = await mount(t);
  await ui.click('next');
  assert.equal(ui.viewport.scrollLeft + ui.viewport.clientWidth, 360, 'the first revealed item stays fully visible after the previous arrow appears');
  await ui.click('next');
  assert.equal(ui.arrow('next'), undefined);
  assert.deepEqual(ui.slots().map(slot => slot.props.hidden), [false, true]);
  assert.equal(ui.viewport.scrollLeft + ui.viewport.clientWidth, 600);
  await ui.click('previous');
  assert.ok(ui.arrow('next'));
  assert.equal(ui.viewport.scrollLeft, 180);
  await ui.click('previous');
  assert.equal(ui.viewport.scrollLeft, 0);
  assert.deepEqual(ui.slots().map(slot => slot.props.hidden), [true, false]);
});

test('padded ribbons hide the terminal arrow on the same click that reveals the final group', async t => {
  const ui = await mount(t, { contentWidth: 604 });
  ui.setItems([[4, 184], [184, 364], [364, 600]]);
  await ui.click('next');
  assert.equal(ui.viewport.scrollLeft + ui.viewport.clientWidth, 364);
  await ui.click('next');
  assert.equal(ui.arrow('next'), undefined);
  assert.deepEqual(ui.slots().map(slot => slot.props.hidden), [false, true]);
  assert.equal(ui.viewport.scrollLeft + ui.viewport.clientWidth, 604);
  await ui.click('previous');
  await ui.click('previous');
  assert.equal(ui.viewport.scrollLeft, 0);
  assert.equal(ui.arrow('previous'), undefined);
});

test('manual wheel scrolling cancels a pending reveal instead of being pulled back on content updates', async t => {
  const ui = await mount(t);
  await ui.click('next');
  await act(async () => ui.viewport.dispatch('wheel'));
  ui.dimensions.scrollLeft = 200;
  await ui.fireScroll();
  const before = ui.scrolls.length;
  await ui.update({ children: createElement('span', { className: 'item' }, 'Updated tabs') });
  assert.equal(ui.viewport.scrollLeft, 200);
  assert.equal(ui.scrolls.length, before);
});

test('resizing and changing content add and remove arrows without permanently consuming their width', async t => {
  const ui = await mount(t, { contentWidth: 280 });
  assert.ok(ui.slots().every(slot => slot.props.hidden));
  ui.dimensions.contentWidth = 600;
  await ui.update({ children: createElement('span', { className: 'item' }, 'More tabs') });
  await ui.notify();
  assert.ok(ui.arrow('next'));
  ui.dimensions.contentWidth = 280;
  await ui.notify();
  assert.ok(ui.slots().every(slot => slot.props.hidden));
  assert.equal(ui.viewport.clientWidth, 300);
  ui.dimensions.width = 200;
  await ui.resize();
  assert.ok(ui.arrow('next'));
  ui.dimensions.width = 400;
  await ui.notify();
  assert.ok(ui.slots().every(slot => slot.props.hidden));
});

test('a hidden panel is measured again after becoming visible and after fonts finish loading', async t => {
  const ui = await mount(t, { width: 0 });
  assert.ok(ui.slots().every(slot => slot.props.hidden));
  ui.dimensions.width = 300;
  await ui.notify();
  assert.ok(ui.arrow('next'));
  ui.dimensions.contentWidth = 280;
  await act(async () => ui.fonts.dispatch('loadingdone'));
  await ui.flush();
  assert.ok(ui.slots().every(slot => slot.props.hidden));
});

test('unmount disconnects observers, removes listeners and cancels pending animation frames', async t => {
  const ui = await mount(t);
  assert.ok(ui.observers.some(observer => observer.targets.size), 'layout observers must be active while mounted');
  await act(async () => { ui.view.dispatch('resize'); });
  await ui.unmount();
  assert.ok(ui.observers.every(observer => observer.disconnected));
  assert.equal(ui.view.listenerCount(), 0);
  assert.equal(ui.fonts.listenerCount(), 0);
  assert.equal(ui.viewport.listenerCount(), 0);
  assert.equal(ui.frames.size, 0);
  await ui.finishFonts();
  assert.equal(ui.frames.size, 0, 'late font readiness must not restart measurements after unmount');
});
