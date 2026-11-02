import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model-entry'; export {openOfficePackage} from './src/ooxml'; export {createZipArchive} from './src/core'; export {resolveDocumentExternalTarget} from './src/state/document-external-search';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, importDocumentDocx, exportDocumentDocx, getDocumentPage, getDocumentText, searchDocument,
  openOfficePackage, createZipArchive, documentSchema, resolveDocumentExternalTarget } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const text = value => `<w:r><w:t>${value}</w:t></w:r>`;
const p = (body = '', properties = '') => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${body}</w:p>`;
const section = (type, extra = '') => `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}${extra}</w:sectPr>`;
const marker = '<w:lastRenderedPageBreak/>';
const manual = '<w:r><w:br w:type="page"/></w:r>';
const flat = node => [node, ...(node.content ?? []).flatMap(flat)];
const count = (document, type) => flat(document.content).filter(node => node.type === type).length;
const pageCount = document => { let pages = 0; while (getDocumentPage(document, pages + 1)) pages++; return pages; };
const base = await exportDocumentDocx(createDocument());
async function file(body, final = section(), styles = '') {
  const archive = await openOfficePackage(base.blob), entries = [];
  for (const path of archive.paths) {
    let bytes = await archive.read(path);
    if (path === 'word/document.xml') bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${body}${final}</w:body>`));
    if (path === 'word/styles.xml' && styles) bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/<w:styles\b[^>]*>[\s\S]*<\/w:styles>/, `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${styles}</w:styles>`));
    entries.push({ path, content: new Blob([bytes]) });
  }
  return createZipArchive(entries);
}
const read = async (...args) => importDocumentDocx(await file(...args));

test('inherits pageBreakBefore through defaults and basedOn while explicit false overrides it', async () => {
  const styles = `<w:docDefaults><w:pPrDefault><w:pPr><w:pageBreakBefore/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:pageBreakBefore/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/></w:style>
    <w:style w:type="paragraph" w:styleId="Off"><w:basedOn w:val="Child"/><w:pPr><w:pageBreakBefore w:val="false"/></w:pPr></w:style>`;
  const { document } = await read(p(text('First')) + p(text('Default')) + p(text('Inherited'), '<w:pStyle w:val="Child"/>') +
    p(text('Direct off'), '<w:pStyle w:val="Child"/><w:pageBreakBefore w:val="0"/>') + p(text('Style off'), '<w:pStyle w:val="Off"/>'), section(), styles);
  assert.equal(pageCount(document), 3, 'no empty page before the first paragraph');
  assert.deepEqual(searchDocument(document, { keywords: ['First', 'Default', 'Inherited', 'Direct off', 'Style off'], operator: 'or' }).matches.map(hit => hit.pageNumber), [1, 2, 3, 3, 3]);
});

test('default paragraph style controls page starts and empty paragraphs are not lost', async () => {
  const styles = '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:pPr><w:pageBreakBefore/></w:pPr></w:style>';
  const { document } = await read(p() + p(text('Second')) + p(), section(), styles);
  assert.equal(count(document, 'paragraph'), 3);
  assert.equal(pageCount(document), 3);
  const cell = `<w:tbl><w:tr><w:tc>${p()}</w:tc></w:tr></w:tbl>`;
  const empty = await read(cell, section(), styles);
  assert.equal(count(empty.document, 'table_cell'), 1);
  assert.equal(count(empty.document, 'paragraph'), 1);
  const markersOnly = await read(p(`<w:r>${marker}</w:r>`) + p(text('B'), '<w:pageBreakBefore/>'));
  assert.equal(count(markersOnly.document, 'paragraph'), 2);
  assert.equal(pageCount(markersOnly.document), 2, 'removing a leading marker must not erase the empty paragraph before the forced page start');
});

