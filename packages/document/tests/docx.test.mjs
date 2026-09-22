import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const output = await build({ stdin: { contents: 'export * from "./src/io"; export * from "./src/model/document";export {openOfficePackage,officeXml} from "./src/ooxml";export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, importDocumentDocx, exportDocumentDocx, DOCX_MIME_TYPE, openOfficePackage, officeXml, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const p = (text, attrs, marks) => ({ type: 'paragraph', attrs, content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] });
const cell = (text, attrs = {}, header = false) => ({ type: header ? 'table_header' : 'table_cell', attrs, content: [p(text)] });
const text = node => (node.text ?? '') + (node.content ?? []).map(text).join('');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .02, `${actual} ≈ ${expected}`);
async function parts(input) { const archive = await openOfficePackage(input), result = new Map(); for (const path of archive.paths) result.set(path, await archive.read(path)); return result; }
async function changed(input, mutate) { const entries = await parts(input); mutate(entries); return createZipArchive([...entries].map(([path, content]) => ({ path, content: new Blob([content]) }))); }
const replace = (entries, path, update) => entries.set(path, new TextEncoder().encode(update(new TextDecoder().decode(entries.get(path)))));
function richDocument() {
  return createDocument({ title: '日本語 & <Word>', page: { width: 297, height: 210, margins: { top: 12, right: 18, bottom: 15, left: 22 } }, content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2, align: 'center' }, content: [{ type: 'text', text: 'LikeDocument の書式' }] },
    p('Japanese <>& "quote" \t preserved\nnext', { align: 'justify' }, [{ type: 'strong' }, { type: 'em' }, { type: 'underline' }, { type: 'strike' }, { type: 'text_style', attrs: { fontFamily: 'Arial', fontSize: 18, color: '#234567', backgroundColor: '#f0eecc' } }]),
    p('Link', undefined, [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2', title: 'Example <site>' } }]),
    { type: 'ordered_list', attrs: { order: 3 }, content: [{ type: 'list_item', content: [p('First'), { type: 'bullet_list', content: [{ type: 'list_item', content: [p('Nested')] }] }] }, { type: 'list_item', content: [p('Second')] }] },
    { type: 'table', content: [{ type: 'table_row', content: [cell('Name', { backgroundColor: '#ddeeff', colwidth: [140] }, true), cell('Value', { backgroundColor: '#ddeeff', colwidth: [90] }, true)] }, { type: 'table_row', content: [cell('A'), cell('123')] }] },
    { type: 'image', attrs: { src: png, alt: 'two to one & preview', width: 240, height: 120 } },
    { type: 'page_break' }, p('Last page'),
  ] } });
}

test('writes standard DOCX parts and preserves text, styles, links, lists, tables, picture aspect, page setup', async () => {
  const source = richDocument(), before = JSON.stringify(source), exported = await exportDocumentDocx(source);
  assert.equal(exported.blob.type, DOCX_MIME_TYPE); assert.deepEqual(exported.warnings, []); assert.equal(JSON.stringify(source), before);
  const entries = await parts(exported.blob);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'word/media/image1.png']) assert.ok(entries.has(name), name);
  for (const [path, bytes] of entries) if (path.endsWith('.xml') || path.endsWith('.rels')) assert.ok(officeXml.parseXml(bytes));
  assert.ok(![...entries.keys()].some(path => /\.json$/.test(path)), 'uses Word XML, not a private JSON payload');
  const result = await importDocumentDocx(exported.blob), blocks = result.document.content.content;
  assert.deepEqual(result.warnings, []); assert.equal(result.document.title, source.title);
  close(result.document.page.width, 297); close(result.document.page.height, 210); close(result.document.page.margins.left, 22);
  assert.equal(blocks[0].type, 'heading'); assert.equal(blocks[0].attrs.level, 2); assert.equal(blocks[0].attrs.align, 'center');
  assert.equal(blocks[1].attrs.align, 'justify'); assert.equal(text(blocks[1]), text(source.content.content[1]).replace('\n', ''));
  assert.ok(blocks[1].content.some(node => node.type === 'hard_break'));
  const marks = blocks[1].content[0].marks; for (const type of ['strong', 'em', 'underline', 'strike']) assert.ok(marks.some(mark => mark.type === type));
  assert.deepEqual({ ...marks.find(mark => mark.type === 'text_style').attrs }, { fontFamily: 'Arial', fontSize: 18, color: '#234567', backgroundColor: '#f0eecc' });
  assert.deepEqual({ ...blocks[2].content[0].marks.find(mark => mark.type === 'link').attrs }, { href: 'https://example.com/?a=1&b=2', title: 'Example <site>' });
  assert.equal(blocks[3].type, 'ordered_list'); assert.equal(blocks[3].attrs.order, 3); assert.equal(blocks[3].content.length, 2); assert.equal(blocks[3].content[0].content[1].type, 'bullet_list');
  const table = blocks[4]; assert.equal(table.type, 'table'); assert.equal(table.content[0].content[0].type, 'table_header'); assert.equal(table.content[0].content[0].attrs.backgroundColor, '#ddeeff'); assert.deepEqual(table.content[0].content[0].attrs.colwidth, [140]); assert.equal(text(table.content[1]), 'A123');
  assert.equal(blocks[5].type, 'image'); assert.equal(blocks[5].attrs.src, png); assert.equal(blocks[5].attrs.alt, 'two to one & preview'); assert.equal(blocks[5].attrs.width / blocks[5].attrs.height, 2);
  assert.equal(blocks[6].type, 'page_break'); assert.equal(text(blocks[7]), 'Last page');
});

