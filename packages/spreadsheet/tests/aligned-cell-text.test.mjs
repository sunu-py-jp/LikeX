import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: "export { AlignedCellText, layoutAlignedCellText } from './src/ui/grid/aligned-cell-text';", resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { AlignedCellText, layoutAlignedCellText } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const units = text => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text));
const measure = text => units(text).length * 10;

test('fill repeats complete text runs within the supplied width and retains manual lines', () => {
  const result = layoutAlignedCellText('1234\nAB', 100, 'fill', false, false, measure);
  assert.deepEqual(result.lines.map(line => line.text), ['12341234', 'ABABABABAB']);
  assert.deepEqual(layoutAlignedCellText('1234', 20, 'fill', false, false, measure).lines.map(line => line.text), ['1234']);
  assert.deepEqual(layoutAlignedCellText('', 100, 'fill', false, false, measure).lines.map(line => line.text), ['']);
});

test('justify wraps at words, spreads interior spaces, and keeps the last paragraph line aligned to the start', () => {
  const result = layoutAlignedCellText('one two three\nlast', 80, 'justify', false, false, measure);
  assert.deepEqual(result.lines.map(line => line.text), ['one two', 'three', 'last']);
  assert.equal(result.lines[0].wordSpacing, 10);
  assert.equal(result.lines[0].paragraphEnd, false);
  assert.equal(result.lines[1].wordSpacing, undefined);
  assert.equal(result.lines[2].wordSpacing, undefined);
});

test('distributed aligns every line by grapheme while centering single-character lines', () => {
  const result = layoutAlignedCellText('ABCD', 35, 'distributed', false, false, measure);
  assert.deepEqual(result.lines.map(line => line.text), ['ABC', 'D']);
  assert.equal(result.lines[0].letterSpacing, 2.5);
  assert.equal(result.lines[1].textAlign, 'center');
  const combined = layoutAlignedCellText('e\u0301x', 25, 'distributed', false, false, measure);
  assert.equal(combined.lines[0].letterSpacing, 5, 'combining marks do not become independent alignment gaps');
  const japanese = layoutAlignedCellText('天地玄黃宇宙', 35, 'distributed', false, false, measure);
  assert.deepEqual(japanese.lines.map(line => line.text), ['天地玄', '黃宇宙']);
  assert.equal(japanese.lines[1].letterSpacing, 2.5);
});

test('vertical-only unwrapped content preserves manual lines without font measurement', () => {
  let calls = 0;
  const result = layoutAlignedCellText('first\r\nsecond\rthird\n', 20, 'left', false, false, () => { calls++; return 100; });
  assert.deepEqual(result.lines.map(line => line.text), ['first', 'second', 'third', '']);
  assert.equal(calls, 0);
});

test('ordinary wrapped content and shrink-to-fit remain available with advanced vertical alignment', () => {
  const wrapped = layoutAlignedCellText('one two three', 80, 'right', true, false, measure);
  assert.deepEqual(wrapped.lines.map(line => line.text), ['one two ', 'three']);
  assert.equal(wrapped.lines[0].wordSpacing, undefined);
  const shrunk = layoutAlignedCellText('abcdefghij\nabc', 50, 'right', false, true, measure);
  assert.equal(shrunk.scale, 0.5);
  assert.deepEqual(shrunk.lines.map(line => line.text), ['abcdefghij', 'abc']);
});

test('very long strings, tiny cells, and zero-width glyphs have bounded layout work', () => {
  let calls = 0;
  const original = 'abcdefghijklmnopqrstuvwxyz'.repeat(4_000);
  const result = layoutAlignedCellText(original, 1, 'distributed', false, false, value => { calls++; return measure(value); });
  assert.equal(result.clipped, true);
  assert.equal(result.fallbackText, original, 'the work budget changes placement strategy rather than dropping original text');
  assert.ok(result.lines.length <= 512);
  assert.ok(calls <= 4_096);
  const emptyGlyph = layoutAlignedCellText('\u200b', 1_000_000, 'fill', false, false, () => 0);
  assert.equal(emptyGlyph.lines[0].text, '\u200b');
  const repeated = layoutAlignedCellText('.', 1_000_000, 'fill', false, false, () => 0.001);
  assert.ok(repeated.lines[0].text.length <= 2_048);
});

