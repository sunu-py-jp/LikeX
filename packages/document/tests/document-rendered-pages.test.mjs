import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export * from './src/model-entry';
  export { documentThumbnailContent } from './src/ui/document-thumbnail-content';
  export { assertDocumentFeatures, resolveDocumentFeatures } from './src/state/document-features';
  export { openOfficePackage, officeXml } from './src/ooxml';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, normalizeDocument, serializeDocument, parseDocument, executeDocumentCommands, getDocumentText,
  getDocumentPage, getBlocks, documentSchema, searchDocument, documentThumbnailContent,
  assertDocumentFeatures, resolveDocumentFeatures, exportDocumentDocx, openOfficePackage, officeXml } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const marker = () => ({ type: 'rendered_page_break' });
const paragraph = (...content) => ({ type: 'paragraph', content });
const model = content => createDocument({ content: { type: 'doc', content } });
const plain = node => (node.text ?? '') + (node.content ?? []).map(plain).join('');
const markers = node => Number(node.type === 'rendered_page_break') + (node.content ?? []).reduce((count, child) => count + markers(child), 0);

test('saved inline page boundaries preserve paragraphs, text, marks and IDs through DCON roundtrips and editing', () => {
  const source = model([paragraph(text('Al', [{ type: 'strong' }]), marker(), text('pha', [{ type: 'em' }]))]);
  const json = serializeDocument(source), restored = parseDocument(json), block = restored.content.content[0];
  assert.equal(serializeDocument(restored), json);
  assert.equal(restored.content.content.length, 1);
  assert.equal(block.attrs.id, source.content.content[0].attrs.id);
  assert.equal(getDocumentText(restored), 'Alpha');
  assert.deepEqual(block.content.map(item => item.type), ['text', 'rendered_page_break', 'text']);
  assert.deepEqual(block.content[0].marks, [{ type: 'strong' }]);
  assert.deepEqual(block.content[2].marks, [{ type: 'em' }]);
  assert.deepEqual(block.content[1], marker());
  assert.equal(getBlocks(restored).length, 1, 'saved inline metadata is not an editable block with an ID');

  const edited = executeDocumentCommands(restored, [
    { type: 'mark.set', from: 1, to: 7, mark: 'strong' },
    { type: 'mark.set', from: 1, to: 7, mark: 'text_style', attrs: { color: '#123456' } },
  ]).document;
  const savedBoundary = edited.content.content[0].content.find(item => item.type === 'rendered_page_break');
  assert.deepEqual(savedBoundary.marks.map(mark => mark.type), ['strong', 'text_style']);
  assert.equal(getDocumentText(edited), 'Alpha');
  assert.equal(serializeDocument(parseDocument(serializeDocument(edited))), serializeDocument(edited));
  assert.equal(serializeDocument(source), json);
});

test('rendered boundary validation rejects block placement, attributes, text and child content', () => {
  assert.throws(() => model([marker()]));
  for (const invalid of [{ ...marker(), attrs: { id: 'unexpected' } }, { ...marker(), text: 'x' }, { ...marker(), content: [] },
    { ...marker(), marks: [{ type: 'unknown' }] }]) {
    assert.throws(() => model([paragraph(invalid)]));
  }
  const source = model([paragraph(marker())]);
  assert.equal(normalizeDocument(source), source);
  assert.equal(documentSchema.nodes.rendered_page_break.isInline, true);
  assert.equal(documentSchema.nodes.rendered_page_break.isAtom, true);
  const dom = documentSchema.nodes.rendered_page_break.spec.toDOM(documentSchema.nodes.rendered_page_break.create());
  assert.equal(dom[0], 'span'); assert.equal(dom.length, 2, 'metadata adds no visible text or content hole');
  assert.equal(dom[1]['data-rendered-page-break'], 'true');
  assert.equal(dom[1].contenteditable, 'false');
  assert.match(dom[1].style, /width:0/);
  assert.match(dom[1].title, /保存時点/);
});

test('stored page ranges agree with ProseMirror positions across inline markers, lists, tables and manual breaks', () => {
  const source = model([paragraph(text('😀A'), marker(), marker(), text('B')),
    { type: 'ordered_list', content: [{ type: 'list_item', content: [paragraph(text('C'), marker(), text('D'))] }] },
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph(text('E'), marker(), text('F'))] }] }] },
    { type: 'page_break' }, paragraph(marker()),
  ]);
  const before = serializeDocument(source), pm = documentSchema.nodeFromJSON(source.content), boundaries = [];
  pm.descendants((node, pos) => { if (['page_break', 'rendered_page_break'].includes(node.type.name)) boundaries.push(pos); });
  let from = 0;
  [...boundaries, pm.content.size].forEach((to, index) => {
    assert.deepEqual(getDocumentPage(source, index + 1), { pageNumber: index + 1, from, to });
    from = to + 1;
  });
  assert.equal(getDocumentPage(source, boundaries.length + 2), undefined);
  assert.equal(serializeDocument(source), before);
});

