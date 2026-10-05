import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export * from './src/model-entry';
  export { openOfficePackage, officeXml } from './src/ooxml';
  export { createZipArchive } from './src/core';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { collectSlideImages, createSlideDeck, createSlideElement, createSlideSvgSource,
  exportSlidePptx, importSlidePptx, openOfficePackage, officeXml, createZipArchive } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const otherPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const bytes = src => Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
const imageId = src => `sha256:${createHash('sha256').update(bytes(src)).digest('hex')}`;
const image = (id, patch = {}) => createSlideElement({ type: 'image', id, src: png, name: id,
  alt: `Description of ${id}`, x: 10, y: 20, width: 200, height: 100, ...patch });
const slide = (id, elements = [], patch = {}) => ({ id, name: id, background: '#ffffff', notes: '', elements, ...patch });
const deck = slides => createSlideDeck({ id: 'deck', slides });
const clone = value => JSON.parse(JSON.stringify(value));
const placement = (element, page, pageNumber, source = 'slide', sourceId = page.id) => ({
  imageId: imageId(element.src), slideId: page.id, pageNumber, elementId: element.id, source, sourceId,
  ...Object.fromEntries(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'name', 'alt'].map(key => [key, element[key]])),
});

test('same bytes share one SHA-256 asset while every placement retains its own metadata', async () => {
  const input = deck([
    slide('first', [image('back'), createSlideElement({ type: 'text', id: 'text', text: 'No image here' }),
      image('front', { x: 340, y: 140, width: 80, height: 160, rotation: 32, opacity: .4, name: 'Second use', alt: 'Different description' })]),
    slide('second', [image('invisible', { x: -10, y: 450, width: 600, height: 300, rotation: 180, opacity: 0, alt: '' })]),
  ]);
  const before = JSON.stringify(input), result = await collectSlideImages(input);
  assert.deepEqual(result.images, [{ imageId: imageId(png), src: png, mimeType: 'image/png', byteLength: bytes(png).length }]);
  assert.match(result.images[0].imageId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(result.placements, [placement(input.slides[0].elements[0], input.slides[0], 1),
    placement(input.slides[0].elements[2], input.slides[0], 1), placement(input.slides[1].elements[0], input.slides[1], 2)]);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(await collectSlideImages(input), result);

  const analyzed = [], descriptions = new Map();
  const analyze = async asset => { analyzed.push(asset.imageId); return 'One shared image description'; };
  for (const asset of result.images) descriptions.set(asset.imageId, await analyze(asset));
  const references = result.placements.map(item => ({ pageNumber: item.pageNumber, elementId: item.elementId,
    description: descriptions.get(item.imageId) }));
  assert.deepEqual(analyzed, [imageId(png)]);
  assert.deepEqual(references, [{ pageNumber: 1, elementId: 'back', description: 'One shared image description' },
    { pageNumber: 1, elementId: 'front', description: 'One shared image description' },
    { pageNumber: 2, elementId: 'invisible', description: 'One shared image description' }]);
});

test('different bytes stay separate and asset ordering follows first placement rather than hash order', async () => {
  const input = deck([slide('first', [image('other-first', { src: otherPng }), image('original')]),
    slide('second', [image('other-again', { src: otherPng })])]);
  const result = await collectSlideImages(input);
  assert.deepEqual(result.images.map(item => item.imageId), [imageId(otherPng), imageId(png)]);
  assert.deepEqual(result.images.map(item => item.src), [otherPng, png]);
  assert.deepEqual(result.placements.map(item => item.imageId), [imageId(otherPng), imageId(png), imageId(otherPng)]);
  assert.deepEqual(result.images.map(item => item.byteLength), [bytes(otherPng).length, bytes(png).length]);
});

test('SVG is hashed as original embedded bytes without rasterization or visual deduplication', async () => {
  const one = createSlideSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#f00"/></svg>');
  const two = createSlideSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10">\n<rect width="20" height="10" fill="#f00"/>\n</svg>');
  const result = await collectSlideImages(deck([slide('page', [image('one', { src: one }), image('two', { src: two }), image('repeat', { src: one })])]));
  assert.deepEqual(result.images, [one, two].map(src => ({ imageId: imageId(src), src, mimeType: 'image/svg+xml', byteLength: bytes(src).length })));
  assert.deepEqual(result.placements.map(item => item.imageId), [imageId(one), imageId(two), imageId(one)]);
});

function inheritedDeck() {
  const prototype = createSlideSvgSource('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');
  return createSlideDeck({
    masters: [{ id: 'master', name: 'Used', background: '#ffffff', elements: [image('master-back'), image('master-front', { src: otherPng })] },
      { id: 'unused-master', name: 'Unused', background: '#ffffff', elements: [image('unused-master-image', { src: prototype })] }],
    layouts: [{ id: 'layout', masterId: 'master', name: 'Used', elements: [image('layout-image', { src: otherPng })],
      placeholders: [{ id: 'unused-slot', kind: 'pic', element: image('prototype', { src: prototype }) }] },
    { id: 'hidden-master-layout', masterId: 'master', name: 'Hidden master', showMasterShapes: false,
      elements: [image('hidden-layout-image')], placeholders: [] },
    { id: 'unused-layout', masterId: 'unused-master', name: 'Unused', elements: [image('unused-layout-image', { src: prototype })], placeholders: [] }],
    slides: [slide('first', [image('local')], { layoutId: 'layout' }),
      slide('second', [image('local-second')], { layoutId: 'layout', showMasterShapes: false }),
      slide('third', [], { layoutId: 'hidden-master-layout' }), slide('unassigned')],
  });
}

test('applied visible artwork is ordered master, layout and local on each page; unused catalogs and prototypes are excluded', async () => {
  const input = inheritedDeck(), result = await collectSlideImages(input);
  assert.deepEqual(result.placements, [
    ...input.masters[0].elements.map(element => placement(element, input.slides[0], 1, 'master', 'master')),
    placement(input.layouts[0].elements[0], input.slides[0], 1, 'layout', 'layout'),
    placement(input.slides[0].elements[0], input.slides[0], 1),
    placement(input.layouts[0].elements[0], input.slides[1], 2, 'layout', 'layout'),
    placement(input.slides[1].elements[0], input.slides[1], 2),
    placement(input.layouts[1].elements[0], input.slides[2], 3, 'layout', 'hidden-master-layout'),
  ]);
  assert.deepEqual(result.images.map(item => item.imageId), [imageId(png), imageId(otherPng)]);
});

test('decks without placed images return empty collections even when unused catalogs contain images', async () => {
  assert.deepEqual(await collectSlideImages(deck([slide('page', [createSlideElement({ type: 'shape', id: 'shape' })])])),
    { images: [], placements: [] });
  const input = clone(inheritedDeck());
  input.slides = [slide('unassigned')];
  assert.deepEqual(await collectSlideImages(input), { images: [], placements: [] });
});

test('final animation geometry is the default; initial preserves authored geometry and both retain invisible placements', async () => {
  const element = image('moving', { x: 10, y: 20, opacity: 0 });
  const input = deck([slide('page', [element], { animations: [{ id: 'move', trigger: { type: 'click' }, animation: {
    type: 'tween', elementId: 'moving', durationMs: 100, from: { x: -100, opacity: .25 },
    to: { x: 300, y: 200, width: 400, height: 160, rotation: 45, opacity: .75 },
  } }] })]);
  const before = JSON.stringify(input), initial = await collectSlideImages(input, { animationState: 'initial' });
  const final = await collectSlideImages(input, { animationState: 'final' });
  assert.deepEqual(await collectSlideImages(input), final);
  assert.deepEqual(initial.placements, [placement(element, input.slides[0], 1)]);
  assert.deepEqual(final.placements, [{ ...initial.placements[0], x: 300, y: 200, width: 400, height: 160, rotation: 45, opacity: .75 }]);
  assert.deepEqual(initial.images, final.images);
  assert.equal(JSON.stringify(input), before);
});

test('asynchronous collection uses an independent snapshot when the caller changes later pages and image sources', async () => {
  const input = clone(deck([slide('first', [image('one')]), slide('second', [image('two', { src: otherPng })])]));
  const expected = clone(input), pending = collectSlideImages(input);
  input.slides[1].elements[0].src = png;
  input.slides[1].elements[0].x = 999;
  input.slides[1].elements[0].alt = 'Changed while hashing';
  input.slides.reverse();
  input.slides[0].id = 'changed';
  const result = await pending;
  assert.deepEqual(result.images.map(item => item.imageId), [imageId(png), imageId(otherPng)]);
  assert.deepEqual(result.placements, expected.slides.map((page, index) => placement(page.elements[0], page, index + 1)));
});

test('invalid input or options fail as a whole without changing the original deck', async () => {
  const input = deck([slide('page', [image('valid'), image('later')])]), before = JSON.stringify(input);
  for (const options of [null, [], { animationState: 'middle' }, { animationState: 0 }, { unknown: true }])
    await assert.rejects(collectSlideImages(input, options));
  let getterCalls = 0;
  await assert.rejects(collectSlideImages(input, { get animationState() { getterCalls++; return 'final'; } }));
  assert.equal(getterCalls, 0);
  for (const mutate of [
    value => { value.version = 2; },
    value => { value.slides[0].elements[1].src = 'https://example.com/remote.png'; },
    value => { value.slides[0].elements[1].src = 'data:image/png;base64,AAAA'; },
    value => { value.slides[0].elements[1].width = NaN; },
    value => { value.slides[0].elements[1].id = 'valid'; },
    value => { value.slides[0].layoutId = 'missing'; },
  ]) {
    const invalid = clone(input); mutate(invalid); const snapshot = clone(invalid);
    await assert.rejects(collectSlideImages(invalid));
    assert.deepEqual(clone(invalid), snapshot);
  }
  assert.equal(JSON.stringify(input), before);
});

test('pre-aborted and active collection reject with the host reason and never publish partial results', async () => {
  const input = deck([slide('first', [image('one')]), slide('second', [image('two', { src: otherPng })])]);
  const before = JSON.stringify(input), preAborted = new AbortController(), reason = new Error('Stopped by host');
  preAborted.abort(reason);
  await assert.rejects(collectSlideImages(input, { signal: preAborted.signal }), error => error === reason);
  const active = new AbortController(), pending = collectSlideImages(input, { signal: active.signal });
  active.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(JSON.stringify(input), before);
});

test('collection needs no DOM, image decoder, Blob or network requests', async t => {
  const input = deck([slide('page', [image('one')])]);
  for (const name of ['document', 'window', 'Image', 'ImageBitmap', 'createImageBitmap', 'Blob', 'fetch', 'XMLHttpRequest']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error(`Unexpected global ${name}`); } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  assert.deepEqual((await collectSlideImages(input)).images.map(item => item.imageId), [imageId(png)]);
});

test('an empty collection does not require Web Crypto', async t => {
  const input = deck([slide('page')]), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; });
  assert.deepEqual(await collectSlideImages(input), { images: [], placements: [] });
});

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00011, `${actual} ≈ ${expected}`);

