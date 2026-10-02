import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export { SlideCanvas } from './src/ui/slide-canvas'; export { SlideElementContent } from './src/ui/slide-artwork'; export { SlideRibbon } from './src/ui/slide-ribbon'; export { SlideProperties } from './src/ui/slide-properties'; export {useSlideEditor} from './src/state/use-slide-editor'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const initial = () => m.applySlideCommands(m.createSlideDeck({ width: 800, height: 600, slides: [{ id: 's', name: 's', background: '#fff', notes: '', elements: [
  m.createSlideElement({ type: 'shape', shape: 'rect', id: 'a', name: 'Box', x: 100, y: 100, width: 100, height: 80 }),
  m.createSlideElement({ type: 'shape', id: 'far', x: 700, y: 500, width: 80, height: 50 }),
]}] }), { type: 'line.add', slideId: 's', id: 'line', name: 'Line', start: { x: 20, y: 20 }, end: { x: 300, y: 220 } }).deck;
const pointer = (x, y, extra = {}) => ({ button: 0, pointerId: 1, clientX: x + 80, clientY: y + 40, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {}, ...extra });
async function mount(t, options = {}) {
  const old = globalThis.ResizeObserver; globalThis.ResizeObserver = class { observe() {} disconnect() {} }; t.after(() => { globalThis.ResizeObserver = old; });
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} });
  const viewport = Object.assign(new EventTarget(), { ownerDocument: { defaultView: win }, isConnected: true, clientWidth: 960, clientHeight: 664, scrollLeft: 0, scrollTop: 0, getBoundingClientRect() { return { left: 0, top: 0, right: 960, bottom: 664 }; }, focus() {}, contains() { return true; }, setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {} });
  const surface = { getBoundingClientRect() { return { left: 80, top: 40 }; } };
  const target = Object.assign(new EventTarget(), { setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {} });
  const commands = [], editor = { deck: initial(), editable: true, readOnly: false, features: { formatting: true, shapes: true, text: true, animations: false }, selection: { slideId: 's', elementIds: ['line'] }, select(selection) { editor.selection = selection; }, execute(command) { commands.push(command); editor.deck = m.applySlideCommands(editor.deck, command).deck; }, ...options };
  let renderer; const view = () => h(m.SlideCanvas, { deck: editor.deck, slide: editor.deck.slides[0], editor, zoom: 100 });
  await change(() => { renderer = create(view(), { createNodeMock: el => el.props.className === 'lxp-canvas-viewport' ? viewport : el.props.className === 'lxp-canvas-surface' ? surface : null }); });
  t.after(() => change(() => renderer.unmount()));
  const canvas = () => renderer.root.findByProps({ className: 'lxp-canvas-surface' });
  const endpoint = end => renderer.root.findByProps({ 'aria-label': `Lineの${end === 'start' ? '始点' : '終点'}` });
  return { renderer, editor, commands, canvas, endpoint, refresh: () => change(() => renderer.update(view())),
    beginBody: (id, x, y) => change(() => renderer.root.findByProps({ "data-slide-element": id }).props.onPointerDown(pointer(x, y, { currentTarget: target }))),
    begin: (end, x = 300, y = 220) => change(() => endpoint(end).props.onPointerDown(pointer(x, y, { currentTarget: target }))),
    move: (x, y) => change(() => canvas().props.onPointerMove(pointer(x, y))),
    finish: (x, y) => change(() => canvas().props.onPointerUp(pointer(x, y))),
    key: key => change(() => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { key }); win.dispatchEvent(event); }),
    ports: () => renderer.root.findAllByProps({ className: 'lxp-connection-port' }),
  };
}

test('line selection exposes two endpoint handles, stroke-only hit testing and no rectangular resize/rotation handles', async t => {
  const app = await mount(t), line = app.renderer.root.findByProps({ 'data-slide-element': 'line' });
  assert.equal(line.findAllByProps({ className: 'lxp-line-handle' }).length, 2);
  assert.equal(line.findAll(node => typeof node.props.className === 'string' && /lxp-(resize|rotate)-handle/.test(node.props.className)).length, 0);
  const hit = line.findByProps({ className: 'lxp-line-hit' }).findByType('line');
  assert.equal(hit.props.style.pointerEvents, 'stroke'); assert.ok(hit.props.strokeWidth >= 12);
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.lxp-canvas-element\.lxp-line-element\s*\{[^}]*pointer-events:none/);
});

