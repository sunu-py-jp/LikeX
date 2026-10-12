import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export {default as LikeSlide} from './src/slide'; export {useSlideEditor} from './src/state/use-slide-editor'; export {SlideSearchPanel} from './src/ui/slide-search-panel'; export {SlideCanvas} from './src/ui/slide-canvas'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlide, useSlideEditor, SlideSearchPanel, createSlideDeck, createSlideElement, serializeSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
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


test('initial slide search renders on the first paint with a hidden ribbon and read-only deck', () => {
  const html = renderToStaticMarkup(h(LikeSlide, { initialDeck: fixture(), readOnly: true, initialRibbonDisplayMode: 'hidden', initialSearchOpen: true, initialSearchQuery: 'needle' }));
  assert.match(html, /class="lxp-search-panel"/);
  assert.match(html, /aria-label="検索する文字列"[^>]*value="needle"/);
  assert.match(html, /class="lxp-ribbon" data-display-mode="hidden" hidden=""/);
  const disabled = renderToStaticMarkup(h(LikeSlide, { initialDeck: fixture(), initialSearchOpen: true, initialSearchQuery: 'needle', features: { search: false } }));
  assert.doesNotMatch(disabled, /class="lxp-search-panel"/);
});

test('initial slide search is mount-only, navigates without edits, and keeps the query through close and feature changes', async t => {
  let permissions = 0, changes = 0;
  const app = await mount(t, { readOnly: true, initialSearchOpen: true, initialSearchQuery: 'needle', onEditRequest() { permissions++; return true; }, onChange() { changes++; } });
  const api = app.ref.current;
  assert.equal(app.label('検索する文字列').props.value, 'needle');
  assert.equal(app.status, '1 / 2 件'); assert.equal(api.getPageNumber(), 2);
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false); assert.equal(permissions, 0); assert.equal(changes, 0);
  await app.update({ initialSearchOpen: false, initialSearchQuery: 'Sales review' });
  assert.equal(app.label('検索する文字列').props.value, 'needle');
  await change(() => api.closeSearch());
  await app.update({ initialSearchOpen: true, initialSearchQuery: 'Sales review' });
  assert.equal(app.label('検索する文字列'), undefined);
  await change(() => assert.equal(api.openSearch(), true));
  assert.equal(app.label('検索する文字列').props.value, 'needle');
  await app.update({ features: { search: false } });
  await app.update({ features: { search: true } });
  assert.equal(app.label('検索する文字列'), undefined);
  await change(() => assert.equal(api.openSearch(''), true));
  assert.equal(app.label('検索する文字列').props.value, '');
});

test('initially closed or disabled slide search retains its initial query and invalid inputs do not open it', async t => {
  for (const features of [undefined, { search: false }]) {
    const app = await mount(t, { initialSearchOpen: features ? true : false, initialSearchQuery: 'needle', features });
    assert.equal(app.label('検索する文字列'), undefined);
    await app.update({ features: { search: true } });
    assert.equal(app.label('検索する文字列'), undefined);
    await open(app); assert.equal(app.label('検索する文字列').props.value, 'needle');
  }
  for (const initialSearchQuery of [123, null, 'x'.repeat(4097)]) {
    const app = await mount(t, { initialSearchOpen: true, initialSearchQuery });
    assert.equal(app.label('検索する文字列').props.value, '');
    const api = app.ref.current;
    await change(() => api.closeSearch());
    assert.equal(api.openSearch(initialSearchQuery), false);
    assert.equal(app.label('検索する文字列'), undefined);
  }
});

const externalVisible = node => { for (let item = node; item; item = item.parent) if (item.props.hidden) return false; return true; };
const externalButton = (app, text) => app.renderer.root.findAll(node => node.type === 'button' && node.children.includes(text) && externalVisible(node))[0];
const externalRows = app => app.renderer.root.findAll(node => node.type === 'button' && node.props['data-external-result-id'] !== undefined);
const externalResults = () => [
  { id: 'rank-first', title: 'External relevance', snippet: 'A summary absent from the slide', target: { slideId: 'two', elementIds: ['text-two'] } },
  { id: 'rank-second', locationLabel: 'Sales / page one', target: { slideId: 'one' } },
];

