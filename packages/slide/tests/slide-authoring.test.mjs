import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model-entry.ts';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, applySlideCommands, createSlideSession, parseSlideDeck, serializeSlideDeck,
  measureSlideText, fitSlideText, getSlideElementBounds, getSlideLayoutDiagnostics, exportSlidePptx, importSlidePptx } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const text = (id, patch = {}) => createSlideElement({ type: 'text', id, text: id, ...patch });
const animation = (id = 'old') => ({ id: 'fade', animation: { type: 'tween', elementId: id, durationMs: 100, to: { opacity: 0 } } });
const page = (id, elements = []) => ({ id, name: id, background: '#fff', notes: 'speaker notes', elements });
const deck = () => createSlideDeck({ slides: [{ ...page('first', [text('old')]), animations: [animation()] }, page('second', [text('other')])] });
const measure = (text, { fontSize }) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * fontSize / 2;
const geometry = (x, y, width = 100, height = 60, rotation = 0) => ({ x, y, width, height, rotation });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('replaceContent atomically rebuilds one page without stale elements or animation targets and preserves identity', () => {
  const original = deck(), session = createSlideSession(original);
  const result = session.execute({ type: 'slide.replaceContent', slideId: 'first', elements: [{ type: 'text', text: 'Fresh' }, { type: 'shape', id: 'box', x: 600 }], name: 'Rebuilt' });
  assert.equal(result.slideId, 'first');
  assert.deepEqual(result.elementIds, result.deck.slides[0].elements.map(element => element.id));
  assert.deepEqual(result.deck.slides.map(slide => slide.id), ['first', 'second']);
  assert.equal(result.deck.slides[1], original.slides[1]);
  assert.equal(result.deck.slides[0].name, 'Rebuilt');
  assert.equal(result.deck.slides[0].notes, 'speaker notes');
  assert.equal(result.deck.slides[0].background, '#ffffff');
  assert.equal(result.deck.slides[0].elements.length, 2);
  assert.equal(result.deck.slides[0].elements.some(element => element.id === 'old'), false);
  assert.equal(result.deck.slides[0].animations, undefined);
  assert.equal(original.slides[0].elements[0].id, 'old');
  session.undo(); assert.deepEqual(session.getSnapshot().deck, original);
  session.redo(); assert.deepEqual(session.getSnapshot().deck, result.deck);
  assert.deepEqual(parseSlideDeck(serializeSlideDeck(result.deck)), result.deck);
});

test('replaceContent permits complete explicit animation replacement and clearing the page', () => {
  const replaced = applySlideCommands(deck(), { type: 'slide.replaceContent', slideId: 'first', elements: [{ type: 'text', id: 'fresh' }], animations: [animation('fresh')], background: '#123456', notes: '' }).deck;
  assert.equal(replaced.slides[0].animations[0].animation.elementId, 'fresh');
  assert.equal(replaced.slides[0].notes, '');
  assert.equal(replaced.slides[0].background, '#123456');
  assert.equal(applySlideCommands(replaced, { type: 'slide.replaceContent', slideId: 'first', elements: [] }).deck.slides[0].elements.length, 0);
});

test('replaceContent rejects partial content, duplicate IDs, locks and stale animation references without changing input/history', () => {
  const original = deck(), before = serializeSlideDeck(original), session = createSlideSession(original);
  for (const invalid of [
    { elements: [{ text: 'Missing type' }] }, { elements: [{ type: 'text', width: 0 }] }, { elements: [{ type: 'text', id: 'other' }] },
    { elements: [{ type: 'text', id: 'same' }, { type: 'shape', id: 'same' }] }, { elements: [], animations: [animation()] },
    { elements: [], id: 'cannot-rename' },
  ]) assert.throws(() => session.execute([{ type: 'deck.rename', title: 'Must not persist' }, { type: 'slide.replaceContent', slideId: 'first', ...invalid }]), /commands\[1\]/);
  assert.equal(serializeSlideDeck(original), before);
  assert.equal(session.getSnapshot().canUndo, false);
  const locked = createSlideDeck({ slides: [page('first', [text('locked', { locked: true })])] });
  assert.throws(() => applySlideCommands(locked, { type: 'slide.replaceContent', slideId: 'first', elements: [] }), /ロック/);
  assert.throws(() => applySlideCommands(original, { type: 'element.delete', slideId: 'first', elementIds: ['bad-id', 'other-bad'] }), /commands\[0\].*bad-id, other-bad/);
});