test('endpoint drag shows only nearest nearby shape, snaps at 12px, and clears attachment away from points', async t => {
  const app = await mount(t); await app.begin('end');
  await app.move(127, 80);
  assert.equal(app.ports().length, 8); assert.ok(app.ports().every(node => node.props['data-connection-target'] === 'a'));
  await app.move(350, 350); assert.equal(app.ports().length, 0);
  await app.move(201, 140); assert.equal(app.ports().length, 8);
  await app.finish(201, 140);
  assert.deepEqual(app.commands.at(-1)[0].end, { x: 200, y: 140, binding: { targetId: 'a', port: 'right' } });
  await app.refresh(); await app.begin('end', 200, 140); await app.move(360, 320); await app.finish(360, 320);
  assert.deepEqual(app.commands.at(-1)[0].end, { x: 360, y: 320 });
});

test('endpoint gestures cancel on Escape and stale target changes; readonly/formatting-off expose no handles', async t => {
  const app = await mount(t); await app.begin('end'); await app.move(200, 140); await app.key('Escape'); await app.finish(200, 140);
  assert.equal(app.commands.length, 0); assert.equal(app.ports().length, 0);
  await app.begin('end'); await app.move(200, 140); app.editor.deck = initial(); await app.refresh(); await app.finish(200, 140);
  assert.equal(app.commands.length, 0);
  app.editor.editable = false; await app.refresh(); assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-line-handle' }).length, 0);
  app.editor.editable = true; app.editor.features.formatting = false; await app.refresh(); assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-line-handle' }).length, 0);
});

test('line menu has four endpoint presets independent of left/right block arrow shapes and property selectors', async t => {
  const commands = [], editor = { deck: initial(), editable: true, readOnly: false, features: { formatting: true, shapes: true, text: true, animations: false }, selection: { slideId: 's', elementIds: ['line'] }, execute(command) { commands.push(command); } };
  let renderer;
  await change(() => { renderer = create(h(m.SlideRibbon, { editor, propertiesOpen: false, onProperties() {}, ownerDocument: null })); });
  t.after(() => change(() => renderer.unmount()));
  const menu = renderer.root.findByProps({ 'aria-label': '線を挿入' });
  assert.deepEqual(menu.findAllByType('option').slice(1).map(node => node.props.value), ['plain', 'right', 'left', 'both']);
  for (const value of ['plain', 'right', 'left', 'both']) await change(() => menu.props.onChange({ target: { value } }));
  assert.deepEqual(commands.map(command => [command.type, command.startArrow, command.endArrow]), [ ['line.add','none','none'], ['line.add','none','triangle'], ['line.add','triangle','none'], ['line.add','triangle','triangle'] ]);
  for (const label of ['右ブロック矢印', '左ブロック矢印']) await change(() => renderer.root.findByProps({ 'aria-label': label }).props.onClick());
  assert.deepEqual(commands.slice(-2).map(command => command.element.shape), ['arrow', 'leftArrow']);
  await change(() => renderer.update(h(m.SlideProperties, { editor, onClose() {} })));
  const start = renderer.root.findByProps({ 'aria-label': '始点の矢印' });
  await change(() => start.props.onChange({ target: { value: 'diamond' } }));
  assert.deepEqual(commands.at(-1)[0], { type: 'line.update', slideId: 's', elementId: 'line', startArrow: 'diamond' });
});

