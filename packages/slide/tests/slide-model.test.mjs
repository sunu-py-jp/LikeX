import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({ absWorkingDir: packageRoot, entryPoints: ['src/model-entry.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, normalizeSlideDeck, parseSlideDeck, serializeSlideDeck, applySlideCommands,
  getSlide, getElement, createSlideSession, SLIDE_LIMITS } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
const slide = (id, elements = []) => ({ id, name: id, background: '#fff', notes: '', elements });
const text = (id, patch = {}) => createSlideElement({ type: 'text', id, text: id, ...patch });
const deck = () => createSlideDeck({ id: 'deck', title: 'Example', slides: [slide('one', [text('a'), text('b'), text('c'), text('d')]), slide('two')] });

test('factories create one usable slide and JSON-only immutable isolated values', () => {
  const empty = createSlideDeck();
  assert.equal(empty.format, 'likex.slide');
  assert.equal(empty.version, 1);
  assert.equal(empty.slides.length, 1);
  assert.equal(empty.width / empty.height, 16 / 9);
  const supplied = JSON.parse(serializeSlideDeck(deck()));
  const accepted = normalizeSlideDeck(supplied);
  supplied.slides[0].elements[0].text = 'host mutation';
  assert.equal(accepted.slides[0].elements[0].text, 'a');
  assert.ok(Object.isFrozen(accepted) && Object.isFrozen(accepted.slides) && Object.isFrozen(accepted.slides[0].elements[0]));
  assert.throws(() => { accepted.slides[0].elements.push(text('new')); }, TypeError);
  assert.equal(normalizeSlideDeck(accepted), accepted);
  assert.equal(serializeSlideDeck(parseSlideDeck(serializeSlideDeck(accepted))), serializeSlideDeck(accepted));
  assert.equal(getSlide(accepted, 'two').name, 'two');
  assert.equal(getElement(accepted, 'one', 'a').text, 'a');
  assert.equal(getElement(accepted, 'missing', 'a'), undefined);
});

test('native SLON JSON carries a format marker and accepts legacy unmarked decks', () => {
  const original = deck();
  const { format, ...legacy } = JSON.parse(serializeSlideDeck(original));
  assert.equal(format, 'likex.slide');
  assert.deepEqual(parseSlideDeck(JSON.stringify(legacy)), original);
  assert.deepEqual(createSlideDeck(legacy), original);
  assert.equal(JSON.parse(serializeSlideDeck(legacy)).format, 'likex.slide');
  const session = createSlideSession(legacy);
  assert.equal(session.getSnapshot().deck.format, 'likex.slide');
  assert.equal(session.getSnapshot().dirty, false);
  session.replace(original);
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().canUndo, false);
  for (const marker of ['likex.spreadsheet', 'another.slide', '', null, 1, {}]) {
    assert.throws(() => parseSlideDeck(JSON.stringify({ ...legacy, format: marker })), /LikeSlideのファイル形式/);
    assert.throws(() => createSlideDeck({ ...legacy, format: marker }), /LikeSlideのファイル形式/);
  }
});

test('all element types retain JSON formatting, text, image and geometry without DOM dependencies', () => {
  const items = [text('text', { text: '日本語\nA & <B>', color: '#ABC', rotation: -30, bold: true, italic: true }),
    createSlideElement({ type: 'shape', id: 'shape', shape: 'diamond', text: 'Review', fill: '#abcd', strokeWidth: 0 }),
    createSlideElement({ type: 'image', id: 'image', src: pixel, alt: 'A picture', width: .5, height: .25, opacity: .4 })];
  const accepted = createSlideDeck({ slides: [slide('one', items)] });
  const restored = parseSlideDeck(serializeSlideDeck(accepted));
  assert.deepEqual(restored, accepted);
  assert.equal(items[0].color, '#aabbcc');
  assert.equal(items[0].rotation, 330);
  assert.equal(items[1].fill, '#aabbccdd');
  assert.equal(items[2].src, pixel);
});

test('untrusted JSON rejects malformed models, unsupported properties, sparse arrays and duplicate IDs', () => {
  const original = JSON.parse(serializeSlideDeck(deck()));
  for (const patch of [{ version: 2 }, { slides: [] }, { width: Infinity }, { height: 0 }, { id: ' bad' }, { unknown: true }])
    assert.throws(() => normalizeSlideDeck({ ...original, ...patch }));
  assert.throws(() => createSlideDeck({ slides: Array(1) }));
  assert.throws(() => createSlideDeck({ slides: [slide('same'), slide('same')] }));
  assert.throws(() => createSlideDeck({ slides: [slide('a', [text('same')]), slide('b', [text('same')])] }));
  assert.throws(() => normalizeSlideDeck(new Date()));
  assert.throws(() => parseSlideDeck('{ broken'));
  assert.throws(() => createSlideDeck({ title: '\ud800' }));
  assert.throws(() => createSlideElement({ type: 'text', text: '\ufffe' }));
  assert.throws(() => createSlideElement({ type: 'text', text: 'x'.repeat(SLIDE_LIMITS.textLength + 1) }));
  assert.throws(() => createSlideElement({ type: 'text', src: pixel }));
  let accessed = false;
  const malicious = { ...original, get title() { accessed = true; return 'x'; } };
  assert.throws(() => normalizeSlideDeck(malicious));
  assert.equal(accessed, false);
});

test('image and presentation styles cannot smuggle URLs, SVG or executable CSS', () => {
  for (const src of ['https://example.com/photo.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,PHN2Zy8+', pixel.replace('image/png', 'image/jpeg'), pixel + '\n'])
    assert.throws(() => createSlideElement({ type: 'image', src }));
  for (const fill of ['url(https://example.com/a)', 'red; color: blue', 'var(--external)', '#12'])
    assert.throws(() => createSlideElement({ type: 'shape', fill }));
  for (const fontFamily of ['Arial; background:url(x)', 'url(https://example.com/font)', 'Arial\n'])
    assert.throws(() => createSlideElement({ type: 'text', fontFamily }));
  for (const patch of [{ x: NaN }, { width: 0 }, { opacity: 2 }, { locked: 'yes' }, { fontSize: 0 }])
    assert.throws(() => createSlideElement({ type: 'text', ...patch }));
});

test('commands edit privately, share unaffected slides and return selection receipts', () => {
  const original = deck();
  const added = applySlideCommands(original, { type: 'element.add', slideId: 'one', element: { type: 'shape', id: 'new', text: 'Hi' } });
  assert.equal(added.changed, true);
  assert.equal(added.slideId, 'one');
  assert.deepEqual(added.elementIds, ['new']);
  assert.equal(original.slides[0].elements.length, 4);
  assert.equal(added.deck.slides[1], original.slides[1]);
  const result = applySlideCommands(added.deck, [
    { type: 'deck.rename', title: 'Renamed' },
    { type: 'deck.resize', width: 960, height: 720 },
    { type: 'slide.update', slideId: 'one', patch: { background: '#000', notes: 'Presenter notes' } },
    { type: 'element.update', slideId: 'one', elementId: 'new', patch: { x: 240, rotation: 90, text: 'Changed' } },
  ]);
  assert.equal(result.deck.title, 'Renamed');
  assert.equal(result.deck.slides[0].notes, 'Presenter notes');
  assert.equal(getElement(result.deck, 'one', 'new').text, 'Changed');
  assert.equal(getElement(result.deck, 'one', 'new').rotation, 90);
  assert.ok(Object.isFrozen(result.elementIds));
});

test('invalid or locked operations reject the complete batch and preserve its input', () => {
  const original = deck(), serialized = serializeSlideDeck(original);
  assert.throws(() => applySlideCommands(original, [{ type: 'deck.rename', title: 'Temporary' },
    { type: 'element.update', slideId: 'one', elementId: 'missing', patch: { x: 1 } }]));
  assert.equal(serializeSlideDeck(original), serialized);
  assert.throws(() => applySlideCommands(original, { type: 'element.update', slideId: 'one', elementId: 'a', patch: { type: 'image', src: pixel } }));
  assert.throws(() => applySlideCommands(original, { type: 'element.add', slideId: 'two', element: { type: 'text', id: 'a' } }));
  assert.throws(() => applySlideCommands(original, { type: 'deck.rename', title: 'x', surprise: true }));
  assert.throws(() => applySlideCommands(original, Array(1)));
  const locked = applySlideCommands(original, { type: 'element.update', slideId: 'one', elementId: 'a', patch: { locked: true } }).deck;
  for (const type of ['element.delete', 'element.duplicate', 'element.order'])
    assert.throws(() => applySlideCommands(locked, { type, slideId: 'one', elementIds: ['a'], ...(type === 'element.order' ? { direction: 'front' } : {}) }));
  assert.throws(() => applySlideCommands(locked, { type: 'element.update', slideId: 'one', elementId: 'a', patch: { x: 10, locked: false } }));
  const unlocked = applySlideCommands(locked, [{ type: 'element.update', slideId: 'one', elementId: 'a', patch: { locked: false } },
    { type: 'element.update', slideId: 'one', elementId: 'a', patch: { x: 10 } }]);
  assert.equal(getElement(unlocked.deck, 'one', 'a').x, 10);
});

test('multi-selection stacking keeps selected order for each direction and duplicate IDs are fresh', () => {
  const original = deck();
  const order = (ids, direction) => applySlideCommands(original,
    { type: 'element.order', slideId: 'one', elementIds: ids, direction }).deck.slides[0].elements.map(element => element.id);
  assert.deepEqual(order(['c', 'a'], 'front'), ['b', 'd', 'a', 'c']);
  assert.deepEqual(order(['c', 'a'], 'back'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(order(['a', 'b'], 'forward'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(order(['c', 'd'], 'backward'), ['a', 'c', 'd', 'b']);
  const copied = applySlideCommands(original, { type: 'element.duplicate', slideId: 'one', elementIds: ['b', 'a'] });
  assert.equal(copied.elementIds.length, 2);
  assert.equal(new Set(copied.deck.slides[0].elements.map(element => element.id)).size, 6);
  assert.equal(getElement(copied.deck, 'one', copied.elementIds[0]).x, 120);
  assert.equal(getElement(copied.deck, 'one', copied.elementIds[0]).text, 'a');
});

test('slide insertion, duplication, reordering and deletion preserve a nonempty deck', () => {
  const original = deck();
  const added = applySlideCommands(original, { type: 'slide.add', afterId: 'one', slide: { id: 'middle', name: 'Middle' } });
  assert.deepEqual(added.deck.slides.map(slide => slide.id), ['one', 'middle', 'two']);
  const moved = applySlideCommands(added.deck, { type: 'slide.move', slideId: 'middle', index: 2 });
  assert.deepEqual(moved.deck.slides.map(slide => slide.id), ['one', 'two', 'middle']);
  const copied = applySlideCommands(original, { type: 'slide.duplicate', slideId: 'one' });
  assert.equal(copied.deck.slides[1].elements.length, 4);
  assert.equal(new Set(copied.deck.slides.flatMap(slide => slide.elements.map(element => element.id))).size, 8);
  assert.equal(copied.deck.slides[1].id, copied.slideId);
  const removed = applySlideCommands(original, { type: 'slide.delete', slideId: 'one' });
  assert.equal(removed.slideId, 'two');
  assert.throws(() => applySlideCommands(removed.deck, { type: 'slide.delete', slideId: 'two' }));
});

test('empty, same-value and fully reversed batches preserve snapshot identity', () => {
  const original = deck();
  for (const commands of [[], { type: 'deck.rename', title: original.title }, { type: 'element.update', slideId: 'one', elementId: 'a', patch: {} },
    [{ type: 'deck.rename', title: 'temporary' }, { type: 'deck.rename', title: original.title }]]) {
    const result = applySlideCommands(original, commands);
    assert.equal(result.changed, false);
    assert.equal(result.deck, original);
  }
});

test('session keeps stable snapshots, isolates observer failures and records a batch as one undo step', () => {
  const session = createSlideSession(deck()), start = session.getSnapshot();
  let notifications = 0;
  const unsubscribe = session.subscribe(() => notifications++);
  session.subscribe(() => { throw Error('observer failure'); });
  session.execute([]);
  assert.equal(session.getSnapshot(), start);
  session.execute([{ type: 'deck.rename', title: 'Changed' }, { type: 'slide.update', slideId: 'one', patch: { notes: 'Changed' } }]);
  assert.equal(session.getSnapshot().dirty, true);
  assert.equal(notifications, 1);
  assert.equal(session.undo(), true);
  assert.equal(session.getSnapshot().deck, start.deck);
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.undo(), false);
  assert.equal(session.redo(), true);
  unsubscribe();
  session.execute({ type: 'deck.rename', title: 'Another' });
  assert.equal(notifications, 3);
});

test('saving preserves undo/redo and dirty compares with the saved contents through history', () => {
  const session = createSlideSession(deck());
  session.execute({ type: 'deck.rename', title: 'Saved title' });
  const saved = session.getSnapshot().deck;
  session.markSaved();
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().canUndo, true);
  session.undo();
  assert.equal(session.getSnapshot().dirty, true);
  session.markSaved();
  assert.equal(session.getSnapshot().canRedo, true);
  session.redo();
  assert.equal(session.getSnapshot().deck, saved);
  assert.equal(session.getSnapshot().dirty, true);
  session.markSaved(createSlideDeck({ ...saved, title: 'Server title' }));
  assert.equal(session.getSnapshot().deck.title, 'Server title');
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().canUndo, true);
});

test('replacement, discard and failed commands keep history and baselines consistent', () => {
  const session = createSlideSession(deck()), initial = session.getSnapshot();
  assert.throws(() => session.execute([{ type: 'deck.rename', title: 'temporary' }, { type: 'slide.delete', slideId: 'missing' }]));
  assert.equal(session.getSnapshot(), initial);
  session.replace(createSlideDeck({ title: 'Imported' }));
  assert.equal(session.getSnapshot().dirty, true);
  session.undo();
  assert.equal(session.getSnapshot().deck, initial.deck);
  session.execute({ type: 'deck.rename', title: 'Branch' });
  assert.equal(session.getSnapshot().canRedo, false);
  session.discard();
  assert.equal(session.getSnapshot().deck, initial.deck);
  assert.equal(session.getSnapshot().canUndo, false);
  session.replace(createSlideDeck({ title: 'Loaded' }), { saved: true });
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().deck.title, 'Loaded');
  assert.equal(session.getSnapshot().canUndo, false);
});

test('invalid save responses and replacements leave snapshots, baseline and redo untouched', () => {
  const session = createSlideSession(deck());
  session.execute({ type: 'deck.rename', title: 'Changed' });
  session.markSaved();
  session.undo();
  const before = session.getSnapshot();
  const invalid = { ...before.deck, slides: [] };
  assert.throws(() => session.markSaved(invalid));
  assert.equal(session.getSnapshot(), before);
  assert.throws(() => session.replace(invalid, { saved: true }));
  assert.equal(session.getSnapshot(), before);
  assert.equal(session.redo(), true);
  assert.equal(session.getSnapshot().deck.title, 'Changed');
  assert.equal(session.getSnapshot().dirty, false);
});
