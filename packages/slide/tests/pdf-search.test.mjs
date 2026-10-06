import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [new URL('../src/pdf-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { searchPdf, createPdfTextLoader, PDF_SEARCH_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = () => new TextEncoder().encode('%PDF-1.7 example handled by injected engine');
function textHost(pages, overrides = {}) {
  const counts = { loads: 0, destroyed: 0, pages: [], signals: [] };
  const document = { pageCount: pages.length, async getPageText(number, { signal }) { counts.pages.push(number); counts.signals.push(signal); return pages[number - 1]; },
    async destroy() { counts.destroyed++; }, ...overrides };
  return { counts, document, load: async ({ signal }) => { counts.loads++; counts.signal = signal; return document; } };
}
function engine(items, overrides = {}) {
  const counts = { destroyed: 0, cleanup: 0, pages: [], options: [] };
  const page = { async getTextContent(options) { counts.options.push(options); return { items }; }, cleanup() { counts.cleanup++; }, ...overrides };
  const document = { numPages: 1, async getPage(number) { counts.pages.push(number); return page; } };
  const pdfjs = { getDocument(options) { counts.loading = options; return { promise: Promise.resolve(document), async destroy() { counts.destroyed++; } }; } };
  return { counts, pdfjs, page, document, load: createPdfTextLoader(pdfjs, bytes()) };
}

test('the PDF entry loads without a rendering engine, React, DOM or editable Slide modules', () => {
  const inputs = Object.keys(built.metafile.inputs).join('\n');
  assert.doesNotMatch(inputs, /node_modules\/react(?:-dom)?\//);
  assert.doesNotMatch(inputs, /pdfjs-loader|pdf-viewer|pdf-thumbnail|src\/model\/(?:deck|normalize)|src\/state\//);
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.HTMLCanvasElement, 'undefined');
});

test('AND is per page, OR preserves page order, literals and Unicode offsets refer to returned text', async () => {
  const host = textHost(['😀 Alpha beta a.b', 'alpha alone', 'Beta alone', 'image without searchable words']);
  const and = await searchPdf(host.load, { keywords: ['alpha', 'BETA'] });
  assert.deepEqual(and.matches.map(hit => hit.pageNumber), [1]);
  assert.equal(and.truncated, false);
  assert.deepEqual(and.matches[0].matches.map(match => [match.keyword, match.from, match.to]), [['alpha', 3, 8], ['BETA', 9, 13]]);
  for (const match of and.matches[0].matches) assert.ok(['Alpha', 'beta'].includes(and.matches[0].text.slice(match.from, match.to)));
  const or = await searchPdf(host.load, { keywords: ['alpha', 'beta'], operator: 'or', matchCase: true });
  assert.deepEqual(or.matches.map(hit => hit.pageNumber), [1, 2]);
  assert.deepEqual((await searchPdf(host.load, { keywords: ['a.b'] })).matches.map(hit => hit.pageNumber), [1]);
  assert.equal(host.counts.destroyed, 3);
});

test('a limit reports omitted matching pages only and never retains an unbounded result', async () => {
  const host = textHost(['hit', 'miss', 'hit', 'hit']);
  const limited = await searchPdf(host.load, { keywords: ['hit'] }, { limit: 1 });
  assert.equal(limited.truncated, true); assert.deepEqual(limited.matches.map(hit => hit.pageNumber), [1]);
  assert.deepEqual(host.counts.pages, [1, 2, 3]);
  const exact = await searchPdf(textHost(['hit', 'miss']).load, { keywords: ['hit'] }, { limit: 1 });
  assert.equal(exact.truncated, false);
});

test('empty queries do not load a PDF; bad queries/options reject before loading', async () => {
  const host = textHost(['hello']);
  assert.deepEqual(await searchPdf(host.load, { keywords: [] }), { matches: [], truncated: false });
  for (const query of [{ keywords: [''] }, { keywords: ['x'], operator: 'xor' }, { keywords: ['x'], useRegex: true }])
    await assert.rejects(searchPdf(host.load, query));
  for (const options of [null, [], { limit: 0 }, { limit: 10001 }, { limit: 1.5 }, { signal: {} }, { unknown: true }])
    await assert.rejects(searchPdf(host.load, { keywords: ['x'] }, options));
  const signal = AbortSignal.abort(new Error('already stopped'));
  await assert.rejects(searchPdf(host.load, { keywords: [] }, { signal }), /already stopped/);
  assert.equal(host.counts.loads, 0);
});

test('query and limit snapshots survive host mutation while a page read is pending', async () => {
  const pending = deferred(), host = textHost(['', 'alpha'], { getPageText: number => number === 1 ? pending.promise : Promise.resolve('alpha') });
  const query = { keywords: ['alpha'] }, options = { limit: 1 };
  const result = searchPdf(host.load, query, options);
  query.keywords[0] = 'missing'; options.limit = 10;
  pending.resolve('alpha');
  const found = await result;
  assert.equal(found.matches.length, 1); assert.equal(found.truncated, true); assert.equal(found.matches[0].matches[0].keyword, 'alpha');
});

test('unsupported text documents and read failures reject and release their owned document', async () => {
  for (const overrides of [{ getPageText: undefined }, { pageCount: 0 }, { pageCount: 2001 }, { getPageText: async () => null },
    { getPageText: async () => { throw new Error('parse failed'); } }]) {
    const host = textHost(['one'], overrides);
    await assert.rejects(searchPdf(host.load, { keywords: ['one'] }));
    assert.equal(host.counts.destroyed, 1); assert.equal(host.counts.signal.aborted, true);
  }
});

test('aborting loading destroys a late document and aborting a read rejects without waiting for stuck cleanup', async () => {
  const loading = deferred(), controller = new AbortController(), host = textHost(['one']);
  const first = searchPdf(() => loading.promise, { keywords: ['one'] }, { signal: controller.signal });
  controller.abort(new Error('loading stopped'));
  await assert.rejects(first, /loading stopped/);
  loading.resolve(host.document); await tick(); assert.equal(host.counts.destroyed, 1);
  const reading = deferred(), cancellation = new AbortController(); let destroyed = 0;
  const slow = textHost(['one'], { getPageText: () => reading.promise, destroy: () => { destroyed++; return new Promise(() => {}); } });
  const second = searchPdf(slow.load, { keywords: ['one'] }, { signal: cancellation.signal });
  await tick(); cancellation.abort(new Error('read stopped'));
  await assert.rejects(second, /read stopped/); assert.equal(destroyed, 1);
  reading.reject(new Error('late parser failure')); await tick();
});

test('page, document text and total match-position budgets reject rather than return partial results', async () => {
  for (const host of [textHost(['x'.repeat(PDF_SEARCH_LIMITS.pageTextCharacters + 1)]),
    textHost(Array.from({ length: 21 }, () => 'x'.repeat(1_000_000))),
    textHost(['x'.repeat(10001)]), textHost(Array.from({ length: 11 }, () => 'x'.repeat(10000)))]) {
    const keyword = host.document.pageCount === 21 ? 'absent' : 'x';
    await assert.rejects(searchPdf(host.load, { keywords: [keyword] }), /上限|10,000/);
    assert.equal(host.counts.destroyed, 1);
  }
});

test('PDF.js text fragments concatenate across items, EOL is LF, and pages need no viewport or render method', async () => {
  const host = engine([{ str: 'inter', hasEOL: false }, { str: 'national', hasEOL: true }, { str: 'Résumé' }]);
  const result = await searchPdf(host.load, { keywords: ['international', 'résumé'] });
  assert.equal(result.matches[0].text, 'international\nRésumé');
  assert.deepEqual(host.counts.options, [{ includeMarkedContent: false }]);
  assert.equal(host.counts.cleanup, 1); assert.equal(host.counts.destroyed, 1);
  assert.deepEqual(host.counts.pages, [1]);
  assert.equal(host.counts.loading.isEvalSupported, false); assert.equal('url' in host.counts.loading, false);
});

test('textless pages are not OCRed; malformed/oversized text and missing extraction capability fail cleanly', async () => {
  assert.deepEqual(await searchPdf(engine([]).load, { keywords: ['anything'] }), { matches: [], truncated: false });
  for (const host of [engine([{ str: 1 }]), engine([{ str: 'ok', hasEOL: 1 }]), engine([{ str: 'x'.repeat(1_000_001) }]),
    engine(Array.from({ length: 100001 }, () => ({ str: '' }))), engine([], { getTextContent: undefined })]) {
    await assert.rejects(searchPdf(host.load, { keywords: ['x'] }));
    assert.equal(host.counts.cleanup, 1); assert.equal(host.counts.destroyed, 1);
  }
});

test('concurrent text reads clean the native page only after underlying work settles, including cancelled reads', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const host = engine([], { getTextContent: () => ++calls === 1 ? first.promise : second.promise });
  const document = await host.load({ signal: new AbortController().signal }), controller = new AbortController();
  const a = document.getPageText(1, { signal: controller.signal }), b = document.getPageText(1);
  await tick(); controller.abort(); await assert.rejects(a, { name: 'AbortError' });
  first.resolve({ items: [{ str: 'late' }] }); await tick(); assert.equal(host.counts.cleanup, 0);
  second.resolve({ items: [{ str: 'current' }] }); assert.equal(await b, 'current'); assert.equal(host.counts.cleanup, 1);
  await document.destroy(); await assert.rejects(document.getPageText(1), { name: 'AbortError' });
});

test('an aborted page acquisition cannot clean a cached page while another read is extracting its text', async () => {
  const extraction = deferred(), acquisition = deferred(); let requests = 0;
  const host = engine([], { getTextContent: () => extraction.promise });
  host.document.getPage = async () => ++requests === 1 ? host.page : acquisition.promise;
  const document = await host.load({ signal: new AbortController().signal }), controller = new AbortController();
  const first = document.getPageText(1); await tick();
  const second = document.getPageText(1, { signal: controller.signal }); await tick();
  controller.abort(); await assert.rejects(second, { name: 'AbortError' });
  acquisition.resolve(host.page); await tick();
  assert.equal(host.counts.cleanup, 0, 'A late cancelled acquisition must not interrupt the active extraction');
  extraction.resolve({ items: [{ str: 'Still extracting safely' }] });
  assert.equal(await first, 'Still extracting safely'); assert.equal(host.counts.cleanup, 1);
  await document.destroy(); assert.equal(host.counts.destroyed, 1);
});

test('the DOM-free file-like input captures its reader while byte buffers are copied at factory creation', async () => {
  const host = engine([{ str: 'text' }]), source = bytes(), expected = source.slice();
  const load = createPdfTextLoader(host.pdfjs, source); source.fill(0);
  await searchPdf(load, { keywords: ['text'] }); assert.deepEqual(host.counts.loading.data, expected);
  const file = { size: expected.length, async arrayBuffer() { return expected.buffer; } };
  const fileLoad = createPdfTextLoader(host.pdfjs, file); file.arrayBuffer = async () => { throw new Error('changed reader'); };
  await searchPdf(fileLoad, { keywords: ['text'] }); assert.deepEqual(host.counts.loading.data, expected);
});

function realPdf() {
  const streams = ['BT /F1 12 Tf 20 80 Td (Alpha ) Tj (beta) Tj ET', 'BT /F1 12 Tf 20 80 Td (Alpha only) Tj ET', ''];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  streams.forEach((stream, index) => { objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4 + index * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let output = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

test('real PDF.js extracts and searches a generated PDF in Node without initializing page rendering', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = fileURLToPath(new URL('../../standard_fonts/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
  const load = createPdfTextLoader(pdfjs, realPdf(), { standardFontDataUrl });
  const result = await searchPdf(load, { keywords: ['alpha', 'beta'] });
  assert.deepEqual(result.matches.map(hit => hit.pageNumber), [1]);
  assert.equal(result.matches[0].text, 'Alpha beta');
  assert.deepEqual((await searchPdf(load, { keywords: ['Alpha'] })).matches.map(hit => hit.pageNumber), [1, 2]);
});
