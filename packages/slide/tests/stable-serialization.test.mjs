import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, serializeSlideDeck, parseSlideDeck, createSlideSession } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const hash = json => createHash('sha256').update(json, 'utf8').digest('hex');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
const content = ' 日本語の資料 📄\r\n 余白・タブ\t・e\u0301・éをそのまま保持 ';
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
}
function deck() {
  return createSlideDeck({ id: 'presentation', title: '保存の検証', slides: [
    { id: 'z-slide', name: '資料', notes: content, background: '#ffffff', elements: [
      createSlideElement({ id: 'z-text', type: 'text', text: content, x: 10, y: 400 }),
      createSlideElement({ id: 'm-image', type: 'image', src: pixel, alt: content, x: 200, y: 20 }),
      createSlideElement({ id: 'a-shape', type: 'shape', shape: 'arrow', text: '次へ', x: 20, y: 20 }),
    ] },
    { id: 'a-slide', name: '補足', notes: '', background: '#ffffff', elements: [] },
  ] });
}

test('SLON bytes and hashes ignore object-key insertion order and never mutate caller-owned input', () => {
  const original = deck(), reordered = reverseKeys(original), before = structuredClone(reordered);
  const saved = serializeSlideDeck(original), second = serializeSlideDeck(reordered);
  assert.equal(second, saved); assert.equal(hash(second), hash(saved));
  assert.deepEqual(reordered, before);
  assert.deepEqual(Object.keys(JSON.parse(saved)), ['format', 'version', 'id', 'title', 'width', 'height', 'slides']);
  assert.match(saved, /^\{\n  "format": "likex.slide",\n  "version": 2,/);
});

test('native save-load-save is byte-identical and preserves Unicode, images and stacking order', () => {
  const saved = serializeSlideDeck(deck()), restored = parseSlideDeck(Buffer.from(saved, 'utf8').toString('utf8'));
  assert.equal(serializeSlideDeck(restored), saved);
  assert.equal(saved.endsWith('\n'), false); assert.equal(saved.charCodeAt(0), 123);
  assert.equal(saved.includes('\n'), true); assert.equal(saved.includes('\r'), false);
  assert.equal(restored.slides[0].notes, content);
  assert.equal(restored.slides[0].elements[0].text, content);
  assert.equal(restored.slides[0].elements[1].src, pixel);
  assert.deepEqual(restored.slides.map(slide => slide.id), ['z-slide', 'a-slide']);
  assert.deepEqual(restored.slides[0].elements.map(element => element.id), ['z-text', 'm-image', 'a-shape']);
  assert.notEqual(hash(serializeSlideDeck({ ...restored, slides: [...restored.slides].reverse() })), hash(saved));
  const reorderedElements = { ...restored, slides: restored.slides.map((slide, index) => index ? slide : {
    ...slide, elements: [...slide.elements].reverse(),
  }) };
  assert.notEqual(hash(serializeSlideDeck(reorderedElements)), hash(saved));
});

test('SLON groups by page, sorts elements by position, and keeps drawing layers explicit', () => {
  const original = deck(), saved = serializeSlideDeck(original), file = JSON.parse(saved);
  assert.deepEqual(file.slides.map(slide => slide.id), ['z-slide', 'a-slide']);
  assert.deepEqual(file.slides[0].elements.map(element => [element.id, element.stackOrder]), [
    ['a-shape', 2], ['m-image', 1], ['z-text', 0],
  ]);
  assert.deepEqual(Object.keys(file.slides[0]), ['id', 'name', 'background', 'notes', 'elements']);
  assert.deepEqual(Object.keys(file.slides[0].elements[0]).slice(0, 8), ['id', 'type', 'name', 'stackOrder', 'x', 'y', 'width', 'height']);
  assert.equal(file.version, 2);
  const restored = parseSlideDeck(saved);
  assert.deepEqual(restored, original);
  assert.equal(restored.version, 1);
  assert.ok(restored.slides.every(slide => slide.elements.every(element => !Object.hasOwn(element, 'stackOrder'))));
  // Array order in imported v2 files is spatial/editorial: stackOrder alone controls visual overlap.
  file.slides[0].elements.reverse();
  assert.equal(serializeSlideDeck(parseSlideDeck(JSON.stringify(file))), saved);
  const samePosition = createSlideDeck({ ...original, slides: original.slides.map(slide => ({ ...slide,
    elements: slide.elements.map(element => ({ ...element, x: 50, y: 50 })),
  })) });
  assert.deepEqual(JSON.parse(serializeSlideDeck(samePosition)).slides[0].elements.map(element => element.id),
    ['z-text', 'm-image', 'a-shape']);
});

test('legacy v1 files remain readable; v2 rejects ambiguous or malformed layer information', () => {
  const original = deck();
  const { format, ...legacy } = original;
  assert.equal(format, 'likex.slide');
  assert.deepEqual(parseSlideDeck(JSON.stringify(legacy)), original);
  assert.deepEqual(parseSlideDeck(JSON.stringify(original)), original);
  const valid = JSON.parse(serializeSlideDeck(original));
  const expectInvalid = mutate => {
    const file = structuredClone(valid); mutate(file);
    assert.throws(() => parseSlideDeck(JSON.stringify(file)));
  };
  for (const value of [-1, 0.5, 3, '1', null, Number.MAX_SAFE_INTEGER])
    expectInvalid(file => { file.slides[0].elements[0].stackOrder = value; });
  expectInvalid(file => { file.slides[0].elements[0].stackOrder = file.slides[0].elements[1].stackOrder; });
  expectInvalid(file => { delete file.slides[0].elements[0].stackOrder; });
  expectInvalid(file => { delete file.format; });
  expectInvalid(file => { file.slides[0].elements[0].unexpected = true; });
  expectInvalid(file => { file.slides[0].elements[0].src = pixel; }); // Wrong type-specific field.
  expectInvalid(file => { file.version = 3; });
  expectInvalid(file => { file.version = 1; }); // V1 must not silently discard v2 layers.
  expectInvalid(file => { delete file.slides[0].elements; });
  const empty = createSlideDeck({ id: 'empty', slides: [{ id: 'empty-slide', name: '空', background: '#fff', notes: '', elements: [] }] });
  assert.deepEqual(parseSlideDeck(serializeSlideDeck(empty)), empty);
});

test('readable serialization keeps a pre-allocation output bound and the same read bound', async () => {
  const boundedBuild = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'small-json-bound', setup(build) {
      build.onLoad({ filter: /slide\/src\/model\/limits\.ts$/ }, async ({ path }) => ({
        loader: 'ts', contents: (await readFile(path, 'utf8')).replace('jsonLength: 80 * 1024 * 1024', 'jsonLength: 1000'),
      }));
    } }],
  });
  const bounded = await import(`data:text/javascript;base64,${Buffer.from(boundedBuild.outputFiles[0].text).toString('base64')}`);
  const small = bounded.createSlideDeck({ id: 'small', slides: [{ id: 'one', name: 'one', background: '#fff', notes: '', elements: [] }] });
  assert.deepEqual(bounded.parseSlideDeck(bounded.serializeSlideDeck(small)), small);
  assert.throws(() => bounded.serializeSlideDeck(deck()), /JSONのサイズが上限/);
  assert.throws(() => bounded.parseSlideDeck(' '.repeat(1001)), /JSONのサイズが上限/);
});

test('save does not allocate IDs or read time, and save after Undo reproduces the original bytes', t => {
  const session = createSlideSession(deck()), before = serializeSlideDeck(session.getSnapshot().deck);
  t.mock.method(globalThis.crypto, 'randomUUID', () => { throw new Error('save must not allocate an ID'); });
  t.mock.method(Date, 'now', () => { throw new Error('save must not read time'); });
  session.markSaved();
  assert.equal(serializeSlideDeck(session.getSnapshot().deck), before);
  session.execute({ type: 'element.update', slideId: 'z-slide', elementId: 'z-text', patch: { text: '変更後' } });
  const changed = serializeSlideDeck(session.getSnapshot().deck);
  assert.notEqual(hash(changed), hash(before));
  assert.equal(session.undo(), true); session.markSaved();
  assert.equal(serializeSlideDeck(session.getSnapshot().deck), before);
  assert.equal(session.redo(), true);
  assert.equal(serializeSlideDeck(session.getSnapshot().deck), changed);
});
