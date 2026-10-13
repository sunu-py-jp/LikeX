import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel, xml } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';
  export { readWorksheetDrawings } from './import/drawings';
  export { readDrawingImage } from './import/drawing-media';
  export { normalizeWorkbook } from './model/workbook';
  export { parseXml } from './import/xml';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, readWorksheetDrawings, readDrawingImage, normalizeWorkbook, parseXml } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=', 'base64');
const shape = (id, text = `図形 ${id}`, preset = 'rect') => `<sp><nvSpPr><cNvPr id="${id}" name="Object ${id}"/><cNvSpPr/></nvSpPr><spPr><prstGeom prst="${preset}"/></spPr><txBody><bodyPr/><p><r><t>${xml(text)}</t></r></p></txBody></sp>`;
const image = (id, link = 'image', alt = '画像') => `<pic><nvPicPr><cNvPr id="${id}" name="Image ${id}" descr="${xml(alt)}"/></nvPicPr><blipFill><blip r:embed="${link}"/></blipFill><spPr/></pic>`;
const one = object => `<oneCellAnchor><from><col>0</col><colOff>0</colOff><row>0</row><rowOff>0</rowOff></from><ext cx="952500" cy="476250"/>${object}</oneCellAnchor>`;
const relationship = (id, type, target) => `<Relationship Id="${id}" Type="${rel}${type}" Target="${target}"/>`;
const relationships = content => `<Relationships>${content}</Relationships>`;
const file = (sheets, parts = {}) => zip(fixture({ sheets: sheets.map((sheet, index) => ({ name: `仕様 ${index + 1}`, xml:
  `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>セル ${index + 1}</t></is></c></row></sheetData>${sheet.refs ?? '<drawing r:id="drawing"/>'}` })), parts: {
  ...Object.fromEntries(sheets.flatMap((sheet, index) => [
    [`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, relationships(sheet.rels ?? relationship('drawing', 'drawing', `../drawings/drawing${index + 1}.xml`))],
    [`xl/drawings/drawing${index + 1}.xml`, sheet.raw ?? `<wsDr>${sheet.drawings ?? ''}</wsDr>`],
  ])), ...parts,
} }));
const paddedPng = size => { const bytes = Buffer.alloc(size); png.copy(bytes); return bytes; };

test('unsupported anchors do not consume the accepted drawing budget', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one('<grpSp/>').repeat(1001) + one(shape(7)) }]));
  assert.deepEqual(result.workbook.sheets[0].drawings.map(d => d.text), ['図形 7']);
  assert.equal(result.workbook.sheets[0].cells.A1.value, 'セル 1');
});

test('workbook drawing capacity omits only the excess and survives export/import', async () => {
  const shapes = (first, count) => Array.from({ length: count }, (_, n) => one(shape(first + n))).join('');
  const result = await importSpreadsheetXlsx(file([{ drawings: shapes(1, 600) }, { drawings: shapes(601, 402) }]));
  assert.deepEqual(result.workbook.sheets.map(s => s.drawings.length), [600, 400]);
  assert.equal(result.workbook.sheets[1].cells.A1.value, 'セル 2');
  assert.ok(result.warnings.some(w => w.sheetName === '仕様 2' && w.message.includes('Object 1001') && w.message.includes('1000')));
  const again = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.deepEqual(again.workbook.sheets.map(s => s.drawings.length), [600, 400]);
});

test('overlong shape and line text omit the object, retain siblings and report the source name', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one(shape(1, '長'.repeat(100001))) + one(shape(2, '長'.repeat(100001), 'line')) + one(shape(3)) }]));
  assert.deepEqual(result.workbook.sheets[0].drawings.map(d => d.text), ['図形 3']);
  assert.ok(result.warnings.some(w => w.sheetName === '仕様 1' && w.message.includes('Object 1') && w.message.includes('文字数')));
  assert.ok(result.warnings.some(w => w.sheetName === '仕様 1' && w.message.includes('Object 2')));
});

test('image normalization failure commits no resource or cache entry and a following use of the same part succeeds', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one(image(1, 'image', '長'.repeat(10001))) + one(image(2)) }], {
    'xl/drawings/_rels/drawing1.xml.rels': relationships(relationship('image', 'image', '../media/a.png')),
    'xl/media/a.png': png,
  }));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.drawings.length, 1); assert.equal(sheet.drawings[0].alt, '画像');
  assert.equal(Object.keys(result.workbook.resources.images).length, 1);
  assert.ok(result.warnings.some(w => w.message.includes('Image 1') && w.message.includes('画像の説明')));
});

test('an oversized image is omitted while a later ordinary image and all cells remain', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one(image(1, 'large')) + one(image(2)) }], {
    'xl/drawings/_rels/drawing1.xml.rels': relationships(relationship('large', 'image', '../media/large.png') + relationship('image', 'image', '../media/a.png')),
    'xl/media/large.png': paddedPng(5 * 1024 * 1024 + 1), 'xl/media/a.png': png,
  }));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.drawings.length, 1); assert.equal(sheet.cells.A1.value, 'セル 1');
  assert.equal(Object.keys(result.workbook.resources.images).length, 1);
  assert.ok(result.warnings.some(w => w.message.includes('Image 1') && w.message.includes('5 MiB')));
});

test('image preparation accounts only for committed resources, including total bytes and cache reuse', async () => {
  const files = new Map(Array.from({ length: 5 }, (_, i) => [`${i}.png`, paddedPng(4 * 1024 * 1024)]));
  files.set('small.png', png);
  const context = { resources: {}, archive: { read: async path => files.get(path) } };
  const discarded = await readDrawingImage('0.png', context);
  assert.equal(Object.keys(context.resources).length, 0);
  assert.equal(discarded.resource.width, 1);
  for (let i = 0; i < 5; i++) (await readDrawingImage(`${i}.png`, context)).commit();
  assert.equal(Object.keys(context.resources).length, 5);
  await assert.rejects(readDrawingImage('small.png', context), /20 MiB/);
  assert.equal((await readDrawingImage('0.png', context)).id, 'image-1');
  assert.equal(Object.keys(context.resources).length, 5);
});

test('resource count overflow leaves the resources unchanged', async () => {
  const resource = { mimeType: 'image/png', width: 1, height: 1, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  const context = { resources: Object.fromEntries(Array.from({ length: 1000 }, (_, n) => [`image-${n}`, resource])), archive: { read: async () => png } };
  await assert.rejects(readDrawingImage('a.png', context), /画像数/);
  assert.equal(Object.keys(context.resources).length, 1000);
});

test('malformed drawing XML and invalid wsDr roots omit only their own part', async () => {
  for (const raw of ['<wsDr><sp></wsDr>', '<worksheet/>']) {
    const result = await importSpreadsheetXlsx(file([{ raw }, { drawings: one(shape(2)) }]));
    assert.equal(result.workbook.sheets[0].cells.A1.value, 'セル 1');
    assert.equal(result.workbook.sheets[0].drawings, undefined);
    assert.equal(result.workbook.sheets[1].drawings.length, 1);
    assert.ok(result.warnings.some(w => w.sheetName === '仕様 1' && w.message.includes('drawing1.xml')));
  }
});

test('a missing optional image omits only its reference and leaves sibling objects usable', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one(image(1, 'missing')) + one(shape(2)) + one(image(3)) }], {
    'xl/drawings/_rels/drawing1.xml.rels': relationships(relationship('missing', 'image', '../media/missing.png') + relationship('image', 'image', '../media/a.png')),
    'xl/media/a.png': png,
  }));
  assert.deepEqual(result.workbook.sheets[0].drawings.map(d => d.type), ['shape', 'image']);
  assert.ok(result.warnings.some(w => w.sheetName === '仕様 1' && w.message.includes('missing.png')));
});

test('a malformed drawing relationship part keeps independent shapes, while invalid package paths stay fatal', async () => {
  const result = await importSpreadsheetXlsx(file([{ drawings: one(image(1)) + one(shape(2)) }], {
    'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship></Relationships>',
  }));
  assert.deepEqual(result.workbook.sheets[0].drawings.map(d => d.text), ['図形 2']);
  assert.ok(result.warnings.some(w => w.message.includes('参照情報')));
  await assert.rejects(importSpreadsheetXlsx(file([{ drawings: one(shape(2)) }], {
    'xl/drawings/_rels/drawing1.xml.rels': relationships(relationship('image', 'image', '../../../escaped.png')),
  })), /パッケージ外/);
});

test('a failed target drawing detaches its connector while preserving the source endpoints', async () => {
  const connector = `<cxnSp><nvCxnSpPr><cNvPr id="2" name="Connector"/><cNvCxnSpPr><stCxn id="1" idx="0"/></cNvCxnSpPr></nvCxnSpPr><spPr><prstGeom prst="straightConnector1"/></spPr></cxnSp>`;
  const result = await importSpreadsheetXlsx(file([{ drawings: one(shape(1, '長'.repeat(100001))) + one(connector) }]));
  const drawing = result.workbook.sheets[0].drawings[0];
  assert.equal(drawing.shape, 'line'); assert.ok(drawing.line);
  assert.equal(drawing.line.start.binding, undefined); assert.equal(drawing.line.end.binding, undefined);
  assert.ok(result.warnings.some(w => w.message.includes('接続を解除')));
  assert.doesNotThrow(() => normalizeWorkbook(result.workbook));
});

test('drawing-part and image-read cancellation is never downgraded to an omission warning', async () => {
  const bytes = value => new TextEncoder().encode(value);
  const node = parseXml(bytes('<worksheet><drawing r:id="drawing"/></worksheet>'));
  const initial = { id: 's', name: 'Sheet', rowCount: 10, columnCount: 10, cells: {} };
  const relations = new Map([['drawing', { type: `${rel}drawing`, target: 'xl/drawings/drawing1.xml', external: false }]]);
  const error = new DOMException('cancelled', 'AbortError');
  const warnings = [];
  const context = { resources: {}, warnings, warn: warning => warnings.push(warning), archive: { read: async () => { throw error; } } };
  await assert.rejects(readWorksheetDrawings(node, initial, relations, context), error);
  await assert.rejects(readDrawingImage('a.png', context), error);
  assert.deepEqual(warnings, []);
  const archiveError = new Error('Excelファイルを読み込めません: ZIPのCRCが一致しません');
  context.archive.read = async () => { throw archiveError; };
  await assert.rejects(readWorksheetDrawings(node, initial, relations, context), archiveError);
  assert.deepEqual(warnings, []);
  const controller = new AbortController(), reason = new Error('custom cancellation');
  context.signal = controller.signal;
  context.archive.read = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(readWorksheetDrawings(node, initial, relations, context), reason);
  assert.deepEqual(warnings, []);
});
