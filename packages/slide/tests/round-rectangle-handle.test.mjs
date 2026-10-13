import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { SlideCanvas } from './src/ui/slide-canvas'; export { useSlideEditor } from './src/state/use-slide-editor'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = fn => act(async () => { await fn(); });
const pointer = (x, y, extra = {}) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {}, ...extra });
async function mount(t, { shape = {}, zoom = 100, allowed = true, ...initialProps } = {}) {
  let resize;
  const old = globalThis.ResizeObserver; globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} }; t.after(() => { globalThis.ResizeObserver = old; });
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} });
  const viewport = Object.assign(new EventTarget(), { ownerDocument: { defaultView: win }, isConnected: true, clientWidth: 960, clientHeight: 664, scrollLeft: 0, scrollTop: 0, getBoundingClientRect() { return { left: 0, top: 0, right: 960, bottom: 664 }; }, focus() {}, contains() { return true; } });
  const surface = { getBoundingClientRect() { return { left: 80, top: 40 }; } };
  const capture = Object.assign(new EventTarget(), { focus() {}, setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {} });
  const initialDeck = m.createSlideDeck({ width: 800, height: 600, slides: [{ id: 's', name: 'Page', background: '#fff', notes: '', elements: [m.createSlideElement({ type: 'shape', shape: 'roundRect', name: 'Rounded', id: 'rounded', x: 100, y: 100, width: 200, height: 100, ...shape })] }] });
  let props = { initialDeck, onSave() {}, onEditRequest() { requests++; return allowed; }, ...initialProps }, editor, renderer, requests = 0;
  function Probe() { editor = m.useSlideEditor(props); return h(m.SlideCanvas, { deck: editor.deck, slide: editor.deck.slides[0], editor, zoom }); }
  await change(() => { renderer = create(h(Probe), { createNodeMock: el => el.props.className === 'lxp-canvas-viewport' ? viewport : el.props.className === 'lxp-canvas-surface' ? surface : null }); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => editor.select({ slideId: 's', elementIds: ['rounded'] }));
  const canvas = () => renderer.root.findByProps({ className: 'lxp-canvas-surface' });
  const handle = () => renderer.root.findByProps({ className: 'lxp-corner-handle' });
  const scale = () => Number(canvas().props.style.transform.match(/[\d.]+/)[0]);
  const emit = (type, attrs = {}, target = win) => { const event = new Event(type, { cancelable: true }); Object.assign(event, attrs); target.dispatchEvent(event); };
  return { renderer, canvas, handle, capture, get editor() { return editor; }, get requests() { return requests; },
    value: () => editor.deck.slides[0].elements[0].cornerRadiusRatio,
    begin: () => change(() => handle().props.onPointerDown(pointer(200, 200, { currentTarget: capture }))),
    move: (dx, dy = 0) => change(() => canvas().props.onPointerMove(pointer(200 + dx * scale(), 200 + dy * scale()))),
    finish: (dx, dy = 0) => change(() => canvas().props.onPointerUp(pointer(200 + dx * scale(), 200 + dy * scale()))),
    emit: (type, attrs, target) => change(() => emit(type, attrs, target)),
    key: (key, shiftKey = false) => change(() => handle().props.onKeyDown({ key, shiftKey, preventDefault() {}, stopPropagation() {} })),
    zoom: value => change(() => { zoom = value; renderer.update(h(Probe)); }),
    resize: (width, height) => change(() => { viewport.clientWidth = width; viewport.clientHeight = height; resize(); }),
    props: patch => change(() => { props = { ...props, ...patch }; renderer.update(h(Probe)); }),
  };
}

test('yellow handle previews radius, uses final pointer coordinates and commits one undoable edit', async t => {
  const app = await mount(t);
  assert.equal(app.handle().props.role, 'slider'); assert.equal(app.handle().props['aria-valuenow'], 24);
  assert.equal(app.handle().props.style.left, 12);
  await app.begin(); await app.move(25);
  assert.equal(app.value(), undefined); assert.equal(app.requests, 0);
  assert.equal(app.handle().props['aria-valuenow'], 74);
  await app.finish(38); assert.equal(app.value(), .5); assert.equal(app.requests, 1);
  assert.equal(app.handle().props['aria-valuenow'], 100);
  assert.deepEqual([app.editor.deck.slides[0].elements[0].x, app.editor.deck.slides[0].elements[0].width], [100, 200]);
  await change(() => app.editor.history('undo')); assert.equal(app.value(), undefined);
  await change(() => app.editor.history('redo')); assert.equal(app.value(), .5);
});

