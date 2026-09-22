import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export {importSlidePptx,exportSlidePptx} from "./src/model-entry";export {PPTX_MIME_TYPE} from "./src/export/export-pptx";export * from "./src/model";export {openOfficePackage,officeXml} from "./src/ooxml";export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSlidePptx, exportSlidePptx, PPTX_MIME_TYPE, createSlideDeck, createSlideElement, normalizeSlideDeck, openOfficePackage, officeXml, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const fixture = new Uint8Array(await readFile(new URL('fixtures/powerpoint-basic.pptx', import.meta.url)));
const { child, children, parseXml } = officeXml;
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const close = (actual, expected, tolerance = .00011) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const slide = (id, elements = [], notes = '') => ({ id, name: `Slide ${id}`, background: '#ffffff', notes, elements });
function deck() {
  return createSlideDeck({ title: '日本語 & <deck>', width: 1280, height: 720, slides: [slide('first', [
    createSlideElement({ type: 'text', id: 'text', name: 'Text', text: 'first\n\n日本語 <>& "quote" _x0041_\nfinal', x: 32, y: 48, width: 320, height: 120, fontSize: 36, fontFamily: 'Arial', color: '#123456', bold: true, italic: true, align: 'right', verticalAlign: 'bottom', rotation: 12.5, locked: true }),
    createSlideElement({ type: 'shape', id: 'shape', name: 'Shape', shape: 'roundRect', x: 400, y: 200, width: 180, height: 90, fill: '#abcdef', stroke: '#123456', strokeWidth: 3, text: 'Shape', fontSize: 24, textColor: '#112233' }),
    createSlideElement({ type: 'image', id: 'image', name: 'Image', src: png, alt: 'orange & white', x: 600, y: 300, width: 200, height: 100, rotation: 45, opacity: .75, locked: true }),
  ], 'speaker\nnotes & <xml>'), slide('second')] });
}
async function parts(input) {
  const archive = await openOfficePackage(input), result = new Map();
  for (const path of archive.paths) result.set(path, await archive.read(path));
  return result;
}
async function changed(input, mutate) {
  const entries = await parts(input); mutate(entries);
  return createZipArchive([...entries].map(([path, content]) => ({ path, content: new Blob([content]) })));
}
const replace = (entries, path, update) => entries.set(path, new TextEncoder().encode(update(new TextDecoder().decode(entries.get(path)))));

test('imports an independent python-pptx file with layout/master text geometry, colors, pictures, rotation and notes', async () => {
  const { deck, warnings } = await importSlidePptx(fixture);
  assert.equal(deck.title, 'PowerPoint compatibility fixture'); assert.equal(deck.slides.length, 2);
  close(deck.width, 1280); assert.equal(deck.height, 720);
  const [title, subtitle] = deck.slides[0].elements;
  assert.equal(title.text, 'Inherited title geometry'); assert.equal(title.x, 72); close(title.height, 154.333333);
  assert.equal(title.fontFamily, 'Calibri'); assert.equal(title.verticalAlign, 'middle');
  assert.equal(subtitle.color, '#404040'); assert.equal(deck.slides[0].notes, 'Presenter notes\nSecond line');
  const [text, shape, picture] = deck.slides[1].elements;
  assert.equal(deck.slides[1].background, '#e7f0fa');
  assert.equal(text.text, '日本語 & <PowerPoint>'); assert.equal(text.color, '#123456'); assert.equal(text.fontSize, 32); assert.equal(text.bold, true); assert.equal(text.align, 'right');
  assert.equal(shape.shape, 'roundRect'); assert.equal(shape.rotation, 15); assert.equal(shape.fill, '#339966'); assert.equal(shape.textColor, '#ffffff');
  assert.equal(picture.type, 'image'); assert.equal(picture.rotation, 20); assert.equal(picture.width / picture.height, 2);
  assert.match(picture.src, /^data:image\/png;base64,/); assert.ok(Array.isArray(warnings));
});

