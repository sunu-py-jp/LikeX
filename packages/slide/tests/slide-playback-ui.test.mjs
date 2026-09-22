import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export { SlidePresentation } from './src/ui/slide-presentation';
  export { useSlidePlayback } from './src/state/use-slide-playback';
  export { createSlideDeck, createSlideElement } from './src/model';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'react-and-portal', setup(builder) {
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'test-portal' }));
  builder.onLoad({ filter: /.*/, namespace: 'test-portal' }, () => ({ contents: 'export const createPortal = (children) => children;' }));
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { SlidePresentation, useSlidePlayback, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=slide-playback-ui-test.js').toString('base64')}`);
const change = async callback => act(async () => { await callback(); });
const tween = (to, extra = {}) => ({ type: 'tween', elementId: 'title', durationMs: 100, to, ...extra });
const step = (id, animation, trigger) => ({ id, animation, ...(trigger ? { trigger } : {}) });
function deck(animations, extra = []) {
  return createSlideDeck({ slides: [{ id: 'one', name: 'One', background: '#fff', notes: '',
    elements: [createSlideElement({ type: 'text', id: 'title', name: 'Title', text: 'Hello', x: 0, opacity: 1 })], animations }, ...extra] });
}
function environment(t, reduced = false) {
  const previous = globalThis.ResizeObserver;
  let observers = 0, focuses = 0, serial = 0;
  globalThis.ResizeObserver = class { observe() { observers++; } disconnect() { observers--; } };
  t.after(() => { globalThis.ResizeObserver = previous; });
  const frames = new Map(), media = new EventTarget();
  media.matches = reduced;
  const view = { innerWidth: 1280, innerHeight: 720, matchMedia: () => media,
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; }, cancelAnimationFrame(id) { frames.delete(id); } };
  const previousFocus = { isConnected: true, focus() { focuses++; } };
  const doc = { defaultView: view, activeElement: previousFocus, body: {} };
  const node = { clientWidth: 1280, clientHeight: 720, ownerDocument: doc,
    focus() { doc.activeElement = node; }, querySelectorAll() { return []; } };
  return { doc, node, frames, media, previousFocus, get focuses() { return focuses; }, get observers() { return observers; },
    async tick(time) { await change(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); }); },
    async reduce(value) { await change(() => { media.matches = value; media.dispatchEvent(new Event('change')); }); } };
}
async function hook(t, source, options = {}) {
  const env = environment(t, options.reduced);
  let latest, renderer, enabled = options.enabled ?? true;
  const View = () => { latest = useSlidePlayback(source, env.doc, enabled); return null; };
  await change(() => { renderer = create(h(View)); });
  t.after(() => change(() => renderer.unmount()));
  return { ...env, get value() { return latest; }, renderer,
    async advance(id) { let result; await change(() => { result = latest.advance(id); }); return result; },
    async replace(next, nextEnabled = enabled) { source = next; enabled = nextEnabled; await change(() => renderer.update(h(View))); } };
}

test('playback evaluates animation frames without changing source data, then stops requesting frames', async t => {
  const source = deck([step('fade', tween({ opacity: 1 }, { from: { opacity: 0 } }))]).slides[0];
  const before = JSON.stringify(source), app = await hook(t, source);
  assert.equal(app.value.slide.elements[0].opacity, 0);
  await app.tick(1000); await app.tick(1050);
  assert.equal(app.value.slide.elements[0].opacity, .5);
  await app.tick(1100);
  assert.equal(app.value.finished, true); assert.equal(app.frames.size, 0);
  assert.equal(app.value.slide.elements[0].opacity, 1);
  assert.equal(JSON.stringify(source), before);
});

