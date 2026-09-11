import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model'; export * from './src/model/formatting'; export * from './src/state/sizing/auto-fit'; export * from './src/state/sizing/auto-fit-command';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet1', rowCount: 10, columnCount: 5, cells, ...extra }] });
const tenPixels = text => Array.from(text).length * 10;

function documentWithCellStyle({ canvas = true, zoom = 1 } = {}) {
  let appended = 0, removed = 0;
  const fonts = [];
  const css = { fontFamily: '"Custom Grid", sans-serif', fontSize: '20px', fontWeight: '600', fontStyle: 'normal', lineHeight: '28px',
    letterSpacing: '2px', wordSpacing: '3px', paddingLeft: '8px', paddingRight: '10px', paddingTop: '2px', paddingBottom: '3px',
    borderLeftWidth: '2px', borderRightWidth: '3px', borderTopWidth: '1px', borderBottomWidth: '2px', zoom: String(zoom) };
  const root = { closest: () => root, querySelector: () => null, appendChild() { appended++; } };
  const otherRoot = { closest: () => otherRoot, querySelector: () => null, appendChild() { throw new Error('must measure the invoking spreadsheet'); } };
  const source = { closest: () => root, getBoundingClientRect() { throw new Error('screen pixels must not enter saved dimensions'); } };
  const context = { font: '', measureText(text) { fonts.push(this.font); return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)[1]) / 2 }; } };
  const document = {
    activeElement: otherRoot, querySelectorAll: () => [otherRoot, root], defaultView: { getComputedStyle: () => css },
    createElement(tag) { return tag === 'canvas' ? { getContext: () => canvas ? context : null } : { className: '', style: {}, remove() { removed++; } }; },
  };
  return { document, source, fonts, get appended() { return appended; }, get removed() { return removed; } };
}

test('canvas sizing uses the invoking sheet CSS font and padding in logical pixels at every zoom', () => {
  const workbook = book({ A1: { value: 'AB' } });
  for (const zoom of [0.5, 1, 2]) {
    const fixture = documentWithCellStyle({ zoom });
    const command = m.autoFitCommand(workbook, 's', 'column', [0], fixture.document, undefined, fixture.source);
    assert.equal(command.columnWidths[0], 48, '20px shaped text + 4px tracking + 18px padding + 5px borders + rounding room');
    assert.match(fixture.fonts[0], /^normal 600 20px "Custom Grid", sans-serif$/);
    assert.equal(fixture.appended, 1); assert.equal(fixture.removed, 1, 'one temporary style probe is always removed');
    const measure = m.createTextMeasurer(fixture.document, fixture.source);
    measure('AB', { fontSize: 30, fontFamily: 'Noto Sans JP', bold: true, italic: true });
    assert.equal(fixture.fonts.at(-1), 'italic 700 30px Noto Sans JP');
  }
});

test('canvas fallback keeps the real default font size and spacing rather than assuming 13px', () => {
  const fixture = documentWithCellStyle({ canvas: false });
  const measure = m.createTextMeasurer(fixture.document, fixture.source);
  assert.equal(measure('AB'), 2 * 0.58 * 20 + 4);
  assert.equal(m.autoFitColumnWidth(book({ A1: { value: 'AB' } }).sheets[0], 0, {}, measure), 52);
  assert.equal(m.createTextMeasurer()('日本語'), 39);
});

test('fit measures formatted formula results, preserved text and the longest explicit line, and can shrink', () => {
  const workbook = book({ A1: { value: '=SUM(1000,234)', format: { numberFormat: 'currency' } },
    B1: { value: '00123' }, C1: { value: '日本語\r\n列' } }, { columnWidths: { 0: 600, 1: 600, 2: 600, 3: 600 } });
  const values = { A1: 1234, B1: '00123', C1: '日本語\r\n列' };
  const sizes = m.autoFitDimensions(workbook.sheets[0], 'column', new Set([0, 1, 2, 3]), values, tenPixels);
  assert.equal(sizes.get(0), tenPixels(m.formatCellValue(1234, workbook.sheets[0].cells.A1.format)) + 16);
  assert.equal(sizes.get(1), 66);
  assert.equal(sizes.get(2), 46);
  assert.equal(sizes.get(3), 24, 'empty columns shrink to the minimum');
  assert.equal(workbook.sheets[0].columnWidths[0], 600, 'measurement does not mutate the workbook');
});

