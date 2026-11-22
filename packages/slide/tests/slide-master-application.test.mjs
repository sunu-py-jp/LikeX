import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const text = (id, x = 40) => m.createSlideElement({ type: 'text', id, text: 'Template prompt', x, y: 40, width: 300, height: 70, fontSize: 30 });
const library = () => ({ width: 1280, height: 720,
  masters: [{ id: 'brand', name: 'Brand', background: '#112233', elements: [text('brand-mark')] }],
  layouts: [{ id: 'title', name: 'Title', masterId: 'brand', elements: [], placeholders: [{ id: 'title-slot', kind: 'title', element: text('title-prototype') }] },
    { id: 'body', name: 'Body', masterId: 'brand', background: '#445566', elements: [], placeholders: [{ id: 'body-slot', kind: 'title', element: text('body-prototype', 140) }] }],
});
const initial = (catalog = true) => m.createSlideDeck({ id: 'deck', ...(catalog ? library() : {}), slides: ['first', 'second', 'third'].map(id => ({
  id, name: id, background: '#ffffff', notes: `${id} notes`, elements: [m.createSlideElement({ type: 'text', id: `${id}-local`, text: `${id} content`, locked: true })],
})) });

test('default master layout applies to every page without mutating input, local content or identities', () => {
  const source = initial(), before = m.serializeSlideDeck(source);
  const result = m.applySlideMaster(source, { layoutId: 'title' });
  assert.equal(m.serializeSlideDeck(source), before);
  assert.equal(result.masterIds, undefined); assert.equal(result.layoutIds, undefined);
  assert.deepEqual(result.deck.slides.map(page => page.id), source.slides.map(page => page.id));
  for (const [index, page] of result.deck.slides.entries()) {
    assert.equal(page.layoutId, 'title'); assert.equal(page.inheritBackground, true);
    assert.equal(page.notes, source.slides[index].notes);
    assert.deepEqual(page.elements[0], source.slides[index].elements[0]);
    assert.equal(page.elements[1].text, '');
    assert.equal(m.resolveSlideAppearance(result.deck, page).background, '#112233');
  }
  const again = m.applySlideCommands(result.deck, { type: 'deck.applyMaster', layoutId: 'title' });
  assert.equal(again.changed, false); assert.equal(again.deck, result.deck);
});

test('per-page overrides select alternate layouts and null preserves the complete existing page', () => {
  let source = m.applySlideMaster(initial(), { layoutId: 'title' }).deck;
  const heading = source.slides[2].elements.find(element => element.layoutPlaceholderId);
  source = m.applySlideCommands(source, { type: 'element.update', slideId: 'third', elementId: heading.id, patch: { text: 'User heading' } }).deck;
  const result = m.applySlideMaster(source, { layoutId: 'body', layoutsBySlideId: { first: 'title', second: null } }).deck;
  assert.deepEqual(result.slides.map(page => page.layoutId), ['title', 'title', 'body']);
  assert.equal(result.slides[1], source.slides[1]);
  const updatedHeading = result.slides[2].elements.find(element => element.id === heading.id);
  assert.equal(updatedHeading.text, 'User heading'); assert.equal(updatedHeading.x, 140);
  assert.equal(m.applySlideMaster(source, { layoutId: 'body', layoutsBySlideId: { first: null, second: null, third: null } }).deck, source);
  const nonEnumerable = Object.create(null);
  Object.defineProperty(nonEnumerable, 'second', { value: null });
  assert.equal(m.applySlideMaster(source, { layoutId: 'body', layoutsBySlideId: nonEnumerable }).deck.slides[1], source.slides[1]);
});

test('imported library source IDs map to new catalog IDs once and geometry scales to the destination', () => {
  const source = m.normalizeSlideDeck({ ...initial(), width: 640, height: 360 }), input = library();
  const before = JSON.stringify(input), original = m.serializeSlideDeck(source);
  const result = m.applySlideCommands(source, { type: 'deck.applyMaster', library: input, layoutId: 'body', layoutsBySlideId: { first: 'title', second: null } });
  assert.equal(result.changed, true); assert.equal(result.masterIds.length, 1); assert.equal(result.layoutIds.length, 2);
  assert.deepEqual(result.deck.slides.map(page => page.layoutId), [result.layoutIds[0], undefined, result.layoutIds[1]]);
  assert.notEqual(result.masterIds[0], 'brand'); assert.notEqual(result.layoutIds[0], 'title');
  assert.equal(result.deck.masters.length, 2); assert.equal(result.deck.layouts.length, 4);
  assert.deepEqual(result.deck.masters[0], source.masters[0]);
  assert.equal(result.deck.slides[0].elements[1].x, 20); assert.equal(result.deck.slides[2].elements[1].fontSize, 15);
  assert.equal(result.deck.layouts[2].masterId, result.masterIds[0]);
  assert.equal(JSON.stringify(input), before); assert.equal(m.serializeSlideDeck(source), original);
  const onlySource = library(); onlySource.layouts = [onlySource.layouts[0]];
  assert.throws(() => m.applySlideMaster(source, { library: onlySource, layoutId: 'body' }), /レイアウト/,
    'library selections cannot silently resolve an identically named destination layout');
});