test('click gates consume one input, matching targets only, and active playback advances to its own boundary', async t => {
  const app = await hook(t, deck([
    step('first', tween({ x: 100 }), { type: 'click', elementId: 'title' }),
    step('second', tween({ x: 200 }), { type: 'click' }),
  ]).slides[0]);
  assert.equal(app.value.waitingTargetId, 'title'); assert.equal(app.frames.size, 0);
  await app.advance(); assert.equal(app.value.waitingForClick, true);
  await app.advance('title'); assert.equal(app.value.stepId, 'first'); assert.equal(app.value.waitingForClick, false);
  await app.advance(); assert.equal(app.value.slide.elements[0].x, 100); assert.equal(app.value.stepId, 'second');
  assert.equal(app.value.waitingForClick, true);
  await app.advance(); assert.equal(app.value.stepId, 'second'); assert.equal(app.value.waitingForClick, false);
  await app.advance(); assert.equal(app.value.finished, true); assert.equal(app.value.slide.elements[0].x, 200);
  assert.equal(await app.advance(), false);
});

test('reduced motion settles delays and nested groups while retaining click gates, including a live preference change', async t => {
  const source = deck([
    step('one', tween({ x: 100 }), { type: 'after-delay', delayMs: 500 }),
    step('two', { type: 'sequence', children: [tween({ x: 200 }), tween({ x: 300 })] }, { type: 'click' }),
  ]).slides[0];
  const app = await hook(t, source, { reduced: true });
  assert.equal(app.value.slide.elements[0].x, 100); assert.equal(app.value.waitingForClick, true); assert.equal(app.frames.size, 0);
  await app.reduce(false); assert.equal(app.value.waitingForClick, true);
  await app.advance(); await app.tick(100); await app.tick(150);
  assert.equal(app.value.slide.elements[0].x, 150);
  await app.reduce(true); assert.equal(app.value.finished, true); assert.equal(app.value.slide.elements[0].x, 300); assert.equal(app.frames.size, 0);
});

test('feature disabling, source replacement and unmount cancel stale playback callbacks', async t => {
  const first = deck([step('move', tween({ x: 100 }))]).slides[0], app = await hook(t, first);
  const stale = [...app.frames.values()][0];
  await app.replace(first, false);
  assert.equal(app.value.finished, true); assert.equal(app.value.slide.elements[0].x, 100); assert.equal(app.frames.size, 0);
  const next = deck([step('new', tween({ x: 200 }), { type: 'click' })]).slides[0];
  await app.replace(next, true);
  await change(() => stale(500));
  assert.equal(app.value.stepId, 'new'); assert.equal(app.value.slide.elements[0].x, 0);
  await app.advance(); assert.equal(app.frames.size, 1);
  await change(() => app.renderer.unmount()); assert.equal(app.frames.size, 0);
});

async function presentation(t, initialDeck) {
  const env = environment(t); let current = initialDeck, renderer, closed = 0;
  const render = () => h(SlidePresentation, { deck: current, initialSlideId: initialDeck.slides[0].id, ownerDocument: env.doc, theme: {}, onClose() { closed++; } });
  await change(() => { renderer = create(render(), { createNodeMock: element => element.props.className === 'lxp-presentation' ? env.node : null }); });
  t.after(() => change(() => renderer.unmount()));
  const root = () => renderer.root.findByProps({ className: 'lxp-presentation' });
  return { ...env, renderer, get closed() { return closed; }, get focuses() { return env.focuses; }, get observers() { return env.observers; },
    button: label => renderer.root.findByProps({ 'aria-label': label }),
    page: () => renderer.root.findByProps({ className: 'lxp-presentation-controls' }).findAllByType('span')[0].children.join(''),
    async key(key, extra = {}) { const state = { prevented: false, stopped: false }; await change(() => root().props.onKeyDown({ key, target: { closest: () => null }, preventDefault() { state.prevented = true; }, stopPropagation() { state.stopped = true; }, ...extra })); return state; },
    async click(id) { await change(() => renderer.root.findByProps({ className: 'lxp-presentation-slide' }).props.onClick({ stopPropagation() {}, target: { closest: () => id ? { dataset: { slideElementId: id } } : null } })); },
    async replace(value) { current = value; await change(() => renderer.update(render())); } };
}