async function mount(t, initial = {}, options = {}) {
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const observers = [], listeners = new Set();
  let resolveFonts, renderer, unmounted = false, canvasCount = 0, measurements = 0;
  let props = { text: 'ABC\nDEF', align: 'left', verticalAlign: 'justify', hidden: false, revision: 'initial', ...initial };
  const size = { width: 80, height: 100, glyph: 10, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 };
  const fonts = { status: options.fontStatus ?? 'loading', ready: new Promise(resolve => { resolveFonts = resolve; }),
    addEventListener(type, fn) { assert.equal(type, 'loadingdone'); listeners.add(fn); },
    removeEventListener(type, fn) { assert.equal(type, 'loadingdone'); listeners.delete(fn); } };
  const context = { measureText(text) { measurements++; return { width: units(text).length * size.glyph }; } };
  const document = { fonts, createElement(name) { assert.equal(name, 'canvas'); canvasCount++; return { getContext() { return context; } }; },
    defaultView: { getComputedStyle() { return { width: `${size.width}px`, height: `${size.height}px`, font: '16px Arial', fontSize: '16px', lineHeight: '20px', boxSizing: 'border-box', paddingLeft: `${size.paddingLeft}px`, paddingRight: `${size.paddingRight}px`, paddingTop: `${size.paddingTop}px`, paddingBottom: `${size.paddingBottom}px` }; } } };
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback) { this.callback = callback; this.disconnected = false; this.observed = []; observers.push(this); }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  } });
  await act(async () => { renderer = create(createElement(AlignedCellText, props), { createNodeMock: () => ({ ownerDocument: document, clientWidth: size.width, clientHeight: size.height }) }); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => renderer.unmount()); } };
  t.after(async () => { await unmount(); if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver); else delete globalThis.ResizeObserver; });
  return { size, observers, listeners, unmount,
    get measurements() { return measurements; }, get canvasCount() { return canvasCount; },
    get box() { return renderer.root.find(node => typeof node.type === 'string' && node.props.className?.split(' ').includes('lxs-cell-text-aligned')); },
    get lines() { return renderer.root.findAllByProps({ className: 'lxs-cell-text-line' }); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(AlignedCellText, props))); },
    async resize() { await act(async () => observers.at(-1).callback()); },
    async fontsReady() { await act(async () => resolveFonts()); },
    async loadFont() { await act(async () => { for (const callback of listeners) callback(); }); },
  };
}

test('vertical justify and distributed use the whole cell height, including the one-line cases', async t => {
  const ui = await mount(t);
  assert.equal(ui.box.props.style.justifyContent, 'space-between');
  assert.equal(ui.lines.length, 2);
  assert.equal(ui.lines[0].props.style.lineHeight, '20px');
  assert.equal(ui.canvasCount, 0, 'vertical placement with no wrapping never creates a measuring canvas');
  await ui.update({ text: 'Single' });
  assert.equal(ui.box.props.style.justifyContent, 'space-between', 'one flex item starts at the top');
  await ui.update({ verticalAlign: 'distributed' });
  assert.equal(ui.box.props.style.justifyContent, 'space-around', 'one flex item is centered');
  await ui.update({ text: 'One\nTwo\nThree' });
  ui.size.height = 30;
  await ui.resize();
  assert.equal(ui.box.props.style.justifyContent, 'flex-start', 'overflow never moves the first lines out of the visible region');
});

test('font loading and resize recompute horizontal placement without accumulating canvases or observers', async t => {
  const ui = await mount(t, { text: 'ABCD', align: 'distributed' });
  ui.size.width = 35;
  await ui.resize();
  assert.deepEqual(ui.lines.map(line => line.findByProps({ className: 'lxs-cell-text-content' }).children.join('')), ['ABC', 'D']);
  assert.equal(ui.lines[0].findByProps({ className: 'lxs-cell-text-content' }).props.style.letterSpacing, 2.5);
  ui.size.glyph = 5;
  await ui.fontsReady();
  assert.equal(ui.lines.length, 1);
  assert.equal(ui.lines[0].findByProps({ className: 'lxs-cell-text-content' }).props.style.letterSpacing, 5);
  ui.size.glyph = 10;
  await ui.loadFont();
  assert.equal(ui.lines.length, 2);
  assert.equal(ui.canvasCount, 1);
  assert.equal(ui.observers.length, 1);
  assert.equal(ui.listeners.size, 1);
  const measured = ui.measurements;
  await ui.update({ hidden: true });
  assert.equal(ui.box.props['aria-hidden'], true);
  assert.equal(ui.measurements, measured, 'selection/accessibility changes do not remeasure text');
});

