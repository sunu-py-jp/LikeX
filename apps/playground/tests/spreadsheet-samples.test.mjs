import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = await build({ stdin: { contents: `
  export * from './apps/playground/src/demo/spreadsheet-workbook.ts';
  export * from './packages/spreadsheet/src/model/index.ts';
  export * from './packages/spreadsheet/src/model/function-definitions.ts';
  export { exportSpreadsheetXlsx } from './packages/spreadsheet/src/export/export-xlsx.ts';
`, resolveDir: root },
alias: { '@likex/spreadsheet': `${root}/packages/spreadsheet/src/model/index.ts` },
bundle: true, platform: 'node', format: 'esm', write: false });
const { createDemoWorkbook, normalizeWorkbook, calculateWorkbook, SPREADSHEET_SHAPES,
  SUPPORTED_SPREADSHEET_FUNCTIONS, exportSpreadsheetXlsx } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('every supported function has a working example in the actual playground workbook', () => {
  const workbook = normalizeWorkbook(createDemoWorkbook()), results = calculateWorkbook(workbook).functions;
  const sheet = workbook.sheets.find(item => item.id === 'functions');
  const expected = {
    SUM: 30, AVERAGE: 15, MIN: 10, MAX: 20, COUNT: 2, COUNTA: 3, ROUND: -12.35, ABS: 12.345,
    IF: '達成', IFERROR: '計算できません', AND: true, OR: true, NOT: true, LEN: 4, CONCAT: 'LikeX',
    COUNTIF: 3, SUMIF: 450, AVERAGEIF: 150, COUNTIFS: 2, SUMIFS: 350, AVERAGEIFS: 175, COUNTBLANK: 1,
    ROUNDUP: -12.35, ROUNDDOWN: -12.34, INT: -13, MOD: 2, PRODUCT: 200,
    LEFT: 'テキ', RIGHT: 'スト', MID: 'キス', TRIM: 'LikeX Spreadsheet', UPPER: 'LIKE', LOWER: 'x',
    SUBSTITUTE: '2026-09-15', FIND: 5, SEARCH: 1, TEXTJOIN: 'りんご・みかん・にんじん・バナナ', VALUE: 123.45,
    IFNA: '見つかりません', IFS: '中', ISBLANK: true, ISNUMBER: true, ISTEXT: true, ISERROR: true,
    INDEX: 200, MATCH: 3, VLOOKUP: 200, HLOOKUP: 150, XLOOKUP: 150,
    DATE: 46280, YEAR: 2026, MONTH: 9, DAY: 15, COLUMN: 4, ROWS: 4, COLUMNS: 3,
  };
  assert.deepEqual(SUPPORTED_SPREADSHEET_FUNCTIONS.map(item => item.name).sort(), [...Object.keys(expected), 'ROW'].sort());
  SUPPORTED_SPREADSHEET_FUNCTIONS.forEach(({ name }, index) => {
    const row = index + 4;
    assert.equal(sheet.cells[`A${row}`].value, name);
    assert.equal(results[`D${row}`], name === 'ROW' ? row : expected[name], `${name}: ${sheet.cells[`D${row}`].value}`);
  });
});

test('the shape gallery demo contains the supported Office shapes, lines and flowchart symbols', () => {
  const workbook = normalizeWorkbook(createDemoWorkbook());
  const drawings = workbook.sheets.find(sheet => sheet.id === 'shape-catalog').drawings;
  const expected = ['rectangle', 'roundedRectangle', 'ellipse', 'triangle', 'rightTriangle', 'diamond',
    'parallelogram', 'trapezoid', 'line', 'arrow', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow',
    'bentArrow', 'bentUpArrow', 'uturnArrow', 'leftUpArrow', 'leftRightUpArrow', 'quadArrow', 'chevron', 'homePlate',
    'pentagon', 'hexagon', 'octagon', 'star5', 'plus', 'flowChartProcess', 'flowChartDecision', 'flowChartTerminator',
    'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartDocument', 'flowChartMultidocument',
    'flowChartPreparation', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartMerge', 'flowChartDelay'];
  assert.deepEqual(SPREADSHEET_SHAPES.map(shape => shape.kind).sort(), expected.sort());
  assert.deepEqual(drawings.map(drawing => drawing.shape).sort(), expected.sort());
  assert.ok(drawings.every(drawing => drawing.type === 'shape' && drawing.width > 0 && drawing.height > 0));
});

test('the complete demo with expanded functions and shapes can still be exported to Excel', async () => {
  const blob = await exportSpreadsheetXlsx(createDemoWorkbook());
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(blob.size > 10_000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 3, 4]);
});

test('the formatting demo compares overflow, blockers, wrapping and shrinking without merging sample cells', () => {
  const workbook = normalizeWorkbook(createDemoWorkbook());
  const sheet = workbook.sheets.find(item => item.id === 'formatting-and-input');
  const calculated = calculateWorkbook(workbook)[sheet.id];
  const text = sheet.cells.B25.value;
  assert.equal(sheet.cells.C25, undefined, 'the standard example has an empty neighbor');
  assert.equal(sheet.cells.C26.value, '入力済み');
  assert.equal(sheet.cells.C27.value, '=""', 'a visually empty formula still occupies the neighboring cell');
  assert.equal(calculated.C27, '');
  for (const address of ['B26', 'B27', 'B28', 'B29']) assert.equal(sheet.cells[address].value, text);
  assert.equal(sheet.cells.B28.format.wrap, true);
  assert.equal(sheet.cells.B29.format.shrinkToFit, true);
  assert.equal(calculated.B31, text, 'formula results use the same text as literal examples');
  assert.equal(sheet.cells.E32.format.align, 'right');
  assert.equal(sheet.cells.D33.format.align, 'center');
  assert.ok(sheet.merges.every(merge => merge.bottom < 24 || merge.top > 32));
});
