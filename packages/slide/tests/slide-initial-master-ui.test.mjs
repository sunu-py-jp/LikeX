import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export { useSlideEditor } from './src/state/use-slide-editor';
  export * from './src/model';
  export { importSlidePptx } from './src/import/import-pptx';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const element = (id, text = id) => m.createSlideElement({ type: 'text', id, name: id, text, x: 40, y: 50, width: 280, height: 60 });
const library = () => ({ width: 1280, height: 720,
  masters: [{ id: 'brand', name: 'Brand', background: '#173f5f', elements: [element('logo', 'BRAND')] }],
  layouts: [
    { id: 'body', masterId: 'brand', name: 'Body', elements: [], placeholders: [{ id: 'body-slot', kind: 'body', element: element('body-prototype', 'BODY SAMPLE') }] },
    { id: 'cover', masterId: 'brand', name: 'Cover', background: '#224466', elements: [], placeholders: [{ id: 'cover-slot', kind: 'title', element: element('cover-prototype', 'TITLE SAMPLE') }] },
  ],
});
const deck = (withCatalog = false) => m.createSlideDeck({ id: 'source', title: 'Source', ...(withCatalog ? library() : {}),
  slides: ['one', 'two', 'three'].map(id => ({ id, name: id, background: '#ffffff', notes: '', elements: [element(`text-${id}`, `Content ${id}`)] })) });

async function mount(t, supplied = {}) {
  let editor, renderer, closed = false, props = { initialDeck: deck(), onSave: value => value, ...supplied };
  const ref = createRef();
  function Probe() { editor = m.useSlideEditor({ ...props, ref }); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } });
  return { ref, get editor() { return editor; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); } };
}

test('initial master is applied before the first snapshot and is a clean readonly baseline, including page overrides', async t => {
  const original = deck(true), before = m.serializeSlideDeck(original), changes = [], dirty = [], events = [];
  let requests = 0;
  const app = await mount(t, { initialDeck: original, initialMaster: { layoutId: 'body', layoutsBySlideId: { one: 'cover', three: null } },
    initialPageNumber: 2, initialSlideId: 'two', readOnly: true, features: { masters: false, formatting: false, import: false },
    onEditRequest: () => { requests++; return false; }, onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value), onEvent: value => events.push(value) });
  assert.deepEqual(app.ref.current.getSlides().map(slide => slide.layoutId), ['cover', 'body', undefined]);
  assert.deepEqual(app.ref.current.getSlide('three'), original.slides[2]);
  for (const id of ['one', 'two']) {
    assert.equal(app.ref.current.getSlide(id).elements.find(item => item.id === `text-${id}`).text, `Content ${id}`);
    assert.equal(app.ref.current.getSlide(id).elements.find(item => item.layoutPlaceholderId).text, '');
  }
  assert.equal(app.ref.current.getPageNumber(), 2);
  assert.deepEqual(app.ref.current.getSelection(), { slideId: 'two', elementIds: [] });
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false); assert.equal(app.editor.canRedo, false);
  assert.equal(requests, 0); assert.deepEqual(changes, []); assert.deepEqual(dirty, [false]);
  assert.equal(events.some(event => event.type === 'change'), false);
  assert.equal(m.serializeSlideDeck(original), before);
  await change(async () => assert.equal(await app.ref.current.undo(), false));
});

test('initial library remaps source layout IDs and its applied master survives native and PowerPoint output', async t => {
  const original = deck(), source = library(), before = JSON.stringify({ original, source });
  const app = await mount(t, { initialDeck: original, initialMaster: { library: source, layoutId: 'body', layoutsBySlideId: { one: 'cover' } }, readOnly: true });
  const applied = app.ref.current.getDeck(), layouts = new Map(applied.layouts.map(layout => [layout.name, layout.id]));
  assert.notEqual(layouts.get('Body'), 'body'); assert.notEqual(applied.masters[0].id, 'brand');
  assert.deepEqual(applied.slides.map(slide => slide.layoutId), [layouts.get('Cover'), layouts.get('Body'), layouts.get('Body')]);
  assert.equal(JSON.stringify({ original, source }), before);
  let native, pptx;
  await change(async () => { native = await app.ref.current.exportNative(); pptx = await app.ref.current.exportPptx(); });
  assert.deepEqual(m.parseSlideDeck(await native.text()), applied);
  const { deck: restored } = await m.importSlidePptx(pptx);
  assert.equal(restored.masters.length, 1); assert.equal(restored.layouts.length, 2);
  assert.deepEqual(restored.slides.map(slide => restored.layouts.find(layout => layout.id === slide.layoutId).name), ['Cover', 'Body', 'Body']);
  assert.deepEqual(restored.slides.map(slide => m.resolveSlideAppearance(restored, slide).background.toLowerCase()), ['#224466', '#173f5f', '#173f5f']);
  assert.ok(restored.masters[0].elements.some(item => item.text === 'BRAND'));
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
});

