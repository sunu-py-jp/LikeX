import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

async function inspector() {
  const bundle = await build({ absWorkingDir: packageRoot, stdin: { resolveDir: packageRoot, contents: "export { inspectExplorerUploadFile } from './src/inspection/index.ts';" }, bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'reader-sources', setup(builder) {
      builder.onResolve({ filter: /^@likex\/core$/ }, () => ({ path: new URL('../../core/src/index.ts', import.meta.url).pathname }));
    } }] });
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)).inspectExplorerUploadFile;
}
const inspect = await inspector();
const withLimits = pdfInspectionLimits => request => inspect({ ...request, pdfInspectionLimits });
const small = withLimits({ streamBytes: 4096, decodedBytes: 5000, depth: 16, treeDepth: 16, sections: 4 });
const request = (bytes, signal = new AbortController().signal) => ({ file: new File([bytes], 'independent.pdf'), extension: '.pdf', kind: 'pdf', signal });
const accepts = async (bytes, pages = 2, read = inspect) => assert.deepEqual(await read(request(bytes)), { kind: 'pdf', pages });
const rejects = (bytes, read = inspect, message) => assert.rejects(read(request(bytes)), message);
const B = value => Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');

// Independent binary fixtures: no PDF library or production parser builds them.
class Pdf {
  constructor(previous) { this.parts = [previous ? previous.bytes : B('%PDF-1.7\n%\xff\xfe\xfd\xfc\n')]; this.length = this.parts[0].length; this.entries = new Map(); }
  put(value) { const part = B(value); this.parts.push(part); this.length += part.length; }
  object(id, body, generation = 0) {
    this.entries.set(id, { type: 1, a: this.length, b: generation });
    this.put(`${id} ${generation} obj\n`); this.put(body); this.put('\nendobj\n'); return this;
  }
  stream(id, dict, data, generation = 0) { return this.object(id, Buffer.concat([B(`<< ${dict} /Length ${data.length} >>\nstream\n`), B(data), B('\nendstream')]), generation); }
  classic({ size = Math.max(...this.entries.keys()) + 1, root = '1 0 R', prev, extra = '', entries = this.entries, dense = true } = {}) {
    const xref = this.length;
    this.put('xref\n');
    const table = dense ? Array.from({ length: size }, (_, id) => [id, entries.get(id) ?? { type: 0, a: 0, b: id ? 0 : 65535 }]) : [...entries].sort(([a], [b]) => a - b);
    for (let at = 0; at < table.length;) {
      let end = at + 1;
      while (end < table.length && table[end][0] === table[end - 1][0] + 1) end++;
      this.put(`${table[at][0]} ${end - at}\n`);
      for (; at < end; at++) { const [, entry] = table[at]; this.put(`${String(entry.a).padStart(10, '0')} ${String(entry.b).padStart(5, '0')} ${entry.type === 0 ? 'f' : 'n'} \n`); }
    }
    this.put(`trailer\n<< /Size ${size} /Root ${root}${prev === undefined ? '' : ` /Prev ${prev}`} ${extra} >>\nstartxref\n${xref}\n%%EOF\n`);
    return { bytes: Buffer.concat(this.parts), xref, size };
  }
}
const pageObjects = (count = 2, extra = '') => [
  [1, `<< /Type /Catalog /Pages 2 0 R ${extra} >>`],
  [2, `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, index) => `${index + 3} 0 R`).join(' ')}] >>`],
  ...Array.from({ length: count }, (_, index) => [index + 3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']),
];
function classic({ count = 2, extra = '', mutate, trailer = '' } = {}) {
  const objects = new Map(pageObjects(count, extra)); mutate?.(objects);
  const pdf = new Pdf(); for (const [id, body] of objects) pdf.object(id, body);
  return pdf.classic({ extra: trailer });
}
function xrefBytes(entries, indices) {
  const out = Buffer.alloc(indices.length * 7);
  indices.forEach((id, index) => { const row = entries.get(id) ?? { type: 0, a: 0, b: id ? 0 : 65535 }; out[index * 7] = row.type; out.writeUInt32BE(row.a, index * 7 + 1); out.writeUInt16BE(row.b, index * 7 + 5); });
  return out;
}
function predictor(bytes, kind, columns = 7) {
  const rows = [];
  for (let at = 0; at < bytes.length; at += columns) {
    const row = bytes.subarray(at, at + columns), predicted = Buffer.alloc(columns);
    for (let x = 0; x < columns; x++) predicted[x] = (row[x] - (kind === 2 ? (x ? row[x - 1] : 0) : at ? bytes[at - columns + x] : 0)) & 255;
    rows.push(kind === 2 ? predicted : Buffer.concat([Buffer.from([2]), predicted]));
  }
  return Buffer.concat(rows);
}
function ascii85(bytes) {
  let output = '';
  for (let at = 0; at < bytes.length; at += 4) {
    const count = Math.min(4, bytes.length - at), group = Buffer.alloc(4); bytes.copy(group, 0, at, at + count);
    let value = group.readUInt32BE(), text = '';
    for (let i = 0; i < 5; i++) { text = String.fromCharCode(value % 85 + 33) + text; value = Math.floor(value / 85); }
    output += text.slice(0, count + 1);
  }
  return B(output + '~>');
}
function streamPdf({ compressedObjects = true, objectCount, firstOffset, objectTail = '', objectBody, objectParameters = '', xrefDict, index, widths = '[1 4 2]', prediction = 0, chained = false, xrefFilter = '/FlateDecode', xrefEncode = deflateSync, extraObject } = {}) {
  const pdf = new Pdf(), entries = new Map(), objects = pageObjects();
  if (compressedObjects) {
    let body = '', header = '';
    objects.forEach(([id, value], slot) => { header += `${id} ${Buffer.byteLength(body, 'latin1')} `; body += `${value}\n`; entries.set(id, { type: 2, a: 5, b: slot }); });
    const raw = B(header + body + objectTail), first = B(header).length;
    pdf.stream(5, `/Type /ObjStm /N ${objectCount ?? objects.length} /First ${firstOffset ?? first} /Filter /FlateDecode ${objectParameters}`, deflateSync(objectBody ? objectBody({ raw, first, objects }) : raw));
  } else for (const [id, value] of objects) pdf.object(id, value);
  if (extraObject) extraObject(pdf);
  for (const [id, entry] of pdf.entries) entries.set(id, entry);
  const xref = pdf.length; entries.set(6, { type: 1, a: xref, b: 0 });
  const size = Math.max(...entries.keys()) + 1;
  let raw = xrefBytes(entries, Array.from({ length: size }, (_, id) => id));
  if (prediction) raw = predictor(raw, prediction);
  let encoded = xrefEncode(raw), filter = xrefFilter;
  if (chained) { encoded = ascii85(encoded); filter = '[/ASCII85Decode /FlateDecode]'; }
  const params = prediction ? `/DecodeParms << /Predictor ${prediction} /Columns 7 /Colors 1 /BitsPerComponent 8 >>` : '';
  pdf.stream(6, xrefDict ?? `/Type /XRef /Size ${size} /Root 1 0 R /W ${widths} /Index ${index ?? `[0 ${size}]`} /Filter ${filter} ${params}`, encoded);
  pdf.put(`startxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(pdf.parts);
}

test('independent classic xref, compressed xref and ObjStm PDFs count actual pages without DOM', async () => {
  assert.equal(typeof document, 'undefined');
  await accepts(classic().bytes);
  await accepts(streamPdf({ compressedObjects: false }));
  await accepts(streamPdf());
  await accepts(classic({ count: 0 }).bytes, 0);
});

test('xref stream predictors and chained standard filters preserve page counts', async () => {
  await accepts(streamPdf({ prediction: 12 }));
  await accepts(streamPdf({ prediction: 2 }));
  await accepts(streamPdf({ chained: true }));
});

test('uncompressed, ASCIIHex, RunLength and literal LZW metadata streams remain readable', async () => {
  await accepts(streamPdf({ xrefFilter: 'null', xrefEncode: raw => raw }));
  await accepts(streamPdf({ xrefFilter: '/ASCIIHexDecode', xrefEncode: raw => B(raw.toString('hex') + '>') }));
  await accepts(streamPdf({ xrefFilter: '/RunLengthDecode', xrefEncode: raw => Buffer.concat([Buffer.from([raw.length - 1]), raw, Buffer.from([128])]) }));
  await accepts(streamPdf({ xrefFilter: '/LZWDecode', xrefEncode: raw => {
    // Clear, literal codes, end. This fixture is below the first width transition.
    const bits = [256, ...raw, 257].map(code => code.toString(2).padStart(9, '0')).join('');
    return Buffer.from(Array.from({ length: Math.ceil(bits.length / 8) }, (_, index) => parseInt(bits.slice(index * 8, index * 8 + 8).padEnd(8, '0'), 2)));
  } }));
});

test('ordinary object streams can resolve an indirect Length through xref entries', async () => {
  const pdf = new Pdf();
  pdf.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pages = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n', page = '<< /Type /Page /Parent 2 0 R >>\n';
  const header = `2 0 3 ${B(pages).length} `, data = deflateSync(B(header + pages + page));
  pdf.object(4, String(data.length));
  pdf.object(5, Buffer.concat([B(`<< /Type /ObjStm /N 2 /First ${B(header).length} /Filter /FlateDecode /Length 4 0 R >>\nstream\n`), data, B('\nendstream')]));
  const entries = new Map(pdf.entries), xref = pdf.length;
  entries.set(2, { type: 2, a: 5, b: 0 }); entries.set(3, { type: 2, a: 5, b: 1 }); entries.set(6, { type: 1, a: xref, b: 0 });
  pdf.stream(6, '/Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Filter /FlateDecode', deflateSync(xrefBytes(entries, [0, 1, 2, 3, 4, 5, 6])));
  pdf.put(`startxref\n${xref}\n%%EOF\n`);
  await accepts(Buffer.concat(pdf.parts), 1);
});

test('configured object limits include dependencies resolved while a compressed page is pending', async () => {
  const pdf = new Pdf();
  pdf.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.object(2, '<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
  const data = deflateSync(B('3 0 << /Type /Page /Parent 2 0 R >>'));
  pdf.object(4, String(data.length));
  pdf.object(5, Buffer.concat([B('<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 4 0 R >>\nstream\n'), data, B('\nendstream')]));
  const entries = new Map(pdf.entries), xref = pdf.length;
  entries.set(3, { type: 2, a: 5, b: 0 }); entries.set(6, { type: 1, a: xref, b: 0 });
  pdf.stream(6, '/Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Filter /FlateDecode', deflateSync(xrefBytes(entries, [0, 1, 2, 3, 4, 5, 6])));
  pdf.put(`startxref\n${xref}\n%%EOF\n`);
  const bytes = Buffer.concat(pdf.parts);
  await rejects(bytes, withLimits({ objects: 3 }), /上限/);
  await accepts(bytes, 1, withLimits({ objects: 4 }));
});

test('name escapes are decoded once and strings/comments cannot manufacture pages', async () => {
  const valid = classic({ extra: '/Note (fake \\(/Type /Page\\) 88 0 obj endobj) /Hex <2f54797065202f50616765>', mutate(objects) {
    objects.set(1, '<< /T#79pe /Cat#61log /P#61ges 2 0 R /Note (a\\\nb \\(nested\\)) /Hex <2f50616765> >>');
    objects.set(2, '<< /Type /Pages /Count 2 /Kids [3 0 R % /Type /Page\n 4 0 R] >>');
  } });
  await accepts(valid.bytes);
  await rejects(classic({ mutate(objects) { objects.set(1, '<< /Type /#2343atalog /Pages 2 0 R >>'); } }).bytes);
});

test('unrelated content and image streams are not inflated or interpreted', async () => {
  const pdf = new Pdf();
  for (const [id, body] of pageObjects()) pdf.object(id, id === 3 ? '<< /Type /Page /Parent 2 0 R /Contents 8 0 R /Resources << /XObject << /Image 9 0 R >> >> >>' : body);
  pdf.stream(8, '/Filter /FlateDecode', deflateSync(B(' /Type /Page '.repeat(10_000))));
  pdf.stream(9, '/Type /XObject /Subtype /Image /Width 100 /Height 100 /Filter /UnrecognizedImageFilter', B('not an image, and deliberately not decoded'));
  await accepts(pdf.classic().bytes, 2, small);
});

test('latest incremental replacement overrides stale objects and Count', async () => {
  const original = classic(), updated = new Pdf(original);
  updated.object(2, '<< /Type /Pages /Count 1 /Kids [4 0 R] >>');
  await accepts(updated.classic({ size: original.size, prev: original.xref, dense: false }).bytes, 1);
});

test('incremental free entries and generation changes cannot resurrect stale pages', async () => {
  const original = classic(), deleted = new Pdf(original);
  deleted.entries.set(3, { type: 0, a: 0, b: 1 });
  await rejects(deleted.classic({ size: original.size, prev: original.xref, dense: false }).bytes);
  const stale = new Pdf(original); stale.object(3, '<< /Type /Page /Parent 2 0 R >>', 1);
  await rejects(stale.classic({ size: original.size, prev: original.xref, dense: false }).bytes);
  const revised = new Pdf(original); revised.object(3, '<< /Type /Page /Parent 2 0 R >>', 1); revised.object(2, '<< /Type /Pages /Count 1 /Kids [3 1 R] >>');
  await accepts(revised.classic({ size: original.size, prev: original.xref, dense: false }).bytes, 1);
});

test('hybrid xref stream entries override same-revision classic free placeholders', async () => {
  const pdf = new Pdf(), objects = pageObjects(), body = objects.map(([, value]) => value + '\n');
  let header = '', at = 0;
  objects.forEach(([id], index) => { header += `${id} ${at} `; at += B(body[index]).length; });
  pdf.stream(5, `/Type /ObjStm /N 4 /First ${B(header).length} /Filter /FlateDecode`, deflateSync(B(header + body.join(''))));
  const entries = new Map(objects.map(([id], index) => [id, { type: 2, a: 5, b: index }]));
  const supplemental = pdf.length;
  pdf.stream(6, '/Type /XRef /Size 7 /W [1 4 2] /Index [1 4] /Filter /FlateDecode', deflateSync(xrefBytes(entries, [1, 2, 3, 4])));
  await accepts(pdf.classic({ size: 7, extra: `/XRefStm ${supplemental}` }).bytes);
});

test('xref section loops and excessive revision chains fail within bounded work', async () => {
  const self = new Pdf(); for (const [id, body] of pageObjects()) self.object(id, body);
  await rejects(self.classic({ prev: self.length }).bytes);
  let current = classic();
  for (let i = 0; i < 5; i++) { const next = new Pdf(current); next.object(2, '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>'); current = next.classic({ size: current.size, prev: current.xref, dense: false }); }
  await rejects(current.bytes, small, /上限/);
});

test('malformed xref widths and index arithmetic are rejected before allocation', async () => {
  for (const widths of ['[1 4]', '[1 -1 2]', '[1 1000000000 2]', '[0 0 0]', '[1 4 2 0]']) await rejects(streamPdf({ widths }));
  for (const index of ['[0]', '[0 -1]', '[0 9007199254740991]', '[9007199254740991 2]', '[0 4 3 4]']) await rejects(streamPdf({ index }));
});

test('compressed object counts, offsets and illegal metadata filters fail closed', async () => {
  for (const options of [{ objectCount: -1 }, { objectCount: 1000000000 }, { firstOffset: -1 }, { firstOffset: 9007199254740991 }]) await rejects(streamPdf(options));
  await rejects(streamPdf({ objectBody: ({ raw }) => B('1 999999999999 ' + raw.toString('latin1')) }));
  await rejects(streamPdf({ xrefFilter: '/UnrecognizedMetadataFilter' }));
  await rejects(streamPdf({ xrefFilter: '[/FlateDecode /FlateDecode]' }));
  await rejects(streamPdf({ xrefEncode(raw) { const corrupt = deflateSync(raw); corrupt[corrupt.length - 1] ^= 1; return corrupt; } }));
});

test('page tree Count, duplicate visits, malformed references and nesting limits are checked', async () => {
  for (const body of ['<< /Type /Pages /Count 99 /Kids [3 0 R 4 0 R] >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 3 0 R] >>', '<< /Type /Pages /Count 1 /Kids [2 0 R] >>', '<< /Type /Pages /Count 1 /Kids [9007199254740991 0 R] >>'])
    await rejects(classic({ mutate(objects) { objects.set(2, body); } }).bytes);
  const pdf = new Pdf(); pdf.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  for (let id = 2; id < 22; id++) pdf.object(id, `<< /Type /Pages /Count 1 /Kids [${id + 1} 0 R] >>`);
  pdf.object(22, '<< /Type /Page /Parent 21 0 R >>');
  await rejects(pdf.classic().bytes, small, /上限|深/);
  await rejects(classic({ extra: `/Nested ${'['.repeat(18)}0${']'.repeat(18)}` }).bytes, small, /上限|深/);
});

test('compressed metadata expansion stops at stream and cumulative decoded limits', async () => {
  await accepts(streamPdf({ objectTail: ' '.repeat(1000) }), 2, small);
  await rejects(streamPdf({ objectTail: ' '.repeat(8000) }), small, /上限/);
  const total = withLimits({ decodedBytes: 1000 });
  await rejects(streamPdf({ objectTail: ' '.repeat(1000) }), total, /上限/);
});

test('compact shared parameter references cannot expand beyond the parsed-value budget', async () => {
  const bounded = withLimits({ values: 1000 });
  const bytes = streamPdf({ objectParameters: '/DecodeParms 10 0 R', extraObject(pdf) {
    for (let id = 10; id < 22; id++) pdf.object(id, `[${id + 1} 0 R ${id + 1} 0 R]`);
    pdf.object(22, '<< /Predictor 1 >>');
  } });
  assert.ok(bytes.length < 2500);
  await rejects(bytes, bounded, /上限/);
});

test('encryption and forged bootstrap stream lengths do not enter a permissive parser fallback', async () => {
  await rejects(classic({ trailer: '/Encrypt 9 0 R' }).bytes, inspect, /暗号化|パスワード/);
  const pdf = new Pdf(); for (const [id, body] of pageObjects()) pdf.object(id, body);
  const at = pdf.length;
  pdf.object(6, '<< /Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Length 7 0 R >>\nstream\nendstream');
  pdf.object(7, '0'); pdf.put(`startxref\n${at}\n%%EOF\n`);
  await rejects(Buffer.concat(pdf.parts));
});

test('cancellation interrupts real lexical processing and stops further cooperative work', { timeout: 5000 }, async t => {
  const originalTimeout = globalThis.setTimeout, controller = new AbortController();
  let ticks = 0, abortTicks;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 0) {
      ticks++;
      if (abortTicks === undefined) originalTimeout(() => { abortTicks = ticks; controller.abort(); }, 0);
    }
    return originalTimeout(callback, delay, ...args);
  });
  const bytes = classic({ extra: `/LongString (${'a'.repeat(2 * 1024 * 1024)})` }).bytes;
  await assert.rejects(inspect(request(bytes, controller.signal)), { name: 'AbortError' });
  assert.notEqual(abortTicks, undefined, 'the parser yielded during real processing');
  await new Promise(resolve => originalTimeout(resolve, 25));
  assert.ok(ticks <= abortTicks + 1, `parser continued scheduling after cancellation: ${abortTicks} -> ${ticks}`);
});

test('deadline checks stop real metadata parsing between cooperative yields', { timeout: 5000 }, async () => {
  const timed = withLimits({ timeoutMs: 5 });
  const bytes = classic({ extra: `/LongString (${'a'.repeat(2 * 1024 * 1024)})` }).bytes;
  await rejects(bytes, timed, /タイムアウト/);
});
