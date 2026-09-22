import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
let menu;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { SlideCanvas } from './src/ui/slide-canvas';
  export { SlideFilmstrip } from './src/ui/slide-filmstrip';
  export { useSlideEditor } from './src/state/use-slide-editor';
  export { createSlideDeck, createSlideElement } from './src/model';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-menu', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^@likex\/core\/browser$/ }, () => ({ path: 'context-menu', namespace: 'test-menu' }));
  builder.onLoad({ filter: /.*/, namespace: 'test-menu' }, () => ({ contents: `export const openContextMenu = options => globalThis.__slideTestMenu(options);` }));
} }] });
const { SlideCanvas, SlideFilmstrip, useSlideEditor, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const fixture = () => createSlideDeck({ id: 'deck', width: 800, height: 600, slides: [
  { id: 'one', name: 'One', notes: '', background: '#fff', elements: [
    createSlideElement({ type: 'text', id: 'a', text: 'A', x: 20, y: 20 }),
    createSlideElement({ type: 'shape', id: 'b', text: 'B', x: 120, y: 120 }),
    createSlideElement({ type: 'shape', id: 'locked', locked: true, x: 320, y: 120 }),
  ] },
  { id: 'two', name: 'Two', notes: '', background: '#fff', elements: [] },
  { id: 'three', name: 'Three', notes: '', background: '#fff', elements: [] },
] });

async function mount(t, supplied = {}) {
  let editor, renderer, images = 0, imageTarget;
  let props = { initialDeck: fixture(), onSave() {}, ...supplied };
  menu = undefined;
  globalThis.__slideTestMenu = options => {
    menu?.close();
    const value = { ...options, closed: false, close() { if (!value.closed) { value.closed = true; options.onClose?.(); } } };
    menu = value; return value.close;
  };
  function Probe() {
    editor = useSlideEditor(props);
    return h('div', null, h(SlideCanvas, { deck: editor.deck, slide: editor.deck.slides.find(slide => slide.id === editor.selection.slideId), editor, zoom: 100, onImage(target) { images++; imageTarget = target; } }), h(SlideFilmstrip, { editor }));
  }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  const event = (editable = false) => ({ clientX: 220, clientY: 170, currentTarget: {}, target: { closest: () => editable ? {} : null }, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {} });
  return {
    get editor() { return editor; }, get images() { return images; }, get imageTarget() { return imageTarget; }, get menu() { return menu; }, renderer,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); },
    async openElement(id, editable = false) { const e = event(editable); await change(() => renderer.root.findByProps({ 'data-slide-element': id }).props.onContextMenu(e)); return e; },
    async openCanvas(editable = false) { const e = event(editable); await change(() => renderer.root.findByProps({ className: 'lxp-canvas-viewport' }).props.onContextMenu(e)); return e; },
    async openSlide(id) { const e = event(); await change(() => renderer.root.findByProps({ 'data-filmstrip-id': id }).props.onContextMenu(e)); return e; },
    async choose(id) { const item = menu.items.find(item => item.id === id); assert.ok(item, `Missing ${id}`); assert.equal(!!item.disabled, false); const current = menu; await change(async () => { current.close(); await item.onSelect(); }); },
  };
}

test('element context menus select the clicked target, preserve selected groups, and share permission/history', async t => {
  let requests = 0;
  const app = await mount(t, { onEditRequest: () => { requests++; return true; } });
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['a'] }));
  assert.equal((await app.openElement('b')).prevented, true);
  assert.deepEqual(app.editor.selection.elementIds, ['b']);
  assert.equal(app.menu.closed, false, 'selecting the right-click target leaves its menu open');
  await app.choose('delete');
  assert.deepEqual(app.editor.deck.slides[0].elements.map(item => item.id), ['a', 'locked']);
  assert.equal(requests, 1);
  assert.equal(app.editor.canUndo, true);
  await change(() => app.editor.history('undo'));
  assert.deepEqual(app.editor.selection.elementIds, ['b']);
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['a', 'b'] }));
  await app.openElement('b'); await app.choose('duplicate');
  assert.equal(app.editor.deck.slides[0].elements.length, 5);
  assert.equal(app.editor.selection.elementIds.length, 2);
  assert.deepEqual(app.editor.deck.slides[0].elements.slice(-2).map(item => item.text), ['A', 'B']);
});

test('ordering and lock menus use model commands and locked targets cannot be deleted', async t => {
  const app = await mount(t);
  await app.openElement('a'); await app.choose('front');
  assert.equal(app.editor.deck.slides[0].elements.at(-1).id, 'a');
  await app.openElement('locked');
  for (const id of ['delete', 'cut', 'duplicate', 'front', 'back', 'edit-text']) assert.equal(app.menu.items.find(item => item.id === id)?.disabled, true);
  assert.equal(app.menu.items.find(item => item.id === 'lock').label, 'ロックを解除');
  await app.choose('lock');
  assert.equal(app.editor.deck.slides[0].elements.find(item => item.id === 'locked').locked, false);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck.slides[0].elements.find(item => item.id === 'locked').locked, true);
});

