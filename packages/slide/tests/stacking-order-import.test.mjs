import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './model-entry';
  export { openOfficePackage, createZipArchive } from './core';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
const shapeXml = /<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g;

test('PPTX shape-tree order wins over IDs and coordinates through SLON and PPTX round trips', async () => {
  const elements = [
    m.createSlideElement({ id: 'shape', name: 'Shape', type: 'shape', shape: 'rect', x: 100, y: 100, fill: '#00ff00' }),
    m.createSlideElement({ id: 'text', name: 'Text', type: 'text', x: 150, y: 150, text: 'Text' }),
    m.createSlideElement({ id: 'image', name: 'Image', type: 'image', x: 200, y: 200, src: png }),
    m.createSlideElement({ id: 'line', name: 'Line', type: 'shape', shape: 'line', line: { start: { x: 250, y: 250 }, end: { x: 400, y: 250 } } }),
  ];
  const source = m.createSlideDeck({ slides: [{ id: 'page', name: 'Layers', background: '#ffffff', notes: '', elements }] });
  const archive = await m.openOfficePackage(await m.exportSlidePptx(source)), entries = [];
  for (const path of archive.paths) {
    let bytes = await archive.read(path);
    if (path === 'ppt/slides/slide1.xml') {
      const xml = new TextDecoder().decode(bytes), shapes = [...xml.matchAll(shapeXml)].map(match => match[0]).reverse();
      assert.equal(shapes.length, 4);
      const ids = shapes.map(shape => Number(shape.match(/<p:cNvPr id="(\d+)"/)[1]));
      assert.ok(ids.every((id, index) => !index || id < ids[index - 1]));
      let index = 0;
      bytes = new TextEncoder().encode(xml.replace(shapeXml, () => shapes[index++]));
    }
    entries.push({ path, content: new Blob([bytes]) });
  }
  const expected = ['Line', 'Image', 'Text', 'Shape'];
  const imported = await m.importSlidePptx(await m.createZipArchive(entries));
  assert.deepEqual(imported.deck.slides[0].elements.map(element => element.name), expected);
  const restored = m.parseSlideDeck(m.serializeSlideDeck(imported.deck));
  assert.deepEqual(restored.slides[0].elements.map(element => element.name), expected);
  const reimported = await m.importSlidePptx(await m.exportSlidePptx(restored));
  assert.deepEqual(reimported.deck.slides[0].elements.map(element => element.name), expected);
});
