import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { xls, record, R, u16, str, cell, number, labelSst, sst, font, xf, defaultFont, defaultFormats } from './xls-fixture.mjs';

const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXls } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-formats-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXls: importModel } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
// Measured digit metrics stand in for the browser, as the default sheet font of these files is not Calibri.
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const importSpreadsheetXls = (input, options) => importModel(input, { ...measured, ...options });
const messages = result => result.warnings.map(warning => warning.message);
const close = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
/** Globals with extra fonts and cell formats appended after Excel's default sixteen formats. */
const book = ({ fonts = [], formats = [], extra = [] } = {}) => [defaultFont(), ...fonts, ...extra, ...defaultFormats(), ...formats];
const importOne = async (globals, records, options) => importSpreadsheetXls(xls({ globals, sheets: [{ name: 'S', records }] }), options);

test('font attributes and palette colours reach the cell format', async () => {
  // Font records are numbered 0–3, then 5 and up: index 4 does not exist in the file format.
  const fonts = [font(), font(), font(), font({ name: 'MS ゴシック', height: 240, bold: true, italic: true, underline: 1, color: 10 })];
  const result = await importOne(book({ fonts, formats: [xf({ font: 5 })] }), [number(0, 0, 1, 16)]);
  const format = result.workbook.sheets[0].cells.A1.format;
  assert.equal(format.fontFamily, 'MS ゴシック');
  close(format.fontSize, 16);
  assert.deepEqual([format.bold, format.italic, format.underline, format.color], [true, true, true, '#FF0000']);
  assert.deepEqual(messages(result), []);
});

test('a custom palette replaces the default colours', async () => {
  const palette = record(R.PALETTE, u16(2), 0x12, 0x34, 0x56, 0, 0xab, 0xcd, 0xef, 0);
  const result = await importOne(book({ fonts: [font(), font(), font(), font({ color: 9 })], extra: [palette], formats: [xf({ font: 5, pattern: 1, fore: 8, back: 65 })] }), [number(0, 0, 1, 16)]);
  const format = result.workbook.sheets[0].cells.A1.format;
  assert.equal(format.color, '#ABCDEF');
  assert.equal(format.background, '#123456');
});

test('fills, borders and alignment are converted', async () => {
  const formats = [
    xf({ pattern: 1, fore: 13, left: 1, right: 2, top: 5, bottom: 6, leftColor: 10, rightColor: 12, topColor: 0x40, bottomColor: 17 }),
    xf({ horizontal: 2, vertical: 1, wrap: true, indent: 2 }), xf({ horizontal: 3, vertical: 0, shrink: true }), xf({ horizontal: 6 }), xf({ left: 3, top: 4, bottom: 7 }),
  ];
  const result = await importOne(book({ formats }), [number(0, 0, 1, 16), number(0, 1, 1, 17), number(0, 2, 1, 18), number(0, 3, 1, 19), number(0, 4, 1, 20)]);
  const { A1, B1, C1, D1, E1 } = result.workbook.sheets[0].cells;
  assert.equal(A1.format.background, '#FFFF00');
  assert.deepEqual(A1.format.borders, { left: { style: 'solid', width: 1, color: '#FF0000' }, right: { style: 'solid', width: 2, color: '#0000FF' },
    top: { style: 'solid', width: 3, color: '#000000' }, bottom: { style: 'double', width: 1, color: '#008000' } });
  assert.deepEqual([B1.format.align, B1.format.verticalAlign, B1.format.wrap, B1.format.indent], ['center', 'middle', true, 2]);
  assert.deepEqual([C1.format.align, C1.format.verticalAlign, C1.format.shrinkToFit], ['right', 'top', true]);
  assert.equal(D1.format.align, 'centerContinuous');
  assert.deepEqual(Object.fromEntries(Object.entries(E1.format.borders).map(([edge, border]) => [edge, border.style])), { left: 'dashed', top: 'dotted', bottom: 'dotted' });
  assert.deepEqual(messages(result), []);
});

test('unsupported decoration is reported with the XLSX wording', async () => {
  const fonts = [font(), font(), font(), font({ strike: true })];
  const formats = [xf({ font: 5 }), xf({ pattern: 3, fore: 10 }), xf({ rotation: 45 }), xf({ diagonal: 1, diagonalStyle: 1 })];
  const result = await importOne(book({ fonts, formats }), [number(0, 0, 1, 16), number(0, 1, 1, 17), number(0, 2, 1, 18), number(0, 3, 1, 19)]);
  assert.deepEqual(messages(result).sort(), ['グラデーション・模様の塗りつぶしを省略しました', 'セルの文字回転を省略しました', '取り消し線・上付きなど未対応の文字装飾を省略しました', '斜め罫線を省略しました'].sort());
});