test('merged cells preserve row and column spans, including rows fully occupied by prior cells', async () => {
  const source = createDocument({ content: { type: 'doc', content: [{ type: 'table', content: [
    { type: 'table_row', content: [cell('Merged', { colspan: 2, rowspan: 2, colwidth: [100, 100] })] },
    { type: 'table_row', content: [] },
    { type: 'table_row', content: [cell('Left'), cell('Right')] },
  ] }] } });
  const { document } = await importDocumentDocx((await exportDocumentDocx(source)).blob);
  const rows = document.content.content[0].content;
  assert.equal(rows[0].content[0].attrs.colspan, 2); assert.equal(rows[0].content[0].attrs.rowspan, 2); assert.equal((rows[1].content ?? []).length, 0); assert.equal(text(rows[2]), 'LeftRight');
});

test('exports are deterministic for unchanged model and duplicate images share one media part', async () => {
  const source = structuredClone(richDocument()); source.content.content.push({ ...source.content.content[5], attrs: { ...source.content.content[5].attrs, id: 'second-image' } });
  const one = (await exportDocumentDocx(source)).blob, two = (await exportDocumentDocx(source)).blob;
  assert.deepEqual(new Uint8Array(await one.arrayBuffer()), new Uint8Array(await two.arrayBuffer()));
  assert.equal([...await parts(one)].filter(([name]) => name.startsWith('word/media/')).length, 1);
});

test('external image relations never fetch, unsafe links become ordinary text, conversion warnings are deduplicated', async t => {
  let fetched = 0; t.mock.method(globalThis, 'fetch', async () => { fetched++; throw new Error('unexpected request'); });
  const output = (await exportDocumentDocx(richDocument())).blob;
  const file = await changed(output, entries => replace(entries, 'word/_rels/document.xml.rels', source => source.replace('Target="media/image1.png"', 'Target="https://example.invalid/image.png" TargetMode="External"').replace('Target="https://example.com/?a=1&amp;b=2"', 'Target="javascript:alert(1)"')));
  const result = await importDocumentDocx(file);
  assert.equal(fetched, 0); assert.ok(result.warnings.some(item => item.includes('外部画像'))); assert.ok(result.warnings.some(item => item.includes('安全なURL')));
  assert.equal(result.document.content.content.some(node => node.type === 'image'), false);
  assert.equal(result.document.content.content[2].content[0].marks.some(mark => mark.type === 'link'), false);
  assert.equal(new Set(result.warnings).size, result.warnings.length);
});

test('unsupported headers, columns, fields and notes are reported without evaluating document instructions', async () => {
  const output = (await exportDocumentDocx(createDocument({ content: { type: 'doc', content: [p('Visible')] } }))).blob;
  const file = await changed(output, entries => replace(entries, 'word/document.xml', source => source.replace('<w:sectPr>', '<w:sectPr><w:headerReference r:id="missing"/><w:cols w:num="2"/>').replace('<w:t xml:space="preserve">Visible</w:t>', '<w:instrText>INCLUDETEXT "https://example.invalid/secret"</w:instrText><w:t>Visible</w:t><w:footnoteReference w:id="1"/>')));
  const result = await importDocumentDocx(file); assert.equal(text(result.document.content), 'Visible');
  for (const phrase of ['ヘッダー', '段組み', 'フィールド', '脚注']) assert.ok(result.warnings.some(item => item.includes(phrase)), phrase);
});