test('a default paragraph style does not leak pageBreakBefore into unrelated explicit styles', async () => {
  const styles = '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:pPr><w:pageBreakBefore/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Plain"/>' +
    '<w:style w:type="paragraph" w:styleId="Derived"><w:basedOn w:val="Normal"/></w:style>';
  const { document } = await read(p(text('First')) + p(text('Plain'), '<w:pStyle w:val="Plain"/>') + p(text('Derived'), '<w:pStyle w:val="Derived"/>'), section(), styles);
  assert.deepEqual(searchDocument(document, { keywords: ['First', 'Plain', 'Derived'], operator: 'or' }).matches.map(hit => hit.pageNumber), [1, 1, 2]);
});

test('saved page markers preserve run text, marks and paragraphs and roundtrip without hard breaks', async () => {
  const body = p(`<w:hyperlink w:anchor="target"><w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t>${marker}<w:t>Beta</w:t></w:r></w:hyperlink>`);
  const imported = await read(body), { document } = imported;
  assert.equal(count(document, 'paragraph'), 1); assert.equal(count(document, 'page_break'), 0);
  assert.equal(count(document, 'rendered_page_break'), 1); assert.equal(pageCount(document), 2);
  assert.equal(getDocumentText(document), 'AlphaBeta');
  for (const node of flat(document.content).filter(node => node.type === 'text')) {
    assert.ok(node.marks.some(mark => mark.type === 'strong'));
    assert.ok(node.marks.some(mark => mark.type === 'link' && mark.attrs.href === '#target'));
  }
  assert.ok(imported.warnings.some(warning => warning.includes('再計算')));
  const exported = await exportDocumentDocx(document), archive = await openOfficePackage(exported.blob);
  const xml = new TextDecoder().decode(await archive.read('word/document.xml'));
  assert.equal((xml.match(/<w:p>/g) ?? []).length, 1);
  assert.equal((xml.match(/<w:lastRenderedPageBreak\/>/g) ?? []).length, 1);
  assert.doesNotMatch(xml, /<w:br w:type="page"/);
  const again = await importDocumentDocx(exported.blob);
  assert.equal(getDocumentText(again.document), 'AlphaBeta'); assert.equal(pageCount(again.document), 2);
});

test('duplicate saved, paragraph and manual boundaries count once; consecutive manual breaks survive', async () => {
  const { document } = await read(p(text('A') + manual) + p(`<w:r>${marker}<w:t>B</w:t></w:r>`, '<w:pageBreakBefore/>') +
    p(manual + manual + `<w:r>${marker}<w:t>C</w:t></w:r>`));
  assert.equal(count(document, 'rendered_page_break'), 0);
  assert.equal(count(document, 'page_break'), 3); assert.equal(pageCount(document), 4);
  assert.deepEqual(searchDocument(document, { keywords: ['A', 'B', 'C'], operator: 'or' }).matches.map(hit => hit.pageNumber), [1, 2, 4]);
  const preceding = await read(p(`<w:r><w:t>A</w:t>${marker}</w:r>`) + p(text('B'), '<w:pageBreakBefore/>'));
  assert.equal(count(preceding.document, 'rendered_page_break'), 0); assert.equal(pageCount(preceding.document), 2);
  const inside = await read(p(`<w:r><w:t>A</w:t>${marker}<w:br w:type="page"/><w:t>B</w:t></w:r>`));
  assert.equal(count(inside.document, 'rendered_page_break'), 0); assert.equal(pageCount(inside.document), 2);
});

test('section boundaries use the next section type, not the section ending at the paragraph', async () => {
  const { document, warnings } = await read(p(text('A'), section('continuous')) + p(text('B'), section('nextPage')) + p(text('C')), section('continuous'));
  assert.equal(pageCount(document), 2);
  assert.deepEqual(searchDocument(document, { keywords: ['A', 'B', 'C'], operator: 'or' }).matches.map(hit => hit.pageNumber), [1, 2, 2]);
  assert.ok(warnings.some(warning => warning.includes('最後のセクション')));
  const implicit = await read(p(text('A'), section('oddPage')) + p(text('B')));
  assert.equal(pageCount(implicit.document), 2, 'missing next type defaults to nextPage, without an initial or trailing break');
});