test('external slide results retain rank and selection across all-pages browsing, local search and close', async t => {
  const selected = [], results = externalResults(), app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden', initialSearchOpen: true,
    externalSearch: { results, onResultSelect: result => selected.push(result.id) } }, true), api = app.ref.current;
  assert.equal(api.getPageNumber(), 2); assert.deepEqual(api.getSelection().elementIds, ['text-two']);
  const before = api.getDeck();
  assert.deepEqual(externalRows(app).map(row => row.props['data-external-result-id']), ['rank-first', 'rank-second']);
  assert.equal(externalVisible(app.label('検索する文字列')), false, 'external mode never runs its summary as a local query');
  const pages = app.label('スライド一覧');
  await change(() => externalButton(app, '全ページ').props.onClick());
  assert.equal(externalVisible(pages), true);
  await change(() => api.goToPage(1));
  await change(() => externalButton(app, '検索結果').props.onClick());
  assert.equal(api.getPageNumber(), 1, 'returning to the list does not steal page position');
  await change(() => externalButton(app, '選択した結果に戻る').props.onClick()); assert.equal(api.getPageNumber(), 2);
  await change(() => api.openSearch('Sales')); assert.equal(api.getPageNumber(), 1); assert.equal(externalVisible(app.label('検索する文字列')), true);
  await change(() => api.openExternalSearch()); assert.equal(api.getPageNumber(), 1, 'switching modes retains the external active result without auto-navigation');
  await change(() => externalButton(app, '選択した結果に戻る').props.onClick()); assert.equal(api.getPageNumber(), 2);
  await change(() => api.closeSearch()); await change(() => api.goToPage(1)); await change(() => api.openSearch());
  assert.equal(externalVisible(app.label('検索する文字列')), false); assert.equal(api.getPageNumber(), 1);
  assert.deepEqual(api.getDeck(), before); assert.deepEqual(selected, ['rank-first', 'rank-first', 'rank-first']);
});

test('external slide result IDs survive updates and invalid targets never select another element', async t => {
  const results = externalResults(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results } }, true), api = app.ref.current;
  await change(() => assert.equal(api.openExternalSearch('rank-second'), true)); assert.equal(api.getPageNumber(), 1);
  await app.update({ externalSearch: { results: [...results].reverse(), onResultSelect() { throw Error('observer'); } } });
  assert.equal(api.getPageNumber(), 1); assert.equal(externalRows(app)[0].props['aria-current'], 'true');
  await change(() => api.openExternalSearch('rank-first')); assert.equal(api.getPageNumber(), 2);
  await change(() => api.execute({ type: 'element.delete', slideId: 'two', elementIds: ['text-two'] }));
  const stale = externalRows(app).find(row => row.props['data-external-result-id'] === 'rank-first'); assert.equal(stale.props.disabled, true);
  assert.equal(api.openExternalSearch('rank-first'), false); assert.equal(api.openExternalSearch('missing'), false);
  await change(() => api.openExternalSearch('rank-second')); assert.equal(api.getPageNumber(), 1);
  await app.update({ features: { search: false } }); assert.equal(api.openExternalSearch(), false);
  await app.update({ features: { search: true } }); assert.equal(externalVisible(externalRows(app)[0]), false);
  await app.unmount(); assert.equal(api.openExternalSearch(), false);
});

test('external slide results are bound to the loaded document and refreshed explicitly for a replacement', async t => {
  const results = externalResults(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results } }, true), api = app.ref.current;
  const replacement = createSlideDeck({ ...fixture(), id: 'a-new-document' });
  await change(() => api.importNative(serializeSlideDeck(replacement)));
  assert.equal(api.getDeck().id, 'a-new-document');
  assert.equal(api.openExternalSearch('rank-first'), false, 'matching slide IDs in another document do not reuse old results');
  await app.update({ externalSearch: { results: [...results] } });
  assert.equal(api.getPageNumber(), 2);
});

test('external slide list is bounded, preserves full order and skips malformed or duplicate result IDs', async t => {
  const results = Array.from({ length: 1200 }, (_, n) => ({ id: String(n), title: `Rank ${n}`, target: { slideId: 'one' } }));
  const app = await mount(t, { initialSearchOpen: true, externalSearch: { results: [null, ...results, results[0]] } }, true);
  assert.equal(externalRows(app).length, 200);
  const more = app.renderer.root.findAll(node => node.type === 'button' && node.children.some(child => typeof child === 'string' && child.startsWith('さらに表示')))[0];
  await change(() => more.props.onClick()); assert.equal(externalRows(app).length, 400);
  await change(() => app.ref.current.openExternalSearch('1199'));
  assert.equal(externalRows(app).at(-1).props['data-external-result-id'], '1199');
});


test('partial external slide results wait for their requested initial result and navigate only once', async t => {
  const results = externalResults(), selected = [];
  const externalSearch = { results: [results[1]], initialResultId: 'rank-first', onResultSelect: result => selected.push(result.id) };
  const app = await mount(t, { initialSearchOpen: true, externalSearch }, true), api = app.ref.current;
  assert.equal(api.getPageNumber(), 1); assert.deepEqual(selected, []);
  await app.update({ externalSearch: { ...externalSearch, results } });
  assert.equal(api.getPageNumber(), 2); assert.deepEqual(selected, ['rank-first']);
  await change(() => api.goToPage(1));
  await app.update({ externalSearch: { ...externalSearch, results: [...results] } });
  assert.equal(api.getPageNumber(), 1); assert.deepEqual(selected, ['rank-first']);
});
