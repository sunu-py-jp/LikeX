import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { packageRoot } from './test-paths.mjs';

const bundle = await build({ absWorkingDir: packageRoot, stdin: { resolveDir: packageRoot, contents: `
  export { inspectExplorerUploadFile } from './src/inspection/index.ts';
  export { createZipArchive } from '../core/src/zip.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'reader-sources', setup(builder) {
  builder.onResolve({ filter: /^@likex\/core$/ }, () => ({ path: new URL('../../core/src/index.ts', import.meta.url).pathname }));
  builder.onResolve({ filter: /^pdf-lib$/ }, () => ({ path: import.meta.resolve('pdf-lib'), external: true }));
} }] });
const { inspectExplorerUploadFile: inspect, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const request = (file, kind, signal = new AbortController().signal) => ({ file, kind, signal,
  extension: kind === 'pdf' ? '.pdf' : kind === 'presentation' ? '.pptx' : kind === 'audio' ? '.mp3' : '.mp4' });
const mediaFile = () => new File(['media'], 'recording.mp4');
async function pdfFile(pages = 3, mutate) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage();
  mutate?.(pdf);
  return new File([await pdf.save()], 'document.pdf');
}
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const C = 'application/vnd.openxmlformats-officedocument.presentationml.';
async function presentationFile(count = 3, overrides = {}) {
  const entries = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="${C}presentation.main+xml"/>${Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${C}slide+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<Relationships><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i}" Type="${R}/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="${P}" show="${i === 0 ? 0 : 1}"/>`])),
    ...overrides,
  };
  const zip = await createZipArchive(Object.entries(entries).filter(([, content]) => content !== null).map(([path, content]) => ({ path, content: new Blob([content]) })));
  return new File([zip], 'slides.pptx');
}

test('PDF reader parses real compressed PDF objects and counts actual pages without DOM', async () => {
  assert.equal(typeof document, 'undefined');
  assert.deepEqual(await inspect(request(await pdfFile(7), 'pdf')), { kind: 'pdf', pages: 7 });
});

test('PDF reader rejects truncated, encrypted, inconsistent, and cyclic documents', async () => {
  const valid = await pdfFile();
  const invalid = [new File(['%PDF-1.7\nnot a document\n%%EOF'], 'broken.pdf'), new File([await valid.slice(0, valid.size - 30).arrayBuffer()], 'truncated.pdf'),
    await pdfFile(2, pdf => pdf.catalog.Pages().set(PDFName.of('Count'), PDFNumber.of(99))),
    await pdfFile(1, pdf => { pdf.catalog.Pages().Kids().push(pdf.catalog.get(PDFName.of('Pages'))); }),
    await pdfFile(1, pdf => { pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: 'Standard', V: 1, R: 2, Length: 40 })); }),
  ];
  for (const file of invalid) await assert.rejects(inspect(request(file, 'pdf')));
  await assert.rejects(inspect(request(invalid.at(-1), 'pdf')), /暗号化・パスワード付きPDF/);
});

