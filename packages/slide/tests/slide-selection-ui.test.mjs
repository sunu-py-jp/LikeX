import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export {default as LikeSlide} from './src/slide'; export {useSlideEditor} from './src/state/use-slide-editor'; export {SlideFilmstrip} from './src/ui/slide-filmstrip'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { LikeSlide, useSlideEditor, SlideFilmstrip, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const fixture = () => createSlideDeck({ slides: ['one', 'two', 'three', 'four'].map(id => ({ id, name: id, notes: '', background: '#fff',
  elements: id === 'one' ? ['a', 'b', 'locked'].map(id => createSlideElement({ type: 'text', id, text: id, locked: id === 'locked' })) : [] })) });
async function mount(t, supplied = {}, full = false) {
  const ref = createRef(); let editor, renderer, props = { initialDeck: fixture(), onSave() {}, ref, ...supplied };
  function Probe() { editor = useSlideEditor(props); return h(SlideFilmstrip, { editor }); }
  const view = () => full ? h(LikeSlide, props) : h(Probe);
  await change(() => { renderer = create(view()); });
  t.after(() => change(() => renderer.unmount()));
  return { ref, renderer, get editor() { return editor; }, async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(view())); } };
}
const thumbnail = (app, id) => app.renderer.root.findByProps({ 'data-filmstrip-id': id }).findByProps({ className: 'lxp-slide-thumbnail' });
const click = (app, id, modifiers = {}) => change(() => thumbnail(app, id).props.onClick(modifiers));
function key(app, value, scope, options = {}) {
  const event = { key: value, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, nativeEvent: { isComposing: false }, ...options,
    target: { closest(selector) {
      if (selector === '[data-slide-selection-scope]') return scope ? { dataset: { slideSelectionScope: scope }, focus() { event.focusedScope = scope; } } : null;
      if (selector === 'input,textarea,select,[contenteditable=true]') return options.input ? {} : null;
      if (selector === 'button:not(.lxp-slide-thumbnail)') return options.button ? {} : null;
      return null;
    } }, preventDefault() { this.defaultPrevented = true; } };
  app.renderer.root.findByProps({ 'data-likex-slide': '' }).props.onKeyDown(event);
  return event;
}

test('filmstrip supports modifier and contiguous selection, preserves active page and exposes selected buttons', async t => {
  const selections = [], app = await mount(t, { onSelectionChange: value => selections.push(value) });
  await click(app, 'two'); await click(app, 'four', { metaKey: true });
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'four', elementIds: [], slideIds: ['two', 'four'] });
  assert.equal(thumbnail(app, 'two').props['aria-pressed'], true);
  assert.equal(thumbnail(app, 'three').props['aria-pressed'], false);
  await click(app, 'four', { ctrlKey: true });
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'two', elementIds: [] });
  await click(app, 'two'); await click(app, 'four', { shiftKey: true });
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['two', 'three', 'four']);
  await click(app, 'one', { shiftKey: true });
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'one', elementIds: [], slideIds: ['one', 'two'] });
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['a'], slideIds: ['four', 'four', 'missing'] }));
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'one', elementIds: [], slideIds: ['one', 'four'] });
  selections.at(-1).slideIds.push('host mutation');
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'four']);
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['a'] }));
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'one', elementIds: ['a'] }, 'legacy selection shape is unchanged');
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
});

test('pointer selection is applied once despite the following click, even when reordering is disabled', async t => {
  const app = await mount(t, { features: { reorderSlides: false } });
  const item = () => app.renderer.root.findByProps({ 'data-filmstrip-id': 'three' });
  const pointer = { button: 0, ctrlKey: true, preventDefault() {}, target: { closest() { return null; } }, currentTarget: { querySelector() { return null; } } };
  await change(() => item().props.onPointerDown(pointer));
  await click(app, 'three', { ctrlKey: true });
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'three']);
  await app.update({ readOnly: true }); await click(app, 'four', { shiftKey: true });
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['three', 'four']);
  assert.equal(app.editor.dirty, false);
});

