import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const output = await build({ stdin: { contents: 'export * from "./src/io"; export * from "./src/model/document";export {openOfficePackage,officeXml} from "./src/ooxml";export {createZipArchive} from "./src/core";export {OFFICE_SHAPE_PRESETS} from "./src/model/core-office-shapes";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, importDocumentDocx, exportDocumentDocx, DOCX_MIME_TYPE, openOfficePackage, officeXml, createZipArchive, OFFICE_SHAPE_PRESETS } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
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

test('all Office preset shapes round-trip as editable DrawingML with text, paint, extent and transforms', async () => {
  const source = createDocument({ content: { type: 'doc', content: OFFICE_SHAPE_PRESETS.map((entry, index) => ({ type: 'shape', attrs: {
    preset: entry.preset, text: `${entry.label}\nApproved & <ready>`, width: 240, height: 140, fill: index % 2 ? null : '#32c6aa', stroke: index % 3 ? '#193e60' : null, strokeWidth: 2.5, rotation: index % 2 ? -30 : 25, flipH: index % 3 === 0, flipV: index % 4 === 0, color: '#112233', fontSize: 18,
  } })) } });
  const { blob, warnings } = await exportDocumentDocx(source); assert.deepEqual(warnings, []);
  const xml = new TextDecoder().decode((await parts(blob)).get('word/document.xml'));
  assert.ok(xml.includes('<wps:wsp>')); assert.ok(xml.includes('prst="bentArrow"')); assert.ok(!xml.includes('<pic:pic>'));
  const imported = await importDocumentDocx(blob); assert.deepEqual(imported.warnings, []);
  assert.equal(imported.document.content.content.length, source.content.content.length);
  for (const [index, node] of imported.document.content.content.entries()) {
    assert.equal(node.type, 'shape'); const actual = { ...node.attrs }, expected = { ...source.content.content[index].attrs }; delete actual.id; delete expected.id;
    close(actual.strokeWidth, expected.strokeWidth); delete actual.strokeWidth; delete expected.strokeWidth;
    assert.deepEqual(actual, expected);
  }
});

test('external Word anchor/AlternateContent shape imports once, retains editing data and its place in front of the text', async () => {
  const fixture = await readFile(new URL('fixtures/word-bent-arrow.xml', import.meta.url), 'utf8');
  const initial = (await exportDocumentDocx(createDocument())).blob;
  const source = await changed(initial, entries => replace(entries, 'word/document.xml', xml => xml.replace('<w:body>', `<w:body>${fixture}`)));
  const imported = await importDocumentDocx(source), shapes = imported.document.content.content.filter(node => node.type === 'shape');
  assert.equal(shapes.length, 1); const attrs = shapes[0].attrs;
  assert.equal(attrs.preset, 'bentArrow'); assert.equal(attrs.text, '審査から承認'); assert.equal(attrs.width, 240); assert.equal(attrs.height, 120);
  assert.equal(attrs.rotation, 30); assert.equal(attrs.flipH, true); assert.equal(attrs.fill, '#19a18c'); assert.equal(attrs.stroke, '#173d50'); assert.equal(attrs.strokeWidth, 2); assert.equal(attrs.fontSize, 18); assert.equal(attrs.color, '#ffffff');
  // In front of the text the shape lies over it without moving it, which a placed block does as well.
  assert.equal(attrs.position.horizontal.from, 'margin'); close(attrs.position.horizontal.offset, 95250 / 36000);
  assert.equal(attrs.position.vertical.from, 'paragraph'); close(attrs.position.vertical.offset, 190500 / 36000);
  assert.ok(!imported.warnings.some(item => item.includes('浮動配置の図形'))); assert.ok(!JSON.stringify(imported.document).includes('DO NOT DUPLICATE'));
  // With text wrapped around it, it stays in the text and says so.
  const wrapped = await importDocumentDocx(await changed(initial, entries => replace(entries, 'word/document.xml', xml => xml.replace('<w:body>', `<w:body>${fixture.replaceAll('<wp:wrapNone/>', '<wp:wrapSquare wrapText="bothSides"/>')}`))));
  assert.ok(wrapped.warnings.some(item => item.includes('浮動配置の図形'))); assert.equal('position' in wrapped.document.content.content.find(node => node.type === 'shape').attrs, false);
  const reimported = await importDocumentDocx((await exportDocumentDocx(imported.document)).blob);
  const a = { ...reimported.document.content.content.find(node => node.type === 'shape').attrs }, b = { ...attrs }; delete a.id; delete b.id; assert.deepEqual(a, b);
  assert.deepEqual(reimported.warnings, []);
});

test('shape adjustments and unsupported geometry explicitly warn instead of silently reporting full fidelity', async () => {
  const source = (await exportDocumentDocx(createDocument({ content: { type: 'doc', content: [{ type: 'shape', attrs: { preset: 'bentArrow', text: 'Keeps text' } }] } }))).blob;
  const adjusted = await changed(source, entries => replace(entries, 'word/document.xml', xml => xml.replace('<a:avLst/>', '<a:avLst><a:gd name="adj1" fmla="val 50000"/></a:avLst>').replace('<a:prstDash val="solid"/>', '<a:prstDash val="dash"/>')));
  const imported = await importDocumentDocx(adjusted); assert.equal(imported.document.content.content[0].type, 'shape');
  assert.ok(imported.warnings.some(item => item.includes('調整ハンドル'))); assert.ok(imported.warnings.some(item => item.includes('破線')));
  const custom = await changed(source, entries => replace(entries, 'word/document.xml', xml => xml.replace('<a:prstGeom prst="bentArrow"><a:avLst/></a:prstGeom>', '<a:custGeom><a:avLst/><a:pathLst/></a:custGeom>')));
  const unsupported = await importDocumentDocx(custom); assert.ok(!unsupported.document.content.content.some(node => node.type === 'shape')); assert.ok(unsupported.warnings.some(item => item.includes('自由図形')));
});

test('shape textbox tables and content controls retain their text when flattened', async () => {
  const initial = (await exportDocumentDocx(createDocument({ content: { type: 'doc', content: [{ type: 'shape', attrs: { preset: 'rect', text: 'Placeholder' } }] } }))).blob;
  const source = await changed(initial, entries => replace(entries, 'word/document.xml', xml => xml.replace(/<w:txbxContent>.*?<\/w:txbxContent>/, '<w:txbxContent><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Customer essential details</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>¥120,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sdt><w:sdtContent><w:p><w:r><w:t>Approval owner</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p/></w:txbxContent>')));
  const result = await importDocumentDocx(source), shape = result.document.content.content.find(node => node.type === 'shape');
  assert.equal(shape.attrs.text, 'Customer essential details\n¥120,000\nApproval owner\n');
  assert.ok(result.warnings.some(message => message.includes('通常の文字に変換')));
});

const FLOATING_PICTURE = '浮動配置の画像は本文中の画像として読み込みました';
const documentXml = async blob => new TextDecoder().decode((await parts(blob)).get('word/document.xml'));
// A wide left margin with the text on the right, as manuals keep their screenshots beside the text.
const sideBySide = content => createDocument({ page: { width: 420, height: 297, margins: { top: 20, right: 15, bottom: 20, left: 260 } }, content: { type: 'doc', content } });

test('blocks placed on the page are anchored in the paragraph that follows and read back in place', async () => {
  const screen = { horizontal: { from: 'page', offset: 12 }, vertical: { from: 'paragraph', offset: 5 } }, note = { horizontal: { from: 'margin', offset: -230 }, vertical: { from: 'margin', offset: 150 } };
  const last = { horizontal: { from: 'page', offset: 20 }, vertical: { from: 'page', offset: 250 } };
  const source = sideBySide([
    { type: 'image', attrs: { src: png, width: 400, height: 200, alt: 'Screen', position: screen } },
    { type: 'shape', attrs: { preset: 'rect', text: 'Note', width: 120, height: 60, position: note } },
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] }, p('Body'),
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'image', attrs: { src: png, width: 40, height: 20, position: screen } }] }] }] },
    { type: 'image', attrs: { src: png, width: 100, height: 50, position: last } },
  ]);
  const exported = await exportDocumentDocx(source), xml = await documentXml(exported.blob);
  assert.deepEqual(exported.warnings, []); assert.ok(officeXml.parseXml(new TextEncoder().encode(xml)));
  // Both drawings stand in the heading that follows them, so Word shows no empty line for them.
  assert.match(xml, /<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"\/><w:jc w:val="left"\/><\/w:pPr><w:r><w:drawing><wp:anchor [^>]*behindDoc="0"[^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="page"><wp:posOffset>432000<\/wp:posOffset><\/wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>180000<\/wp:posOffset><\/wp:positionV><wp:extent cx="3810000" cy="1905000"\/><wp:wrapNone\/><wp:docPr /);
  assert.match(xml, /<\/wp:anchor><\/w:drawing><\/w:r><w:r><w:drawing><wp:anchor [^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="margin"><wp:posOffset>-8280000<\/wp:posOffset><\/wp:positionH><wp:positionV relativeFrom="margin"><wp:posOffset>5400000<\/wp:posOffset>.*?<\/wp:anchor><\/w:drawing><\/w:r><w:r><w:t xml:space="preserve">Title<\/w:t>/);
  assert.equal(xml.match(/<wp:anchor /g).length, 3); assert.equal(xml.match(/<wp:inline /g).length, 1, 'in a table the block is written in the text, where it is shown');
  assert.match(xml, /<w:p><w:r><w:drawing><wp:anchor [^>]*>.*?<\/wp:anchor><\/w:drawing><\/w:r><\/w:p><w:sectPr>/, 'without a paragraph after it, the drawing gets one of its own');

  const result = await importDocumentDocx(exported.blob), blocks = result.document.content.content;
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(blocks.map(block => block.type), ['image', 'shape', 'heading', 'paragraph', 'table', 'image', 'paragraph']);
  assert.deepEqual([blocks[0].attrs.position, blocks[1].attrs.position, blocks[5].attrs.position], [screen, note, last]);
  assert.deepEqual([blocks[0].attrs.width, blocks[0].attrs.alt, blocks[1].attrs.text, text(blocks[2])], [400, 'Screen', 'Note', 'Title']);
  assert.equal('position' in blocks[4].content[0].content[0].content[0].attrs, false);
  // A second round changes nothing more.
  const again = await importDocumentDocx((await exportDocumentDocx(result.document)).blob);
  assert.deepEqual(again.document.content.content.map(block => [block.type, block.attrs?.position]), blocks.map(block => [block.type, block.attrs?.position]));
});