test('canvas menu inserts and pastes through the shared model, and typing retains the native context menu', async t => {
  const app = await mount(t);
  await app.openElement('a'); await app.choose('copy');
  await app.openCanvas();
  assert.deepEqual(app.editor.selection.elementIds, []);
  await app.choose('paste');
  assert.equal(app.editor.deck.slides[0].elements.length, 4);
  assert.equal(app.editor.deck.slides[0].elements.at(-1).text, 'A');
  await app.openCanvas(); await app.choose('add-text');
  assert.equal(app.editor.deck.slides[0].elements.at(-1).type, 'text');
  await app.openCanvas(); await app.choose('add-shape');
  assert.equal(app.editor.deck.slides[0].elements.at(-1).type, 'shape');
  await app.openCanvas(); await app.choose('add-image');
  assert.equal(app.images, 1);
  await app.openElement('a'); await app.choose('edit-text');
  assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'オブジェクトのテキスト' }).length, 1);
  const before = menu;
  assert.equal((await app.openCanvas(true)).prevented, false);
  assert.equal(menu, before);
  assert.equal((await app.openElement('b')).prevented, false, 'an active text edit is not replaced by an object menu');
});

test('filmstrip menus act on the clicked slide and blank menus create a slide', async t => {
  const app = await mount(t);
  await app.openSlide('two');
  assert.equal(app.editor.selection.slideId, 'two');
  await app.choose('move-previous');
  assert.deepEqual(app.editor.deck.slides.map(item => item.id), ['two', 'one', 'three']);
  await app.openSlide('three'); await app.choose('duplicate-slide');
  assert.equal(app.editor.deck.slides.length, 4);
  await app.openSlide('one'); await app.choose('delete-slide');
  assert.equal(app.editor.deck.slides.some(item => item.id === 'one'), false);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck.slides.some(item => item.id === 'one'), true);
  await app.openCanvas(); await app.choose('add-slide');
  assert.equal(app.editor.deck.slides.length, 5);
});

test('read-only and disabled features hide editing actions without swallowing native empty menus', async t => {
  const app = await mount(t);
  await app.openElement('a'); await app.choose('copy');
  await app.update({ features: { text: false, shapes: false, images: false, formatting: false, addSlides: false, deleteSlides: false, reorderSlides: false } });
  await app.openElement('a');
  assert.deepEqual(app.menu.items.map(item => item.id), ['copy', 'cut', 'delete']);
  assert.equal((await app.openCanvas()).prevented, false);
  assert.equal((await app.openSlide('one')).prevented, false);
  await app.update({ readOnly: true });
  assert.equal(app.menu.closed, true);
  await app.openElement('a');
  assert.deepEqual(app.menu.items.map(item => item.id), ['copy']);
  assert.equal((await app.openCanvas()).prevented, false);
  assert.equal((await app.openSlide('two')).prevented, false);
});

test('menu commands keep captured IDs after selection changes and reject a replaced deck', async t => {
  const app = await mount(t);
  await app.openElement('b');
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['a'] }));
  await app.choose('delete');
  assert.deepEqual(app.editor.deck.slides[0].elements.map(item => item.id), ['a', 'locked']);
  await app.openElement('a');
  const stale = app.menu.items.find(item => item.id === 'delete');
  await change(() => app.editor.execute({ type: 'deck.rename', title: 'Changed elsewhere' }));
  assert.equal(app.menu.closed, true);
  const before = app.editor.deck;
  await change(() => stale.onSelect());
  assert.equal(app.editor.deck, before);
  await app.openElement('a');
  await change(() => app.renderer.unmount());
  assert.equal(app.menu.closed, true);
});

test('image context actions retain their original deck and slide after selection changes', async t => {
  const app = await mount(t);
  const deck = app.editor.deck;
  await app.openCanvas();
  const image = app.menu.items.find(item => item.id === 'add-image');
  await change(() => app.editor.select({ slideId: 'two', elementIds: [] }));
  await change(() => image.onSelect());
  assert.equal(app.imageTarget.deck, deck);
  assert.equal(app.imageTarget.slideId, 'one');
});

test('permission rejection and a late approval after read-only preserve the deck and history', async t => {
  let resolve;
  const app = await mount(t, { onEditRequest: () => new Promise(yes => { resolve = yes; }) });
  await app.openElement('b');
  let pending;
  await change(() => { pending = app.menu.items.find(item => item.id === 'delete').onSelect(); });
  assert.equal(app.editor.requesting, true);
  assert.equal(app.menu.closed, true);
  await change(async () => { resolve(false); await pending; });
  assert.equal(app.editor.deck.slides[0].elements.length, 3);
  assert.equal(app.editor.canUndo, false);
  await app.openElement('b');
  await change(() => { pending = app.menu.items.find(item => item.id === 'delete').onSelect(); });
  await app.update({ readOnly: true });
  await change(async () => { resolve(true); await pending; });
  assert.equal(app.editor.deck.slides[0].elements.length, 3);
  assert.equal(app.editor.canUndo, false);
});

test('Shift right click keeps native menus without changing the selected element or slide', async t => {
  const app = await mount(t);
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['a'] }));
  for (const props of [{ 'data-slide-element': 'b' }, { 'data-filmstrip-id': 'two' }, { className: 'lxp-canvas-viewport' }]) {
    const event = { shiftKey: true, clientX: 100, clientY: 100, currentTarget: {}, target: { closest: () => null }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    await change(() => app.renderer.root.findByProps(props).props.onContextMenu(event));
    assert.equal(event.prevented, false);
    assert.deepEqual(app.editor.selection, { slideId: 'one', elementIds: ['a'] });
  }
  assert.equal(app.menu, undefined);
});