test('search splits a paragraph at saved boundaries without treating metadata as text or losing exact positions', () => {
  const source = model([paragraph(text('😀Alpha', [{ type: 'strong' }]), marker(), text('Be', [{ type: 'em' }]),
    text('ta'), { type: 'hard_break' }, text('gamma'), marker(), text('Delta'))]);
  const pm = documentSchema.nodeFromJSON(source.content), id = source.content.content[0].attrs.id;
  assert.equal(getDocumentText(source), '😀AlphaBeta\ngammaDelta');
  const result = searchDocument(source, { keywords: ['Alpha', 'Beta\ngamma', 'Delta'], operator: 'or' });
  assert.deepEqual(result.matches.map(hit => [hit.pageNumber, hit.blockId, hit.text]), [
    [1, id, '😀Alpha'], [2, id, 'Beta\ngamma'], [3, id, 'Delta'],
  ]);
  for (const hit of result.matches) {
    const page = getDocumentPage(source, hit.pageNumber);
    assert.ok(hit.from >= page.from && hit.to <= page.to);
    for (const match of hit.matches) {
      assert.equal(pm.textBetween(match.from, match.to, '', '\n'), match.keyword);
      assert.equal(hit.text.slice(match.textFrom, match.textTo), match.keyword);
    }
  }
  assert.equal(result.matches[0].matches[0].textFrom, 2);
  for (const matchBy of ['page', 'block']) {
    assert.deepEqual(searchDocument(source, { keywords: ['Alpha', 'Beta'] }, { matchBy }).matches, []);
    assert.deepEqual(searchDocument(source, { keywords: ['AlphaBeta'] }, { matchBy }).matches, []);
  }
  assert.equal(searchDocument(source, { keywords: ['Delta'] }).matches[0].from, getDocumentPage(source, 3).from);
});

test('thumbnails keep the selected inline fragment and its marks without splitting the saved list or table', () => {
  const source = model([{ type: 'ordered_list', attrs: { order: 4 }, content: [{ type: 'list_item', content: [
    paragraph(text('Before'), marker(), text('Selected', [{ type: 'em' }]), marker(), text('After')),
  ] }] }]);
  const before = serializeDocument(source);
  assert.deepEqual([1, 2, 3].map(page => plain(documentThumbnailContent(source, page))), ['Before', 'Selected', 'After']);
  const selected = documentThumbnailContent(source, 2);
  assert.equal(selected.content[0].attrs.order, 4);
  const selectedParagraph = selected.content[0].content[0].content[0];
  assert.equal(selectedParagraph.attrs.id, source.content.content[0].content[0].content[0].attrs.id);
  assert.deepEqual(selectedParagraph.content[0].marks, [{ type: 'em' }]);
  assert.equal(markers(selected), 0);
  assert.equal(serializeDocument(source), before);
  const table = model([{ type: 'table', content: [{ type: 'table_row', content: [
    { type: 'table_cell', content: [paragraph(text('Old cell'))] },
    { type: 'table_cell', content: [paragraph(text('Before'), marker(), text('Selected'))] },
    { type: 'table_cell', content: [paragraph(text('Following cell'))] },
  ] }] }]);
  const cells = documentThumbnailContent(table, 2).content[0].content[0].content;
  assert.equal(cells.length, 3); assert.deepEqual(cells[0].content, []);
  assert.equal(plain(cells[1]), 'Selected'); assert.equal(plain(cells[2]), 'Following cell');
  assert.equal(markers(documentThumbnailContent(table, 2)), 0);
});

test('disabled page layout protects saved boundaries while ordinary text and mark edits remain available', () => {
  const source = model([paragraph(text('A'), marker(), text('B'))]), features = resolveDocumentFeatures({ pageLayout: false });
  for (const command of [{ type: 'text.insert', from: 1, text: 'More ' }, { type: 'mark.set', from: 1, to: 4, mark: 'strong' }]) {
    const after = executeDocumentCommands(source, command).document;
    assert.doesNotThrow(() => assertDocumentFeatures(source, after, [command], features));
  }
  const deleted = { type: 'text.delete', from: 2, to: 3 };
  assert.throws(() => assertDocumentFeatures(source, executeDocumentCommands(source, deleted).document, [deleted], features), /無効/);
  const moved = { type: 'transaction.apply', steps: [
    { stepType: 'replace', from: 2, to: 3 },
    { stepType: 'replace', from: 1, to: 1, slice: { content: [marker()] } },
  ] };
  const after = executeDocumentCommands(source, moved).document;
  assert.equal(markers(after.content), 1);
  assert.throws(() => assertDocumentFeatures(source, after, [moved], features), /無効/);
});

test('DOCX export keeps saved boundaries inline and preserves paragraph and list structure instead of forcing breaks', async () => {
  const source = model([paragraph(text('A'), { ...marker(), marks: [{ type: 'strong' }] }, text('B')),
    { type: 'ordered_list', content: [{ type: 'list_item', content: [paragraph(text('C'), marker(), text('D'))] }] },
    { type: 'page_break' }, paragraph(text('E')),
  ]);
  const before = serializeDocument(source), exported = await exportDocumentDocx(source);
  const archive = await openOfficePackage(exported.blob);
  const xml = new TextDecoder().decode(await archive.read('word/document.xml'));
  officeXml.parseXml(new TextEncoder().encode(xml));
  assert.equal((xml.match(/<w:lastRenderedPageBreak\/>/g) ?? []).length, 2);
  assert.equal((xml.match(/<w:br w:type="page"\/>/g) ?? []).length, 1);
  assert.equal((xml.match(/<w:p>/g) ?? []).length, 4);
  assert.equal((xml.match(/<w:numPr>/g) ?? []).length, 1);
  assert.match(xml, /<w:t xml:space="preserve">A<\/w:t><\/w:r><w:r><w:lastRenderedPageBreak\/><\/w:r><w:r><w:t xml:space="preserve">B<\/w:t>/);
  assert.equal(exported.warnings.length, 1); assert.match(exported.warnings[0], /保存時点.*再計算/);
  assert.equal(serializeDocument(source), before);
});