test('adjustment projects drag to the rotated local top edge and compensates for zoom', async t => {
  const app = await mount(t, { shape: { rotation: 90 }, zoom: 200 });
  await app.begin(); await app.move(0, 25);
  assert.equal(app.handle().props['aria-valuenow'], 74);
  await app.finish(0, 25); assert.equal(app.value(), .37);
  await app.begin(); await app.move(100, 0); await app.finish(100, 0);
  assert.ok(Math.abs(app.value() - .37) < 1e-9);
});

test('Escape, pointer cancellation, capture loss and blur restore without editing', async t => {
  const app = await mount(t);
  for (const [event, attrs, target] of [['keydown', { key: 'Escape' }], ['pointercancel', { pointerId: 1 }], ['lostpointercapture', { pointerId: 1 }, app.capture], ['blur', {}]]) {
    await app.begin(); await app.move(20); await app.emit(event, attrs, target); await app.finish(20);
    assert.equal(app.value(), undefined); assert.equal(app.requests, 0); assert.equal(app.handle().props['aria-valuenow'], 24);
  }
  await app.begin(); await app.move(20); await app.props({ readOnly: true }); await app.finish(20);
  assert.equal(app.value(), undefined); assert.equal(app.requests, 0);
});

test('keyboard percent steps, extremes and history use existing permissions', async t => {
  const app = await mount(t);
  await app.key('ArrowRight'); assert.equal(app.value(), .125);
  await app.key('ArrowLeft', true); assert.ok(Math.abs(app.value() - .075) < 1e-9);
  await app.key('End'); assert.equal(app.value(), .5);
  await app.key('Home'); assert.equal(app.value(), 0); assert.equal(app.handle().props.style.left, 0);
  await app.key('ArrowDown'); assert.equal(app.value(), 0);
  await change(() => app.editor.history('undo')); assert.equal(app.value(), .5);
});

test('permission refusal discards adjustment and disabled or locked shapes expose no control', async t => {
  const app = await mount(t, { allowed: false });
  await app.begin(); await app.move(25); await app.finish(25);
  assert.equal(app.requests, 1); assert.equal(app.value(), undefined); assert.equal(app.handle().props['aria-valuenow'], 24);
  await app.key('End'); assert.equal(app.requests, 2); assert.equal(app.value(), undefined);
  await app.props({ features: { formatting: false } }); assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-corner-handle' }).length, 0);
  await app.props({ features: {}, readOnly: true }); assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-corner-handle' }).length, 0);
});

test('locked and ordinary rectangles do not render the adjustment control', async t => {
  const locked = await mount(t, { shape: { locked: true } });
  assert.equal(locked.renderer.root.findAllByProps({ className: 'lxp-corner-handle' }).length, 0);
  const plain = await mount(t, { shape: { shape: 'rect' } });
  assert.equal(plain.renderer.root.findAllByProps({ className: 'lxp-corner-handle' }).length, 0);
});

test('changes to the source deck discard the pending adjustment without replaying it', async t => {
  const app = await mount(t);
  await app.begin(); await app.move(25);
  await change(() => app.editor.execute({ type: 'element.update', slideId: 's', elementId: 'rounded', patch: { x: 130 } }));
  await app.finish(25);
  assert.equal(app.value(), undefined);
  assert.equal(app.editor.deck.slides[0].elements[0].x, 130);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck.slides[0].elements[0].x, 100);
  assert.equal(app.value(), undefined);
});

test('zoom and viewport resize discard an active corner drag instead of applying stale pointer scaling', async t => {
  const app = await mount(t);
  await app.begin(); await app.move(25);
  assert.equal(app.handle().props['aria-valuenow'], 74);
  await app.zoom(200); await app.finish(25);
  assert.equal(app.value(), undefined); assert.equal(app.requests, 0);
  assert.equal(app.handle().props['aria-valuenow'], 24);
  await app.begin(); await app.move(25);
  assert.equal(app.handle().props['aria-valuenow'], 74);
  await app.resize(480, 500); await app.finish(25);
  assert.equal(app.value(), undefined); assert.equal(app.requests, 0);
  assert.equal(app.handle().props['aria-valuenow'], 24);
});
