import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';
import { pngHeader } from './image-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export * from './model-entry';
  export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';
  export { prepareWorksheetDrawings, containXlsxImage } from './export/xlsx/drawings';`,
  resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const emu = pixels => Math.round(pixels * 9525), drawingPath = 'xl/drawings/drawing1.xml';
const image = { name: 'screen.png', mimeType: 'image/png', width: 1000, height: 800,
  dataUrl: `data:image/png;base64,${pngHeader(1000, 800).toString('base64')}` };
const marker = (x, y) => `<xdr:col>0</xdr:col><xdr:colOff>${emu(x)}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${emu(y)}</xdr:rowOff>`;
const transform = ({ x, y, width, height }) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>`;
const frame = { x: 80, y: 120, width: 1000, height: 900 };
function anchored(object, box, type = 'oneCellAnchor') {
  if (type === 'absoluteAnchor') return `<xdr:absoluteAnchor><xdr:pos x="${emu(box.x)}" y="${emu(box.y)}"/><xdr:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/>${object}<xdr:clientData/></xdr:absoluteAnchor>`;
  return `<xdr:${type}><xdr:from>${marker(box.x, box.y)}</xdr:from>${type === 'twoCellAnchor'
    ? `<xdr:to>${marker(box.x + box.width, box.y + box.height)}</xdr:to>`
    : `<xdr:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/>`}${object}<xdr:clientData/></xdr:${type}>`;
}
function sourceFile(anchorType = 'oneCellAnchor', extraFill = '', fillAttributes = '') {
  const picture = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Screenshot"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="image"/>${extraFill}<a:stretch><a:fillRect${fillAttributes}/></a:stretch></xdr:blipFill><xdr:spPr>${transform(frame)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
  // Two annotations over known image locations, one near the top and one near
  // the center. Contain used to move the image underneath the first annotation.
  const boxes = [{ x: 180, y: 220, width: 160, height: 30 }, { x: 680, y: 550, width: 120, height: 80 }];
  const outlines = boxes.map((box, index) => anchored(`<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${index + 2}" name="Red frame ${index + 1}"/></xdr:nvSpPr><xdr:spPr>${transform(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></xdr:spPr></xdr:sp>`, box)).join('');
  const parts = {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    [drawingPath]: `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel.slice(0, -1)}">${anchored(picture, frame, anchorType)}${outlines}</xdr:wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': `<Relationships><Relationship Id="image" Type="${rel}image" Target="../media/screen.png"/></Relationships>`,
    'xl/media/screen.png': pngHeader(1000, 800),
  };
  return { file: zip(fixture({ sheets: [{ name: 'Annotated image', xml: '<sheetFormatPr defaultRowHeight="21" defaultColWidth="14.28515625"/><sheetData/><drawing r:id="drawing"/>' }], parts })), boxes };
}
function rectangle(sheet, drawing) {
  return { x: Array.from({ length: drawing.anchor.column }, (_, i) => sheet.columnWidths?.[i] ?? 100).reduce((a, b) => a + b, 0) + drawing.anchor.offsetX,
    y: Array.from({ length: drawing.anchor.row }, (_, i) => sheet.rowHeights?.[i] ?? 28).reduce((a, b) => a + b, 0) + drawing.anchor.offsetY,
    width: drawing.width, height: drawing.height };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .001, `${actual} vs ${expected}`);
function verifyOverlay(sheet, boxes) {
  const picture = sheet.drawings[0];
  assert.equal(picture.type, 'image'); assert.equal(picture.fit, 'fill');
  const visible = picture.fit === 'fill' ? rectangle(sheet, picture) : m.containXlsxImage(rectangle(sheet, picture), image);
  for (const [index, original] of boxes.entries()) {
    const box = rectangle(sheet, sheet.drawings[index + 1]);
    // The same normalized image point and the red rectangle center must stay
    // coincident, including after export/import (independent of border width).
    const u = (original.x + original.width / 2 - frame.x) / frame.width;
    const v = (original.y + original.height / 2 - frame.y) / frame.height;
    near(visible.x + visible.width * u, box.x + box.width / 2);
    near(visible.y + visible.height * v, box.y + box.height / 2);
  }
}

test('stretched XLSX screenshots keep both red overlays aligned for all supported anchor forms and on re-export', async () => {
  for (const type of ['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor']) {
    const { file, boxes } = sourceFile(type), result = await m.importSpreadsheetXlsx(file);
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
    verifyOverlay(result.workbook.sheets[0], boxes);
    const again = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(result.workbook));
    assert.equal(again.warnings.length, 0, JSON.stringify(again.warnings));
    verifyOverlay(again.workbook.sheets[0], boxes);
  }
});

test('fill exports the full image frame and unchanged pixels while legacy contain keeps centered letterboxing', async () => {
  const picture = { id: 'image', type: 'image', resourceId: 'asset', alt: '', anchor: { row: 0, column: 0, offsetX: frame.x, offsetY: frame.y }, width: frame.width, height: frame.height };
  for (const fit of [undefined, 'contain', 'fill']) {
    const sheet = { id: 's', name: 's', rowCount: 50, columnCount: 20, cells: {}, drawings: [{ ...picture, ...(fit ? { fit } : {}) }] };
    const output = await m.prepareWorksheetDrawings(sheet, { images: { asset: image } }, { sheetIndex: 1 });
    const xml = await output.parts.find(part => part.path === drawingPath).content.text();
    const box = fit === 'fill' ? frame : m.containXlsxImage(frame, image);
    assert.ok(xml.includes(transform(box)));
    const pixels = output.parts.find(part => part.path.startsWith('xl/media/'));
    assert.deepEqual(Buffer.from(await pixels.content.arrayBuffer()), pngHeader(1000, 800));
  }
});

test('connected pictures retain legacy contain and new fill with their original frame and connector binding', async () => {
  for (const fit of [undefined, 'contain', 'fill']) for (const size of [{ width: 1000, height: 900 }, { width: 1000, height: 800 }]) {
    const picture = { id: 'target', type: 'image', resourceId: 'asset', alt: '', anchor: { row: 0, column: 0, offsetX: frame.x, offsetY: frame.y }, rotation: 45, flipY: true, ...size, ...(fit ? { fit } : {}) };
    const book = m.normalizeWorkbook({ sheets: [{ id: 's', name: 's', rowCount: 50, columnCount: 20, cells: {}, drawings: [picture] }], resources: { images: { asset: image } } });
    const command = m.applySpreadsheetCommands(book, [{ type: 'lines.insert', sheetId: 's', start: { x: 20, y: 30 }, end: { x: 0, y: 0, binding: { targetId: 'target', port: 'bottomRight' } } }]);
    assert.equal(command.ok, true, command.message);
    const result = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(command.workbook));
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
    const sheet = result.workbook.sheets[0], restored = sheet.drawings[0], line = sheet.drawings[1];
    assert.equal(restored.fit, fit ?? 'contain');
    assert.equal(restored.rotation, 45); assert.equal(restored.flipY, true);
    assert.deepEqual(rectangle(sheet, restored), { ...frame, ...size });
    assert.deepEqual(line.line.end.binding, { targetId: restored.id, port: 'bottomRight' });
  }
});

test('unsupported crop and fill-region adjustments remain explicit warnings', async () => {
  const cropped = await m.importSpreadsheetXlsx(sourceFile('oneCellAnchor', '<a:srcRect t="10000"/>').file);
  assert.ok(cropped.warnings.some(warning => warning.message.includes('トリミング')));
  const inset = await m.importSpreadsheetXlsx(sourceFile('oneCellAnchor', '', ' l="10000"').file);
  assert.ok(inset.warnings.some(warning => warning.message.includes('塗りつぶし範囲')));
});