test('built-in and custom number formats select the model format', async () => {
  const custom = record(R.FORMAT, u16(164), str('#,##0.000'));
  const formats = [xf({ format: 9 }), xf({ format: 4 }), xf({ format: 14 }), xf({ format: 164 }), xf({ format: 49 }), xf({ format: 20 })];
  const result = await importOne(book({ extra: [custom], formats }), [16, 17, 18, 19, 20, 21].map((index, column) => number(0, column, 0.5, index)));
  const cells = result.workbook.sheets[0].cells;
  assert.equal(cells.A1.format.numberFormat, 'percent');
  assert.deepEqual([cells.B1.format.numberFormat, cells.B1.format.useGrouping, cells.B1.format.decimalPlaces], ['number', true, 2]);
  assert.equal(cells.C1.format.numberFormat, 'date');
  assert.deepEqual([cells.D1.format.numberFormat, cells.D1.format.decimalPlaces], ['number', 3]);
  assert.equal(cells.E1.format.numberFormat, 'text');
  assert.equal(cells.F1.format.numberFormat, 'time');
});

test('row heights and column widths are converted with the XLSX rules', async () => {
  const records = [
    record(R.DEFCOLWIDTH, u16(8)), record(R.DEFAULTROWHEIGHT, u16(0), u16(255)),
    record(R.COLINFO, u16(1), u16(2), u16(20 * 256), u16(15), u16(2), u16(0)),
    record(R.ROW, u16(1), u16(0), u16(1), u16(600), u16(0), u16(0), u16(0x0140), u16(15)),
    record(R.ROW, u16(2), u16(0), u16(1), u16(0x8000 | 255), u16(0), u16(0), u16(0x0100), u16(15)),
    number(0, 0, 1), number(1, 0, 2), number(2, 0, 3),
  ];
  const sheet = (await importOne(book(), records)).workbook.sheets[0];
  close(sheet.rowHeights[1], 40);
  close(sheet.rowHeights[0], 17);
  close(sheet.rowHeights[2], 17);
  assert.equal(sheet.columnWidths[1], sheet.columnWidths[2]);
  assert.ok(sheet.columnWidths[1] > sheet.columnWidths[0] * 2, 'a 20-character column is much wider than the default');
  close(sheet.columnWidths[1], 140);
  close(sheet.columnWidths[0], 61);
});

test('hidden rows and columns are shown with a warning, as for XLSX', async () => {
  const records = [record(R.COLINFO, u16(0), u16(0), u16(2048), u16(15), u16(1), u16(0)),
    record(R.ROW, u16(0), u16(0), u16(1), u16(255), u16(0), u16(0), u16(0x0120), u16(15)), number(0, 0, 1)];
  assert.deepEqual([...new Set(messages(await importOne(book(), records)))], ['非表示の行・列を表示状態で読み込みました']);
});

test('merged ranges are imported and invalid ones are recovered by the shared reader', async () => {
  const records = [labelSst(0, 0, 0), number(3, 0, 1),
    record(R.MERGEDCELLS, u16(2), u16(0), u16(1), u16(0), u16(2), u16(3), u16(3), u16(0), u16(0))];
  const result = await importSpreadsheetXls(xls({ globals: [...book(), sst(['title'])], sheets: [{ name: 'S', records }] }));
  assert.deepEqual(result.workbook.sheets[0].merges, [{ top: 0, left: 0, bottom: 1, right: 2 }]);
  assert.equal(result.warnings.length, 1, 'the single-cell merge is reported by the XLSX reader');
});

test('blank formatted cells follow the emptyCellFormatting option', async () => {
  const formats = [xf({ pattern: 1, fore: 13 })];
  const records = [number(0, 0, 1), record(R.BLANK, cell(0, 1, 16)), record(R.MULBLANK, u16(1), u16(0), u16(16), u16(16), u16(1))];
  const preserved = (await importOne(book({ formats }), records)).workbook.sheets[0];
  assert.ok((preserved.formatRanges?.length ?? 0) + Object.keys(preserved.cells).length > 1, 'blank formatting is kept');
  const omitted = (await importOne(book({ formats }), records, { emptyCellFormatting: 'omit' })).workbook.sheets[0];
  assert.deepEqual(Object.keys(omitted.cells), ['A1']);
  assert.equal(omitted.formatRanges, undefined);
});

test('whole-row and whole-column formats become format ranges, as for XLSX', async () => {
  const formats = [xf({ pattern: 1, fore: 13 })];
  const records = [record(R.COLINFO, u16(0), u16(0), u16(2048), u16(16), u16(0), u16(0)),
    record(R.ROW, u16(0), u16(0), u16(1), u16(255), u16(0), u16(0), u16(0x0180), u16(16)), number(0, 0, 1)];
  const result = await importOne(book({ formats }), records);
  assert.deepEqual(result.workbook.sheets[0].formatRanges.map(item => [item.range, item.format.background]), [
    [{ top: 0, left: 0, bottom: 0, right: 'end' }, '#FFFF00'], [{ top: 1, left: 0, bottom: 'end', right: 0 }, '#FFFF00'],
  ]);
  assert.deepEqual(messages(result), []);
});
