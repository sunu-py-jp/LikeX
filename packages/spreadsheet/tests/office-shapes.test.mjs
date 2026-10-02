import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zip, fixture, rel } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: { contents: `export * from './model-entry';
  export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';
  export { prepareWorksheetDrawings } from './export/xlsx/drawings';
  export { shapeTextFrame } from './model/shapes';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
// Standard DrawingML fixture, constructed independently of the LikeX exporter and catalog.
const presets = ['bentArrow', 'bentUpArrow', 'uturnArrow', 'leftUpArrow', 'leftRightUpArrow', 'quadArrow', 'chevron', 'homePlate',
  'pentagon', 'hexagon', 'octagon', 'star5', 'plus', 'flowChartProcess', 'flowChartDecision', 'flowChartTerminator',
  'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartDocument', 'flowChartMultidocument', 'flowChartPreparation',
  'flowChartManualInput', 'flowChartManualOperation', 'flowChartMerge', 'flowChartDelay'];
function externalFile(guides = '') {
  const shapes = presets.map((preset, index) => `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${index * 5}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1905000" cy="952500"/>
    <xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${index + 1}" name="${preset}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm flipH="1"><a:off x="609600" y="${index * 952500}"/><a:ext cx="1905000" cy="952500"/></a:xfrm>
      <a:prstGeom prst="${preset}"><a:avLst>${guides}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="D8EFF5"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="175066"/></a:solidFill></a:ln></xdr:spPr>
      <xdr:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1200"/><a:t>Office ${preset}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>`).join('');
  return zip(fixture({ sheets: [{ name: 'Office shapes', xml: '<sheetData/><drawing r:id="drawing"/>' }], parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${shapes}</xdr:wsDr>`,
  } }));
}

test('external Office presets import without rasterizing, then export and reimport with text, styles and reflection', async () => {
  const first = await m.importSpreadsheetXlsx(externalFile());
  assert.deepEqual(first.workbook.sheets[0].drawings.map(item => item.shape), presets);
  assert.equal(first.warnings.some(item => item.message.includes('図形')), false);
  const xmlParts = await m.prepareWorksheetDrawings(first.workbook.sheets[0], undefined, { sheetIndex: 1 });
  const xml = await xmlParts.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
  for (const preset of presets) assert.ok(xml.includes(`<a:prstGeom prst="${preset}">`), preset);
  assert.doesNotMatch(xml, /<xdr:pic>/);
  const second = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(first.workbook));
  assert.deepEqual(second.workbook.sheets[0].drawings.map(item => item.shape), presets);
  for (const item of second.workbook.sheets[0].drawings) {
    assert.equal(item.text, `Office ${item.shape}`); assert.equal(item.fill, '#D8EFF5'); assert.equal(item.stroke, '#175066');
    assert.equal(item.width, 202); assert.equal(item.height, 102);
    assert.equal(item.strokeWidth, 2); assert.equal(item.flipX, true); assert.equal(item.fontSize, 16);
    assert.ok(m.shapeTextFrame(item).width >= 0); assert.ok(m.shapeTextFrame(item).height >= 0);
  }
});

test('Office deformation guides are reported rather than silently claiming exact custom shape support', async () => {
  const result = await m.importSpreadsheetXlsx(externalFile('<a:gd name="adj1" fmla="val 50000"/>'));
  assert.equal(result.workbook.sheets[0].drawings.length, presets.length);
  assert.ok(result.warnings.some(item => item.message.includes('細かな変形')));
});

test('connected bent arrows and curved flowcharts retain outlines and both arrow markers in XLSX', async () => {
  let workbook = m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Connections', rowCount: 50, columnCount: 20, cells: {}, drawings: [
    { id: 'bend', type: 'shape', shape: 'bentArrow', anchor: { row: 2, column: 1, offsetX: 0, offsetY: 0 }, width: 210, height: 100, fill: '#E8F3EC', stroke: '#217346', strokeWidth: 2, text: '承認', flipX: true, rotation: 30 },
    { id: 'document', type: 'shape', shape: 'flowChartDocument', anchor: { row: 8, column: 5, offsetX: 0, offsetY: 0 }, width: 180, height: 100, fill: '#E8F3EC', stroke: '#217346', strokeWidth: 2, text: '帳票' },
  ] }] });
  const inserted = m.applySpreadsheetCommands(workbook, [{ type: 'lines.insert', sheetId: 's', start: { x: 0, y: 0, binding: { targetId: 'bend', port: 'bottomRight' } },
    end: { x: 0, y: 0, binding: { targetId: 'document', port: 'left' } }, startArrow: 'oval', endArrow: 'triangle' }]);
  assert.equal(inserted.ok, true, inserted.message); workbook = inserted.workbook;
  const parts = await m.prepareWorksheetDrawings(workbook.sheets[0], undefined, { sheetIndex: 1 });
  const xml = await parts.parts.find(part => part.path === 'xl/drawings/drawing1.xml').content.text();
  assert.match(xml, /<a:cubicBezTo>/);
  assert.match(xml, /<a:headEnd type="oval"/); assert.match(xml, /<a:tailEnd type="triangle"/);
  const imported = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(workbook));
  const sheet = imported.workbook.sheets[0], [bend, document, line] = sheet.drawings;
  assert.equal(bend.shape, 'bentArrow'); assert.equal(document.shape, 'flowChartDocument');
  assert.equal(bend.rotation, 30); assert.equal(bend.flipX, true);
  assert.equal(line.line.start.binding.targetId, bend.id); assert.equal(line.line.end.binding.targetId, document.id);
  assert.equal(line.startArrow, 'oval'); assert.equal(line.endArrow, 'triangle');
  const actual = m.getSpreadsheetLinePoints(sheet, line.id), expected = m.getSpreadsheetLinePoints(workbook.sheets[0], workbook.sheets[0].drawings[2].id);
  assert.ok(Math.abs(actual.start.x - expected.start.x) < 0.01); assert.ok(Math.abs(actual.start.y - expected.start.y) < 0.01);
  assert.ok(Math.abs(actual.end.x - expected.end.x) < 0.01); assert.ok(Math.abs(actual.end.y - expected.end.y) < 0.01);
});


test('new preset outer frames do not shrink over repeated XLSX roundtrips', async () => {
  let workbook = m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Size', rowCount: 50, columnCount: 20, cells: {}, drawings: presets.map((shape, index) => ({
    id: `shape-${index}`, type: 'shape', shape, anchor: { row: 2, column: 1, offsetX: 15, offsetY: 12 },
    width: 247, height: 133, fill: '#D8EFF5', stroke: '#175066', strokeWidth: 3, text: shape, rotation: 45, flipX: true,
  })) }] });
  for (let iteration = 0; iteration < 3; iteration++) {
    workbook = (await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(workbook))).workbook;
    for (const drawing of workbook.sheets[0].drawings) {
      assert.equal(drawing.width, 247); assert.equal(drawing.height, 133);
      assert.equal(drawing.rotation, 45); assert.equal(drawing.flipX, true);
      assert.equal(drawing.anchor.row, 2); assert.equal(drawing.anchor.column, 1);
      assert.ok(Math.abs(drawing.anchor.offsetX - 15) < 0.001); assert.ok(Math.abs(drawing.anchor.offsetY - 12) < 0.001);
    }
  }
});
