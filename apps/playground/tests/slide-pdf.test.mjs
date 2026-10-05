import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = await build({ absWorkingDir: repo, stdin: { contents: `
  export { createSlidePdfSample } from './apps/playground/src/demo/slide-pdf-sample.ts';
  export { createSlidePdfLoader } from './packages/slide/src/pdf/pdfjs-loader.ts';
`, resolveDir: repo }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlidePdfSample, createSlidePdfLoader } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const fonts = fileURLToPath(new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));

test('real PDF.js reads landscape/portrait pages through the public adapter and repeated loads retain bytes', async () => {
  const data = createSlidePdfSample(), before = data.slice();
  const loader = createSlidePdfLoader(pdfjs, data, { standardFontDataUrl: fonts });
  for (let iteration = 0; iteration < 2; iteration++) {
    const controller = new AbortController();
    const document = await loader({ signal: controller.signal });
    try {
      assert.equal(document.pageCount, 3);
      for (const [index, dimensions] of [[960, 540], [960, 540], [595, 842]].entries()) {
        const page = await document.getPage(index + 1);
        assert.deepEqual([page.width, page.height], dimensions);
      }
      await assert.rejects(document.getPage(4), /ページ番号/);
    } finally { await document.destroy(); }
    await assert.rejects(document.getPage(1), { name: 'AbortError' });
  }
  assert.deepEqual(data, before);
});

test('real PDF.js renders vector content into a canvas without converting the PDF into slide elements', async t => {
  let createCanvas;
  try { ({ createCanvas } = await import('@napi-rs/canvas')); }
  catch { t.skip('PDF.js optional native Canvas is unavailable; browser rendering is verified separately.'); return; }
  const ownerDocument = { createElement(name) { assert.equal(name, 'canvas'); return canvas(); } };
  function canvas() { const node = createCanvas(1, 1); node.ownerDocument = ownerDocument; return node; }
  const target = canvas(), controller = new AbortController();
  const document = await createSlidePdfLoader(pdfjs, createSlidePdfSample(), { standardFontDataUrl: fonts })({ signal: controller.signal });
  try {
    const page = await document.getPage(1);
    await page.render({ canvas: target, scale: 0.5 });
    assert.deepEqual([target.width, target.height], [480, 270]);
    const [red, green, blue, alpha] = target.getContext('2d').getImageData(5, 5, 1, 1).data;
    assert.equal(alpha, 255);
    assert.ok(red < green && green < blue && blue < 70, `Expected the PDF's navy background, got ${red},${green},${blue}`);
    controller.abort();
    await assert.rejects(page.render({ canvas: target, scale: 1 }), { name: 'AbortError' });
  } finally { await document.destroy(); }
});
