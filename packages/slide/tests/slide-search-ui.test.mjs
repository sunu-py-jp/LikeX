import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export {default as LikeSlide} from './src/slide'; export {useSlideEditor} from './src/state/use-slide-editor'; export {SlideSearchPanel} from './src/ui/slide-search-panel'; export {SlideCanvas} from './src/ui/slide-canvas'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlide, useSlideEditor, SlideSearchPanel, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const fixture = () => createSlideDeck({ slides: ['one', 'two'].map((id, index) => ({ id, name: id, notes: 'Notes needle', background: '#fff',
  elements: [createSlideElement({ type: 'text', id: `text-${id}`, text: index ? 'Needle needle' : 'Sales review' })] })) });
async function mount(t, supplied = {}, full = false) {
  const ref = createRef(); let editor, renderer, active = true, focused = 0, props = { initialDeck: fixture(), onSave() {}, ref, ...supplied };
  function Probe() { editor = useSlideEditor(props); return editor.search.open && editor.features.search ? h(SlideSearchPanel, { editor, onClose: editor.closeSearch }) : null; }
  const render = () => full ? h(LikeSlide, props) : h(Probe);
  await change(() => { renderer = create(render(), { createNodeMock(element) {
    if (element.props['aria-label'] === '検索する文字列') return { focus() { focused++; }, select() {} };
    return null;
  } }); });
  const unmount = async () => { if (active) { active = false; await change(() => renderer.unmount()); } }; t.after(unmount);
  return { ref, renderer, unmount, get editor() { return editor; }, get focused() { return focused; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); },
    label(label) { return renderer.root.findAllByProps({ 'aria-label': label }).find(item => typeof item.type === 'string'); },
    get status() { return renderer.root.findAllByProps({ role: 'status' }).map(item => item.children.join('')).join(''); },
  };
}
const open = (app, query) => change(() => app.ref.current.openSearch(query));
function keyboard(app, extra = {}) {
  const event = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, nativeEvent: {}, target: { closest() { return null; } },
    preventDefault() { this.defaultPrevented = true; }, ...extra };
  app.renderer.root.findByProps({ 'data-likex-slide': '' }).props.onKeyDown(event); return event;
}

test('search finds text across pages, navigates occurrences, is literal and preserves document/history in read-only', async t => {
  let permissionCalls = 0, changes = 0;
  const app = await mount(t, { readOnly: true, onEditRequest() { permissionCalls++; return true; }, onChange() { changes++; } });
  const original = app.ref.current.getDeck({ includeAnimations: true });
  await open(app, 'needle');
  assert.equal(app.status, '1 / 2 件');
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'two', elementIds: ['text-two'] });
  assert.equal(app.renderer.root.findAllByType('mark').length, 2);
  await change(() => app.label('次の検索結果').props.onClick()); assert.equal(app.status, '2 / 2 件');
  await change(() => app.label('次の検索結果').props.onClick()); assert.equal(app.status, '1 / 2 件');
  await change(() => app.label('前の検索結果').props.onClick()); assert.equal(app.status, '2 / 2 件');
  const checkbox = app.renderer.root.findByProps({ type: 'checkbox' });
  await change(() => checkbox.props.onChange({ target: { checked: true } })); assert.equal(app.status, '1 / 1 件');
  await open(app, 'Sales review'); assert.equal(app.status, '1 / 1 件');
  await open(app, 'Sales.*'); assert.equal(app.status, '0 / 0 件');
  assert.deepEqual(app.ref.current.getDeck({ includeAnimations: true }), original);
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false); assert.equal(changes, 0); assert.equal(permissionCalls, 0);
});

test('search requests refocus, preserve query on reopen and respect feature disable/unmount/invalid calls', async t => {
  const app = await mount(t), api = app.ref.current;
  await open(app, 'needle'); const firstFocus = app.focused;
  await open(app); assert.ok(app.focused > firstFocus);
  await change(() => api.closeSearch()); assert.equal(app.label('検索する文字列'), undefined);
  await open(app); assert.equal(app.label('検索する文字列').props.value, 'needle');
  await app.update({ features: { search: false } }); assert.equal(app.label('検索する文字列'), undefined);
  assert.equal(api.openSearch('needle'), false);
  await app.update({ features: { search: true } });
  assert.equal(api.openSearch(123), false); assert.equal(api.openSearch('x'.repeat(4097)), false);
  await app.unmount(); assert.equal(api.openSearch(), false); api.closeSearch();
});

