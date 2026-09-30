import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: `export * from './src/model-entry'; export { exportSlidePptx as exportBrowser } from './src/export/export-pptx-browser'; export { openOfficePackage } from './src/ooxml'; export { createZipArchive } from './src/core';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + "\n//# sourceURL=slide-svg-test-bundle.js").toString('base64')}`);
const shell = content => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">${content}</svg>`;
const svg = shell('<defs><linearGradient id="brand"><stop offset="0" stop-color="#f60"/><stop offset="1" stop-color="#fa0"/></linearGradient><clipPath id="cut"><rect width="40" height="20" rx="2"/></clipPath></defs><g clip-path="url(#cut)"><path d="M0 0 H40 V20 H0 Z" fill="url(#brand)"/><text x="2" y="12" font-size="8">成長 &amp; 未来</text></g>');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=', 'base64');
const rasterizeSvg = async () => new Blob([png], { type: 'image/png' });
const makeDeck = () => m.createSlideDeck({ slides: [{ id: 'page', name: 'SVG', background: '#ffffff', notes: 'native SVG', elements: [m.createSlideElement({ type: 'image', id: 'art', src: m.createSlideSvgSource(svg), alt: '成長のイラスト', x: 31, y: 51, width: 400, height: 200, opacity: .8, rotation: 4 })] }] });

test('raw SVG is an ordinary bounded image preserving UTF8 through commands, history and native JSON', () => {
  const deck = makeDeck(), source = deck.slides[0].elements[0].src;
  assert.equal(Buffer.from(source.split(',')[1], 'base64').toString('utf8'), svg);
  assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(deck)), deck);
  const session = m.createSlideSession(deck);
  session.execute({ type: 'element.update', slideId: 'page', elementId: 'art', patch: { x: 100, width: 500 } });
  assert.equal(session.getSnapshot().deck.slides[0].elements[0].src, source);
  session.undo(); assert.equal(session.getSnapshot().deck.slides[0].elements[0].x, 31);
  assert.ok(m.createSlideSvgSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><circle cx="30" cy="15" r="12"/></svg>'));
});

test('active content, external references, unsupported effects and malformed SVG fail before model publication', () => {
  const invalid = [shell('<script>alert(1)</script>'), shell('<rect onload="alert(1)"/>'), shell('<image href="https://example.test/a.png"/>'), shell('<foreignObject/>'), shell('<use href="#a"/>'), shell('<rect style="fill:red"/>'), shell('<rect fill="url(https://example.test/a.svg#x)"/>'), shell('<rect fill="u&#114;l(#missing)"/>'), shell('<rect clip-path="url(#missing)"/>'), shell('<style>@import "x";</style>'), shell('<filter id="x"/>'), shell('<svg/>'), shell('<path d="M0 0 L1e999 2"/>'), shell('<rect xmlns="urn:evil"/>'), shell('<text id="a">1</text><text id="a">2</text>'), shell('<g>'.repeat(33) + '</g>'.repeat(33)), '<!DOCTYPE svg [<!ENTITY bad SYSTEM "file:///etc/passwd">]>' + shell(''), '<?xml-stylesheet href="https://example.test/style.css"?>' + shell(''), shell('').replace('width="40"', 'width="999999"'), shell('').replace('height="20"', 'height="0"'), shell('<rect/>'.repeat(10_001))];
  for (const source of invalid) {
    assert.throws(() => m.createSlideSvgSource(source), /SVG/);
    assert.throws(() => m.createSlideElement({ type: 'image', src: `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}` }), /SVG/);
  }
});