test('exports complete standard parts/relationships and reimports editable content, order, geometry and notes', async () => {
  const source = deck(), snapshot = JSON.stringify(source), file = await exportSlidePptx(source);
  assert.equal(file.type, PPTX_MIME_TYPE); assert.equal(JSON.stringify(source), snapshot);
  const entries = await parts(file);
  for (const path of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/notesMasters/notesMaster1.xml', 'ppt/notesSlides/notesSlide1.xml']) assert.ok(entries.has(path), path);
  for (const [path, bytes] of entries) if (path.endsWith('.xml') || path.endsWith('.rels')) assert.ok(parseXml(bytes), path);
  const presentation = parseXml(entries.get('ppt/presentation.xml'));
  assert.equal(children(child(presentation, 'sldIdLst'), 'sldId').length, 2);
  const result = await importSlidePptx(file); assert.deepEqual(result.warnings, []);
  assert.equal(result.deck.title, source.title); assert.deepEqual(result.deck.slides.map(s => s.name), source.slides.map(s => s.name));
  assert.equal(result.deck.slides[0].notes, source.slides[0].notes);
  for (const [i, element] of result.deck.slides[0].elements.entries()) {
    const before = source.slides[0].elements[i]; assert.equal(element.type, before.type); assert.equal(element.name, before.name);
    for (const key of ['x', 'y', 'width', 'height', 'rotation']) close(element[key], before[key]);
    assert.equal(element.locked, before.locked);
    for (const key of before.type === 'image' ? ['src', 'alt', 'opacity'] : before.type === 'shape' ? ['shape', 'fill', 'stroke', 'strokeWidth', 'text', 'textColor'] : ['text', 'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'align', 'verticalAlign', 'fill']) assert.deepEqual(element[key], before[key], key);
  }
});

test('all basic presets and semitransparent fills survive the standard format', async () => {
  const elements = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'arrow', 'line'].map((shape, i) => createSlideElement({ type: 'shape', id: `shape-${i}`, shape, fill: '#12345680', stroke: 'transparent', width: 100, height: 10, rotation: 30 }));
  const source = createSlideDeck({ slides: [slide('shapes', elements)] });
  const result = await importSlidePptx(await exportSlidePptx(source));
  assert.deepEqual(result.deck.slides[0].elements.map(e => e.shape), elements.map(e => e.shape));
  assert.ok(result.deck.slides[0].elements.every(e => e.fill === '#12345680' && e.stroke === 'transparent'));
});

test('slide list order wins over ZIP order and slide part filenames', async () => {
  const file = await changed(await exportSlidePptx(deck()), entries => replace(entries, 'ppt/presentation.xml', xml => xml.replace(/(<p:sldId id="256"[^>]+\/>)(<p:sldId id="257"[^>]+\/>)/, '$2$1')));
  const result = await importSlidePptx(file);
  assert.deepEqual(result.deck.slides.map(slide => slide.name), ['Slide second', 'Slide first']);
});

test('shared images are embedded once without fetching; external links are warned and never followed', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('network is forbidden'); });
  const source = deck(), image = createSlideElement({ ...source.slides[0].elements[2], id: 'image-copy' });
  const file = await exportSlidePptx(normalizeSlideDeck({ ...source, slides: [{ ...source.slides[0], elements: [...source.slides[0].elements, image] }] }));
  assert.equal([...await parts(file)].filter(([path]) => path.startsWith('ppt/media/')).length, 1);
  const external = await changed(file, entries => replace(entries, 'ppt/slides/_rels/slide1.xml.rels', xml => xml.replace('</Relationships>', `<Relationship Id="external" Type="${rel}hyperlink" Target="https://example.invalid/never" TargetMode="External"/></Relationships>`)));
  const result = await importSlidePptx(external);
  assert.ok(result.warnings.some(warning => warning.includes('外部'))); assert.equal(requests, 0);
});

