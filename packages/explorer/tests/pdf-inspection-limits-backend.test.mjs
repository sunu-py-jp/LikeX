import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

const bundle = await build({ absWorkingDir: packageRoot, stdin: { resolveDir: packageRoot, contents: `
  export * from './src/model/pdf-inspection-limits.ts';
  export { PdfBudget } from './src/inspection/pdf-budget.ts';
  export { PdfLexer } from './src/inspection/pdf-lexer.ts';
  export { readPdfPageCount } from './src/inspection/pdf-document.ts';
  export { inspectPdf } from './src/inspection/pdf.ts';
  export { inspectExplorerUploadFile } from './src/inspection/index.ts';
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = value => new TextEncoder().encode(value);
const budget = limits => new m.PdfBudget(new AbortController().signal, limits);
const request = (file, pdfInspectionLimits) => ({ file, extension: '.pdf', kind: 'pdf', signal: new AbortController().signal, pdfInspectionLimits });

function pdf(gap = '') {
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, value] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>', '<< /Type /Page /Parent 2 0 R >>'].entries()) {
    offsets.push(text.length); text += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = text.length;
  text += 'xref\n0 4\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return bytes(`${text}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n${gap}%%EOF\n`);
}

test('PDF defaults remain frozen, complete and inherited; overrides are detached', () => {
  const defaults = m.EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS;
  assert.equal(defaults.inputBytes, 100 * 1024 * 1024);
  assert.equal(defaults.streamBytes, 16 * 1024 * 1024);
  assert.equal(defaults.decodedBytes, 64 * 1024 * 1024);
  assert.equal(defaults.timeoutMs, 30000);
  for (const key of ['objects', 'xrefEntries', 'objectStreamObjects', 'treeNodes']) assert.equal(defaults[key], 100000);
  assert.equal(Object.keys(defaults).length, 19);
  assert.ok(Object.isFrozen(defaults));
  const source = { inputBytes: 1234, streamBytes: undefined };
  const resolved = m.resolvePdfInspectionLimits(source);
  source.inputBytes = 1;
  assert.equal(resolved.inputBytes, 1234); assert.equal(resolved.streamBytes, defaults.streamBytes);
  assert.ok(Object.isFrozen(resolved)); assert.notEqual(resolved, source);
  assert.equal(m.resolvePdfInspectionLimits(Object.assign(Object.create(null), { treeNodes: 2 })).treeNodes, 2);
});

test('every PDF limit rejects unlimited, invalid and unknown settings', () => {
  for (const value of [null, false, [], 2, 'x', new Date(), Object.create({ work: 3 })])
    assert.throws(() => m.resolvePdfInspectionLimits(value), /pdfInspectionLimits/);
  for (const key of Object.keys(m.EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS)) {
    for (const value of [0, -1, 1.5, NaN, Infinity, false, null, '3', Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => m.resolvePdfInspectionLimits({ [key]: value }), /pdfInspectionLimits/);
    assert.equal(m.resolvePdfInspectionLimits({ [key]: 1 })[key], 1);
  }
  for (const value of [{ unknown: 1 }, { [Symbol('work')]: 1 }, Object.defineProperty({}, 'unknown', { value: 1 })])
    assert.throws(() => m.resolvePdfInspectionLimits(value), /pdfInspectionLimits/);
  assert.throws(() => m.resolvePdfInspectionLimits({ timeoutMs: 2147483648 }), /timeoutMs/);
  assert.equal(m.resolvePdfInspectionLimits({ timeoutMs: 2147483647 }).timeoutMs, 2147483647);
});

test('resource counters use detached per-instance settings', () => {
  const source = { work: 2, values: 1, decodedBytes: 1 }, resource = budget(source);
  source.work = 100;
  resource.work(2); assert.throws(() => resource.work(), /上限/);
  const values = budget({ values: 1 }); values.value(); assert.throws(() => values.value(), /上限/);
  const decoded = budget({ decodedBytes: 1 }); decoded.decodedBytes(1); assert.throws(() => decoded.decodedBytes(1), /上限/);
  assert.doesNotThrow(() => budget().work(3));
});

test('larger lexical limits support long tokens/names without argument-stack overflow', async () => {
  const long = 'a'.repeat(150000);
  assert.equal(await new m.PdfLexer(bytes(long), budget({ tokenLength: long.length })).word(), long);
  assert.deepEqual(await new m.PdfLexer(bytes('/' + long), budget({ nameLength: long.length })).value(), { kind: 'name', value: long });
  await assert.rejects(new m.PdfLexer(bytes('a'.repeat(1025)), budget()).word(), /上限/);
  await assert.rejects(new m.PdfLexer(bytes('/' + 'a'.repeat(1025)), budget()).value(), /上限/);
  assert.equal(await new m.PdfLexer(bytes('0'.repeat(19) + '1'), budget({ integerDigits: 20 })).integer(), 1);
  await assert.rejects(new m.PdfLexer(bytes('0'.repeat(19) + '1'), budget()).integer(), /整数/);
  const fractional = '0.' + '0'.repeat(70) + '1';
  assert.equal(await new m.PdfLexer(bytes(fractional), budget({ numberLength: 80 })).value(), Number(fractional));
  await assert.rejects(new m.PdfLexer(bytes(fractional), budget()).value(), /値/);
});

test('xref entry, cache and page-tree budgets can be configured independently', async () => {
  const data = pdf();
  assert.equal(await m.readPdfPageCount(data, budget({ xrefEntries: 4, objects: 3, treeNodes: 2, objectStreamObjects: 1 })), 1);
  for (const limits of [{ xrefEntries: 3 }, { objects: 2 }, { treeNodes: 1 }])
    await assert.rejects(m.readPdfPageCount(data, budget(limits)), /上限|不正/);
  const distant = pdf(' '.repeat(1200));
  await assert.rejects(m.readPdfPageCount(distant, budget()), /参照位置/);
  assert.equal(await m.readPdfPageCount(distant, budget({ startXrefSearchBytes: 2048 })), 1);
});

test('file size overrides are checked before reading and captured before await', async () => {
  const data = pdf();
  const oversized = new File([data], 'test.pdf');
  oversized.arrayBuffer = () => { assert.fail('over-limit file must not be read'); };
  await assert.rejects(m.inspectPdf(request(oversized, { inputBytes: 8 })), /8 bytes/);
  let release;
  const file = new File([data], 'test.pdf');
  file.arrayBuffer = () => new Promise(resolve => { release = resolve; });
  const limits = { inputBytes: data.length, treeNodes: 2 };
  const pending = m.inspectPdf(request(file, limits));
  limits.inputBytes = 1; limits.treeNodes = 1;
  release(data.buffer);
  assert.deepEqual(await pending, { kind: 'pdf', pages: 1 });
});

test('the outer PDF timeout honors its override while non-PDF readers keep 30 seconds', async t => {
  const delays = [], original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return original(callback, delay, ...args); });
  const file = new File([pdf()], 'slow.pdf');
  file.arrayBuffer = () => new Promise(() => {});
  await assert.rejects(m.inspectExplorerUploadFile(request(file, { timeoutMs: 5 })), /タイムアウト/);
  assert.equal(delays[0], 5);
  delays.length = 0;
  await assert.rejects(m.inspectExplorerUploadFile({ ...request(file, { timeoutMs: 1 }), kind: 'video', extension: '.mp4' }));
  assert.equal(delays[0], 30000);
});