test('stale resize and font callbacks cannot change replaced or unmounted content', async t => {
  const ui = await mount(t, { text: 'ABCD', align: 'distributed' });
  const first = ui.observers[0];
  await ui.update({ revision: 'changed-font' });
  assert.equal(first.disconnected, true);
  const measured = ui.measurements;
  await act(async () => first.callback());
  assert.equal(ui.measurements, measured);
  assert.equal(ui.listeners.size, 1);
  await ui.unmount();
  assert.equal(ui.observers.at(-1).disconnected, true);
  assert.equal(ui.listeners.size, 0);
  await ui.fontsReady();
  assert.equal(ui.measurements, measured);
});

test('border-box indent padding reduces the available text area and distribution compensates trailing letter spacing', async t => {
  const ui = await mount(t, { text: 'ABC', align: 'distributed', verticalAlign: 'distributed', style: { boxSizing: 'border-box', paddingLeft: 10, paddingRight: 5 } });
  ui.size.width = 50; ui.size.paddingLeft = 10; ui.size.paddingRight = 5;
  await ui.resize();
  const text = ui.lines[0].findByProps({ className: 'lxs-cell-text-content' });
  assert.equal(text.props.style.letterSpacing, 2.5, '(50 - 10 - 5 - 30) / (3 - 1)');
  assert.equal(text.props.style.marginRight, -2.5, 'trailing CSS letter spacing does not push the final glyph outside the alignment area');
  ui.size.height = 30; ui.size.paddingTop = 5; ui.size.paddingBottom = 10;
  await ui.resize();
  assert.equal(ui.box.props.style.justifyContent, 'flex-start', 'only the unpadded vertical area is available');
});

test('extended fill exposes each visible manual line to overflow border measurement', async t => {
  const ui = await mount(t, { text: 'AB\nC', align: 'fill', overflow: true });
  assert.ok(ui.box.props.className.split(' ').includes('lxs-cell-text-overflow'));
  const contents = ui.lines.map(line => line.findByProps({ className: 'lxs-cell-text-content' }));
  assert.deepEqual(contents.map(content => content.children.join('')), ['ABABABAB', 'CCCCCCCC']);
  assert.equal(contents.length, 2, 'independent line rectangles let the border mask ignore lines below the vertical clip');
});

test('unchanged initial resize notifications and already loaded fonts do not duplicate measurement', async t => {
  const ui = await mount(t, { text: 'ABC', align: 'distributed' }, { fontStatus: 'loaded' });
  const measured = ui.measurements;
  await ui.resize();
  await ui.fontsReady();
  assert.equal(ui.measurements, measured);
  await ui.loadFont();
  assert.ok(ui.measurements > measured, 'later font changes still invalidate cached geometry');
});

test('line and measurement budgets retain the full input in a native-layout fallback', () => {
  const manyLines = 'line\n'.repeat(600);
  const manual = layoutAlignedCellText(manyLines, 200, 'left', false, false);
  assert.equal(manual.fallbackText, manyLines);
  const narrow = 'abcdefghijklmnopqrstuvwx'.repeat(1_000);
  let calls = 0;
  const wrapped = layoutAlignedCellText(narrow, 1, 'distributed', true, false, value => { calls++; return measure(value); });
  assert.equal(wrapped.fallbackText, narrow);
  assert.equal(wrapped.lines.length, 0);
  assert.ok(calls <= 4_096);
});

test('native fallback renders every original character and preserves explicit and automatic wrapping', async t => {
  const original = 'Original content\n'.repeat(2_500);
  const ui = await mount(t, { text: original, align: 'justify' });
  const fallback = () => ui.box.findByProps({ className: 'lxs-cell-text-native lxs-cell-text-content' });
  assert.equal(fallback().children.join(''), original);
  assert.equal(fallback().props.style.whiteSpace, 'pre-wrap');
  assert.equal(fallback().props.style.textAlign, 'justify');
  assert.equal(ui.box.props.style.justifyContent, 'flex-start');
  assert.equal(ui.measurements, 0, 'oversized content uses browser layout without unbounded measurement');
  await ui.update({ align: 'left', verticalAlign: 'distributed', wrap: false });
  assert.equal(fallback().children.join(''), original);
  assert.equal(fallback().props.style.whiteSpace, 'pre');
});