test('unsupported groups and transitions produce warnings while supported siblings remain editable', async () => {
  const file = await changed(await exportSlidePptx(deck()), entries => replace(entries, 'ppt/slides/slide1.xml', xml => xml.replace('</p:spTree>', '<p:grpSp><p:nvGrpSpPr/><p:grpSpPr/></p:grpSp></p:spTree>').replace('</p:sld>', '<p:transition/><p:timing/></p:sld>')));
  const result = await importSlidePptx(file);
  assert.equal(result.deck.slides[0].elements.length, 3);
  assert.ok(result.warnings.some(warning => warning.includes('グループ')));
  assert.ok(result.warnings.some(warning => warning.includes('アニメーション')));
});

test('plain DrawingML text preserves literal escape-like content and carriage returns', async () => {
  const element = createSlideElement({ type: 'text', text: 'literal _x0041_\rreturn\t世界 🗂️', id: 'literal' });
  const result = await importSlidePptx(await exportSlidePptx(createSlideDeck({ slides: [slide('text', [element])] })));
  assert.equal(result.deck.slides[0].elements[0].text, element.text);
});

test('model-valid long metadata is preserved without truncation', async () => {
  const name = '名前'.repeat(250), source = createSlideDeck({ title: name, slides: [{ ...slide('long', [createSlideElement({ type: 'text', name })]), name }] });
  const result = await importSlidePptx(await exportSlidePptx(source));
  assert.equal(result.deck.title, name); assert.equal(result.deck.slides[0].name, name); assert.equal(result.deck.slides[0].elements[0].name, name);
});

test('rejects DTD/entity declarations, invalid relationships and duplicate slide targets', async () => {
  const source = await exportSlidePptx(deck());
  const dtd = await changed(source, entries => replace(entries, 'ppt/slides/slide1.xml', xml => xml.replace('?>', '?><!DOCTYPE p:sld [<!ENTITY secret SYSTEM "file:///etc/passwd">]>')));
  await assert.rejects(importSlidePptx(dtd), /XML/);
  const traversal = await changed(source, entries => replace(entries, 'ppt/_rels/presentation.xml.rels', xml => xml.replace('Target="slides/slide1.xml"', 'Target="../../../secret.xml"')));
  await assert.rejects(importSlidePptx(traversal), /パッケージ外/);
  const duplicate = await changed(source, entries => replace(entries, 'ppt/presentation.xml', xml => xml.replace('r:id="rIdSlide2"', 'r:id="rIdSlide1"')));
  await assert.rejects(importSlidePptx(duplicate), /重複/);
});

test('refuses legacy/encrypted/macro files, malformed images and oversized members', async () => {
  await assert.rejects(importSlidePptx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), /暗号化.*\.pptx|\.ppt/);
  await assert.rejects(importSlidePptx(new File([fixture], 'legacy.ppt')), /\.ppt/);
  const source = await exportSlidePptx(deck());
  const macro = await changed(source, entries => replace(entries, '[Content_Types].xml', xml => xml.replace('presentation.main+xml', 'presentation.macroEnabled.main+xml')));
  await assert.rejects(importSlidePptx(macro), /マクロ/);
  const badImage = await changed(source, entries => entries.set('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71])));
  await assert.rejects(importSlidePptx(badImage), /画像/);
  const huge = await createZipArchive([{ path: 'oversized.xml', content: new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]) }]);
  await assert.rejects(importSlidePptx(huge), /展開サイズ/);
});

test('cancelled input and cancellation during read never publish a partial deck', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(importSlidePptx(fixture, { signal: controller.signal }), { name: 'AbortError' });
  const active = new AbortController();
  const input = { size: fixture.length, async arrayBuffer() { active.abort(); return fixture.slice().buffer; } };
  await assert.rejects(importSlidePptx(input, { signal: active.signal }), { name: 'AbortError' });
});