test('odd/even and next-column sections disclose approximation; section markers are deduplicated', async () => {
  for (const type of ['oddPage', 'evenPage']) {
    const imported = await read(p(text('A'), section()) + p(`<w:r>${marker}<w:t>B</w:t></w:r>`, '<w:pageBreakBefore/>'), section(type));
    assert.equal(pageCount(imported.document), 2); assert.equal(count(imported.document, 'rendered_page_break'), 0);
    assert.ok(imported.warnings.some(warning => warning.includes('空白ページ')));
  }
  const column = await read(p(text('A'), section()) + p(text('B')), section('nextColumn'));
  assert.equal(pageCount(column.document), 1); assert.ok(column.warnings.some(warning => warning.includes('次の段')));
});

test('only current accepted body sections determine boundaries and final paper settings', async () => {
  const old = '<w:sectPrChange>' + section('nextPage', '<w:pgSz w:w="20000" w:h="20000"/>') + '</w:sectPrChange>';
  const body = `<w:del>${p(text('Deleted'), section('nextPage'))}</w:del><w:sdt><w:sdtContent>${p(text('A'), section('continuous'))}</w:sdtContent></w:sdt>` +
    `<w:customXml>${p(text('B'))}</w:customXml><w:ins>${p(text('C'), section('nextPage'))}</w:ins>` + p(text('D'));
  const { document } = await read(body, section('continuous', '<w:pgSz w:w="11906" w:h="16838"/>' + old));
  assert.equal(pageCount(document), 2);
  assert.ok(Math.abs(document.page.width - 210) < .1); assert.ok(Math.abs(document.page.height - 297) < .1);
  assert.equal(getDocumentText(document).includes('Deleted'), false);
  assert.deepEqual(searchDocument(document, { keywords: ['A', 'B', 'C', 'D'], operator: 'or' }).matches.map(hit => hit.pageNumber), [1, 2, 2, 2]);
  const cell = `<w:tbl><w:tr><w:tc>${p(text('Cell'), section())}</w:tc></w:tr></w:tbl>`;
  assert.equal(pageCount((await read(cell + p(text('End')))).document), 1, 'invalid cell section properties never create body section boundaries');
});

test('saved markers in a table keep cell text and do not create extra paragraphs', async () => {
  const { document } = await read(`<w:tbl><w:tr><w:tc>${p(`<w:r><w:t>First</w:t>${marker}<w:t>Second</w:t></w:r>`)}</w:tc></w:tr></w:tbl>`);
  assert.equal(count(document, 'paragraph'), 1); assert.equal(count(document, 'rendered_page_break'), 1);
  assert.equal(getDocumentText(document), 'FirstSecond'); assert.equal(pageCount(document), 2);
  assert.equal(pageCount((await importDocumentDocx((await exportDocumentDocx(document)).blob)).document), 2);
});

test('external search text offsets exclude saved markers while cursor positions and pages include them', () => {
  const document = createDocument({ content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'para' }, content: [
    { type: 'text', text: '😀A' }, { type: 'rendered_page_break' }, { type: 'text', text: 'B' }, { type: 'hard_break' }, { type: 'text', text: 'C' },
  ] }] } });
  const pm = documentSchema.nodeFromJSON(document.content), expectedText = '😀AB\nC';
  const first = resolveDocumentExternalTarget(document, { blockId: 'para', textFrom: 0, textTo: 3, expectedText });
  assert.equal(first.pageNumber, 1); assert.equal(first.match.to, 4);
  const second = resolveDocumentExternalTarget(document, { blockId: 'para', textFrom: 3, textTo: 6, expectedText });
  assert.equal(second.pageNumber, 2); assert.equal(second.match.from, 5);
  assert.equal(pm.textBetween(second.match.from, second.match.to, '', '\n'), 'B\nC');
  const cursor = resolveDocumentExternalTarget(document, { blockId: 'para', textFrom: 3, textTo: 3, expectedText });
  assert.equal(cursor.match.from, cursor.match.to); assert.equal(cursor.pageNumber, 2);
});
