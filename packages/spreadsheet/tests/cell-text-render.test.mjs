import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: "export { CellText } from './src/ui/grid/cell-text';", resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { CellText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const defaults = { text: 'Long text to fit inside a narrow cell', overflow: { before: 0, after: 0 }, shrink: true, revision: 'initial', hidden: false };

async function mountShrink(t, initial = {}) {
  const hadObserver = Object.hasOwn(globalThis, 'ResizeObserver'), originalObserver = globalThis.ResizeObserver;
  const observers = [], fontListeners = new Set();
  let resolveFonts, renderer, props = { ...defaults, ...initial }, unmounted = false, measurements = 0;
  const sizes = { available: 120, natural: 300 };
  const fonts = { ready: new Promise(resolve => { resolveFonts = resolve; }),
    addEventListener(name, listener) { assert.equal(name, 'loadingdone'); fontListeners.add(listener); },
    removeEventListener(name, listener) { assert.equal(name, 'loadingdone'); fontListeners.delete(listener); } };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; observers.push(this); }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  };
  const node = element => ({ ownerDocument: { fonts }, getBoundingClientRect() {
    measurements++;
    return { width: element.props.className === 'lxs-cell-text-measure' ? sizes.natural : sizes.available };
  } });
  await act(async () => { renderer = create(createElement(CellText, props), { createNodeMock: node }); });
  const unmount = async () => { if (unmounted) return; unmounted = true; await act(async () => renderer.unmount()); };
  t.after(async () => {
    await unmount();
    if (hadObserver) globalThis.ResizeObserver = originalObserver;
    else delete globalThis.ResizeObserver;
  });
  return { renderer, sizes, observers, fontListeners, get measurements() { return measurements; }, unmount,
    scale: () => parseFloat(renderer.root.findByProps({ className: 'lxs-cell-text-scaled' }).props.style.fontSize) / 100,
    async resize() { await act(async () => observers.at(-1).callback()); },
    async loadingDone() { await act(async () => { for (const listener of fontListeners) listener(); }); },
    async fontsReady() { await act(async () => resolveFonts()); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(CellText, props))); },
  };
}

test('shrink measures the visible and natural text widths, then follows resize without enlarging text', async t => {
  const ui = await mountShrink(t, { hidden: true });
  assert.equal(ui.scale(), 0.4);
  assert.equal(ui.observers.length, 1);
  assert.equal(ui.observers[0].observed.length, 2, 'both cell width and shaped text width are observed');
  assert.equal(ui.renderer.root.findByProps({ className: 'lxs-cell-text lxs-cell-text-shrink' }).props['aria-hidden'], true);
  assert.equal(ui.renderer.root.findByProps({ className: 'lxs-cell-text-measure' }).props['aria-hidden'], 'true');
  ui.sizes.available = 240;
  await ui.resize();
  assert.equal(ui.scale(), 0.8);
  ui.sizes.available = 600;
  await ui.resize();
  assert.equal(ui.scale(), 1, 'wide cells preserve the specified font size');
  ui.sizes.available = 240;
  ui.sizes.natural = 600;
  await ui.resize();
  assert.equal(ui.scale(), 0.4, 'equal scaling of both screen rectangles keeps logical font scale unchanged');
});

test('font readiness and later font loading remeasure actual shaped text', async t => {
  const ui = await mountShrink(t);
  assert.equal(ui.fontListeners.size, 1);
  ui.sizes.natural = 600;
  await ui.fontsReady();
  assert.equal(ui.scale(), 0.2);
  ui.sizes.natural = 240;
  await ui.loadingDone();
  assert.equal(ui.scale(), 0.5);
});

test('text and format revisions replace measurements and release previous observers', async t => {
  const ui = await mountShrink(t);
  const initialObserver = ui.observers[0];
  ui.sizes.natural = 600;
  await ui.update({ text: 'A substantially longer text string' });
  assert.equal(ui.scale(), 0.2);
  assert.equal(initialObserver.disconnected, true);
  assert.equal(ui.fontListeners.size, 1, 'rerenders do not accumulate font listeners');
  const textObserver = ui.observers.at(-1);
  ui.sizes.natural = 400;
  await ui.update({ revision: 'font:20,bold:true,width:120' });
  assert.equal(ui.scale(), 0.3);
  assert.equal(textObserver.disconnected, true);
  assert.equal(ui.observers.length, 3);
  const count = ui.measurements;
  await act(async () => initialObserver.callback());
  assert.equal(ui.measurements, count, 'a queued obsolete resize callback cannot read or update the replacement');
});

test('zero-size hidden elements do not produce invalid scale or erase the last valid measurement', async t => {
  const ui = await mountShrink(t);
  ui.sizes.available = 0;
  await ui.resize();
  assert.equal(ui.scale(), 0.4);
  ui.sizes.available = 120;
  ui.sizes.natural = 0;
  await ui.resize();
  assert.equal(ui.scale(), 0.4);
  ui.sizes.natural = 150;
  await ui.resize();
  assert.equal(ui.scale(), 0.8, 'showing the text again restores live measurement');
});

test('unmount disconnects resize and font observation and ignores pending font readiness', async t => {
  const ui = await mountShrink(t);
  const observer = ui.observers[0];
  await ui.unmount();
  assert.equal(observer.disconnected, true);
  assert.equal(ui.fontListeners.size, 0);
  const count = ui.measurements;
  await act(async () => observer.callback());
  await ui.fontsReady();
  assert.equal(ui.measurements, count, 'late resize/font callbacks never read detached elements');
});

test('overflow aligns a separate content box to the original cell even when available space is asymmetric', async t => {
  for (const [align, overflow, expected] of [
    ['left', { before: 0, after: 300 }, 'flex-start'],
    ['right', { before: 180, after: 0 }, 'flex-end'],
    ['center', { before: 40, after: 250 }, 'center'],
  ]) {
    let renderer;
    await act(async () => { renderer = create(createElement(CellText, { ...defaults, shrink: false, align, overflow })); });
    t.after(async () => { await act(async () => renderer.unmount()); });
    const outside = renderer.root.findByProps({ className: 'lxs-cell-text lxs-cell-text-overflow' });
    const origin = renderer.root.findByProps({ className: 'lxs-cell-text-origin' });
    const content = renderer.root.findByProps({ className: 'lxs-cell-text-content' });
    const added = overflow.before + overflow.after;
    assert.equal(outside.props.style.marginLeft, -overflow.before);
    assert.equal(outside.props.style.width, `calc(100% + ${added}px)`);
    assert.equal(origin.props.style.marginLeft, overflow.before);
    assert.equal(origin.props.style.width, `calc(100% - ${added}px)`);
    assert.equal(origin.props.style.justifyContent, expected);
    assert.deepEqual(content.children, [defaults.text]);
  }
});
