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

test('Design controls group layouts, apply selected pages atomically, detach and add from the chosen/current layout', async t => {
  const app = await mount(t, { initialDeck: fixture(true) }); await design(app);
  assert.deepEqual(app.renderer.root.findAllByType('optgroup').map(group => group.props.label), ['Corporate']);
  await change(() => button(app, 'マスターを読み込む').props.onClick()); assert.equal(app.imported, 1);
  await change(() => app.ref.current.select({ slideId: 'two', slideIds: ['one', 'two'], elementIds: [] }));
  await change(() => button(app, '選択したスライドにレイアウトを適用').props.onClick());
  assert.deepEqual(app.ref.current.getDeck().slides.map(slide => slide.layoutId), ['layout', 'layout', undefined]);
  assert.deepEqual(app.ref.current.getSelection().slideIds, ['one', 'two']);
  await change(() => app.ref.current.undo()); assert.equal(app.ref.current.getDeck().slides[0].layoutId, undefined);
  await change(() => app.ref.current.redo());
  await change(() => button(app, 'レイアウトの継承を解除').props.onClick());
  assert.equal(app.ref.current.getDeck().slides[0].layoutId, undefined);
  assert.ok(app.ref.current.getDeck().slides[0].elements.some(element => element.text === 'BRAND'));
  await change(() => button(app, 'スライドのレイアウト').props.onChange({ target: { value: 'body-layout' } }));
  await change(() => button(app, 'このレイアウトで新しいスライド').props.onClick());
  const current = app.ref.current.getSelection().slideId;
  assert.equal(app.ref.current.getSlide(current).layoutId, 'body-layout');
  await change(() => app.renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes('ホーム')).props.onClick());
  await change(() => button(app, '新しいスライド').props.onClick());
  assert.equal(app.ref.current.getSlide(app.ref.current.getSelection().slideId).layoutId, 'body-layout');
});

test('layout selection remains informative without a catalog and obeys feature/readonly controls', async t => {
  const app = await mount(t); await design(app);
  assert.equal(button(app, 'スライドのレイアウト').props.disabled, true);
  assert.match(app.renderer.root.findByProps({ className: 'lxp-layout-empty' }).children.join(''), /PPTX \/ POTX/);
  await app.update({ features: { masters: false } });
  assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'スライドのレイアウト' }).length, 0);
  const catalog = await mount(t, { initialDeck: fixture(true), features: { formatting: false, addSlides: false } }); await design(catalog);
  assert.equal(button(catalog, 'スライドのレイアウト').props.disabled, true);
  assert.equal(catalog.renderer.root.findAllByProps({ 'aria-label': '選択したスライドにレイアウトを適用' }).length, 0);
  await catalog.update({ readOnly: true, features: {} });
  assert.equal(button(catalog, '選択したスライドにレイアウトを適用').props.disabled, true);
  assert.equal(catalog.renderer.root.findAllByProps({ 'aria-label': 'マスターを読み込む' }).length, 0);
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