test('PDF reader validates input bounds before allocation and rejects late file reads after abort', async () => {
  class Oversized extends File { get size() { return 100 * 1024 * 1024 + 1; } arrayBuffer() { assert.fail('oversized file must not be read'); } }
  await assert.rejects(inspect(request(new Oversized([], 'large.pdf'), 'pdf')), /100 MiB/);
  const controller = new AbortController();
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const file = await pdfFile();
  const bytes = await file.arrayBuffer();
  file.arrayBuffer = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const result = inspect(request(file, 'pdf', controller.signal));
  await ready;
  const rejected = assert.rejects(result, { name: 'AbortError' });
  controller.abort();
  await rejected;
  release(bytes);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('PPTX reader counts hidden slides and exceeds the editor 500-slide limit', async () => {
  assert.deepEqual(await inspect(request(await presentationFile(501), 'presentation')), { kind: 'presentation', slides: 501 });
});

test('PPTX reader reads bounded metadata slices without reading embedded media or full files', async () => {
  const source = await presentationFile(2, { 'ppt/media/video.mp4': new Uint8Array(33 * 1024 * 1024) });
  const sizes = [];
  class SlicedFile extends File {
    arrayBuffer() { assert.fail('whole file read is not allowed'); }
    slice(start, end) { sizes.push(end - start); return super.slice(start, end); }
  }
  assert.deepEqual(await inspect(request(new SlicedFile([source], source.name), 'presentation')), { kind: 'presentation', slides: 2 });
  assert.ok(sizes.length > 10);
  assert.ok(Math.max(...sizes) < 100_000);
});

test('PPTX reader rejects missing slide relationships, malformed XML, renamed ZIPs and macro packages', async () => {
  const invalid = [
    await presentationFile(1, { 'ppt/slides/slide0.xml': null }),
    await presentationFile(1, { 'ppt/presentation.xml': '<p:presentation><p:sldIdLst>' }),
    await presentationFile(1, { 'ppt/presentation.xml': '<p:presentation xmlns:p="urn:wrong"><p:sldIdLst/></p:presentation>' }),
    await presentationFile(1, { '[Content_Types].xml': '<Types><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"/></Types>' }),
    new File(['old or encrypted PowerPoint'], 'old.pptx'),
  ];
  for (const file of invalid) await assert.rejects(inspect(request(file, 'presentation')));
});

function mockMedia(t) {
  const listeners = new Map(), elements = [], revoked = [], created = [];
  t.mock.method(URL, 'createObjectURL', file => { created.push(file); return 'blob:metadata-test'; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(kind) {
    const element = { kind, duration: NaN, source: '', loads: 0,
      addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
      set src(value) { this.source = value; }, removeAttribute(name) { assert.equal(name, 'src'); this.source = ''; },
      load() { this.loads++; }, play() { assert.fail('metadata reader must never play media'); },
    };
    elements.push(element); return element;
  } } });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'document', old); else delete globalThis.document; });
  return { elements, revoked, created, listeners,
    async start(kind = 'video', signal) {
      const pending = inspect(request(mediaFile(), kind, signal));
      await new Promise(resolve => setImmediate(resolve));
      return { pending, element: elements.at(-1) };
    },
    emit(type) { listeners.get(type)?.(); },
  };
}

test('media metadata uses the correct element, releases the object URL, and never plays', async t => {
  const media = mockMedia(t);
  for (const kind of ['video', 'audio']) {
    const { pending, element } = await media.start(kind);
    assert.equal(element.kind, kind); assert.equal(element.preload, 'metadata'); assert.equal(element.muted, true);
    element.duration = 14_400.25; media.emit('loadedmetadata');
    assert.deepEqual(await pending, { kind, durationSeconds: 14_400.25 });
    assert.equal(element.source, ''); assert.equal(media.listeners.size, 0);
  }
  assert.deepEqual(media.revoked, ['blob:metadata-test', 'blob:metadata-test']);
});

test('unsupported, invalid-duration, and aborted media all clean up resources', async t => {
  const media = mockMedia(t);
  for (const scenario of ['error', 'invalid', 'abort']) {
    const controller = new AbortController(), { pending, element } = await media.start('video', controller.signal);
    const rejected = assert.rejects(pending);
    if (scenario === 'abort') controller.abort();
    else if (scenario === 'error') media.emit('error');
    else { element.duration = Infinity; media.emit('loadedmetadata'); }
    await rejected;
    assert.equal(element.source, ''); assert.equal(media.listeners.size, 0);
  }
  assert.equal(media.revoked.length, 3);
});

test('built-in media inspection times out and cleans up when no metadata event arrives', async t => {
  const media = mockMedia(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pending, element } = await media.start();
  const rejected = assert.rejects(pending, /タイムアウト/);
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(element.source, ''); assert.equal(media.revoked.length, 1); assert.equal(media.listeners.size, 0);
});

test('media in a headless environment gives the custom inspector extension point', async () => {
  await assert.rejects(inspect(request(mediaFile(), 'video')), /upload\.inspectFile/);
});