test('an anchored drawing keeps its place only where the page can show it there', async () => {
  const position = { horizontal: { from: 'page', offset: 12 }, vertical: { from: 'paragraph', offset: 5 } };
  const base = await exportDocumentDocx(sideBySide([{ type: 'image', attrs: { src: png, width: 400, height: 200, position } }, p('Text')]));
  const H = '<wp:positionH relativeFrom="page"><wp:posOffset>432000</wp:posOffset></wp:positionH>', V = '<wp:positionV relativeFrom="paragraph"><wp:posOffset>180000</wp:posOffset></wp:positionV>';
  const read = async (...changes) => {
    const result = await importDocumentDocx(await changed(base.blob, entries => replace(entries, 'word/document.xml', xml => changes.reduce((value, [from, to]) => { assert.ok(value.includes(from), from); return value.replace(from, to); }, xml))));
    return { warnings: result.warnings, kinds: result.document.content.content.map(block => block.type), position: result.document.content.content.find(block => block.type === 'image').attrs.position };
  };
  const mm = (actual, expected) => { for (const axis of ['horizontal', 'vertical']) { assert.equal(actual[axis].from, expected[axis].from); close(actual[axis].offset, expected[axis].offset); } };
  const square = ['<wp:wrapNone/>', '<wp:wrapSquare wrapText="bothSides"/>'];

  // Clear of the text area, the wrapping does not matter: nothing is beside the drawing to wrap.
  assert.deepEqual(await read(square), { warnings: [], kinds: ['image', 'paragraph'], position });
  assert.deepEqual((await read(['<wp:wrapNone/>', '<wp:wrapTopAndBottom/>'], ['behindDoc="0"', 'behindDoc="1"'])).position, position);
  // In the text area with wrapped text, or behind the text, it stays a block of the text and says so.
  const inText = ['<wp:posOffset>432000</wp:posOffset>', '<wp:posOffset>9000000</wp:posOffset>'];
  assert.deepEqual(await read(square, inText), { warnings: [FLOATING_PICTURE], kinds: ['image', 'paragraph'], position: undefined });
  assert.deepEqual((await read(inText, ['behindDoc="0"', 'behindDoc="1"'])).warnings, [FLOATING_PICTURE]);
  // In front of the text it lies over it, as Word shows it.
  mm((await read(inText)).position, { horizontal: { from: 'page', offset: 250 }, vertical: position.vertical });
  // The right margin is clear of the text as well.
  mm((await read(square, [H, '<wp:positionH relativeFrom="rightMargin"><wp:posOffset>36000</wp:posOffset></wp:positionH>'], ['cx="3810000" cy="1905000"/><wp:wrap', 'cx="360000" cy="180000"/><wp:wrap'])).position,
    { horizontal: { from: 'page', offset: 406 }, vertical: position.vertical });

  // Origins and alignments are resolved against the page; the column is the text area.
  mm((await read([H, '<wp:positionH relativeFrom="column"><wp:posOffset>-8928000</wp:posOffset></wp:positionH>'], [V, '<wp:positionV relativeFrom="line"><wp:posOffset>-36000</wp:posOffset></wp:positionV>'])).position,
    { horizontal: { from: 'margin', offset: -248 }, vertical: { from: 'paragraph', offset: -1 } });
  mm((await read([H, '<wp:positionH relativeFrom="leftMargin"><wp:align>center</wp:align></wp:positionH>'], [V, '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>'])).position,
    { horizontal: { from: 'page', offset: (260 - 400 * 25.4 / 96) / 2 }, vertical: { from: 'margin', offset: 257 - 200 * 25.4 / 96 } });
  mm((await read([H, '<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>'], [V, '<wp:positionV relativeFrom="topMargin"><wp:posOffset>72000</wp:posOffset></wp:positionV>'])).position,
    { horizontal: { from: 'page', offset: 0 }, vertical: { from: 'page', offset: 2 } });
  // In the margin above or below the text area nothing is beside the drawing either.
  mm((await read(square, inText, [V, '<wp:positionV relativeFrom="page"><wp:posOffset>36000</wp:posOffset></wp:positionV>'], ['cx="3810000" cy="1905000"/><wp:wrap', 'cx="3810000" cy="360000"/><wp:wrap'])).position,
    { horizontal: { from: 'page', offset: 250 }, vertical: { from: 'page', offset: 1 } });
  assert.deepEqual((await read(square, inText, [V, '<wp:positionV relativeFrom="page"><wp:posOffset>720000</wp:posOffset></wp:positionV>'])).warnings, [FLOATING_PICTURE]);
  mm((await read(['simplePos="0"', 'simplePos="1"'], ['<wp:simplePos x="0" y="0"/>', '<wp:simplePos x="720000" y="1080000"/>'])).position, { horizontal: { from: 'page', offset: 20 }, vertical: { from: 'page', offset: 30 } });

  // What the page has no origin for stays in the text.
  for (const change of [[H, '<wp:positionH relativeFrom="character"><wp:posOffset>0</wp:posOffset></wp:positionH>'], [V, '<wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV>'],
    [H, '<wp:positionH relativeFrom="page"><wp:posOffset>x</wp:posOffset></wp:positionH>'], [H, '<wp:positionH relativeFrom="page"><wp:posOffset>-99999999999</wp:posOffset></wp:positionH>'], [V, '']])
    assert.deepEqual(await read(change), { warnings: [FLOATING_PICTURE], kinds: ['image', 'paragraph'], position: undefined });
});