test('PPTX preserves SVG and real PNG fallback, deduplicates sources and roundtrips SVG appearance metadata', async () => {
  let calls = 0;
  const original = makeDeck(), deck = m.applySlideCommands(original, { type: 'element.add', slideId: 'page', element: { ...original.slides[0].elements[0], id: 'copy', x: 700 } }).deck;
  const file = await m.exportSlidePptx(deck, { rasterizeSvg: async request => { calls++; assert.equal(request.width, 40); assert.equal(request.height, 20); assert.ok(request.src.startsWith('data:image/svg+xml;base64,')); return rasterizeSvg(); } });
  assert.equal(calls, 1);
  const zip = await m.openOfficePackage(file);
  assert.equal([...zip.paths].filter(path => path.endsWith('.svg')).length, 1);
  assert.equal([...zip.paths].filter(path => path.endsWith('.png')).length, 1);
  assert.equal(new TextDecoder().decode(await zip.read('ppt/media/image1.svg')), svg);
  assert.deepEqual(await zip.read('ppt/media/image1.png'), new Uint8Array(png));
  const pageXml = new TextDecoder().decode(await zip.read('ppt/slides/slide1.xml'));
  assert.match(pageXml, /asvg:svgBlip/); assert.match(pageXml, /r:embed="rIdImage2"/); assert.match(pageXml, /r:embed="rIdSvg2"/);
  const restored = await m.importSlidePptx(file);
  assert.deepEqual(restored.warnings, []);
  assert.equal(restored.deck.slides[0].elements[0].src, original.slides[0].elements[0].src);
  assert.equal(restored.deck.slides[0].elements[0].alt, '成長のイラスト'); assert.equal(restored.deck.slides[0].elements[0].opacity, .8);
});

test('unsafe imported SVG uses embedded PNG and explicit diagnostic', async () => {
  const file = await m.exportSlidePptx(makeDeck(), { rasterizeSvg }), zip = await m.openOfficePackage(file);
  const entries = await Promise.all([...zip.paths].map(async path => ({ path, content: new Blob([path.endsWith('.svg') ? shell('<script>alert(1)</script>') : await zip.read(path)]) })));
  const result = await m.importSlidePptx(await m.createZipArchive(entries));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.message.includes('SVG')));
  assert.ok(result.deck.slides[0].elements[0].src.startsWith('data:image/png;base64,'));
});

test('headless export requires matching real PNG and cancels pending rasterization', async () => {
  await assert.rejects(m.exportSlidePptx(makeDeck()), /rasterizeSvg/);
  await assert.rejects(m.exportSlidePptx(makeDeck(), { rasterizeSvg: async () => new Blob(['not PNG'], { type: 'image/png' }) }), /PNG/);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=', 'base64');
  await assert.rejects(m.exportSlidePptx(makeDeck(), { rasterizeSvg: async () => new Blob([pixel], { type: 'image/png' }) }), /寸法/);
  const aborter = new AbortController(); let begin;
  const started = new Promise(resolve => { begin = resolve; });
  const pending = m.exportSlidePptx(makeDeck(), { signal: aborter.signal, rasterizeSvg: () => { begin(); return new Promise(() => {}); } });
  await started; aborter.abort(); await assert.rejects(pending, /abort/i);
});

test('browser entry rasterizes SVG automatically and disposes Canvas/image resources', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), images = [], canvases = [], draws = [];
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  globalThis.document = { createElement(tag) {
    if (tag === 'img') { const image = { onload: null, onerror: null, set src(value) { this.value = value; if (value) queueMicrotask(() => this.onload?.()); } }; images.push(image); return image; }
    const canvas = { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage: (image, x, y, width, height) => draws.push([image.value, x, y, width, height]) }), toBlob(callback) { callback(new Blob([png], { type: 'image/png' })); } }; canvases.push(canvas); return canvas;
  } };
  const result = await m.importSlidePptx(await m.exportBrowser(makeDeck()));
  assert.equal(result.deck.slides[0].elements[0].src, makeDeck().slides[0].elements[0].src);
  assert.equal(draws.length, 1); assert.deepEqual(draws[0].slice(1), [0, 0, 40, 20]); assert.ok(draws[0][0].startsWith('data:image/svg+xml;base64,'));
  assert.equal(images[0].value, ''); assert.equal(images[0].onload, null); assert.equal(canvases[0].width, 0); assert.equal(canvases[0].height, 0);
});

test('missing SVG relationship part retains strict package-integrity rejection', async () => {
  const file = await m.exportSlidePptx(makeDeck(), { rasterizeSvg }), zip = await m.openOfficePackage(file);
  const entries = await Promise.all(zip.paths.filter(path => !path.endsWith('.svg')).map(async path => ({ path, content: new Blob([await zip.read(path)]) })));
  await assert.rejects(m.importSlidePptx(await m.createZipArchive(entries)), /参照先/);
});
