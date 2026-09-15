import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zip, fixture } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/zip"; export * from "./src/import/xml"; export * from "./src/import/relationships"; export * from "./src/import/types";', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-security-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { openXlsxArchive, parseXml, readRelationships, XLSX_IMPORT_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const parse = value => parseXml(new TextEncoder().encode(value));

test('STORE, DEFLATE and signed streaming data descriptors verify bytes and CRC', async () => {
  for (const method of [0, 8]) for (const descriptor of [false, true]) {
    const archive = await openXlsxArchive(zip({ 'xl/test.xml': '<a>日本語 &amp; one</a>' }, { method, descriptor }));
    assert.equal(new TextDecoder().decode(await archive.read('xl/test.xml')), '<a>日本語 &amp; one</a>');
  }
});
test('duplicate, case-ambiguous, traversal, absolute and encoded ZIP paths are rejected', async () => {
  for (const entries of [[['a', '1'], ['a', '2']], [['a', '1'], ['A', '2']], [['../a', '1']], [['/a', '1']], [['x/../../a', '1']], [['x\\a', '1']], [['%2e%2e/a', '1']]]) await assert.rejects(openXlsxArchive(zip(entries)), /パス|重複/);
});
test('CRC, malformed local headers, encrypted members, truncation and ZIP64 are rejected', async () => {
  const data = zip({ 'a': 'abcdef' }, { method: 0 });
  for (const mutate of [b => { b[32] ^= 1; }, b => b.writeUInt16LE(1, 6), b => b.writeUInt32LE(0xffffffff, b.length - 6), b => b.writeUInt16LE(0xffff, b.length - 12), b => b.writeUInt32LE(999, 18)]) {
    const changed = Buffer.from(data); mutate(changed); await assert.rejects(openXlsxArchive(changed));
  }
  await assert.rejects(openXlsxArchive(data.subarray(0, data.length - 1)));
});
test('actual inflation is capped even when the directory lies about output size', async () => {
  const data = zip({ 'a': Buffer.alloc(1024 * 1024, 65) });
  const central = data.readUInt32LE(data.length - 6); data.writeUInt32LE(1, 22); data.writeUInt32LE(1, central + 24);
  await assert.rejects(openXlsxArchive(data), /展開サイズ/);
  const oversized = new Blob([new Uint8Array(XLSX_IMPORT_LIMITS.inputBytes + 1)]);
  await assert.rejects(openXlsxArchive(oversized), /32 MiB/);
});
test('unused ZIP members are also CRC checked', async () => {
  const data = zip({ 'unused.bin': 'bad' }, { method: 0 }); data[40] ^= 1;
  await assert.rejects(openXlsxArchive(data), /CRC/);
});
test('internal relationships cannot escape the package; external URLs are retained without reads', async () => {
  for (const target of ['../../outside.xml', 'https://example.test/x', 'file:///etc/passwd', '%2e%2e/%2e%2e/outside']) {
    const entries = fixture(); entries['xl/_rels/workbook.xml.rels'] = `<Relationships><Relationship Id="x" Type="test" Target="${target}"/></Relationships>`;
    await assert.rejects(readRelationships(await openXlsxArchive(zip(entries)), 'xl/workbook.xml'), /パッケージ外/);
  }
  const entries = fixture(); entries['xl/_rels/workbook.xml.rels'] = '<Relationships><Relationship Id="x" Type="test" Target="https://example.test/x" TargetMode="External"/></Relationships>';
  assert.equal((await readRelationships(await openXlsxArchive(zip(entries)), 'xl/workbook.xml')).get('x').external, true);
});
test('XML refuses DTD, external entities, duplicate attributes, malformed entities, depth and controls', () => {
  for (const value of ['<!DOCTYPE x [<!ENTITY b SYSTEM "file:///etc/passwd">]><x>&b;</x>', '<x a="1" a="2"/>', '<x>&unknown;</x>', '<x>&#0;</x>', '<x>\u0000</x>', '<x><y></x>', '<x/>tail', '<x/><y/>', `${'<x>'.repeat(65)}${'</x>'.repeat(65)}`]) assert.throws(() => parse(value), /XML/);
  assert.equal(parse('<x a="&lt;&amp;&#x41;">&apos;&quot;</x>').attributes.a, '<&A');
});
test('XML node cap and cancellation are enforced without DOM globals', async () => {
  assert.equal(globalThis.DOMParser, undefined);
  assert.throws(() => parse(`<x>${'<a/>'.repeat(XLSX_IMPORT_LIMITS.xmlNodes)}</x>`), /XML/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(openXlsxArchive(zip({ a: '1' }), abort.signal), { name: 'AbortError' });
});
test('structural file inputs verify declared size and actual buffer bytes before parsing', async () => {
  const bytes = zip({ 'a': 'valid' }, { method: 0 });
  const input = { size: bytes.length, async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
  const archive = await openXlsxArchive(input);
  assert.equal(new TextDecoder().decode(await archive.read('a')), 'valid');
  for (const size of [NaN, -1, Infinity, 0.5, bytes.length - 1]) await assert.rejects(openXlsxArchive({ ...input, size }), /サイズ/);
  await assert.rejects(openXlsxArchive({ size: 1, async arrayBuffer() { return new ArrayBuffer(XLSX_IMPORT_LIMITS.inputBytes + 1); } }), /32 MiB/);
  await assert.rejects(openXlsxArchive({ size: bytes.length, async arrayBuffer() { return bytes; } }), /ArrayBuffer/);
});
