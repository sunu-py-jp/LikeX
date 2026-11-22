import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

const output = await build({ stdin: { contents: `export {useSlideEditor} from './src/state/use-slide-editor'; export {SlideRibbon} from './src/ui/slide-ribbon'; export {SlideCanvas} from './src/ui/slide-canvas'; export {SlideArtwork} from './src/ui/slide-artwork'; export {default as LikeSlide} from './src/slide'; export * from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-and-decoder', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/pptx-masters$/ }, args => args.importer.endsWith('/state/use-slide-editor.ts') ? { path: 'masters-decoder', namespace: 'test' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const importSlidePptxMasters = (input, options) => globalThis.__slideMasterDecoder(input, options);', loader: 'js' }));
  } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=slide-masters-ui.js').toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = callback => act(async () => { await callback(); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const element = (id, text = id) => m.createSlideElement({ type: 'text', id, name: id, text, x: 40, y: 40, width: 280, height: 80 });
const library = () => ({ width: 1280, height: 720,
  masters: [{ id: 'master', name: 'Corporate', background: '#142c45', elements: [element('brand', 'BRAND')] }],
  layouts: [{ id: 'layout', masterId: 'master', name: 'Title', elements: [element('layout-decor', 'FOOTER')], placeholders: [{ id: 'title-slot', kind: 'title', element: element('title-prototype', 'Do not render this sample') }] },
    { id: 'body-layout', masterId: 'master', name: 'Body', elements: [], placeholders: [{ id: 'body-slot', kind: 'title', element: element('body-prototype') }] }] });
const fixture = (catalog = false) => m.createSlideDeck({ ...(catalog ? library() : {}), slides: ['one', 'two', 'three'].map(id => ({ id, name: id, background: '#ffffff', notes: '', elements: [element(`local-${id}`, id)] })) });
const multipleMasters = () => {
  const deck = fixture(true);
  return m.createSlideDeck({ ...deck,
    masters: [...deck.masters,
      { id: 'alternate-master', name: 'Alternate', background: '#563411', elements: [element('alternate-brand', 'ALTERNATE BRAND')] },
      { id: 'empty-master', name: 'No layouts', background: '#ffffff', elements: [] }],
    layouts: [...deck.layouts,
      { id: 'alternate-title', masterId: 'alternate-master', name: 'Alternate title', elements: [element('alternate-footer', 'ALTERNATE FOOTER')],
        placeholders: [{ id: 'alternate-title-slot', kind: 'title', element: element('alternate-title-prototype', 'ALTERNATE TITLE EXAMPLE') }] },
      { id: 'alternate-body', masterId: 'alternate-master', name: 'Alternate body', elements: [],
        placeholders: [{ id: 'alternate-body-slot', kind: 'body', element: element('alternate-body-prototype', 'ALTERNATE BODY EXAMPLE') }] }],
  });
};
const decoded = () => ({ library: library(), warnings: [], diagnostics: [] });
async function mount(t, supplied = {}, view = 'ribbon') {
  let editor, renderer, closed = false, props = { initialDeck: fixture(), onSave() {}, ...supplied };
  const ref = createRef(); let imported = 0;
  function Probe() { editor = m.useSlideEditor({ ...props, ref });
    return view === 'canvas' ? h(m.SlideCanvas, { deck: editor.deck, slide: editor.deck.slides.find(item => item.id === editor.selection.slideId), editor, zoom: 100 })
      : h(m.SlideRibbon, { editor, onImportMasters() { imported++; }, onProperties() {}, ownerDocument: null }); }
  const render = () => view === 'full' ? h(m.LikeSlide, { ...props, ref }) : h(Probe);
  await change(() => { renderer = create(render()); });
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { ref, renderer, get editor() { return editor; }, get imported() { return imported; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); } };
}
const button = (app, name) => app.renderer.root.findByProps({ 'aria-label': name });
const design = app => change(() => app.renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes('デザイン')).props.onClick());

test('master import appends definitions, preserves pages/selection, exposes isolated queries, and undoes as one edit', async t => {
  globalThis.__slideMasterDecoder = async (_input, options) => { assert.equal(options.signal.aborted, false); return decoded(); };
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  const before = app.ref.current.getDeck(), selected = app.ref.current.getSelection();
  await change(() => app.ref.current.importPptxMasters(new Uint8Array()));
  assert.deepEqual(app.ref.current.getDeck().slides, before.slides);
  assert.deepEqual(app.ref.current.getSelection(), selected);
  const masters = app.ref.current.getSlideMasters(), layouts = app.ref.current.getSlideLayouts(masters[0].id);
  assert.equal(masters.length, 1); assert.equal(layouts.length, 2); assert.equal(app.ref.current.getSlideLayout(layouts[0].id).name, 'Title');
  masters[0].name = 'tamper'; layouts[0].elements.length = 0;
  assert.equal(app.ref.current.getSlideMasters()[0].name, 'Corporate');
  assert.equal(app.ref.current.getSlideLayouts()[0].elements.length, 1);
  assert.equal(app.editor.dirty, true); assert.equal(app.editor.busy, null);
  assert.equal(events.filter(event => event.type === 'change').length, 1);
  await change(() => app.ref.current.undo());
  assert.deepEqual(app.ref.current.getDeck(), before); assert.deepEqual(app.ref.current.getSelection(), selected);
  await change(() => app.ref.current.redo()); assert.equal(app.ref.current.getSlideMasters().length, 1);
});

test('master import settles buffered edits before capturing its baseline and keeps both edits undoable', async t => {
  globalThis.__slideMasterDecoder = async () => decoded();
  const app = await mount(t); let pending = true, flushes = 0;
  app.editor.registerInputFlush(() => { if (pending) { pending = false; flushes++; void app.ref.current.execute({ type: 'deck.rename', title: 'Buffered' }); } }, () => pending);
  await change(() => app.ref.current.importPptxMasters(new Uint8Array()));
  assert.equal(flushes, 1); assert.equal(app.ref.current.getDeck().title, 'Buffered'); assert.equal(app.ref.current.getSlideMasters().length, 1);
  await change(() => app.ref.current.undo()); assert.equal(app.ref.current.getSlideMasters().length, 0); assert.equal(app.ref.current.getDeck().title, 'Buffered');
  await change(() => app.ref.current.undo()); assert.notEqual(app.ref.current.getDeck().title, 'Buffered');
});

test('master import guards readonly, disabled features, edit refusal and overlapping operations', async t => {
  let calls = 0; globalThis.__slideMasterDecoder = async () => { calls++; return decoded(); };
  for (const supplied of [{ readOnly: true }, { features: { masters: false } }, { features: { import: false } }, { onEditRequest: () => false }]) {
    const app = await mount(t, supplied); await change(() => app.ref.current.importPptxMasters(new Uint8Array()));
    assert.equal(app.ref.current.getSlideMasters().length, 0); assert.equal(app.editor.canUndo, false);
  }
  assert.equal(calls, 0);
  const wait = deferred(), app = await mount(t); let pending;
  globalThis.__slideMasterDecoder = async () => { calls++; await wait.promise; return decoded(); };
  await change(() => { pending = app.ref.current.importPptxMasters(new Uint8Array()); });
  await change(() => app.ref.current.importPptxMasters(new Uint8Array()));
  await change(async () => assert.equal(await app.ref.current.execute({ type: 'deck.rename', title: 'blocked' }), null));
  assert.equal(calls, 1); assert.equal(app.editor.busy, 'import');
  await change(async () => { wait.resolve(); await pending; }); assert.equal(app.ref.current.getSlideMasters().length, 1);
});

test('cancel, external abort, selection/feature/readonly changes and unmount discard late master results', async t => {
  for (const outcome of ['cancel', 'external', 'selection', 'masters', 'import', 'readonly', 'unmount']) await t.test(outcome, async child => {
    const wait = deferred(), external = new AbortController(), app = await mount(child); let pending, signal;
    globalThis.__slideMasterDecoder = async (_input, options) => { signal = options.signal; await wait.promise; return decoded(); };
    await change(() => { pending = app.ref.current.importPptxMasters(new Uint8Array(), { signal: external.signal }); });
    const originalHandle = app.ref.current;
    if (outcome === 'cancel') await change(() => originalHandle.cancelMasterImport());
    else if (outcome === 'external') await change(() => external.abort());
    else if (outcome === 'selection') await change(() => originalHandle.select({ slideId: 'two', elementIds: [] }));
    else if (outcome === 'unmount') await app.unmount();
    else if (outcome === 'readonly') await app.update({ readOnly: true });
    else await app.update({ features: { [outcome]: false } });
    await change(() => pending); assert.equal(signal.aborted, true);
    await change(() => wait.resolve()); assert.equal(originalHandle.getSlideMasters().length, 0);
    if (outcome !== 'unmount') { assert.equal(app.editor.busy, null); assert.equal(app.editor.canUndo, false); }
  });
});

test('cancelling an import waiting for edit permission frees the editor without applying a late grant', async t => {
  const wait = deferred(); let signal, pending;
  const app = await mount(t, { onEditRequest: (_request, context) => { signal = context.signal; return wait.promise; } });
  await change(() => { pending = app.ref.current.importPptxMasters(new Uint8Array()); });
  assert.equal(app.editor.requesting, true);
  await change(() => app.ref.current.cancelMasterImport()); await change(() => pending);
  assert.equal(signal.aborted, true); assert.equal(app.editor.busy, null); assert.equal(app.editor.requesting, false);
  await change(() => wait.resolve(true)); assert.equal(app.editor.canUndo, false);
});

const home = app => change(() => app.renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes('ホーム')).props.onClick());
const thumbnail = (app, id) => app.renderer.root.findByProps({ 'data-slide-layout-id': id });
const galleries = app => app.renderer.root.findAll(node => node.props.role === 'dialog' && typeof node.props['aria-label'] === 'string' && node.props['aria-label'].endsWith('レイアウトを選択'));
const openGallery = (app, mode = 'apply') => change(() => button(app, mode === 'apply' ? 'レイアウト' : '新しいスライドのレイアウト').props.onClick());
const selectLayout = async (app, id, mode = 'apply') => { await openGallery(app, mode); await change(() => thumbnail(app, id).props.onClick()); };

test('Home and Design galleries immediately apply or insert the pictured layout with atomic undo and retained selection', async t => {
  const app = await mount(t, { initialDeck: fixture(true) });
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  const before = app.ref.current.getDeck();
  await selectLayout(app, 'layout');
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.layoutId), ['layout', 'layout', undefined]);
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'two']);
  assert.equal(galleries(app).length, 0);
  await change(() => app.ref.current.undo()); assert.deepEqual(app.ref.current.getDeck(), before);
  await change(() => app.ref.current.redo());
  await design(app);
  await change(() => button(app, 'マスターを読み込む').props.onClick()); assert.equal(app.imported, 1);
  await change(() => button(app, 'レイアウトの継承を解除').props.onClick());
  assert.equal(app.ref.current.getDeck().slides[0].layoutId, undefined);
  assert.ok(app.ref.current.getDeck().slides[0].elements.some(element => element.text === 'BRAND'));
  await selectLayout(app, 'body-layout', 'add');
  const current = app.ref.current.getSelection().slideId;
  assert.equal(app.ref.current.getSlide(current).layoutId, 'body-layout');
  assert.equal(app.ref.current.getSlides().length, 4);
  assert.equal(galleries(app).length, 0);
  await home(app);
  await change(() => button(app, '新しいスライド').props.onClick());
  assert.equal(app.ref.current.getSlide(app.ref.current.getSelection().slideId).layoutId, 'body-layout');
});

test('gallery previews all masters and layout placeholders only while open, without changing data or edit state', async t => {
  let requests = 0;
  const events = [], app = await mount(t, { initialDeck: multipleMasters(), onEvent: event => events.push(event), onEditRequest: () => { requests++; return true; } });
  const before = app.ref.current.getDeck(), selection = app.ref.current.getSelection();
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-artwork' }).length, 0);
  await openGallery(app);
  assert.equal(galleries(app).length, 1);
  assert.deepEqual(app.renderer.root.findAll(node => node.props['data-slide-layout-id']).map(node => node.props['data-slide-layout-id']),
    ['layout', 'body-layout', 'alternate-title', 'alternate-body']);
  assert.equal(thumbnail(app, 'layout').props['aria-label'], 'Corporate / Title');
  const preview = thumbnail(app, 'alternate-title');
  assert.equal(preview.props['aria-label'], 'Alternate / Alternate title');
  assert.equal(preview.findByProps({ className: 'lxp-artwork' }).props.style.background, '#563411');
  assert.deepEqual(preview.findAllByProps({ className: 'lxp-element-text' }).map(node => node.children.join('')),
    ['ALTERNATE BRAND', 'ALTERNATE FOOTER', 'ALTERNATE TITLE EXAMPLE']);
  assert.deepEqual(app.ref.current.getDeck(), before);
  assert.deepEqual(app.ref.current.getSelection(), selection);
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
  assert.equal(requests, 0);
  assert.equal(events.filter(event => event.type === 'change').length, 0);
  await openGallery(app);
  assert.equal(galleries(app).length, 0);
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-artwork' }).length, 0);
});

test('thumbnail selection distinguishes matching layout names across masters and never inserts sample text', async t => {
  const deck = multipleMasters();
  const initialDeck = m.createSlideDeck({ ...deck, layouts: deck.layouts.map(layout => layout.id === 'alternate-title' ? { ...layout, name: 'Title' } : layout) });
  const app = await mount(t, { initialDeck });
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  await openGallery(app);
  assert.equal(thumbnail(app, 'layout').props['aria-label'], 'Corporate / Title');
  assert.equal(thumbnail(app, 'alternate-title').props['aria-label'], 'Alternate / Title');
  await change(() => thumbnail(app, 'alternate-title').props.onClick());
  assert.deepEqual(app.ref.current.getSlides().map(slide => slide.layoutId), ['alternate-title', 'alternate-title', undefined]);
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'two']);
  assert.ok(app.ref.current.getSlide('one').elements.some(item => item.id === 'local-one' && item.text === 'one'));
  assert.equal(app.ref.current.getSlide('one').elements.find(item => item.layoutPlaceholderId).text, '', 'thumbnail prompt is never page content');
  await change(() => app.ref.current.undo()); assert.deepEqual(app.ref.current.getDeck(), initialDeck);
  await change(() => app.ref.current.redo());
  await openGallery(app);
  assert.equal(thumbnail(app, 'alternate-title').props['aria-pressed'], true);
  assert.equal(thumbnail(app, 'layout').props['aria-pressed'], false);
});

test('applied-layout highlight follows all selected pages and galleries close when the target or layout changes', async t => {
  const initialDeck = m.applySlideCommands(multipleMasters(), [
    { type: 'slide.applyLayout', slideId: 'one', layoutId: 'alternate-title' },
    { type: 'slide.applyLayout', slideId: 'two', layoutId: 'body-layout' },
  ]).deck;
  const app = await mount(t, { initialDeck });
  await openGallery(app);
  assert.equal(thumbnail(app, 'alternate-title').props['aria-pressed'], true);
  const staleSelect = thumbnail(app, 'alternate-body').props.onClick;
  await change(() => app.ref.current.select({ slideId: 'two', elementIds: [] }));
  assert.equal(galleries(app).length, 0);
  await change(staleSelect);
  assert.deepEqual(app.ref.current.getDeck(), initialDeck, 'a dismissed gallery cannot edit a newly selected page');
  await openGallery(app);
  assert.equal(thumbnail(app, 'body-layout').props['aria-pressed'], true);
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  assert.equal(galleries(app).length, 0);
  await openGallery(app);
  assert.equal(app.renderer.root.findAll(node => node.props['data-slide-layout-id'] && node.props['aria-pressed']).length, 0);
  await change(() => app.ref.current.execute({ type: 'slide.applyLayout', slideId: 'two', layoutId: 'alternate-title' }));
  assert.equal(galleries(app).length, 0);
  await openGallery(app);
  assert.equal(thumbnail(app, 'alternate-title').props['aria-pressed'], true);
});

test('undoing a catalog import closes its gallery and cannot apply a removed thumbnail', async t => {
  const app = await mount(t, { initialDeck: fixture(true) }); let imported;
  await change(async () => { imported = await app.ref.current.execute({ type: 'masters.import', library: library() }); });
  await openGallery(app);
  const staleSelect = thumbnail(app, imported.layoutIds[0]).props.onClick;
  await change(() => app.ref.current.undo());
  assert.equal(galleries(app).length, 0);
  await change(staleSelect);
  assert.equal(app.editor.canUndo, false);
  assert.equal(app.ref.current.getSlides().some(slide => slide.layoutId), false);
  await openGallery(app);
  assert.deepEqual(app.renderer.root.findAll(node => node.props['data-slide-layout-id']).map(node => node.props['data-slide-layout-id']), ['layout', 'body-layout']);
});

test('empty catalogs and masters remain informative without offering invalid layout actions', async t => {
  const empty = await mount(t); await design(empty);
  assert.match(JSON.stringify(empty.renderer.toJSON()), /PPTX|POTX/);
  for (const name of ['レイアウト', '新しいスライドのレイアウト']) {
    const triggers = empty.renderer.root.findAllByProps({ 'aria-label': name });
    for (const trigger of triggers) assert.equal(trigger.props.disabled, true);
  }
  const app = await mount(t, { initialDeck: multipleMasters() });
  await openGallery(app);
  assert.match(JSON.stringify(app.renderer.toJSON()), /No layouts/);
  assert.equal(app.renderer.root.findAll(node => node.props['data-slide-layout-id']).length, 4);
  await design(app);
  assert.equal(galleries(app).length, 0);
});

test('readonly, feature and in-progress changes revoke layout actions including stale callbacks', async t => {
  for (const [mode, feature] of [['apply', 'formatting'], ['add', 'addSlides']]) {
    const app = await mount(t, { initialDeck: fixture(true) });
    await openGallery(app, mode);
    const staleSelect = thumbnail(app, 'layout').props.onClick, before = app.ref.current.getDeck();
    await app.update({ features: { [feature]: false } });
    assert.equal(galleries(app).length, 0);
    await change(staleSelect); assert.deepEqual(app.ref.current.getDeck(), before);
  }
  for (const patch of [{ readOnly: true }, { features: { masters: false } }]) {
    const app = await mount(t, { initialDeck: fixture(true) });
    await openGallery(app);
    const staleSelect = thumbnail(app, 'layout').props.onClick, before = app.ref.current.getDeck();
    await app.update(patch);
    assert.equal(galleries(app).length, 0);
    await change(staleSelect); assert.deepEqual(app.ref.current.getDeck(), before);
    await design(app);
    for (const trigger of app.renderer.root.findAllByProps({ 'aria-label': 'レイアウト' })) assert.equal(trigger.props.disabled, true);
    assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'マスターを読み込む' }).length, 0);
  }
  const wait = deferred(), app = await mount(t, { initialDeck: fixture(true) }); let pending;
  globalThis.__slideMasterDecoder = async () => { await wait.promise; return decoded(); };
  await openGallery(app);
  const staleSelect = thumbnail(app, 'layout').props.onClick;
  await change(() => { pending = app.ref.current.importPptxMasters(new Uint8Array()); });
  assert.equal(galleries(app).length, 0);
  await change(staleSelect); assert.equal(app.ref.current.getSlides().some(slide => slide.layoutId), false);
  await change(async () => { wait.resolve(); await pending; });
});

test('new-slide gallery cancels insertion when the active page changes while edit permission is pending', async t => {
  const permission = deferred();
  const app = await mount(t, { initialDeck: fixture(true), onEditRequest: () => permission.promise });
  const before = app.ref.current.getDeck();
  await openGallery(app, 'add');
  await change(() => thumbnail(app, 'body-layout').props.onClick());
  assert.equal(galleries(app).length, 0);
  assert.equal(app.editor.requesting, true);
  await change(() => app.ref.current.select({ slideId: 'two', elementIds: [] }));
  await change(() => permission.resolve(true));
  assert.deepEqual(app.ref.current.getDeck(), before);
  assert.equal(app.ref.current.getSelection().slideId, 'two');
  assert.equal(app.editor.canUndo, false);
});

test('layout application rejects a selection changed during permission and obeys API feature guards', async t => {
  const wait = deferred(); const app = await mount(t, { initialDeck: fixture(true), onEditRequest: () => wait.promise }); let pending;
  await change(() => { pending = app.editor.applyLayout('layout'); });
  await change(() => app.ref.current.select({ slideId: 'two', elementIds: [] }));
  await change(async () => { wait.resolve(true); assert.equal(await pending, null); });
  assert.equal(app.ref.current.getDeck().slides.some(slide => slide.layoutId), false);
  await app.update({ features: { masters: false } });
  for (const command of [{ type: 'masters.import', library: library() }, { type: 'slide.applyLayout', slideId: 'one', layoutId: 'layout' }, { type: 'slide.add', layoutId: 'layout' }]) await change(async () => assert.equal(await app.ref.current.execute(command), null));
  assert.equal(app.editor.canUndo, false);
});

test('inherited artwork is visible behind local elements but cannot be selected; empty placeholder hints stay in the editor', async t => {
  const deck = m.applySlideCommands(fixture(true), [{ type: 'slide.applyLayout', slideId: 'one', layoutId: 'layout' }]).deck;
  const app = await mount(t, { initialDeck: deck }, 'canvas');
  const surface = app.renderer.root.findByProps({ className: 'lxp-canvas-surface' });
  assert.equal(surface.props.style.background, '#142c45');
  const inherited = app.renderer.root.findAllByProps({ className: 'lxp-element lxp-inherited-element' });
  assert.equal(inherited.length, 2); assert.equal(inherited[0].props.onPointerDown, undefined);
  assert.equal(inherited[0].props['data-slide-element'], undefined);
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxp-placeholder-hint' }).length, 1);
  const placeholder = app.ref.current.getSlide('one').elements.find(element => element.layoutPlaceholderId);
  assert.equal(placeholder.text, '');
  await change(() => app.ref.current.select({ slideId: 'one', elementIds: ['brand', placeholder.id] }));
  assert.deepEqual(app.ref.current.getSelection().elementIds, [placeholder.id]);
  await change(() => app.editor.copyElements()); await change(() => app.editor.pasteElements());
  assert.equal(app.ref.current.getSlide('one').elements.filter(element => element.layoutPlaceholderId).length, 1, 'pasted objects do not claim the original layout slot');
  let artwork; await change(() => { artwork = create(h(m.SlideArtwork, { deck, slide: deck.slides[0] })); }); t.after(() => change(() => artwork.unmount()));
  assert.equal(artwork.root.findAllByProps({ className: 'lxp-placeholder-hint' }).length, 0);
  assert.equal(JSON.stringify(artwork.toJSON()).includes('Do not render this sample'), false);
  assert.equal(artwork.root.findByProps({ className: 'lxp-artwork' }).props.style.background, '#142c45');
});

test('full editor offers a PPTX/POTX chooser without replacing the existing page set', async t => {
  globalThis.__slideMasterDecoder = async () => decoded();
  const app = await mount(t, {}, 'full');
  const chooser = button(app, 'マスターを読み込むPowerPointまたはテンプレート'); assert.equal(chooser.props.accept, '.pptx,.potx');
  await change(() => chooser.props.onChange({ target: { files: [new Blob()], value: 'file' } }));
  assert.equal(app.ref.current.getSlides().length, 3); assert.equal(app.ref.current.getSlideMasters().length, 1);
});