test('actual PPTX roundtrip retains 30 placements while allowing analysis of only three unique assets', async () => {
  const sources = [png, otherPng, gif];
  const input = deck(Array.from({ length: 3 }, (_, pageIndex) => slide(`page-${pageIndex + 1}`,
    Array.from({ length: 10 }, (_, elementIndex) => {
      const index = pageIndex * 10 + elementIndex;
      return image(`image-${index}`, { src: sources[index % sources.length], x: elementIndex * 90, y: 50 + pageIndex * 40,
        width: 40 + elementIndex * 2, height: 20 + elementIndex, rotation: index * 5, opacity: .7 });
    }))));
  const before = JSON.stringify(input), file = await exportSlidePptx(input), imported = await importSlidePptx(file);
  assert.deepEqual(imported.warnings, []);
  const result = await collectSlideImages(imported.deck);
  assert.deepEqual(result.images.map(item => item.imageId), sources.map(imageId));
  assert.deepEqual(result.placements.map(item => item.imageId), Array.from({ length: 30 }, (_, index) => imageId(sources[index % 3])));
  assert.deepEqual(result.placements.map(item => item.pageNumber), Array.from({ length: 30 }, (_, index) => Math.floor(index / 10) + 1));
  let requests = 0;
  const analyze = async asset => { requests++; return `Description for ${asset.imageId}`; };
  const analyses = new Map(await Promise.all(result.images.map(async asset => [asset.imageId, await analyze(asset)])));
  const annotated = result.placements.map(item => ({ ...item, description: analyses.get(item.imageId) }));
  assert.equal(requests, 3); assert.equal(annotated.length, 30);
  assert.ok(annotated.every(item => item.description === `Description for ${item.imageId}`));
  for (const [index, actual] of result.placements.entries()) {
    const original = input.slides.flatMap(page => page.elements)[index];
    const page = imported.deck.slides[actual.pageNumber - 1];
    assert.equal(actual.slideId, page.id); assert.equal(actual.sourceId, page.id); assert.equal(actual.source, 'slide');
    assert.ok(page.elements.some(element => element.id === actual.elementId));
    assert.equal(actual.name, original.name); assert.equal(actual.alt, original.alt);
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity']) close(actual[key], original[key]);
  }
  assert.equal(JSON.stringify(input), before);
});