test('a placed drawing stands before its paragraph without dividing it, and its paragraph remains', async () => {
  const position = { horizontal: { from: 'page', offset: 12 }, vertical: { from: 'paragraph', offset: 5 } };
  const base = await exportDocumentDocx(sideBySide([p('Before after'), { type: 'image', attrs: { src: png, width: 400, height: 200, position } }]));
  const run = /<w:p>(<w:r><w:drawing><wp:anchor .*?<\/wp:anchor><\/w:drawing><\/w:r>)<\/w:p>/;
  // The anchor moves between two runs of the first paragraph; its own paragraph stays behind, empty.
  const middle = await importDocumentDocx(await changed(base.blob, entries => replace(entries, 'word/document.xml', xml => {
    const anchor = run.exec(xml)[1];
    return xml.replace(run, '<w:p/>').replace('<w:t xml:space="preserve">Before after</w:t></w:r>', `<w:t xml:space="preserve">Before </w:t></w:r>${anchor}<w:r><w:t xml:space="preserve">after</w:t></w:r>`);
  })));
  assert.deepEqual(middle.document.content.content.map(block => block.type === 'paragraph' ? text(block) : block.type), ['image', 'Before after', '']);
  assert.deepEqual(middle.document.content.content[0].attrs.position, position); assert.deepEqual(middle.warnings, []);
  // In a table the drawing stays in the text of its cell, where the page shows it.
  const cell = await importDocumentDocx(await changed(base.blob, entries => replace(entries, 'word/document.xml', xml => xml.replace(run, (_all, anchor) => `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p>${anchor}</w:p></w:tc></w:tr></w:tbl>`))));
  const inner = cell.document.content.content.find(block => block.type === 'table').content[0].content[0].content;
  assert.deepEqual(inner.map(block => block.type), ['image']); assert.equal('position' in inner[0].attrs, false);
  assert.deepEqual(cell.warnings, [FLOATING_PICTURE]);
});