test('conditional fonts and number formats are measured exactly as their displayed values', () => {
  const workbook = book({ A1: { value: '0.5' } }, { conditionalFormats: [{ id: 'r', type: 'comparison', operator: 'gt', value: 0,
    ranges: [{ top: 0, bottom: 0, left: 0, right: 0 }], format: { fontSize: 30, bold: true, numberFormat: 'percent' } }] });
  const measured = [];
  const measure = (text, format) => { measured.push({ text, format }); return text.length * format.fontSize; };
  assert.equal(m.autoFitColumnWidth(workbook.sheets[0], 0, { A1: 0.5 }, measure), 106);
  assert.equal(measured[0].text, '50%'); assert.equal(measured[0].format.bold, true);
  assert.equal(m.autoFitDimensions(workbook.sheets[0], 'column', new Set([0]), { A1: 0.5 }, measure).get(0), 106);
});

test('checkboxes fit both control and feature-disabled text, lists reserve the dropdown, and borders contribute width', () => {
  const sheet = book({ A1: { value: 'FALSE', validation: { type: 'checkbox' } }, B1: { value: 'yes', validation: { type: 'list', values: ['yes'] } },
    C1: { value: 'yes', format: { borders: { left: { width: 3 }, right: { width: 3 } } } } }).sheets[0];
  assert.equal(m.autoFitColumnWidth(sheet, 0, {}, tenPixels), 66, 'FALSE stays readable when checkbox rendering is disabled');
  assert.equal(m.autoFitColumnWidth(sheet, 1, {}, tenPixels), 70);
  assert.equal(m.autoFitColumnWidth(sheet, 2, {}, tenPixels), 51);
  assert.equal(m.autoFitRowHeight(sheet, 0, {}, tenPixels), 28);
});

test('wrapped rows preserve word boundaries and shaped whole strings instead of summing isolated glyphs', () => {
  const sheet = book({ A1: { value: 'aaaa aaaa aaaa', format: { wrap: true } }, B2: { value: 'fifififi', format: { wrap: true } }, C3: { value: '日本語日本語', format: { wrap: true } } },
    { columnWidths: { 0: 86, 1: 76, 2: 36 } }).sheets[0];
  assert.equal(m.autoFitRowHeight(sheet, 0, {}, tenPixels), 61, 'three word lines, even though character sums suggest two');
  const ligatures = text => text.replaceAll('fi', 'X').length * 10;
  assert.equal(m.autoFitRowHeight(sheet, 1, {}, ligatures), 28, 'all four shaped ligatures fit on one line');
  assert.equal(m.autoFitRowHeight(sheet, 2, {}, tenPixels), 61);
});

test('merged labels do not widen their constituent columns, and dimensions remain bounded', () => {
  const merged = book({ A1: { value: 'A very long merged title' }, A2: { value: 'x' } }, { merges: [{ top: 0, bottom: 0, left: 0, right: 2 }] }).sheets[0];
  assert.equal(m.autoFitColumnWidth(merged, 0, {}, tenPixels), 26);
  assert.equal(m.autoFitColumnWidth(merged, 1, {}, tenPixels), 24);
  const large = book({ A1: { value: 'x'.repeat(10000), format: { wrap: true, fontSize: 30 } } }).sheets[0];
  assert.equal(m.autoFitColumnWidth(large, 0, {}, tenPixels), 1000);
  assert.equal(m.autoFitRowHeight(large, 0, {}, tenPixels), 1000);
});