test('text measurement matches renderer padding and wrapping, detects horizontal and vertical clipping', () => {
  const element = text('title', { text: 'abcdefgh', fontSize: 20, width: 60, height: 48 });
  const layout = measureSlideText(element, measure);
  assert.deepEqual(layout.lines, ['abcd', 'efgh']);
  assert.equal(layout.measuredHeight, 48);
  assert.equal(layout.availableHeight, 32);
  assert.equal(layout.overflow, true);
  const fit = fitSlideText(element, { measureText: measure, minFontSize: 8 });
  assert.equal(fit.fits, true);
  assert.ok(fit.element.fontSize < 20 && fit.element.fontSize >= 8);
  assert.equal(fit.element.id, element.id);
  assert.equal(fit.element.width, element.width);
  assert.equal(element.fontSize, 20);
  assert.equal(measureSlideText(text('tiny', { text: 'あ', width: 22, height: 100 }), measure).overflow, true);
  assert.equal(measureSlideText(text('empty', { text: '', width: 1, height: 1 }), measure).overflow, false);
  assert.equal(fitSlideText(text('too-small', { width: 1, height: 1 }), { measureText: measure }).fits, false);
  assert.throws(() => measureSlideText(element, () => NaN), /測定した文字幅/);
  assert.throws(() => fitSlideText(element, { measureText: measure, minFontSize: 30 }), /最小文字サイズ/);
});

test('static diagnostics include rotated bounds and text clipping without flagging intentional backgrounds or groups', () => {
  const elements = [createSlideElement({ type: 'shape', id: 'background', x: 0, y: 0, width: 1280, height: 720 }),
    text('clipped', { x: 50, y: 50, width: 80, height: 30, text: 'Long label' }),
    text('rotated', { x: 0, y: 0, width: 200, height: 20, rotation: 90, text: '' })];
  const diagnostics = getSlideLayoutDiagnostics(page('one', elements), { width: 1280, height: 720, measureText: measure });
  assert.deepEqual(diagnostics.map(item => [item.elementId, item.code]), [['clipped', 'text-overflow'], ['rotated', 'out-of-bounds']]);
  assert.ok(diagnostics[0].measuredHeight > diagnostics[0].availableHeight);
  const bounds = getSlideElementBounds(geometry(0, 0, 200, 20, 90));
  near(bounds.left, 90); near(bounds.top, -90); near(bounds.right, 110); near(bounds.bottom, 110);
  assert.throws(() => getSlideElementBounds(geometry(0, 0, 0)), /幅/);
});


test('replaced text and two-point lines retain geometry/text through PPTX import/export', async () => {
  const elements = [text('a', { text: 'API → Worker', x: 50, y: 80, width: 200, height: 60 }), text('b', { text: '日本語の結果', x: 700, y: 300, width: 240, height: 80 })];
  const original = createSlideDeck();
  const replaced = applySlideCommands(original, [
    { type: 'slide.replaceContent', slideId: original.slides[0].id, elements },
    { type: 'line.add', slideId: original.slides[0].id, id: 'link', start: { x: 250, y: 110 }, end: { x: 700, y: 340 }, stroke: '#2563eb', strokeWidth: 3 },
  ]).deck;
  const restored = (await importSlidePptx(await (await exportSlidePptx(replaced)).arrayBuffer())).deck;
  assert.equal(restored.slides[0].elements.length, 3);
  for (let index = 0; index < replaced.slides[0].elements.length; index++) {
    const expected = replaced.slides[0].elements[index], actual = restored.slides[0].elements[index];
    assert.equal(actual.type, expected.type); assert.equal(actual.text, expected.text);
    for (const key of ['x', 'y', 'width', 'height', 'rotation']) assert.ok(Math.abs(actual[key] - expected[key]) < .01, `${index}.${key}: ${actual[key]} ~ ${expected[key]}`);
  }
});
