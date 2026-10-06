import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: 'export * from "./src/model";export * from "./src/io";export {openOfficePackage} from "./src/ooxml";export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createDocument, serializeDocument, parseDocument, documentSchema, exportDocumentDocx, importDocumentDocx, openOfficePackage, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const p = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const cell = (text = '', attrs = {}) => ({ type: 'table_cell', attrs, content: [p(text)] });
const model = (tableAttrs = {}, cells = [cell('No', { colwidth: [30] }), cell('項目名', { colwidth: [230] }), cell('説明', { colwidth: [360] })]) => createDocument({ content: { type: 'doc', content: [{ type: 'table', attrs: tableAttrs, content: [{ type: 'table_row', content: cells }] }] } });
const xmlP = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const xmlCell = (text, properties = '') => `<w:tc><w:tcPr>${properties}</w:tcPr>${xmlP(text)}</w:tc>`;
const xmlTable = (properties = '', grid = '<w:gridCol w:w="450"/><w:gridCol w:w="3450"/><w:gridCol w:w="5400"/>', cells = xmlCell('No') + xmlCell('項目名') + xmlCell('説明')) => `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
async function fixture(body, styles = '') {
  const base = await exportDocumentDocx(createDocument()), archive = await openOfficePackage(base.blob), entries = [];
  for (const path of archive.paths) {
    let bytes = await archive.read(path);
    if (path === 'word/document.xml') bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/<w:body>[\s\S]*?<w:sectPr>/, `<w:body>${body}<w:sectPr>`));
    if (path === 'word/styles.xml') bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('</w:styles>', `${styles}</w:styles>`));
    entries.push({ path, content: new Blob([bytes]) });
  }
  return createZipArchive(entries);
}
const table = document => document.content.content.find(node => node.type === 'table');
const firstCell = document => table(document).content[0].content[0];
const domTable = document => documentSchema.nodes.table.spec.toDOM(documentSchema.nodeFromJSON(table(document)));
const domCell = document => documentSchema.nodes.table_cell.spec.toDOM(documentSchema.nodeFromJSON(firstCell(document)));
async function xml(document) { const archive = await openOfficePackage((await exportDocumentDocx(document)).blob); return new TextDecoder().decode(await archive.read('word/document.xml')); }

test('narrow No column preserves fixed table width, grid and original small margins through DOM and DOCX', async () => {
  const file = await fixture(xmlTable('<w:tblW w:w="9300" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="30" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="30" w:type="dxa"/></w:tblCellMar>'));
  const result = await importDocumentDocx(file), document = result.document;
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(table(document).attrs.width, { unit: 'px', value: 620 });
  assert.equal(table(document).attrs.layout, 'fixed');
  assert.deepEqual(table(document).attrs.cellMargins, { top: 0, right: 2, bottom: 0, left: 2 });
  assert.deepEqual(firstCell(document).attrs.colwidth, [30]);
  const dom = domTable(document);
  assert.match(dom[1].style, /width:620px/);
  assert.match(dom[1].style, /--lxd-cell-padding-left:2px/);
  assert.deepEqual(dom[2], ['colgroup', ['col', { style: 'width:30px' }], ['col', { style: 'width:230px' }], ['col', { style: 'width:360px' }]]);
  assert.equal(serializeDocument(parseDocument(serializeDocument(document))), serializeDocument(document));
  const exported = await exportDocumentDocx(document), again = (await importDocumentDocx(exported.blob)).document;
  assert.deepEqual(table(again).attrs.width, table(document).attrs.width);
  assert.deepEqual(table(again).attrs.cellMargins, table(document).attrs.cellMargins);
  assert.deepEqual(firstCell(again).attrs.colwidth, [30]);
});

test('style inheritance, row exceptions and cell margins resolve per edge including explicit zero', async () => {
  const styles = '<w:style w:type="table" w:default="1" w:styleId="Base"><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tcPr><w:noWrap/></w:tcPr></w:style><w:style w:type="table" w:styleId="Child"><w:basedOn w:val="Base"/><w:tblPr><w:tblW w:w="4000" w:type="pct"/><w:tblCellMar><w:top w:w="15" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';
  const body = xmlTable('<w:tblStyle w:val="Child"/><w:tblCellMar><w:start w:w="30" w:type="dxa"/></w:tblCellMar>', undefined, xmlCell('No', '<w:tcMar><w:left w:w="0" w:type="nil"/></w:tcMar><w:noWrap w:val="0"/>') + xmlCell('項目名') + xmlCell('説明')).replace('<w:tr>', '<w:tr><w:tblPrEx><w:tblCellMar><w:right w:w="45" w:type="dxa"/></w:tblCellMar></w:tblPrEx>');
  const { document, warnings } = await importDocumentDocx(await fixture(body, styles));
  assert.deepEqual(warnings, []);
  assert.deepEqual(table(document).attrs.width, { unit: 'percent', value: 80 });
  assert.deepEqual(table(document).attrs.cellMargins, { top: 1, right: 6, bottom: 0, left: 2 });
  assert.deepEqual(firstCell(document).attrs.margins, { right: 3, left: 0 });
  assert.equal(firstCell(document).attrs.noWrap, false);
  assert.equal(table(document).content[0].content[1].attrs.noWrap, true);
  assert.match(domCell(document)[1].style, /padding-left:0px/);
  const reimported = (await importDocumentDocx((await exportDocumentDocx(document)).blob)).document;
  assert.deepEqual(table(reimported).attrs.cellMargins, table(document).attrs.cellMargins);
  assert.deepEqual(firstCell(reimported).attrs.margins, firstCell(document).attrs.margins);
});

test('missing grid widths use cell preferred widths without reducing supplied columns', async () => {
  const body = xmlTable('<w:tblW w:w="9300" w:type="dxa"/>', '<w:gridCol w:w="450"/><w:gridCol w:w="0"/>', xmlCell('No') + xmlCell('Merged', '<w:gridSpan w:val="2"/><w:tcW w:w="8850" w:type="dxa"/>'));
  const { document, warnings } = await importDocumentDocx(await fixture(body));
  assert.ok(warnings.some(message => message.includes('未確定の列幅')));
  assert.deepEqual(firstCell(document).attrs.colwidth, [30]);
  assert.deepEqual(table(document).content[0].content[1].attrs.colwidth, [295, 295]);
  assert.match(domTable(document)[1].style, /width:620px/);
  const noGrid = await importDocumentDocx(await fixture(xmlTable('<w:tblW w:w="9000" w:type="dxa"/>', '', xmlCell('Half', '<w:tcW w:w="2500" w:type="pct"/>') + xmlCell('Other', '<w:tcW w:w="4500" w:type="dxa"/>'))));
  assert.deepEqual(firstCell(noGrid.document).attrs.colwidth, [300]);
});

test('automatic widths, noWrap and fit-text flags survive conversion and expose rendering limits', async () => {
  const properties = '<w:tcW w:w="0" w:type="auto"/><w:noWrap/><w:tcFitText/><w:tcMar><w:top w:w="15" w:type="dxa"/></w:tcMar>';
  const { document, warnings } = await importDocumentDocx(await fixture(xmlTable('', undefined, xmlCell('Long header', properties) + xmlCell('B') + xmlCell('C'))));
  assert.equal(table(document).attrs.layout, 'auto');
  assert.equal(firstCell(document).attrs.preferredWidth, null);
  assert.equal(firstCell(document).attrs.noWrap, true);
  assert.equal(firstCell(document).attrs.fitText, true);
  assert.ok(warnings.some(message => message.includes('文字間隔の自動伸縮')));
  assert.equal(domCell(document)[1]['data-document-width-unit'], 'auto');
  assert.equal(domCell(document)[1]['data-document-nowrap'], 'true');
  const output = await xml(document);
  assert.match(output, /<w:tcW w:w="0" w:type="auto"\/>/);
  assert.match(output, /<w:noWrap w:val="1"\/>/);
  assert.match(output, /<w:tcFitText w:val="1"\/>/);
  const roundtrip = (await importDocumentDocx((await exportDocumentDocx(document)).blob)).document;
  assert.equal(firstCell(roundtrip).attrs.fitText, true);
  assert.equal(firstCell(roundtrip).attrs.preferredWidth, null);
});

test('grid output consults later rows and rowspans instead of splitting a first-row merge equally', async () => {
  const document = createDocument({ content: { type: 'doc', content: [{ type: 'table', attrs: { layout: 'fixed' }, content: [
    { type: 'table_row', content: [cell('No', { rowspan: 2, colwidth: [30] }), cell('Merged', { colspan: 2 })] },
    { type: 'table_row', content: [cell('Name', { colwidth: [230] }), cell('Description', { colwidth: [360] })] },
  ] }] } });
  assert.deepEqual(domTable(document)[2], ['colgroup', ['col', { style: 'width:30px' }], ['col', { style: 'width:230px' }], ['col', { style: 'width:360px' }]]);
  assert.match(await xml(document), /<w:tblGrid><w:gridCol w:w="450"\/><w:gridCol w:w="3450"\/><w:gridCol w:w="5400"\/><\/w:tblGrid>/);
});

test('legacy colwidth-only tables retain their preferred DOCX cell widths and default table styling', async () => {
  const document = model(), before = serializeDocument(document);
  assert.equal(table(document).attrs.layout, null);
  assert.equal(table(document).attrs.cellMargins, null);
  assert.doesNotMatch(domTable(document)[1].style ?? '', /width:/);
  assert.match(await xml(document), /<w:tcW w:w="450" w:type="dxa"\/>/);
  assert.equal(serializeDocument(document), before);
});

test('table attribute validation rejects malformed width, margins and flags while tiny widths export positively', async () => {
  for (const attrs of [{ width: { unit: 'em', value: 2 } }, { width: { unit: 'px', value: Infinity } }, { width: { unit: 'percent', value: 501 } }, { cellMargins: { left: -1 } }, { cellMargins: { unsupported: 0 } }, { layout: 'absolute' }]) assert.throws(() => model(attrs));
  assert.throws(() => model({}, [cell('A', { noWrap: 'true' })]));
  assert.throws(() => model({}, [cell('A', { fitText: 1 })]));
  assert.throws(() => model({}, [cell('A', { preferredWidth: { unit: 'px', value: 6000 } })]));
  assert.match(await xml(model({ width: { unit: 'px', value: .01 } })), /<w:tblW w:w="1" w:type="dxa"\/>/);
});

test('invalid Office dimensions and unresolved/conditional styles are explicitly diagnosed', async () => {
  const styles = '<w:style w:type="table" w:styleId="Loop"><w:basedOn w:val="Loop"/><w:tblStylePr w:type="firstRow"><w:tcPr><w:noWrap/></w:tcPr></w:tblStylePr></w:style>';
  const body = xmlTable('<w:tblStyle w:val="Loop"/><w:tblW w:w="900000" w:type="dxa"/><w:tblCellMar><w:left w:w="-1" w:type="dxa"/></w:tblCellMar>');
  const { warnings } = await importDocumentDocx(await fixture(body, styles));
  for (const phrase of ['循環', '条件付き書式', '不正な幅', '不正な余白']) assert.ok(warnings.some(message => message.includes(phrase)), phrase);
});
