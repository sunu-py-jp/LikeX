import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, main } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: {
  contents: 'export * from "./src/model-entry"; export * from "./src/model/formatting"; export * from "./src/model/conditional-formatting"; export * from "./src/model/sizing/auto-fit"; export { createXlsxStyles } from "./src/export/xlsx/styles";',
  resolveDir: new URL('../', import.meta.url).pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const horizontal = ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed'];
const vertical = ['top', 'middle', 'bottom', 'justify', 'distributed'];
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Alignment', rowCount: 50, columnCount: 8, cells, ...extra }] });
const formatCommand = format => ({ type: 'cells.format', sheetId: 's', addresses: ['A1:B1'], format });
const combinations = () => Object.fromEntries(horizontal.flatMap((align, i) => vertical.map((verticalAlign, j) =>
  [`A${i * vertical.length + j + 1}`, { value: '配置 1234', format: { align, verticalAlign, indent: (i + j) % 3 ? i + j : 0, fontSize: 15, wrap: true } }])));

test('all horizontal and vertical placements and indentation survive canonical native save', () => {
  const workbook = book(combinations());
  const saved = m.serializeWorkbook(workbook), restored = m.parseWorkbook(saved);
  assert.deepEqual(restored.sheets[0].cells, workbook.sheets[0].cells);
  assert.equal(m.serializeWorkbook(restored), saved);
  assert.equal(m.formatsEqual(undefined, { align: 'general', verticalAlign: 'middle', indent: 0 }), true);
  for (const align of horizontal.filter(value => value !== 'general')) assert.equal(m.formatsEqual(undefined, { align }), false);
  assert.equal(m.formatsEqual(undefined, { indent: 1 }), false);
  assert.equal(book({ A1: { value: 'limit', format: { indent: 250 } } }).sheets[0].cells.A1.format.indent, 250);
});

test('commands apply placement to each addressed cell with stable content and undo/redo', () => {
  const session = m.createSpreadsheetSession(book({ A1: { value: '1234', format: { numberFormat: 'text', bold: true } }, B1: { value: '' } }));
  const before = session.getWorkbook();
  assert.equal(session.execute(formatCommand({ align: 'centerContinuous', verticalAlign: 'distributed', indent: 2 })).ok, true);
  const after = session.getWorkbook();
  assert.deepEqual(after.sheets[0].cells.A1, { value: '1234', format: { bold: true, align: 'centerContinuous', verticalAlign: 'distributed', numberFormat: 'text', indent: 2 } });
  assert.equal(after.sheets[0].cells.B1.format.align, 'centerContinuous');
  assert.equal(session.execute(formatCommand({ align: 'centerContinuous', verticalAlign: 'distributed', indent: 2 })).changed, false);
  assert.equal(session.undo(), true); assert.equal(session.getWorkbook(), before);
  assert.equal(session.redo(), true); assert.equal(session.getWorkbook(), after);
});

test('invalid alignments and indent levels reject atomic commands and native input', () => {
  const invalid = [
    ...[-1, 251, 0.5, NaN, Infinity, '1', null, false, {}, []].map(indent => ({ indent })),
    ...['middle', 'centre', '', null, 1].map(align => ({ align })),
    ...['center', 'fill', '', null, 1].map(verticalAlign => ({ verticalAlign })),
  ];
  for (const patch of invalid) {
    assert.throws(() => book({ A1: { value: 'bad', format: patch } }));
    const session = m.createSpreadsheetSession(book({ A1: { value: 'original' } }));
    const before = session.getWorkbook(), history = session.getHistoryState();
    const result = session.batch([{ type: 'cells.set', sheetId: 's', values: { A1: 'must not publish' } }, formatCommand(patch)]);
    assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION_FAILED');
    assert.equal(session.getWorkbook(), before); assert.deepEqual(session.getHistoryState(), history);
    assert.throws(() => m.formatCells(before, 's', ['A1:B1'], patch));
    assert.equal(before.sheets[0].cells.A1.value, 'original');
  }
});

test('all placement modes and indentation roundtrip through XLSX without approximation warnings', async () => {
  const cells = combinations();
  const source = book(cells, { columnWidths: { 0: 70 }, rowHeights: { 0: 45 } });
  const result = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(source));
  for (const [address, cell] of Object.entries(cells)) {
    const restored = result.workbook.sheets[0].cells[address];
    assert.equal(restored.value, cell.value);
    for (const key of ['align', 'verticalAlign', 'indent', 'fontSize', 'wrap']) assert.equal(restored.format[key], cell.format[key], `${address}.${key}`);
  }
  assert.equal(result.warnings.some(warning => /配置|インデント|字下げ/.test(warning.message)), false);
});