test('selected page queries follow current deck order and active page independently after moves and undo', async t => {
  const app = await mount(t), handle = app.ref.current;
  assert.equal(handle.getPageNumber(), 1);
  assert.deepEqual(handle.getSelectedPageNumbers(), [1]);
  assert.deepEqual(handle.getSelectedSlides().map(slide => slide.id), ['one']);
  await change(() => handle.select({ slideId: 'four', slideIds: ['four', 'two'], elementIds: [] }));
  assert.equal(handle.getPageNumber(), 4, 'active page need not be the first selected page');
  assert.deepEqual(handle.getSelectedPageNumbers(), [2, 4]);
  assert.deepEqual(handle.getSelectedSlides().map(slide => slide.id), ['two', 'four']);
  const pageNumbers = handle.getSelectedPageNumbers();
  pageNumbers.reverse(); pageNumbers.push(99);
  assert.deepEqual(handle.getSelectedPageNumbers(), [2, 4]);
  await change(() => handle.execute({ type: 'slide.move', slideId: 'four', index: 0 }));
  assert.equal(handle.getPageNumber(), 1);
  assert.deepEqual(handle.getSelectedPageNumbers(), [1, 3]);
  assert.deepEqual(handle.getSelectedSlides().map(slide => slide.id), ['four', 'two']);
  await change(() => handle.undo());
  assert.equal(handle.getPageNumber(), 4);
  assert.deepEqual(handle.getSelectedPageNumbers(), [2, 4]);
  assert.deepEqual(handle.getSelectedSlides().map(slide => slide.id), ['two', 'four']);
});

test('selected slide queries return detached final or authored data and remain available in read-only mode', async t => {
  const initialDeck = structuredClone(fixture());
  initialDeck.slides[0].elements[0].x = 10;
  initialDeck.slides[0].animations = [{ id: 'move', trigger: { type: 'click' }, animation: {
    type: 'tween', elementId: 'a', durationMs: 500, easing: 'linear', to: { x: 500 },
  } }];
  let permissionCalls = 0;
  const app = await mount(t, { initialDeck, readOnly: true, features: { export: false }, onSave: undefined,
    onEditRequest: () => { permissionCalls++; return false; } });
  await change(() => app.ref.current.select({ slideId: 'three', slideIds: ['three', 'one'], elementIds: [] }));
  assert.equal(app.ref.current.getPageNumber(), 3);
  assert.deepEqual(app.ref.current.getSelectedPageNumbers(), [1, 3]);
  const final = app.ref.current.getSelectedSlides();
  assert.deepEqual(final.map(slide => slide.id), ['one', 'three']);
  assert.equal(final[0].elements[0].x, 500); assert.equal(final[0].animations, undefined);
  assert.deepEqual(final, ['one', 'three'].map(id => app.ref.current.getSlide(id)));
  final[0].elements[0].x = 900; final[0].name = 'host mutation'; final.reverse(); final.pop();
  const authored = app.ref.current.getSelectedSlides({ includeAnimations: true });
  assert.equal(authored[0].elements[0].x, 10); assert.equal(authored[0].animations[0].animation.to.x, 500);
  assert.deepEqual(authored, ['one', 'three'].map(id => app.ref.current.getSlide(id, { includeAnimations: true })));
  authored[0].elements[0].x = 800; authored[0].animations[0].animation.to.x = 999;
  assert.equal(app.ref.current.getSelectedSlides()[0].elements[0].x, 500);
  assert.equal(app.ref.current.getSelectedSlides()[0].name, 'one');
  assert.equal(app.ref.current.getSelectedSlides({ includeAnimations: true })[0].elements[0].x, 10);
  assert.equal(app.ref.current.getSelectedSlides({ includeAnimations: true })[0].animations[0].animation.to.x, 500);
  assert.throws(() => app.ref.current.getSelectedSlides({ includeAnimations: 'yes' }));
  assert.throws(() => app.ref.current.getSelectedSlides({ unknown: true }));
  assert.equal(permissionCalls, 0); assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
});

test('selected pages delete atomically, choose a surviving neighbor, and restore selection with one undo', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  await change(async () => assert.equal((await app.ref.current.deleteSelection('slides')).changed, true));
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.id), ['three', 'four']);
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'three', elementIds: [] });
  assert.equal(app.ref.current.getPageNumber(), 1);
  assert.deepEqual(app.ref.current.getSelectedPageNumbers(), [1]);
  assert.deepEqual(app.ref.current.getSelectedSlides().map(slide => slide.id), ['three']);
  assert.equal(events.filter(event => event.type === 'change').length, 1);
  await change(async () => assert.equal(await app.ref.current.undo(), true));
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'two', elementIds: [], slideIds: ['one', 'two'] });
  assert.equal(app.ref.current.getPageNumber(), 2);
  assert.deepEqual(app.ref.current.getSelectedPageNumbers(), [1, 2]);
  assert.deepEqual(app.ref.current.getSelectedSlides().map(slide => slide.id), ['one', 'two']);
  assert.equal(app.ref.current.getDeck().slides.length, 4);
  await change(async () => assert.equal(await app.ref.current.undo(), false));
  await change(async () => assert.equal(await app.ref.current.redo(), true));
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.id), ['three', 'four']);
  assert.equal(app.ref.current.getPageNumber(), 1);
  assert.deepEqual(app.ref.current.getSelectedPageNumbers(), [1]);
  assert.deepEqual(app.ref.current.getSelectedSlides().map(slide => slide.id), ['three']);
  await change(() => app.ref.current.select({ slideId: 'four', slideIds: ['three', 'four'], elementIds: [] }));
  await change(async () => assert.equal(await app.ref.current.deleteSelection('slides'), null));
  assert.equal(app.ref.current.getDeck().slides.length, 2);
  assert.match(app.editor.notice.text, /少なくとも1枚/);
});

