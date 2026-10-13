import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const emu = value => Math.round(value * 9525);
const marker = (tag, row, column) => `<${tag}><col>${column}</col><colOff>0</colOff><row>${row}</row><rowOff>0</rowOff></${tag}>`;
const shape = (id, { textBox = false, transform = '', custom = '', stroke = 0 } = {}) => `<sp><nvSpPr><cNvPr id="${id}" name="Object ${id}"/><cNvSpPr${textBox ? ' txBox="1"' : ''}/></nvSpPr><spPr>${transform}${custom || '<prstGeom prst="rect"/>'}<ln w="${emu(stroke)}"/></spPr><txBody><bodyPr/><p><r><t>保持する文字 ${id}</t></r></p></txBody></sp>`;
const one = (object, width, height) => `<oneCellAnchor>${marker('from', 1, 1)}<ext cx="${emu(width)}" cy="${emu(height)}"/>${object}</oneCellAnchor>`;
const transform = (width, height) => `<xfrm rot="5400000"><off x="609600" y="190500"/><ext cx="${emu(width)}" cy="${emu(height)}"/></xfrm>`;
const file = (drawings, dimensions = '') => zip(fixture({ sheets: [{ name: '機能仕様', xml: `${dimensions}<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>元のセル</t></is></c></row></sheetData><drawing r:id="drawing"/>` }], parts: {
  'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="drawing" Type="${rel}drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  'xl/drawings/drawing1.xml': `<wsDr>${drawings}</wsDr>`,
} }));

test('subpixel rectangles and text boxes import with a bounded adjustment instead of rejecting the workbook', async () => {
  const input = file(one(shape(1), .5, 30) + one(shape(2, { textBox: true }), 80, .25) + one(shape(3), 80, 30));
  const result = await importSpreadsheetXlsx(input), sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '元のセル');
  assert.deepEqual(sheet.drawings.map(d => [d.width, d.height]), [[1, 30], [80, 1], [80, 30]]);
  assert.deepEqual(sheet.drawings.map(d => d.text), ['保持する文字 1', '保持する文字 2', '保持する文字 3']);
  const warnings = result.warnings.filter(w => w.code === 'adjusted' && w.message.includes('1px'));
  assert.equal(warnings.reduce((count, w) => count + w.count, 0), 2);
  assert.ok(warnings.every(w => w.sheetName === '機能仕様'));
  const again = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.deepEqual(again.workbook.sheets[0].drawings.map(d => [d.width, d.height]), [[1, 30], [80, 1], [80, 30]]);
});

test('rotated subpixel shapes are adjusted after converting the native frame', async () => {
  const result = await importSpreadsheetXlsx(file(one(shape(1, { transform: transform(.5, 20) }), 20, .5)));
  const drawing = result.workbook.sheets[0].drawings[0];
  assert.equal(drawing.width, 1); assert.equal(drawing.height, 20); assert.equal(drawing.rotation, 90);
  assert.ok(result.warnings.some(w => w.code === 'adjusted' && w.message.includes('1px')));
});

test('out-of-range final frames caused by grid rebasing omit only the drawing and warn', async () => {
  // Source rows are 1/100px; the supported grid raises them to 1px. Rotation
  // projects that scaling onto the local width: 200px becomes 20,000px.
  const expanded = `<twoCellAnchor>${marker('from', 1, 1)}${marker('to', 2, 2)}${shape(1, { transform: transform(200, 20) })}</twoCellAnchor>`;
  const result = await importSpreadsheetXlsx(file(expanded + one(shape(2), 80, 30), '<sheetFormatPr defaultRowHeight="0.0075"/>'));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '元のセル');
  assert.equal(sheet.drawings.length, 1); assert.equal(sheet.drawings[0].text, '保持する文字 2');
  assert.ok(result.warnings.some(w => w.code === 'omitted' && w.message.includes('サイズ')));
});

test('invalid, zero and oversized source frames remain omitted; they are never made valid by minimum-size recovery', async () => {
  for (const [width, height] of [[0, 20], [-1, 20], [20, 0], [10001, 20]]) {
    const result = await importSpreadsheetXlsx(file(one(shape(1), width, height) + one(shape(2), 80, 30)));
    assert.equal(result.workbook.sheets[0].drawings.length, 1);
    assert.ok(result.warnings.some(w => w.code === 'omitted'));
  }
});
