import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export {importDocumentDocx, exportDocumentDocx} from './src/io';export {createZipArchive} from './src/core';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importDocumentDocx, exportDocumentDocx, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=docx-numbering-tests.js').toString('base64')}`);
const xmlns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (text = '', id, level = 0) => `<w:p>${id === undefined ? '' : `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr></w:pPr>`}${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p>`;
const cell = content => `<w:tc><w:tcPr/><w:p/>${content}</w:tc>`;
const table = cells => `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${cells.map(content => `<w:tr>${cell(content)}</w:tr>`).join('')}</w:tbl>`;
const level = (index, extra = '', start = 1) => `<w:lvl w:ilvl="${index}"><w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${index + 1}."/>${extra}</w:lvl>`;
const numbering = (levels = level(0), nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>') => `<w:numbering ${xmlns}><w:abstractNum w:abstractNumId="0">${levels}</w:abstractNum>${nums}</w:numbering>`;
async function file(body, numbers = numbering()) {
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    'word/document.xml': `<w:document ${xmlns}><w:body>${body}</w:body></w:document>`,
    'word/numbering.xml': numbers,
  };
  return createZipArchive(Object.entries(parts).map(([path, content]) => ({ path, content: new Blob([content]) })));
}
const text = node => (node.text ?? '') + (node.content ?? []).map(text).join('');
function numberedItems(node, output = []) {
  if (node.type === 'ordered_list') node.content.forEach((item, index) => output.push({ text: text(item.content[0]), order: node.attrs.order + index }));
  for (const child of node.content ?? []) numberedItems(child, output);
  return output;
}
const orderOf = (document, label) => numberedItems(document.content).find(item => item.text === label)?.order;

test('shared numbering continues through empty numbered table cells and unnumbered empty cells', async () => {
  const source = await file(table([paragraph('', '1'), paragraph(), paragraph('', '1'), paragraph('', '1')]));
  const { document, warnings } = await importDocumentDocx(source);
  assert.deepEqual(numberedItems(document.content), [{ text: '', order: 1 }, { text: '', order: 2 }, { text: '', order: 3 }]);
  assert.equal(document.content.content[0].content.length, 4); assert.deepEqual(warnings, []);
  const returned = await importDocumentDocx((await exportDocumentDocx(document)).blob);
  assert.deepEqual(numberedItems(returned.document.content), numberedItems(document.content));
});

test('numbering follows source order across body paragraphs, cells, nested tables and content controls', async () => {
  const body = paragraph('Before', '1') + table([paragraph('Cell', '1') + table([paragraph('Nested', '1')])])
    + `<w:sdt><w:sdtContent>${paragraph('Control', '1')}</w:sdtContent></w:sdt>` + paragraph('After', '1');
  const { document } = await importDocumentDocx(await file(body));
  assert.deepEqual(['Before', 'Cell', 'Nested', 'Control', 'After'].map(label => orderOf(document, label)), [1, 2, 3, 4, 5]);
});

test('counters are per import and per numId; startOverride applies once then continues', async () => {
  const numbers = numbering(level(0), '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>');
  const source = await file(paragraph('A', '1') + table([paragraph('B', '2'), paragraph('C', '1'), paragraph('D', '2')]), numbers);
  for (const { document } of await Promise.all([importDocumentDocx(source), importDocumentDocx(source)]))
    assert.deepEqual(['A', 'B', 'C', 'D'].map(label => orderOf(document, label)), [1, 7, 2, 8]);
});

test('nested levels restart after their parent by default, while lvlRestart zero continues', async () => {
  const body = paragraph('Parent A', '1') + paragraph('Child A', '1', 1) + paragraph() + paragraph('Child B', '1', 1)
    + paragraph('Parent B', '1') + paragraph('Child C', '1', 1);
  for (const [restart, expected] of [['', 1], ['<w:lvlRestart w:val="0"/>', 3]]) {
    const { document } = await importDocumentDocx(await file(body, numbering(level(0) + level(1, restart))));
    assert.deepEqual(['Parent A', 'Child A', 'Child B', 'Parent B', 'Child C'].map(label => orderOf(document, label)), [1, 1, 2, 2, expected]);
  }
});

test('a specified higher restart level preserves lower-level continuity until that level recurs', async () => {
  const body = paragraph('Top A', '1') + paragraph('Middle A', '1', 1) + paragraph('Low A', '1', 2)
    + paragraph('Middle B', '1', 1) + paragraph('Low B', '1', 2) + paragraph('Top B', '1') + paragraph('Low C', '1', 2);
  const { document } = await importDocumentDocx(await file(body, numbering(level(0) + level(1) + level(2, '<w:lvlRestart w:val="1"/>'))));
  assert.deepEqual(['Low A', 'Low B', 'Low C'].map(label => orderOf(document, label)), [1, 2, 1]);
});


test('custom marker text is reported once while its numbers and empty paragraphs are retained', async () => {
  const source = await file(table([paragraph('', '1'), paragraph('', '1'), paragraph('', '1')]), numbering(level(0).replace('%1.', '%1')));
  const { document, warnings } = await importDocumentDocx(source);
  assert.deepEqual(numberedItems(document.content).map(item => item.order), [1, 2, 3]);
  assert.equal(warnings.filter(message => message.includes('区切り')).length, 1);
});

test('a numbered paragraph split by an explicit break consumes one counter only', async () => {
  const split = paragraph('Before', '1').replace('</w:t>', '</w:t><w:br w:type="page"/><w:t>Continuation</w:t>');
  const { document } = await importDocumentDocx(await file(split + paragraph('Next', '1')));
  assert.deepEqual(numberedItems(document.content), [{ text: 'Before', order: 1 }, { text: 'Next', order: 2 }]);
});