test('invalid configuration, unknown targets and late locked-page failures publish no partial import or changes', () => {
  const source = initial(), before = m.serializeSlideDeck(source);
  let getterCalls = 0;
  const accessor = {}; Object.defineProperty(accessor, 'first', { get() { getterCalls++; return 'title'; } });
  for (const application of [null, [], {}, { layoutId: '' }, { layoutId: 'missing' }, { layoutId: 'title', extra: true },
    { layoutId: 'title', layoutsBySlideId: null }, { layoutId: 'title', layoutsBySlideId: [] },
    { layoutId: 'title', layoutsBySlideId: { missing: 'title' } }, { layoutId: 'title', layoutsBySlideId: { first: undefined } },
    { layoutId: 'title', layoutsBySlideId: { first: 'missing' } }, { layoutId: 'title', layoutsBySlideId: accessor }])
    assert.throws(() => m.applySlideMaster(source, application));
  assert.equal(getterCalls, 0); assert.equal(m.serializeSlideDeck(source), before);
  assert.throws(() => m.applySlideCommands(source, { type: 'deck.applyMaster', layoutId: 'title', extra: true }));
  let locked = m.applySlideMaster(source, { layoutId: 'title' }).deck;
  const lastSlot = locked.slides[2].elements.find(element => element.layoutPlaceholderId);
  locked = m.applySlideCommands(locked, { type: 'element.update', slideId: 'third', elementId: lastSlot.id, patch: { locked: true } }).deck;
  const session = m.createSlideSession(locked), stored = m.serializeSlideDeck(locked);
  assert.throws(() => session.execute({ type: 'deck.applyMaster', library: library(), layoutId: 'body' }), /ロック/);
  assert.equal(session.getSnapshot().deck, locked); assert.equal(session.getSnapshot().canUndo, false);
  assert.equal(m.serializeSlideDeck(locked), stored);
});

test('deck-wide applications retain native/PPTX master references and reject stale conditional edits', async () => {
  const source = initial(false), command = { type: 'deck.applyMaster', library: library(), layoutId: 'body', layoutsBySlideId: { first: 'title', second: null } };
  const session = m.createSlideSession(source), result = session.execute(command);
  assert.equal(session.undo(), true); assert.equal(session.getSnapshot().deck, source);
  assert.equal(session.redo(), true); assert.equal(session.getSnapshot().deck, result.deck);
  assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(result.deck)), result.deck);
  const converted = (await m.importSlidePptx(await m.exportSlidePptx(result.deck))).deck;
  assert.deepEqual(converted.slides.map(slide => m.getSlideLayout(converted, slide.layoutId)?.name), ['Title', 'Blank', 'Body']);
  assert.deepEqual(converted.slides.map(slide => m.resolveSlideAppearance(converted, slide).background), ['#112233', '#ffffff', '#445566']);
  const edit = m.prepareSlideConditionalEdit(source, command);
  const changed = m.applySlideCommands(source, { type: 'element.update', slideId: 'third', elementId: 'third-local', patch: { locked: false } }).deck;
  const conflict = m.applySlideConditionalEdit(changed, edit);
  assert.equal(conflict.ok, false); assert.equal(conflict.code, 'conflict');
});

test('initial applications generate stable SSR identities, unique page slots and collision-free subsequent imports', () => {
  for (const withLibrary of [false, true]) {
    const source = initial(), application = { layoutId: 'title', ...(withLibrary ? { library: library() } : {}) };
    const first = m.applySlideMaster(source, application), repeated = m.applySlideMaster(structuredClone(source), structuredClone(application));
    assert.deepEqual(repeated, first);
    const localIds = first.deck.slides.flatMap(page => page.elements.map(element => element.id));
    assert.equal(new Set(localIds).size, localIds.length);
    const imported = m.applySlideMaster(first.deck, { library: library(), layoutId: 'body' });
    assert.ok(imported.masterIds.every(id => !first.deck.masters.some(master => master.id === id)));
    assert.ok(imported.layoutIds.every(id => !first.deck.layouts.some(layout => layout.id === id)));
  }
  const source = initial(), generated = m.applySlideMaster(source, { layoutId: 'title' }).deck.slides[0].elements[1].id;
  const colliding = m.normalizeSlideDeck({ ...source, slides: source.slides.map((page, index) => index ? page : {
    ...page, elements: [...page.elements, text(generated)],
  }) });
  const applied = m.applySlideMaster(colliding, { layoutId: 'title' }).deck;
  assert.notEqual(applied.slides[0].elements.find(element => element.layoutPlaceholderId).id, generated);
  assert.deepEqual(applied.slides[0].elements.find(element => element.id === generated), colliding.slides[0].elements[1]);
});

test('effective element limits are checked after every page receives the shared master', () => {
  const source = m.createSlideDeck({ slides: Array.from({ length: 11 }, (_, index) => ({ id: `page-${index}`, name: '', background: '#fff', notes: '', elements: [] })) });
  const huge = library(); huge.masters[0].elements = Array.from({ length: 950 }, (_, index) => text(`art-${index}`));
  const before = m.serializeSlideDeck(source);
  assert.throws(() => m.applySlideMaster(source, { library: huge, layoutId: 'title' }), /要素数/);
  assert.equal(m.serializeSlideDeck(source), before);
});