test('PPTX media with distinct filenames and relationships collapse by bytes, while different media stays distinct', async () => {
  const input = deck([slide('first', [image('one')]), slide('second', [image('two')]), slide('third', [image('three')])]);
  const archive = await openOfficePackage(await exportSlidePptx(input)), entries = new Map();
  for (const path of archive.paths) entries.set(path, await archive.read(path));
  const encoder = new TextEncoder(), decoder = new TextDecoder(), newTargets = [];
  for (const [pageNumber, src] of [[2, png], [3, otherPng]]) {
    const path = `ppt/slides/_rels/slide${pageNumber}.xml.rels`;
    const original = decoder.decode(entries.get(path));
    const relationship = officeXml.children(officeXml.parseXml(entries.get(path)), 'Relationship')
      .find(item => item.attributes.Type.endsWith('/image'));
    assert.ok(relationship);
    const target = `../media/copied-page-${pageNumber}.png`, mediaPath = `ppt/media/copied-page-${pageNumber}.png`;
    const replaced = original.replace(`Target="${relationship.attributes.Target}"`, `Target="${target}"`);
    assert.notEqual(replaced, original);
    entries.set(path, encoder.encode(replaced));
    entries.set(mediaPath, bytes(src));
    newTargets.push(mediaPath);
  }
  entries.set('[Content_Types].xml', encoder.encode(decoder.decode(entries.get('[Content_Types].xml')).replace('</Types>',
    newTargets.map(path => `<Override PartName="/${path}" ContentType="image/png"/>`).join('') + '</Types>')));
  const file = await createZipArchive([...entries].map(([path, content]) => ({ path, content: new Blob([content]) })));
  const imported = await importSlidePptx(file);
  assert.deepEqual(imported.warnings, []);
  assert.deepEqual(imported.deck.slides.map(page => page.elements[0].src), [png, png, otherPng]);
  const result = await collectSlideImages(imported.deck);
  assert.deepEqual(result.images.map(item => item.imageId), [imageId(png), imageId(otherPng)]);
  assert.deepEqual(result.images.map(item => item.byteLength), [bytes(png).length, bytes(otherPng).length]);
  assert.deepEqual(result.placements, imported.deck.slides.map((page, index) => placement(page.elements[0], page, index + 1)));
});