test('direct false run properties override inherited formatting and style numbering becomes lists', async () => {
  const exported = (await exportDocumentDocx(createDocument({ content: { type: 'doc', content: [p('Plain')] } }))).blob;
  const file = await changed(exported, entries => {
    replace(entries, 'word/styles.xml', source => source.replace('</w:styles>', '<w:style w:type="paragraph" w:styleId="Test"><w:rPr><w:b/><w:i/></w:rPr></w:style></w:styles>'));
    replace(entries, 'word/document.xml', source => source.replace('<w:pPr>', '<w:pPr><w:pStyle w:val="Test"/>').replace('<w:r>', '<w:r><w:rPr><w:b w:val="0"/></w:rPr>'));
  });
  const result = await importDocumentDocx(file), marks = result.document.content.content[0].content[0].marks;
  assert.ok(!marks.some(mark => mark.type === 'strong')); assert.ok(marks.some(mark => mark.type === 'em'));
  const independent = await importDocumentDocx(new Uint8Array(await readFile(new URL('fixtures/word-basic.docx', import.meta.url))));
  const list = independent.document.content.content.find(node => node.type === 'bullet_list'); assert.equal(list.content.length, 2); assert.equal(text(list), 'First itemSecond item');
});

test('export cancellation during asynchronous ZIP preparation rejects without returning a partial file', async t => {
  const controller = new AbortController(), original = Blob.prototype.arrayBuffer;
  let calls = 0;
  t.mock.method(Blob.prototype, 'arrayBuffer', async function () { if (++calls === 1) controller.abort(); return original.call(this); });
  await assert.rejects(exportDocumentDocx(richDocument(), { signal: controller.signal }), { name: 'AbortError' });
});

test('mixed header rows and multi-paragraph list conversion limitations are explicit', async () => {
  const document = createDocument({ content: { type: 'doc', content: [
    { type: 'table', content: [{ type: 'table_row', content: [cell('H', {}, true), cell('B')] }] },
    { type: 'bullet_list', content: [{ type: 'list_item', content: [p('First'), p('Continuation')] }] },
  ] } });
  const { warnings } = await exportDocumentDocx(document); assert.ok(warnings.some(item => item.includes('一部だけ見出し'))); assert.ok(warnings.some(item => item.includes('複数段落')));
});

test('rejects macro packages, incorrect extension, malformed XML, traversal relationships and pre-aborted reads', async () => {
  const blob = (await exportDocumentDocx(createDocument())).blob;
  await assert.rejects(importDocumentDocx(Object.assign(blob, { name: 'document.doc' })), /docx/);
  const clean = new Blob([await blob.arrayBuffer()]);
  const macro = await changed(clean, entries => replace(entries, '[Content_Types].xml', source => source.replace('wordprocessingml.document.main+xml', 'ms-word.document.macroEnabled.main+xml')));
  await assert.rejects(importDocumentDocx(macro), /マクロ/);
  const xml = await changed(clean, entries => replace(entries, 'word/document.xml', () => '<!DOCTYPE doc [<!ENTITY a SYSTEM "file:///etc/passwd">]><doc>&a;</doc>'));
  await assert.rejects(importDocumentDocx(xml), /XML/);
  const traversal = await changed(clean, entries => replace(entries, '_rels/.rels', source => source.replace('Target="word/document.xml"', 'Target="../../document.xml"')));
  await assert.rejects(importDocumentDocx(traversal), /パッケージ外/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(importDocumentDocx(clean, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(exportDocumentDocx(createDocument(), { signal: controller.signal }), { name: 'AbortError' });
});

test('imports an independent python-docx fixture with headings, styles, cells, image and page layout', async () => {
  const bytes = new Uint8Array(await readFile(new URL('fixtures/word-basic.docx', import.meta.url)));
  const { document, warnings } = await importDocumentDocx(bytes);
  assert.equal(document.title, 'Independent Word fixture'); close(document.page.width, 210); close(document.page.margins.left, 18);
  const blocks = document.content.content; assert.equal(blocks[0].type, 'heading'); assert.equal(text(blocks[0]), 'Project notes');
  const run = blocks.find(node => text(node).includes('Styled Japanese')).content.find(node => node.text.includes('Styled Japanese'));
  assert.ok(run.marks.some(mark => mark.type === 'strong')); assert.equal(run.marks.find(mark => mark.type === 'text_style').attrs.color, '#123456');
  const table = blocks.find(node => node.type === 'table'); assert.equal(table.content.length, 3); assert.equal(text(table.content[0]), 'NameValue');
  const image = blocks.find(node => node.type === 'image'); assert.equal(image.attrs.width / image.attrs.height, 2); assert.equal(image.attrs.alt, 'Independent image');
  assert.ok(Array.isArray(warnings));
});