test('root shortcut opens visible search with hidden ribbon and read-only; IME/Alt/disabled searches are untouched', async t => {
  const app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden' }, true);
  let event; await change(() => { event = keyboard(app); });
  assert.equal(event.defaultPrevented, true); assert.ok(app.label('検索する文字列'));
  await change(() => app.ref.current.closeSearch());
  for (const extra of [{ altKey: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { ctrlKey: true, metaKey: true }]) {
    await change(() => { event = keyboard(app, extra); }); assert.notEqual(event.defaultPrevented, true); assert.equal(app.label('検索する文字列'), undefined);
  }
  await change(() => { event = keyboard(app, { ctrlKey: false, metaKey: true }); }); assert.equal(event.defaultPrevented, true);
  await app.update({ features: { search: false } });
  await change(() => { event = keyboard(app); }); assert.notEqual(event.defaultPrevented, true);
});

test('changing content refreshes results; stale and unfinished-input navigation cannot select another page', async t => {
  const app = await mount(t); await open(app, 'needle');
  const deck = app.editor.deck, match = app.editor.searchMatch;
  await change(() => app.ref.current.execute({ type: 'element.update', slideId: 'two', elementId: 'text-two', patch: { text: 'Something else' } }));
  assert.equal(app.status, '0 / 0 件');
  assert.equal(app.editor.selectSearchMatch(match, deck), false);
  await change(() => app.ref.current.undo()); assert.equal(app.status, '1 / 2 件');
  app.editor.registerInputFlush(() => {}, () => true);
  const selection = app.ref.current.getSelection();
  assert.equal(app.editor.selectSearchMatch({ ...match, slideId: 'one', elementId: 'text-one' }, app.editor.deck), false);
  assert.deepEqual(app.ref.current.getSelection(), selection);
});

test('Escape closes search and Enter supports forward/reverse navigation without changing content', async t => {
  const app = await mount(t); await open(app, 'needle');
  const event = extra => ({ key: 'Enter', nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
  await change(() => app.label('検索する文字列').props.onKeyDown(event())); assert.equal(app.status, '2 / 2 件');
  await change(() => app.label('検索する文字列').props.onKeyDown(event({ shiftKey: true }))); assert.equal(app.status, '1 / 2 件');
  await change(() => app.renderer.root.findByType('aside').props.onKeyDown(event({ key: 'Escape' })));
  assert.equal(app.label('検索する文字列'), undefined);
});

test('typing a search query is excluded from draft input tracking and highlights matched canvas objects', async t => {
  const dirty = [], app = await mount(t, { onDirtyChange(value) { dirty.push(value); } }, true);
  await open(app, 'needle');
  assert.ok(app.renderer.root.findByProps({ 'data-slide-search-highlight': 'text-two' }));
  const node = { value: 'needle', isConnected: true, matches() { return true; }, closest(selector) { return selector === '[data-slide-view-only]' ? {} : null; } };
  const root = () => app.renderer.root.findByProps({ 'data-likex-slide': '' });
  await change(() => root().props.onFocusCapture({ target: node }));
  node.value = 'Sales';
  await change(() => { app.label('検索する文字列').props.onChange({ target: node }); root().props.onInputCapture(); });
  assert.equal(app.ref.current.getPageNumber(), 1); assert.deepEqual(dirty, [false]);
  assert.ok(app.renderer.root.findByProps({ 'data-slide-search-highlight': 'text-one' }));
  await change(() => app.ref.current.closeSearch());
  assert.equal(app.renderer.root.findAllByProps({ 'data-slide-search-highlight': 'text-one' }).length, 0);
});

test('inherited text is found and outlined without pretending it is a local selectable element', async t => {
  const initialDeck = createSlideDeck({ masters: [{ id: 'master', name: 'Master', background: '#fff', elements: [createSlideElement({ type: 'text', id: 'inherited', text: 'Shared header' })] }],
    layouts: [{ id: 'layout', masterId: 'master', name: 'Layout', elements: [], placeholders: [] }],
    slides: [{ id: 'page', layoutId: 'layout', name: 'Page', notes: '', background: '#fff', elements: [] }] });
  const app = await mount(t, { initialDeck, readOnly: true }, true); await open(app, 'Shared');
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'page', elementIds: [] });
  assert.ok(app.renderer.root.findByProps({ 'data-slide-search-highlight': 'inherited' }));
});

test('live content edits refresh matches without taking the user back to the active search result', async t => {
  const app = await mount(t); await open(app, 'Sales');
  assert.equal(app.ref.current.getPageNumber(), 1);
  await change(() => app.ref.current.select({ slideId: 'two', elementIds: ['text-two'] }));
  await change(() => app.ref.current.execute({ type: 'element.update', slideId: 'two', elementId: 'text-two', patch: { text: 'A user edit' } }));
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'two', elementIds: ['text-two'] });
  assert.equal(app.status, '1 / 1 件');
  await change(() => app.label('次の検索結果').props.onClick());
  assert.equal(app.ref.current.getPageNumber(), 1, 'an explicit navigation still reveals the same active result');
  await open(app, 'edit');
  assert.equal(app.ref.current.getPageNumber(), 2, 'new query intent may navigate');
});

test('a search delayed by pending input navigates once, then later content changes only refresh its results', async t => {
  const app = await mount(t); let pending = true;
  app.editor.registerInputFlush(() => {}, () => pending);
  await open(app, 'needle'); assert.equal(app.ref.current.getPageNumber(), 1);
  pending = false;
  await change(() => app.ref.current.execute({ type: 'element.update', slideId: 'one', elementId: 'text-one', patch: { text: 'Committed input' } }));
  assert.equal(app.ref.current.getPageNumber(), 2);
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['text-one'] }));
  await change(() => app.ref.current.execute({ type: 'element.update', slideId: 'one', elementId: 'text-one', patch: { text: 'Another edit' } }));
  assert.equal(app.ref.current.getPageNumber(), 1);
});
