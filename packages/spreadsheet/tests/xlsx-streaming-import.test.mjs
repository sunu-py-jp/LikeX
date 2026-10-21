import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/export/export-xlsx";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const styling = {
  links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }],
  parts: { 'xl/styles.xml': '<styleSheet><fills><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></fills><cellXfs><xf/><xf fillId="0" applyFill="1"/></cellXfs></styleSheet>' },
};
const read = (xml, options, extra = styling) => importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: '帳票', xml }], ...extra })), options);

test('preserve is the default; explicit omit removes only blank formats and keeps dimensions, merges, formulas and data', async () => {
  const xml = '<cols><col min="1" max="1" width="12"/></cols><sheetData><row r="1" ht="30"><c s="1"/><c t="inlineStr"><is><t> </t></is></c><c s="1"><v>0</v></c><c s="1"><f>1</f></c></row><row r="2"><c s="1"/></row><row r="3"><c><v>3</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells>';
  const kept = await read(xml), omitted = await read(xml, { emptyCellFormatting: 'omit' });
  const original = kept.workbook.sheets[0], sheet = omitted.workbook.sheets[0];
  assert.ok(original.cells.A1.format); assert.ok(original.cells.A2.format);
  assert.equal(sheet.cells.A1, undefined); assert.equal(sheet.cells.A2, undefined);
  assert.equal(sheet.cells.B1.value, ' '); assert.equal(sheet.cells.C1.value, '0'); assert.equal(sheet.cells.D1.value, '=1');
  assert.equal(sheet.cells.A3.value, '3'); assert.deepEqual(sheet.cells.C1.format, original.cells.C1.format);
  assert.deepEqual(sheet.merges, original.merges); assert.deepEqual(sheet.rowHeights, original.rowHeights); assert.deepEqual(sheet.columnWidths, original.columnWidths);
  assert.equal(omitted.warnings.find(warning => warning.message.includes('空セルの書式を省略する設定')).count, 2);
  const roundtrip = (await importSpreadsheetXlsx(await exportSpreadsheetXlsx(omitted.workbook))).workbook.sheets[0];
  assert.equal(roundtrip.cells.A1, undefined); assert.equal(roundtrip.cells.D1.value, '=1'); assert.deepEqual(roundtrip.merges, sheet.merges);
});

test('full import retains source row heights for rotated drawings after releasing cell XML', async () => {
  for (const emptyCellFormatting of ['preserve', 'omit']) for (const height of [30, 1125, 0.375]) {
    const sourceY = height / 0.75;
    const drawings = `<wsDr><oneCellAnchor><from><col>1</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></from>
      <ext cx="190500" cy="381000"/><sp><nvSpPr><cNvPr id="1" name="Rotated"/><cNvSpPr/></nvSpPr><spPr>
      <xfrm rot="5400000"><off x="609600" y="${Math.round(sourceY * 9525)}"/><ext cx="190500" cy="381000"/></xfrm>
      <prstGeom prst="rect"/><ln><noFill/></ln></spPr></sp></oneCellAnchor></wsDr>`;
    const extra = { ...styling, parts: { ...styling.parts,
      'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      'xl/drawings/drawing1.xml': drawings,
    } };
    const result = await read(`<sheetData><row ht="${height}"><c s="1"/></row><row><c><v>3</v></c></row></sheetData><drawing r:id="drawing"/>`, { emptyCellFormatting }, extra);
    const sheet = result.workbook.sheets[0], drawing = sheet.drawings[0];
    assert.equal(sheet.rowHeights[0], Math.min(1000, Math.max(1, sourceY)));
    assert.equal(sheet.cells.A2.value, '3');
    assert.equal(drawing.anchor.row, 1, `${emptyCellFormatting}, ${height}`); assert.equal(drawing.anchor.column, 1);
    // Native DrawingML positions are integral EMUs, so half-pixel coordinates round.
    const epsilon = 1 / 9525;
    assert.ok(Math.abs(drawing.anchor.offsetX) < epsilon); assert.ok(Math.abs(drawing.anchor.offsetY) < epsilon);
    assert.equal(drawing.rotation, 90);
    assert.ok(Math.abs(drawing.width - 20) < epsilon); assert.ok(Math.abs(drawing.height - 40) < epsilon);
  }
});

