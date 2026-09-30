import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: `export * from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const element = (id, options = {}) => m.createSlideElement({ type: 'shape', id, shape: 'rect', x: 100, y: 100, width: 100, height: 80, ...options });
const title = (id, options = {}) => m.createSlideElement({ type: 'text', id, text: 'Template prompt', x: 50, y: 40, width: 500, height: 80, fontSize: 32, ...options });
const page = (elements = []) => ({ id: 'page', name: 'Page', background: '#ffffff', notes: 'Notes', elements });
function library() { return { width: 1280, height: 720,
  masters: [{ id: 'master', name: 'Brand', background: '#101820', elements: [element('logo', { x: 40, y: 600 })] }],
  layouts: [{ id: 'title-layout', masterId: 'master', name: 'Title', background: '#112233', elements: [element('accent', { x: 0, y: 680, width: 1280, height: 8 })],
    placeholders: [{ id: 'title-slot', kind: 'title', element: title('title-prototype') }, { id: 'body-slot', kind: 'body', element: title('body-prototype', { y: 250 }) }] },
  { id: 'other-layout', masterId: 'master', name: 'Different', elements: [], placeholders: [{ id: 'other-title-slot', kind: 'title', element: title('other-title-prototype', { x: 180, fontSize: 40 }) }] }] }; }
const initial = (elements = []) => m.createSlideDeck({ ...library(), slides: [page(elements)] });
const execute = (deck, ...commands) => m.applySlideCommands(deck, commands).deck;
const apply = (deck, layoutId = 'title-layout') => execute(deck, { type: 'slide.applyLayout', slideId: 'page', layoutId });

test('native catalogs retain inheritance, stacking and unchanged legacy file bytes', () => {
  const legacy = m.createSlideDeck(), wire = m.serializeSlideDeck(legacy);
  assert.equal(m.serializeSlideDeck(m.parseSlideDeck(wire)), wire);
  assert.equal(Object.hasOwn(JSON.parse(wire), 'masters'), false);
  const deck = initial(), json = m.serializeSlideDeck(deck), stored = JSON.parse(json);
  assert.equal(stored.masters[0].elements[0].stackOrder, 0);
  assert.equal(stored.layouts[0].elements[0].stackOrder, 0);
  assert.equal(Object.hasOwn(stored.layouts[0].placeholders[0].element, 'stackOrder'), false);
  assert.deepEqual(m.parseSlideDeck(json), deck); assert.equal(m.serializeSlideDeck(m.parseSlideDeck(json)), json);
  delete stored.masters[0].elements[0].stackOrder;
  assert.throws(() => m.parseSlideDeck(JSON.stringify(stored)), /重なり順/);
});

test('library validation permits no pages and returns immutable independent catalogs', () => {
  const raw = library(), normalized = m.normalizeSlideMasterLibrary(raw);
  assert.equal(normalized.masters.length, 1); assert.equal(normalized.layouts.length, 2);
  raw.masters[0].name = 'mutated'; assert.equal(normalized.masters[0].name, 'Brand');
  assert.ok(Object.isFrozen(normalized.layouts[0].placeholders[0].element));
  assert.throws(() => m.normalizeSlideMasterLibrary({ ...raw, unknown: true }));
});

test('appearance references decorations without injecting them into page query or editing targets', () => {
  const deck = apply(initial([element('ordinary')])), slide = deck.slides[0];
  assert.equal(slide.elements.length, 3); assert.equal(slide.elements[1].text, '');
  assert.equal(slide.layoutId, 'title-layout'); assert.equal(slide.inheritBackground, true);
  const view = m.resolveSlideAppearance(deck, slide);
  assert.equal(view.background, '#112233'); assert.deepEqual(view.inheritedElements.map(item => item.id), ['logo', 'accent']);
  assert.equal(view.localElements, slide.elements);
  assert.equal(m.getElements(deck, 'page').length, 3); assert.equal(m.getElement(deck, 'page', 'logo'), undefined);
  assert.throws(() => execute(deck, { type: 'element.update', slideId: 'page', elementId: 'logo', patch: { x: 1 } }));
  assert.throws(() => execute(deck, { type: 'line.add', slideId: 'page', start: { x: 0, y: 0, binding: { targetId: 'logo', port: 'left' } }, end: { x: 1, y: 1 } }));
  assert.equal(m.getSlideMasters(deck)[0].name, 'Brand'); assert.equal(m.getSlideLayouts(deck, 'master').length, 2);
  assert.equal(m.getSlideLayout(deck, 'missing'), undefined);
  const hidden = m.normalizeSlideDeck({ ...deck, slides: [{ ...slide, showMasterShapes: false }] });
  assert.deepEqual(m.resolveSlideAppearance(hidden, hidden.slides[0]).inheritedElements.map(item => item.id), ['accent']);
  const layoutHidden = m.normalizeSlideDeck({ ...deck, layouts: deck.layouts.map(layout => ({ ...layout, showMasterShapes: false })) });
  assert.deepEqual(m.resolveSlideAppearance(layoutHidden, layoutHidden.slides[0]).inheritedElements.map(item => item.id), ['accent']);
});

test('applying and switching layouts preserves text, unmatched slots, ordinary elements, animations and connector IDs', () => {
  let deck = apply(initial([element('ordinary')])), [heading, body] = deck.slides[0].elements.filter(item => item.layoutPlaceholderId);
  deck = execute(deck, { type: 'element.update', slideId: 'page', elementId: heading.id, patch: { text: 'Customer title' } },
    { type: 'element.update', slideId: 'page', elementId: body.id, patch: { text: 'Keep this body' } },
    { type: 'line.add', slideId: 'page', id: 'connector', start: { x: 0, y: 0, binding: { targetId: heading.id, port: 'bottom' } }, end: { x: 100, y: 200 } },
    { type: 'animation.set', slideId: 'page', animations: [{ id: 'appear', animation: { type: 'tween', elementId: heading.id, durationMs: 100, from: { opacity: 0 }, to: { opacity: 1 } } }] });
  const changed = apply(deck, 'other-layout'), slide = changed.slides[0], actual = slide.elements.find(item => item.id === heading.id);
  assert.equal(actual.text, 'Customer title'); assert.equal(actual.x, 180); assert.equal(actual.fontSize, 40); assert.equal(actual.layoutPlaceholderId, 'other-title-slot');
  assert.equal(slide.elements.find(item => item.id === body.id).layoutPlaceholderId, undefined); assert.equal(slide.elements.find(item => item.id === body.id).text, 'Keep this body');
  assert.deepEqual(slide.elements.find(item => item.id === 'ordinary'), deck.slides[0].elements.find(item => item.id === 'ordinary'));
  assert.equal(slide.elements.find(item => item.id === 'connector').line.start.x, actual.x + actual.width / 2);
  assert.equal(slide.animations[0].animation.elementId, heading.id);
  assert.equal(m.applySlideCommands(changed, { type: 'slide.applyLayout', slideId: 'page', layoutId: 'other-layout' }).changed, false);
  assert.equal(m.resolveSlideAppearance(changed, slide).background, '#101820');
});

test('layout role matching is one-to-one in ordinal order', () => {
  let deck = initial();
  const raw = { ...deck, layouts: deck.layouts.map(layout => ({ ...layout, placeholders: layout.placeholders.map(slot => ({ ...slot, kind: 'body' })) })) };
  deck = apply(m.normalizeSlideDeck(raw));
  const [one, two] = deck.slides[0].elements;
  deck = execute(deck, { type: 'element.update', slideId: 'page', elementId: one.id, patch: { text: 'first' } },
    { type: 'element.update', slideId: 'page', elementId: two.id, patch: { text: 'second' } });
  const changed = apply(deck, 'other-layout').slides[0];
  assert.equal(changed.elements.find(item => item.id === one.id).layoutPlaceholderId, 'other-title-slot');
  assert.equal(changed.elements.find(item => item.id === two.id).layoutPlaceholderId, undefined);
});

test('new pages instantiate fresh local slots; duplicate pages preserve references while individual copies detach slot markers', () => {
  const deck = initial(), added = m.applySlideCommands(deck, { type: 'slide.add', layoutId: 'title-layout' }), page = added.deck.slides[1];
  assert.equal(page.layoutId, 'title-layout'); assert.equal(page.elements.length, 2);
  assert.ok(page.elements.every(element => element.text === '' && !element.locked));
  const duplicated = m.applySlideCommands(added.deck, { type: 'slide.duplicate', slideId: page.id }).deck.slides[2];
  assert.equal(duplicated.layoutId, page.layoutId); assert.notEqual(duplicated.elements[0].id, page.elements[0].id); assert.equal(duplicated.elements[0].layoutPlaceholderId, page.elements[0].layoutPlaceholderId);
  const copied = m.applySlideCommands(added.deck, { type: 'element.duplicate', slideId: page.id, elementIds: [page.elements[0].id] });
  assert.equal(copied.deck.slides[1].elements.find(item => item.id === copied.elementIds[0]).layoutPlaceholderId, undefined);
});

test('background override, replacement and detach use explicit inheritance and keep visual artwork', () => {
  const deck = apply(initial());
  const override = execute(deck, { type: 'slide.update', slideId: 'page', patch: { background: '#ff0000' } });
  assert.equal(override.slides[0].inheritBackground, false); assert.equal(m.resolveSlideAppearance(override, override.slides[0]).background, '#ff0000');
  const replaced = execute(deck, { type: 'slide.replaceContent', slideId: 'page', elements: [] });
  assert.equal(replaced.slides[0].layoutId, 'title-layout'); assert.equal(m.resolveSlideAppearance(replaced, replaced.slides[0]).inheritedElements.length, 2);
  const explicit = execute(deck, { type: 'slide.replaceContent', slideId: 'page', elements: [], background: '#00ff00' });
  assert.equal(m.resolveSlideAppearance(explicit, explicit.slides[0]).background, '#00ff00');
  const detached = execute(deck, { type: 'slide.detachLayout', slideId: 'page' }).slides[0];
  assert.equal(detached.layoutId, undefined); assert.equal(detached.background, '#112233'); assert.equal(detached.elements.length, 4);
  assert.notEqual(detached.elements[0].id, 'logo'); assert.ok(detached.elements.every(element => element.layoutPlaceholderId === undefined));
  assert.deepEqual(detached.elements.slice(2).map(element => element.id), deck.slides[0].elements.map(element => element.id));
});

test('library imports remap all identities, keep catalog connectors, scale geometry/styles, and form one undo step', () => {
  const raw = library();
  raw.masters[0].elements.push(element('catalog-line', { shape: 'line', line: { start: { x: 0, y: 0, binding: { targetId: 'logo', port: 'right' } }, end: { x: 400, y: 500 } } }));
  const initial = m.createSlideDeck({ width: 640, height: 360 }), session = m.createSlideSession(initial);
  const result = session.execute({ type: 'masters.import', library: raw });
  const deck = session.getSnapshot().deck;
  assert.equal(result.masterIds.length, 1); assert.equal(result.layoutIds.length, 2);
  assert.notEqual(deck.masters[0].id, 'master'); assert.equal(deck.layouts[0].masterId, deck.masters[0].id);
  assert.notEqual(deck.layouts[0].placeholders[0].id, 'title-slot');
  assert.equal(deck.layouts[0].placeholders[0].element.fontSize, 16); assert.equal(deck.masters[0].elements[0].x, 20);
  const line = deck.masters[0].elements.find(m.isSlideLine); assert.equal(line.line.start.binding.targetId, deck.masters[0].elements[0].id); assert.equal(line.line.end.x, 200);
  assert.equal(session.undo(), true); assert.equal(session.getSnapshot().deck, initial); assert.equal(session.redo(), true);
  const importedAgain = execute(deck, { type: 'masters.import', library: raw }); assert.equal(importedAgain.masters.length, 2);
  assert.notEqual(importedAgain.masters[0].elements[0].id, importedAgain.masters[1].elements[0].id);
});

test('layout switches preserve image content even when its replacement prototype is text', () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
  const raw = library();
  raw.layouts[0].placeholders[0].element = m.createSlideElement({ type: 'image', id: 'image-prototype', src, alt: 'Customer image', x: 10, y: 20, width: 100, height: 80 });
  const deck = apply(m.createSlideDeck({ ...raw, slides: [page()] })), image = deck.slides[0].elements[0];
  const switched = apply(deck, 'other-layout').slides[0].elements.find(element => element.id === image.id);
  assert.equal(switched.type, 'image'); assert.equal(switched.src, src); assert.equal(switched.alt, 'Customer image');
  assert.equal(switched.x, 180); assert.equal(switched.layoutPlaceholderId, 'other-title-slot');
});

test('detaching inherited connectors materializes fresh targets and keeps both endpoints attached', () => {
  const raw = library();
  raw.masters[0].elements.push(element('catalog-line', { shape: 'line', line: {
    start: { x: 0, y: 0, binding: { targetId: 'logo', port: 'right' } }, end: { x: 0, y: 0, binding: { targetId: 'logo', port: 'bottom' } },
  } }));
  const deck = apply(m.createSlideDeck({ ...raw, slides: [page()] }));
  const before = m.resolveSlideAppearance(deck, deck.slides[0]).inheritedElements.find(m.isSlideLine);
  const detached = execute(deck, { type: 'slide.detachLayout', slideId: 'page' });
  const target = detached.slides[0].elements[0], line = detached.slides[0].elements.find(m.isSlideLine);
  assert.notEqual(target.id, 'logo'); assert.notEqual(line.id, 'catalog-line');
  assert.equal(line.line.start.binding.targetId, target.id); assert.equal(line.line.end.binding.targetId, target.id);
  assert.equal(line.line.start.x, before.line.start.x); assert.equal(line.line.end.y, before.line.end.y);
  const moved = execute(detached, { type: 'element.update', slideId: 'page', elementId: target.id, patch: { x: target.x + 20 } });
  assert.equal(moved.slides[0].elements.find(m.isSlideLine).line.start.x, line.line.start.x + 20);
});

test('catalog references, slot provenance, unsupported fields and locked changes reject atomically', () => {
  const mutations = [
    value => { value.layouts[0].masterId = 'missing'; }, value => { value.layouts[0].id = value.layouts[1].id; },
    value => { value.layouts[0].placeholders.push(value.layouts[0].placeholders[0]); },
    value => { value.masters[0].elements[0] = { ...value.masters[0].elements[0], extra: 1 }; },
    value => { value.layouts[0].placeholders[0].element = { ...value.layouts[0].placeholders[0].element, layoutPlaceholderId: 'title-slot' }; },
    value => { value.layouts[0].elements = [value.masters[0].elements[0]]; },
  ];
  for (const mutate of mutations) { const value = library(); mutate(value); assert.throws(() => m.normalizeSlideMasterLibrary(value)); }
  const original = apply(initial());
  assert.throws(() => m.normalizeSlideDeck({ ...original, slides: [{ ...original.slides[0], layoutId: 'missing' }] }));
  assert.throws(() => m.normalizeSlideDeck({ ...original, slides: [{ ...original.slides[0], elements: [title('orphan', { layoutPlaceholderId: 'missing' })] }] }));
  assert.throws(() => m.createSlideDeck({ slides: [page([title('orphan', { layoutPlaceholderId: 'title-slot' })])] }));
  const id = original.slides[0].elements[0].id, locked = execute(original, { type: 'element.update', slideId: 'page', elementId: id, patch: { locked: true } });
  const json = m.serializeSlideDeck(locked);
  assert.throws(() => execute(locked, { type: 'deck.rename', title: 'Must not commit' }, { type: 'slide.applyLayout', slideId: 'page', layoutId: 'other-layout' }), /ロック/);
  assert.equal(m.serializeSlideDeck(locked), json);
});

test('shared catalogs remain subject to stored and effective per-page element limits', () => {
  const raw = library(); raw.masters[0].elements = Array.from({ length: 1000 }, (_, i) => element(`logo-${i}`));
  assert.throws(() => m.createSlideDeck({ ...raw, slides: [page()] }), /要素数/);
  raw.masters[0].elements = raw.masters[0].elements.slice(0, 997);
  const deck = m.createSlideDeck({ ...raw, slides: [page([element('extra')])] });
  assert.throws(() => apply(deck), /要素数/);
  const many = library(); many.masters = Array.from({ length: m.SLIDE_LIMITS.masters + 1 }, (_, i) => ({ id: `master-${i}`, name: '', background: '#fff', elements: [] }));
  assert.throws(() => m.normalizeSlideMasterLibrary(many), /マスター/);
});