test('public editor gates and permission paths protect endpoint edits and preserve history and clipboard bindings', async t => {
  let editor, renderer, props = { initialDeck: initial(), onSave() {}, ref: createRef() };
  function Probe() { editor = m.useSlideEditor(props); return null; }
  await change(() => { renderer = create(h(Probe)); }); t.after(() => change(() => renderer.unmount()));
  const update = { type: 'line.update', slideId: 's', elementId: 'line', end: { x: 200, y: 140, binding: { targetId: 'a', port: 'right' } } };
  await change(() => editor.execute(update)); assert.equal(editor.deck.slides[0].elements.at(-1).line.end.binding.targetId, 'a');
  await change(() => editor.select({ slideId: 's', elementIds: ['line', 'a'] })); await change(() => editor.copyElements()); await change(() => editor.pasteElements());
  const pasted = editor.deck.slides[0].elements.slice(-2); assert.ok(pasted[1].line.end.binding.targetId === pasted[0].id);
  await change(() => props.ref.current.undo()); assert.equal(editor.deck.slides[0].elements.length, 3);
  props = { ...props, features: { formatting: false } }; await change(() => renderer.update(h(Probe)));
  await change(() => editor.execute({ ...update, end: { x: 5, y: 5 } })); assert.equal(editor.deck.slides[0].elements.at(-1).line.end.x, 200);
  props = { ...props, features: {}, readOnly: true }; await change(() => renderer.update(h(Probe)));
  await change(() => editor.execute({ ...update, end: { x: 5, y: 5 } })); assert.equal(editor.deck.slides[0].elements.at(-1).line.end.x, 200);
});


test('moving a selected target and its line preserves binding and translates endpoints exactly once', async t => {
  const deck = m.applySlideCommands(initial(), { type: 'line.update', slideId: 's', elementId: 'line', end: { x: 200, y: 140, binding: { targetId: 'a', port: 'right' } } }).deck;
  const app = await mount(t, { deck, selection: { slideId: 's', elementIds: ['a', 'line'] } });
  await app.beginBody('a', 150, 140); await app.move(200, 170); await app.finish(200, 170);
  const line = app.editor.deck.slides[0].elements.find(element => element.id === 'line');
  assert.deepEqual(line.line.start, { x: 70, y: 50 });
  assert.deepEqual(line.line.end, { x: 250, y: 170, binding: { targetId: 'a', port: 'right' } });
});


test('shape insertion menu groups Office presets and inserts bent arrows through element.add', async t => {
  const commands = [], editor = { deck: initial(), editable: true, readOnly: false, features: { shapes: true }, selection: { slideId: 's', elementIds: [] }, execute(command) { commands.push(command); } };
  let renderer;
  await change(() => { renderer = create(h(m.SlideRibbon, { editor, propertiesOpen: false, onProperties() {}, ownerDocument: null })); });
  t.after(() => change(() => renderer.unmount()));
  const menu = renderer.root.findByProps({ 'aria-label': '図形を挿入' });
  assert.ok(menu.findAllByType('optgroup').length >= 3);
  for (const kind of ['bentArrow', 'uturnArrow', 'flowChartDocument']) {
    assert.ok(menu.findAllByType('option').some(option => option.props.value === kind));
    await change(() => menu.props.onChange({ target: { value: kind } }));
    assert.equal(commands.at(-1).type, 'element.add'); assert.equal(commands.at(-1).element.shape, kind);
  }
  editor.editable = false;
  await change(() => renderer.update(h(m.SlideRibbon, { editor, propertiesOpen: false, onProperties() {}, ownerDocument: null })));
  assert.equal(renderer.root.findByProps({ 'aria-label': '図形を挿入' }).props.disabled, true);
});


test('expanded Office shape artwork shares path fills and the dedicated text rectangle', async t => {
  const element = m.createSlideElement({ type: 'shape', shape: 'flowChartMultidocument', width: 300, height: 180, text: '書類', fill: '#ddffaa', stroke: '#123456' });
  let renderer;
  await change(() => { renderer = create(h(m.SlideElementContent, { element })); });
  t.after(() => change(() => renderer.unmount()));
  assert.equal(renderer.root.findByType('svg').props.style.overflow, 'visible');
  const paths = renderer.root.findAllByType('path');
  assert.ok(paths.length >= 2); assert.ok(paths.some(path => path.props.fill === 'none'));
  assert.ok(paths.some(path => path.props.stroke === 'none'));
  const text = renderer.root.findByProps({ className: 'lxp-shape-text' }), rect = m.getSlideShapeTextRect(element);
  for (const key of ['left', 'top', 'width', 'height']) assert.equal(text.props.style[key], rect[key]);
  assert.deepEqual(text.children, ['書類']);
});