test('discarded rows and cells preserve implicit coordinates and still validate duplicates and values', async () => {
  const result = await read('<sheetData><row><c s="1"/></row><row><c s="1"/><c><v>2</v></c></row></sheetData>', { emptyCellFormatting: 'omit' });
  assert.equal(result.workbook.sheets[0].cells.B2.value, '2');
  for (const xml of [
    '<sheetData><row r="1"><c r="A1" s="1"/><c r="A1" s="1"/></row></sheetData>',
    '<sheetData><row r="1"/><row r="1"/></sheetData>',
    '<sheetData><row><c t="s"><v>9</v></c></row></sheetData>',
    '<sheetData><row><c t="b"/></row></sheetData>',
    '<sheetData><row><c r="XFE1" s="1"/></row></sheetData>',
    '<sheetData><row r="10001"><c><v>0</v></c></row></sheetData>',
    '<sheetData><row><c s="1"><is><t>&invalid;</t></is></c></row></sheetData>',
  ]) await assert.rejects(read(xml, { emptyCellFormatting: 'omit' }));
  await assert.rejects(read('<sheetData/>', { emptyCellFormatting: 'unknown' }), /emptyCellFormatting/);
});

test('default mode prunes blank formatting before retaining a full source worksheet and prioritizes later data', async () => {
  const rows = Array.from({ length: 102 }, (_, row) => `<row r="${row + 1}">${'<c s="1"/>'.repeat(1000)}</row>`).join('');
  const result = await read(`<sheetData>${rows}<row r="103"><c><v>7</v></c></row></sheetData>`);
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.A103.value, '7'); assert.equal(Object.keys(cells).length, 100_000);
  assert.equal(result.warnings.find(warning => warning.message.includes('上限を超えた空セルの書式')).count, 2001);
});

test('100MiB expanded package with over16MiB worksheet and over600k nodes imports without retaining blank cells', async () => {
  const rows = Array.from({ length: 700 }, (_, row) => `<row r="${row + 1}">${'<c s="1" t="n"><v></v></c>'.repeat(1000)}</row>`).join('');
  let entries = fixture({ sheets: [{ name: 'Large', xml: `<sheetData>${rows}<row r="701"><c><v>42</v></c></row></sheetData>` }], ...styling });
  assert.ok(Buffer.byteLength(entries['xl/worksheets/sheet1.xml']) > 16 * 1024 * 1024);
  const sourceBytes = Object.values(entries).reduce((total, value) => total + Buffer.byteLength(value), 0);
  entries['unused.bin'] = Buffer.alloc(100 * 1024 * 1024 - sourceBytes, 65);
  const file = zip(entries); entries = undefined;
  let yielded = false; const timer = setTimeout(() => { yielded = true; }, 0);
  try {
    const result = await importSpreadsheetXlsx(file, { emptyCellFormatting: 'omit' });
    assert.deepEqual(Object.keys(result.workbook.sheets[0].cells), ['A701']);
    assert.equal(result.workbook.sheets[0].cells.A701.value, '42');
    assert.equal(result.warnings.find(warning => warning.message.includes('空セルの書式を省略する設定')).count, 700_000);
    assert.equal(yielded, true);
  } finally { clearTimeout(timer); }
});

test('expanded limits and unread-member CRC are still enforced; cancellation never publishes a partial result', async () => {
  const declared = zip(fixture());
  const central = declared.readUInt32LE(declared.length - 6);
  declared.writeUInt32LE(100 * 1024 * 1024 + 1, 22); declared.writeUInt32LE(100 * 1024 * 1024 + 1, central + 24);
  await assert.rejects(importSpreadsheetXlsx(declared), /展開サイズ/);
  const broken = zip(fixture({ parts: { 'unused.bin': 'data' } }), { method: 0 });
  const name = broken.indexOf(Buffer.from('unused.bin'));
  broken[name + 'unused.bin'.length] ^= 1;
  await assert.rejects(importSpreadsheetXlsx(broken), /CRC/);
  const controller = new AbortController();
  const file = zip(fixture({ sheets: [{ name: 'Cancel', xml: `<sheetData>${Array.from({ length: 1000 }, (_, row) => `<row r="${row + 1}">${'<c/>'.repeat(1000)}</row>`).join('')}</sheetData>` }] }));
  const pending = importSpreadsheetXlsx(file, { emptyCellFormatting: 'omit', signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { name: 'AbortError' });
});
