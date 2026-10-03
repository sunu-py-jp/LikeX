import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: `export { SlideCanvas } from './src/ui/slide-canvas'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SlideCanvas, createSlideDeck, createSlideElement, applySlideCommands, getSlideLineRoute } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => act(async () => { await callback(); });
const pointer = (x, y, extra = {}) => ({
  button: 0, pointerId: 7, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
  preventDefault() {}, stopPropagation() {}, ...extra,
});

async function mount(t, { editable = true, formatting = true, zoom = 100 } = {}) {
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  t.after(() => { globalThis.ResizeObserver = previousObserver; });
  const win = new EventTarget(), frames = new Map();
  let frameId = 0, now = 0;
  Object.assign(win, {
    innerWidth: 1100, innerHeight: 800,
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const doc = { defaultView: win }, captures = new Set();
  const viewport = Object.assign(new EventTarget(), {
    ownerDocument: doc, isConnected: true, clientWidth: 960, clientHeight: 664, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 960, bottom: 664, width: 960, height: 664 }),
    focus() { viewport.focused = true; }, contains(target) { return target === viewport; }, closest() { return null; },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  });
  const surface = { closest() { return null; }, getBoundingClientRect: () => ({ left: 80 - viewport.scrollLeft, top: 40 - viewport.scrollTop }) };
  const shapes = [
    { id: 'first', x: 40, y: 40, width: 40, height: 40 },
    { id: 'partial', x: 90, y: 70, width: 70, height: 70 },
    { id: 'rotated', x: 180, y: 80, width: 80, height: 20, rotation: 90 },
    { id: 'diagonal', x: 280, y: 80, width: 60, height: 20, rotation: 45 },
    { id: 'locked', x: 400, y: 40, width: 40, height: 40, locked: true },
  ];
  const deck = createSlideDeck({ width: 800, height: 600, slides: [
    { id: 'one', name: 'One', background: '#fff', notes: '', elements: shapes.map(shape => createSlideElement({ type: 'shape', ...shape })) },
    { id: 'two', name: 'Two', background: '#fff', notes: '', elements: [] },
  ] });
  const selections = [], commands = [];
  const editor = {
    deck, editable, readOnly: !editable, features: { formatting, text: true }, selection: { slideId: 'one', elementIds: ['locked'] },
    select(selection) { selections.push(selection); editor.selection = selection; },
    execute(command) { commands.push(command); },
  };
  let renderer, unmounted = false;
  const render = () => h(SlideCanvas, { deck: editor.deck, slide: editor.deck.slides.find(slide => slide.id === editor.selection.slideId), editor, zoom });
  await change(() => { renderer = create(render(), { createNodeMock: element => element.props.className === 'lxp-canvas-viewport' ? viewport : element.props.className === 'lxp-canvas-surface' ? surface : null }); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  const scope = () => renderer.root.findByProps({ className: 'lxp-canvas-viewport' });
  const canvas = () => renderer.root.findByProps({ className: 'lxp-canvas-surface' });
  const scale = () => Number(canvas().props.style.transform.match(/[\d.]+/)[0]);
  const screen = (x, y) => [80 - viewport.scrollLeft + x * scale(), 40 - viewport.scrollTop + y * scale()];
  const emit = (name, extra = {}, target = win) => { const event = new Event(name, { cancelable: true }); Object.assign(event, extra); target.dispatchEvent(event); };
  return {
    editor, deck, commands, selections, frames, captures, viewport, surface, renderer, scope, canvas, unmount, emit,
    refresh: () => change(() => renderer.update(render())),
    setZoom(value) { zoom = value; },
    shape: id => renderer.root.findByProps({ 'data-slide-element': id }),
    box: () => renderer.root.findAllByProps({ className: 'lxp-canvas-marquee' }),
    async start(x, y, extra = {}, area = 'surface') {
      const point = screen(x, y), target = area === 'viewport' ? viewport : area === 'surface' ? surface : { closest() { return null; } };
      await change(() => (area === 'surface' ? canvas() : scope()).props.onPointerDown(pointer(...point, { target, currentTarget: area === 'surface' ? surface : viewport, ...extra })));
    },
    move: (x, y, extra = {}) => change(() => emit('pointermove', pointer(...screen(x, y), extra))),
    finish: (x, y, extra = {}) => change(() => emit('pointerup', pointer(...screen(x, y), extra))),
    tick: () => change(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now += 16)); }),
  };
}

test('marquee previews full containment in either direction and applies only the release selection', async t => {
  const app = await mount(t);
  assert.equal(app.scope().props['data-slide-selection-scope'], 'elements');
  await app.start(100, 100);
  await app.move(20, 20);
  assert.deepEqual(app.editor.selection.elementIds, ['locked'], 'preview must not mutate committed selection');
  assert.equal(app.shape('first').props['aria-pressed'], true);
  assert.equal(app.shape('partial').props['aria-pressed'], false, 'intersection alone is insufficient');
  assert.deepEqual(app.box()[0].props.style, { left: 20, top: 20, width: 80, height: 80, borderWidth: 1 });
  await app.finish(10, 10);
  assert.deepEqual(app.editor.selection.elementIds, ['first']);
  assert.equal(app.selections.length, 1);
  assert.equal(app.box().length, 0);
  assert.equal(app.captures.size, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.viewport.focused, true);
  await app.start(20, 20);
  await app.move(100, 100);
  await app.finish(170, 150);
  assert.deepEqual(app.editor.selection.elementIds, ['first', 'partial'], 'release position is used even without a final move');
  assert.deepEqual(app.commands, []);
});

test('marquee uses the complete rotated bounds, including precise quarter turns', async t => {
  const app = await mount(t);
  await app.start(210, 50);
  await app.finish(230, 130);
  assert.deepEqual(app.editor.selection.elementIds, ['rotated']);
  await app.start(180, 80);
  await app.finish(260, 100);
  assert.deepEqual(app.editor.selection.elementIds, [], 'unrotated geometry cannot substitute for visual bounds');
  await app.start(280, 80);
  await app.finish(340, 100);
  assert.deepEqual(app.editor.selection.elementIds, [], 'a diagonal shape must be fully contained');
  await app.start(280, 60);
  await app.finish(340, 120);
  assert.deepEqual(app.editor.selection.elementIds, ['diagonal']);
});

for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey']) test(`${modifier} toggles marquee members against the starting selection`, async t => {
  const app = await mount(t);
  app.editor.selection.elementIds = ['first', 'locked'];
  await app.refresh();
  await app.start(20, 20, { [modifier]: true });
  await app.move(170, 150);
  await app.move(170, 150);
  await app.finish(170, 150);
  assert.deepEqual(app.editor.selection.elementIds, ['locked', 'partial']);
  await app.start(10, 10, { [modifier]: true });
  await app.finish(10, 10);
  assert.deepEqual(app.editor.selection.elementIds, ['locked', 'partial'], 'modified blank clicks preserve selection');
});

for (const state of [{ editable: false }, { formatting: false }]) test(`marquee remains selectable with ${JSON.stringify(state)}`, async t => {
  const app = await mount(t, state);
  await app.start(20, 20);
  await app.finish(460, 160);
  assert.deepEqual(app.editor.selection.elementIds, ['first', 'partial', 'rotated', 'diagonal', 'locked']);
  assert.equal(app.commands.length, 0);
});

for (const area of ['surface', 'viewport', 'center', 'frame']) test(`blank ${area} can start a marquee and an unmodified click clears selection`, async t => {
  const app = await mount(t);
  await app.start(20, 20, {}, area);
  await app.finish(100, 100);
  assert.deepEqual(app.editor.selection.elementIds, ['first']);
  await app.start(20, 20, {}, area);
  await app.finish(20, 20);
  assert.deepEqual(app.editor.selection.elementIds, []);
});

for (const event of ['keydown', 'blur', 'pointercancel', 'lostpointercapture']) test(`${event} cancels preview without replacing committed selection`, async t => {
  const app = await mount(t);
  await app.start(20, 20);
  await app.move(170, 150);
  await change(() => app.emit(event, { pointerId: 7, key: 'Escape' }, event === 'lostpointercapture' ? app.viewport : undefined));
  await app.finish(170, 150);
  assert.deepEqual(app.editor.selection.elementIds, ['locked']);
  assert.equal(app.selections.length, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.captures.size, 0);
  assert.equal(app.box().length, 0);
});

for (const mutation of ['deck', 'slide', 'editable', 'formatting', 'zoom']) test(`${mutation} changes invalidate an in-flight marquee`, async t => {
  const app = await mount(t);
  await app.start(20, 20);
  await app.move(170, 150);
  if (mutation === 'deck') app.editor.deck = createSlideDeck({ ...app.deck, title: 'Replacement' });
  if (mutation === 'slide') app.editor.selection = { slideId: 'two', elementIds: [] };
  if (mutation === 'editable') app.editor.editable = false;
  if (mutation === 'formatting') app.editor.features.formatting = false;
  if (mutation === 'zoom') app.setZoom(200);
  await app.refresh();
  await app.finish(170, 150);
  assert.equal(app.selections.length, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.captures.size, 0);
  assert.equal(app.box().length, 0);
});

test('marquee auto-scroll accounts for zoom and cleans up on unmount', async t => {
  const app = await mount(t, { zoom: 200 });
  await app.start(20, 20);
  await change(() => app.emit('pointermove', pointer(1000, 700)));
  const before = app.box()[0].props.style;
  assert.equal(before.borderWidth, .5);
  await app.tick();
  assert.ok(app.viewport.scrollLeft > 0 && app.viewport.scrollTop > 0);
  const after = app.box()[0].props.style;
  assert.ok(Math.abs(after.width - before.width - app.viewport.scrollLeft / 2) < 1e-8);
  assert.ok(Math.abs(after.height - before.height - app.viewport.scrollTop / 2) < 1e-8);
  await app.unmount();
  await change(() => app.emit('pointerup', pointer(1000, 700)));
  assert.equal(app.frames.size, 0);
  assert.equal(app.captures.size, 0);
  assert.equal(app.selections.length, 0);
});

test('non-primary pointers and input targets never start blank selection; foreign pointers cannot finish it', async t => {
  const app = await mount(t);
  await app.start(20, 20, { button: 2 });
  await app.start(20, 20, { target: { closest: () => ({}) } });
  assert.equal(app.frames.size, 0);
  await app.start(20, 20);
  await change(() => app.shape('first').props.onPointerDown(pointer(130, 90, { currentTarget: app.viewport, pointerId: 8 })));
  await app.move(170, 150, { pointerId: 8 });
  await app.finish(170, 150, { pointerId: 8 });
  assert.equal(app.box().length, 0);
  assert.equal(app.selections.length, 0);
  assert.equal(app.commands.length, 0);
  await app.finish(170, 150);
  assert.deepEqual(app.editor.selection.elementIds, ['first', 'partial']);
});

test('moving focus outside the canvas cancels while focus within it preserves the gesture', async t => {
  const app = await mount(t);
  await app.start(20, 20);
  await app.move(100, 100);
  await change(() => app.scope().props.onBlur({ currentTarget: app.viewport, relatedTarget: app.viewport }));
  assert.equal(app.box().length, 1);
  await change(() => app.scope().props.onBlur({ currentTarget: app.viewport, relatedTarget: null }));
  await app.finish(100, 100);
  assert.deepEqual(app.editor.selection.elementIds, ['locked']);
  assert.equal(app.frames.size, 0);
  assert.equal(app.captures.size, 0);
});

test('Ctrl and Meta element clicks retain existing toggle selection behavior without editing locked shapes', async t => {
  const app = await mount(t, { editable: false });
  for (const modifier of ['ctrlKey', 'metaKey']) {
    await change(() => app.shape('first').props.onPointerDown(pointer(130, 90, { currentTarget: app.viewport, [modifier]: true })));
    await app.refresh();
  }
  assert.deepEqual(app.editor.selection.elementIds, ['locked']);
  assert.equal(app.commands.length, 0);
});


test('marquee requires the whole routed elbow, including bends outside the endpoint rectangle', async t => {
  const app = await mount(t);
  app.editor.deck = applySlideCommands(app.editor.deck, {type:'line.add',slideId:'one',id:'elbow',routing:'elbow',start:{x:0,y:0,binding:{targetId:'first',port:'left'}},end:{x:0,y:0,binding:{targetId:'partial',port:'right'}}}).deck;
  await app.refresh();
  const line = app.editor.deck.slides[0].elements.find(item=>item.id==='elbow');
  const route = getSlideLineRoute(line,app.editor.deck.slides[0].elements), {start,end}=line.line;
  const left=Math.min(start.x,end.x),top=Math.min(start.y,end.y),right=Math.max(start.x,end.x),bottom=Math.max(start.y,end.y);
  assert.ok(route.bounds.x<left || route.bounds.y<top || route.bounds.x+route.bounds.width>right || route.bounds.y+route.bounds.height>bottom);
  await app.start(left-.1,top-.1); await app.finish(right+.1,bottom+.1);
  assert.equal(app.editor.selection.elementIds.includes('elbow'),false);
  await app.start(route.bounds.x-1,route.bounds.y-1); await app.finish(route.bounds.x+route.bounds.width+1,route.bounds.y+route.bounds.height+1);
  assert.equal(app.editor.selection.elementIds.includes('elbow'),true);
});