test('presentation finishes click steps on the last page, protects button Space, and isolates all editor shortcuts', async t => {
  const app = await presentation(t, deck([step('click', tween({ x: 100 }), { type: 'click' })]));
  assert.equal(app.button('次のアニメーション').props.disabled, false);
  const space = await app.key(' ', { target: { closest: () => ({}) } });
  assert.equal(space.stopped, true); assert.equal(space.prevented, false);
  assert.equal((await app.key('Delete')).stopped, true);
  await app.key('ArrowRight', { repeat: true }); assert.equal(app.frames.size, 0);
  await app.key('ArrowRight'); assert.equal(app.frames.size, 1);
  await app.key('ArrowRight'); assert.equal(app.button('次のスライド').props.disabled, true);
  await app.key('Escape'); assert.equal(app.closed, 1);
});

test('targeted click remains keyboard accessible and unrelated slide clicks do not trigger it', async t => {
  const app = await presentation(t, deck([step('target', tween({ x: 100 }), { type: 'click', elementId: 'title' })]));
  assert.equal(app.button('次のアニメーション').props.disabled, true);
  await app.click('other'); assert.equal(app.frames.size, 0);
  await change(() => app.button('Titleのクリック操作を実行').props.onClick()); assert.equal(app.frames.size, 1);
  await app.click(); assert.equal(app.button('次のスライド').props.disabled, true);
});

test('presentation artwork enables element hit testing while static previews retain their noninteractive CSS', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /(?:^|\n)\.lxp-artwork\s*\{[^}]*pointer-events\s*:\s*none\s*;/);
  assert.match(css, /(?:^|\n)\.lxp-presentation-slide\s+\.lxp-artwork\s*\{[^}]*pointer-events\s*:\s*auto\s*;/);
  assert.match(css, /\.lxp-canvas-element>svg[^}]*pointer-events\s*:\s*none\s*;/);
});

test('clicking the rendered element starts its targeted animation', async t => {
  const app = await presentation(t, deck([step('target', tween({ x: 100 }), { type: 'click', elementId: 'title' })]));
  const element = app.renderer.root.findByProps({ 'data-slide-element-id': 'title' });
  assert.equal(app.frames.size, 0);
  await app.click(element.props['data-slide-element-id']);
  assert.equal(app.frames.size, 1);
  await app.tick(0); await app.tick(50);
  assert.equal(app.renderer.root.findByProps({ 'data-slide-element-id': 'title' }).props.style.left, 50);
});

test('presentation traps Tab from its container and restores only a connected previous focus target', async t => {
  const app = await presentation(t, deck([]));
  const buttons = [0, 1, 2].map(index => ({ focus() { app.doc.activeElement = this; this.focused = index; } }));
  app.node.querySelectorAll = () => buttons;
  await app.key('Tab', { shiftKey: true }); assert.equal(app.doc.activeElement, buttons[2]);
  await app.key('Tab'); assert.equal(app.doc.activeElement, buttons[0]);
  app.previousFocus.isConnected = false;
  await change(() => app.renderer.unmount()); assert.equal(app.focuses, 0); assert.equal(app.observers, 0);
});

test('navigation tracks slide IDs across reorder and deletion, backwards shows final state, cleanup restores focus', async t => {
  const initial = deck([step('move', tween({ x: 100 }))], [{ id: 'two', name: 'Two', background: '#fff', notes: '', elements: [] }]);
  const app = await presentation(t, initial);
  await app.key('ArrowRight'); await app.key('ArrowRight'); assert.equal(app.page(), '2 / 2');
  await app.key('ArrowLeft'); assert.equal(app.page(), '1 / 2'); assert.equal(app.frames.size, 0);
  assert.equal(app.renderer.root.findByProps({ 'data-slide-element-id': 'title' }).props.style.left, 100);
  await app.replace(createSlideDeck({ ...initial, slides: [...initial.slides].reverse() })); assert.equal(app.page(), '2 / 2');
  await app.replace(createSlideDeck({ ...initial, slides: [initial.slides[1]] })); assert.equal(app.page(), '1 / 1');
  await change(() => app.renderer.unmount()); assert.equal(app.frames.size, 0);
  assert.equal(app.focuses, 1); assert.equal(app.observers, 0);
});