test('selection deletion respects permissions, feature/read-only/busy guards and rejects changed selections while waiting', async t => {
  for (const options of [{ readOnly: true }, { features: { deleteSlides: false } }, { onEditRequest: () => false }]) {
    const app = await mount(t, options), before = app.ref.current.getDeck();
    await change(() => app.ref.current.select({ slideId: 'one', slideIds: ['one', 'two'], elementIds: [] }));
    await change(async () => assert.equal(await app.ref.current.deleteSelection('slides'), null));
    assert.deepEqual(app.ref.current.getDeck(), before); assert.equal(app.editor.canUndo, false);
  }
  let allow, pending;
  const app = await mount(t, { onEditRequest: () => new Promise(resolve => { allow = resolve; }) });
  await change(() => app.ref.current.select({ slideId: 'one', slideIds: ['one', 'two'], elementIds: [] }));
  await change(() => { pending = app.ref.current.deleteSelection('slides'); });
  await change(() => app.ref.current.select({ slideId: 'one', slideIds: ['one', 'three'], elementIds: [] }));
  await change(async () => { allow(true); assert.equal(await pending, null); });
  assert.equal(app.ref.current.getDeck().slides.length, 4); assert.equal(app.editor.canUndo, false);
  let saved;
  await app.update({ onSave: () => new Promise(resolve => { saved = resolve; }) });
  await change(() => app.ref.current.execute({ type: 'deck.rename', title: 'Pending save' }));
  await change(() => { pending = app.ref.current.save(); });
  await change(async () => assert.equal(await app.ref.current.deleteSelection('slides'), null));
  await change(async () => { saved(); await pending; });
});

test('Delete and select-all target only the focused selection surface and preserve input and panel behavior', async t => {
  const app = await mount(t, {}, true);
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['a', 'b'] }));
  for (const [scope, options] of [[undefined, {}], ['elements', { input: true }], ['slides', { button: true }]]) {
    await change(() => assert.equal(key(app, 'Delete', scope, options).defaultPrevented, false));
    assert.equal(app.ref.current.getDeck().slides[0].elements.length, 3); assert.equal(app.ref.current.getDeck().slides.length, 4);
  }
  await change(() => key(app, 'Delete', 'elements'));
  assert.deepEqual(app.ref.current.getDeck().slides[0].elements.map(element => element.id), ['locked']);
  await change(() => app.ref.current.undo());
  assert.deepEqual(app.ref.current.getSelection().elementIds, ['a', 'b']);
  await change(() => key(app, 'a', 'slides', { metaKey: true }));
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'two', 'three', 'four']);
  await change(() => key(app, 'Delete', 'slides'));
  assert.equal(app.ref.current.getDeck().slides.length, 4, 'all pages cannot be deleted');
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['two', 'three'], elementIds: [] }));
  await change(() => assert.equal(key(app, 'Backspace', 'slides').focusedScope, 'slides'));
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.id), ['one', 'four']);
  await change(() => app.ref.current.undo());
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['a', 'locked'] }));
  await change(() => key(app, 'Delete', 'elements'));
  assert.equal(app.ref.current.getDeck().slides[0].elements.length, 3, 'locked targets reject the whole deletion');
});

test('individual page controls delete only that page and disable the last-page control', async t => {
  const app = await mount(t);
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  await change(() => app.renderer.root.findByProps({ 'aria-label': 'fourを削除' }).props.onClick());
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'two']);
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.id), ['one', 'two', 'three']);
  await change(() => app.ref.current.execute([{ type: 'slide.delete', slideId: 'one' }, { type: 'slide.delete', slideId: 'two' }]));
  assert.equal(app.renderer.root.findByProps({ 'aria-label': 'threeを削除' }).props.disabled, true);
});
