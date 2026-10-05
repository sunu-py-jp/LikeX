import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, main } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: {
  contents: 'export * from "./src/model-entry"; export * from "./src/model/formatting"; export * from "./src/model/sizing/auto-fit"; export { createXlsxStyles } from "./src/export/xlsx/styles";',
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Text', rowCount: 8, columnCount: 6, cells, ...extra }] });
const format = patch => ({ type: 'cells.format', sheetId: 's', addresses: ['A1'], format: patch });

test('text control flags are independent, validated and retained in native files', () => {
  for (const wrap of [false, true]) for (const shrinkToFit of [false, true]) {
    const workbook = book({ A1: { value: '長いセルの文字列', format: { wrap, shrinkToFit, fontSize: 20 } } });
    const saved = m.serializeWorkbook(workbook);
    assert.deepEqual(m.parseWorkbook(saved).sheets[0].cells.A1.format, { wrap, shrinkToFit, fontSize: 20 });
    assert.equal(m.serializeWorkbook(m.parseWorkbook(saved)), saved);
  }
  assert.equal(m.formatsEqual(undefined, { wrap: false, shrinkToFit: false }), true);
  assert.equal(m.formatsEqual(undefined, { shrinkToFit: true }), false);
  assert.equal(m.formatsEqual({ wrap: true }, { wrap: true, shrinkToFit: true }), false);
  for (const shrinkToFit of [1, 0, 'true', null, {}, []]) assert.throws(() => book({ A1: { value: 'invalid', format: { shrinkToFit } } }));
});

test('public formatting commands preserve raw text and font size, and undo/redo restores text controls', () => {
  const session = m.createSpreadsheetSession(book({ A1: { value: '長いセルの文字列', format: { fontSize: 20, bold: true } } }));
  const before = session.getWorkbook();
  assert.equal(session.execute(format({ wrap: false, shrinkToFit: true })).ok, true);
  const after = session.getWorkbook();
  assert.deepEqual(after.sheets[0].cells.A1, { value: '長いセルの文字列', format: { fontSize: 20, bold: true, wrap: false, shrinkToFit: true } });
  assert.equal(session.execute(format({ shrinkToFit: true })).changed, false);
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
  assert.equal(session.execute(format({ wrap: false, shrinkToFit: false })).ok, true);
  assert.equal(session.getWorkbook().sheets[0].cells.A1.format.shrinkToFit, false);
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), after);
  const history = session.getHistoryState();
  const invalid = session.batch([{ type: 'cells.set', sheetId: 's', values: { A1: 'must not publish' } }, format({ shrinkToFit: 'true' })]);
  assert.equal(invalid.ok, false); assert.equal(invalid.code, 'VALIDATION_FAILED');
  assert.equal(session.getWorkbook(), after); assert.deepEqual(session.getHistoryState(), history);
  assert.equal(before.sheets[0].cells.A1.format.shrinkToFit, undefined);
});

test('XLSX roundtrip preserves all wrap/shrink combinations, content and stored font size', async () => {
  const cells = {};
  for (const [index, flags] of [{ wrap: false, shrinkToFit: false }, { wrap: false, shrinkToFit: true }, { wrap: true, shrinkToFit: false }, { wrap: true, shrinkToFit: true }].entries()) {
    cells[`A${index + 1}`] = { value: '長いセルの文字列', format: { ...flags, fontSize: 20, align: 'right' } };
  }
  const source = book(cells, { columnWidths: { 0: 50 }, rowHeights: { 0: 32 } });
  const result = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(source));
  for (const [address, cell] of Object.entries(cells)) {
    const imported = result.workbook.sheets[0].cells[address];
    assert.equal(imported.value, cell.value);
    for (const key of ['wrap', 'shrinkToFit', 'fontSize', 'align']) assert.equal(imported.format[key], cell.format[key]);
  }
  assert.equal(result.workbook.sheets[0].rowHeights[0], 32);
  assert.ok(Math.abs(result.workbook.sheets[0].columnWidths[0] - 50) < 1);
  assert.equal(result.warnings.some(warning => /縮小|文字回転|字下げ/.test(warning.message)), false);
});

test('XLSX reads explicit true/false and inherited shrink settings without an omitted warning', async () => {
  const styles = `<styleSheet xmlns="${main}"><cellStyleXfs><xf><alignment shrinkToFit="true"/></xf></cellStyleXfs><cellXfs><xf xfId="0"/><xf><alignment wrapText="true" shrinkToFit="true"/></xf><xf><alignment shrinkToFit="false"/></xf><xf><alignment shrinkToFit="0" textRotation="30"/></xf></cellXfs></styleSheet>`;
  const result = await m.importSpreadsheetXlsx(zip(fixture({
    sheets: [{ name: 'Imported', xml: '<sheetData><row r="1"><c r="A1" s="0" t="inlineStr"><is><t>inherited</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>both</t></is></c><c r="C1" s="2" t="inlineStr"><is><t>false</t></is></c><c r="D1" s="3" t="inlineStr"><is><t>zero</t></is></c></row></sheetData>' }],
    parts: { 'xl/styles.xml': styles }, links: [{ id: 'style', type: 'styles', target: 'styles.xml' }],
  })));
  const { cells } = result.workbook.sheets[0];
  assert.equal(cells.A1.format.shrinkToFit, true);
  assert.equal(cells.B1.format.wrap, true); assert.equal(cells.B1.format.shrinkToFit, true);
  assert.equal(cells.C1.format.shrinkToFit, false); assert.equal(cells.D1.format.shrinkToFit, false);
  assert.equal(result.warnings.some(warning => warning.message.includes('縮小')), false);
  assert.equal(result.warnings.some(warning => warning.message.includes('文字回転')), true);
});

test('conditional XLSX formats include explicit shrink changes without overriding unrelated alignment', () => {
  const rules = [true, false].map((shrinkToFit, index) => ({ id: `rule-${index}`, type: 'text', operator: 'contains', value: 'long',
    ranges: [{ top: 0, left: 0, bottom: 1, right: 0 }], format: { shrinkToFit } }));
  const styles = m.createXlsxStyles(book({}, { conditionalFormats: rules }));
  assert.match(styles.xml, /<dxfs count="2"><dxf><alignment shrinkToFit="1"\/><\/dxf><dxf><alignment shrinkToFit="0"\/><\/dxf><\/dxfs>/);
  assert.notEqual(styles.dxfId(rules[0].format), styles.dxfId(rules[1].format));
});

test('auto-fit measures the saved font size and gives wrapping priority over shrink display', () => {
  const cells = { A1: { value: 'long text '.repeat(8), format: { fontSize: 20, wrap: true } } };
  const source = book(cells).sheets[0];
  const both = book({ A1: { ...cells.A1, format: { ...cells.A1.format, shrinkToFit: true } } }).sheets[0];
  const shrink = book({ A1: { ...cells.A1, format: { fontSize: 20, shrinkToFit: true } } }).sheets[0];
  assert.equal(m.autoFitRowHeight(both, 0, {}), m.autoFitRowHeight(source, 0, {}));
  assert.ok(m.autoFitRowHeight(shrink, 0, {}) < m.autoFitRowHeight(both, 0, {}));
  assert.equal(m.autoFitColumnWidth(shrink, 0, {}), m.autoFitColumnWidth(source, 0, {}));
});