test('edits undo and discard to the applied initial baseline, and save receives its master references', async t => {
  const saved = [];
  const app = await mount(t, { initialDeck: deck(true), initialMaster: { layoutId: 'body' }, onSave: value => { saved.push(value); return value; } });
  const baseline = app.ref.current.getDeck();
  await change(() => app.ref.current.execute({ type: 'deck.rename', title: 'Edited' }));
  assert.equal(app.editor.dirty, true);
  await change(() => app.ref.current.undo()); assert.deepEqual(app.ref.current.getDeck(), baseline); assert.equal(app.editor.dirty, false);
  await change(() => app.ref.current.redo()); assert.equal(app.editor.dirty, true);
  await change(() => app.ref.current.discard()); assert.deepEqual(app.ref.current.getDeck(), baseline); assert.equal(app.editor.canUndo, false);
  await change(() => app.ref.current.execute({ type: 'deck.rename', title: 'Saved' }));
  await change(async () => assert.equal(await app.ref.current.save(), true));
  assert.equal(saved.length, 1); assert.deepEqual(saved[0].slides.map(slide => slide.layoutId), ['body', 'body', 'body']);
  assert.equal(saved[0].masters[0].name, 'Brand'); assert.equal(app.editor.dirty, false);
});

test('initialMaster is read once and is not reapplied to an imported replacement', async t => {
  const app = await mount(t, { initialDeck: deck(true), initialMaster: { layoutId: 'body' } });
  const baseline = app.ref.current.getDeck();
  await app.update({ initialMaster: { layoutId: 'cover' }, initialDeck: deck() });
  assert.deepEqual(app.ref.current.getDeck(), baseline);
  const replacement = m.createSlideDeck({ id: 'replacement', slides: [{ id: 'other', name: 'Other', background: '#fff', notes: '', elements: [] }] });
  await change(() => app.ref.current.importNative(m.serializeSlideDeck(replacement)));
  assert.deepEqual(app.ref.current.getDeck(), replacement);
  assert.equal(app.ref.current.getDeck().masters, undefined); assert.equal(app.ref.current.getSlide('other').layoutId, undefined);
  await change(() => app.ref.current.undo()); assert.deepEqual(app.ref.current.getDeck(), baseline);
});

test('invalid initial master options report an error and leave the entire original deck as the baseline', async t => {
  for (const options of [null, {}, { layoutId: 'missing' }, { library: library(), layoutId: 'missing' },
    { library: library(), layoutId: 'body', layoutsBySlideId: { missing: 'cover' } },
    { library: library(), layoutId: 'body', layoutsBySlideId: { two: 'missing' } },
    { library: library(), layoutId: 'body', layoutsBySlideId: { two: false } },
    { library: library(), layoutId: 'body', unexpected: true }]) {
    const original = deck(), changes = [], app = await mount(t, { initialDeck: original, initialMaster: options, onChange: value => changes.push(value) });
    assert.deepEqual(app.ref.current.getDeck(), original);
    assert.equal(app.ref.current.getDeck().masters, undefined);
    assert.equal(app.editor.notice?.kind, 'error'); assert.ok(app.editor.notice.text);
    assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false); assert.deepEqual(changes, []);
  }
});

test('runtime deck.applyMaster obeys master/formatting/import permissions while preserving the selection', async t => {
  for (const supplied of [{ readOnly: true }, { features: { masters: false } }, { features: { formatting: false } }, { onEditRequest: () => false }]) {
    const original = deck(true), app = await mount(t, { initialDeck: original, ...supplied });
    await change(async () => assert.equal(await app.ref.current.execute({ type: 'deck.applyMaster', layoutId: 'body' }), null));
    assert.deepEqual(app.ref.current.getDeck(), original); assert.equal(app.editor.canUndo, false);
  }
  const app = await mount(t, { initialDeck: deck(true), features: { import: false } });
  const selection = { slideId: 'two', slideIds: ['one', 'two'], elementIds: [] };
  await change(() => app.ref.current.select(selection));
  await change(async () => assert.equal(await app.ref.current.execute({ type: 'deck.applyMaster', library: library(), layoutId: 'body' }), null));
  assert.equal(app.editor.canUndo, false);
  await change(async () => assert.equal((await app.ref.current.execute({ type: 'deck.applyMaster', layoutId: 'body' })).changed, true));
  assert.deepEqual(app.ref.current.getSelection(), selection);
  assert.deepEqual(app.ref.current.getSlides().map(slide => slide.layoutId), ['body', 'body', 'body']);
  await change(() => app.ref.current.undo()); assert.deepEqual(app.ref.current.getSlides().map(slide => slide.layoutId), [undefined, undefined, undefined]);
});

test('runtime master application rechecks disabled features after an asynchronous permission grant', async t => {
  let allow; const permission = new Promise(resolve => { allow = resolve; });
  const original = deck(true), app = await mount(t, { initialDeck: original, onEditRequest: () => permission }); let pending;
  await change(() => { pending = app.ref.current.execute({ type: 'deck.applyMaster', layoutId: 'body' }); });
  await app.update({ features: { masters: false } });
  await change(async () => { allow(true); assert.equal(await pending, null); });
  assert.deepEqual(app.ref.current.getDeck(), original); assert.equal(app.editor.canUndo, false);
});