test('XLSX alignment inheritance and explicit general/zero override preserve source intent', async () => {
  const styles = `<styleSheet xmlns="${main}"><cellStyleXfs><xf><alignment horizontal="centerContinuous" vertical="distributed" indent="3"/></xf></cellStyleXfs><cellXfs><xf xfId="0"/><xf xfId="0"><alignment horizontal="general" vertical="bottom" indent="0"/></xf><xf><alignment horizontal="fill" vertical="justify" indent="250"/></xf><xf><alignment horizontal="bogus" vertical="bogus" indent="-1"/></xf><xf><alignment horizontal="right" indent="2.5" textRotation="30"/></xf></cellXfs></styleSheet>`;
  const result = await m.importSpreadsheetXlsx(zip(fixture({
    sheets: [{ name: 'Imported', xml: `<sheetData><row r="1">${Array.from({ length: 5 }, (_, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i}" t="inlineStr"><is><t>1234</t></is></c>`).join('')}</row></sheetData>` }],
    parts: { 'xl/styles.xml': styles }, links: [{ id: 'style', type: 'styles', target: 'styles.xml' }],
  })));
  const { cells } = result.workbook.sheets[0];
  assert.deepEqual(cells.A1.format, { align: 'centerContinuous', verticalAlign: 'distributed', indent: 3, numberFormat: 'text' });
  assert.deepEqual(cells.B1.format, { align: 'general', verticalAlign: 'bottom', indent: 0, numberFormat: 'text' });
  assert.deepEqual(cells.C1.format, { align: 'fill', verticalAlign: 'justify', indent: 250, numberFormat: 'text' });
  assert.deepEqual(cells.D1.format, { numberFormat: 'text' });
  assert.deepEqual(cells.E1.format, { align: 'right', numberFormat: 'text' });
  assert.ok(result.warnings.some(warning => /インデント/.test(warning.message)));
  assert.ok(result.warnings.some(warning => /文字回転/.test(warning.message)));
});

test('conditional alignment formats persist, apply and export only specified attributes', () => {
  const rules = [
    { align: 'distributed', verticalAlign: 'justify', indent: 2 },
    { indent: 0 },
  ].map((format, i) => ({ id: `alignment-${i}`, type: 'text', operator: 'contains', value: `value-${i}`, ranges: [{ top: 0, left: 0, bottom: 2, right: 1 }], format }));
  const workbook = book({}, { conditionalFormats: rules });
  const restored = m.parseWorkbook(m.serializeWorkbook(workbook));
  assert.deepEqual(restored.sheets[0].conditionalFormats, workbook.sheets[0].conditionalFormats);
  const appearance = m.createConditionalFormatter(restored.sheets[0])(0, 0, 'value-0', { bold: true });
  assert.deepEqual(appearance.format, { bold: true, ...rules[0].format });
  const styles = m.createXlsxStyles(workbook);
  assert.match(styles.xml, /<dxfs count="2"><dxf><alignment vertical="justify" horizontal="distributed" indent="2"\/><\/dxf><dxf><alignment indent="0"\/><\/dxf><\/dxfs>/);
});

test('auto-fit reserves renderer indentation once for left/right and twice for distributed', () => {
  const measure = text => text.length * 10;
  const width = (align, indent) => m.autoFitColumnWidth(book({ A1: { value: 'content', format: { align, indent } } }).sheets[0], 0, {}, measure);
  for (const align of ['left', 'right']) assert.equal(width(align, 2) - width(align, 0), 60);
  assert.equal(width('distributed', 2) - width('distributed', 0), 120);
  for (const align of ['general', 'center', 'fill', 'justify', 'centerContinuous']) assert.equal(width(align, 2), width(align, 0));
  const height = indent => m.autoFitRowHeight(book({ A1: { value: 'abcd efgh ijkl', format: { align: 'left', indent, wrap: true } } }, { columnWidths: { 0: 110 } }).sheets[0], 0, {}, measure);
  assert.ok(height(1) > height(0));
  for (const align of ['justify', 'distributed']) {
    const auto = wrap => m.autoFitRowHeight(book({ A1: { value: 'abcd efgh ijkl', format: { align, wrap } } }, { columnWidths: { 0: 70 } }).sheets[0], 0, {}, measure);
    assert.equal(auto(false), auto(true), `${align} wraps as part of its alignment`);
  }
  const fill = wrap => m.autoFitRowHeight(book({ A1: { value: 'text to repeat', format: { align: 'fill', wrap } } }, { columnWidths: { 0: 40 } }).sheets[0], 0, {}, measure);
  assert.equal(fill(true), fill(false), 'Fill ignores automatic wrapping');
});
