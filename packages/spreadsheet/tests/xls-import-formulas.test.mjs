import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { xls, record, R, u16, u32, f64, str, shortStr, noCch, cell, number, labelSst, sst, defaultFont, defaultFormats } from './xls-fixture.mjs';

const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXls } from './src/model-entry';
export { formulaText } from './src/import/legacy/biff-formula';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-formulas-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXls: importModel, formulaText } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const importSpreadsheetXls = (input, options) => importModel(input, { ...measured, ...options });
const base = [defaultFont(), ...defaultFormats()];
const values = sheet => Object.fromEntries(Object.entries(sheet.cells).map(([address, item]) => [address, item.value]));
const messages = result => result.warnings.map(warning => warning.message);
const UNSUPPORTED = '未対応の数式を保存済みの計算結果へ置き換えました（結果のないセルは空欄）';

// Parsed-expression tokens. Operand tokens use the value class (0x40) as Excel does in cell formulas.
const ref = (row, column, { absolute = false } = {}) => [0x44, ...u16(row), ...u16(column | (absolute ? 0 : 0xc000))];
const area = (firstRow, lastRow, firstColumn, lastColumn) => [0x25, ...u16(firstRow), ...u16(lastRow), ...u16(firstColumn | 0xc000), ...u16(lastColumn | 0xc000)];
const refN = (rowOffset, columnOffset) => [0x4c, ...u16(rowOffset & 0xffff), ...u16((columnOffset & 0xff) | 0xc000)];
const ref3d = (sheet, row, column) => [0x5a, ...u16(sheet), ...u16(row), ...u16(column | 0xc000)];
const area3d = (sheet, firstRow, lastRow, firstColumn, lastColumn) => [0x3b, ...u16(sheet), ...u16(firstRow), ...u16(lastRow), ...u16(firstColumn), ...u16(lastColumn)];
const int = value => [0x1e, ...u16(value)], num = value => [0x1f, ...f64(value)], text = value => [0x17, ...shortStr(value)];
const func = index => [0x41, ...u16(index)], funcVar = (count, index) => [0x42, count, ...u16(index)];
const name = index => [0x43, ...u16(index), ...u16(0)], nameX = (sheet, index) => [0x59, ...u16(sheet), ...u16(index), ...u16(0)];
const OP = { add: 0x03, sub: 0x04, mul: 0x05, div: 0x06, power: 0x07, concat: 0x08, lt: 0x09, eq: 0x0b, gt: 0x0d, union: 0x10, uminus: 0x13, percent: 0x14, paren: 0x15, missing: 0x16 };
const RESULT = { string: [0, 0, 0, 0, 0, 0, 0xff, 0xff], boolean: value => [1, 0, value ? 1 : 0, 0, 0, 0, 0xff, 0xff], error: code => [2, 0, code, 0, 0, 0, 0xff, 0xff], empty: [3, 0, 0, 0, 0, 0, 0xff, 0xff] };
const formula = (row, column, tokens, { result = f64(0), extra = [] } = {}) => record(R.FORMULA, cell(row, column), result, u16(0), u32(0), u16(tokens.length), tokens, extra);
const importFormulas = async (records, globals = base, sheets) => importSpreadsheetXls(xls({ globals, sheets: sheets ?? [{ name: 'Sheet1', records }] }));

test('operators, parentheses and literals are rebuilt as formula text', async () => {
  const records = [number(0, 0, 2), number(0, 1, 3),
    formula(1, 0, [...ref(0, 0), ...ref(0, 1), ...int(2), OP.mul, OP.add]),
    formula(1, 1, [...ref(0, 0), ...ref(0, 1), OP.add, OP.paren, ...int(2), OP.mul]),
    formula(1, 2, [...ref(0, 0, { absolute: true }), OP.uminus, ...num(1.5), OP.power]),
    formula(1, 3, [...text('a"b'), ...ref(0, 0), OP.concat]),
    formula(1, 4, [...ref(0, 0), ...int(50), OP.percent, OP.mul, ...num(0.25), OP.sub]),
    formula(1, 5, [...ref(0, 0), ...ref(0, 1), OP.lt, 0x1d, 1, OP.eq]),
    formula(1, 6, [...ref(0, 0), ...int(4), OP.div]),
  ];
  const result = await importFormulas(records);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '2', B1: '3', A2: '=A1+B1*2', B2: '=(A1+B1)*2', C2: '=-$A$1^1.5', D2: '="a""b"&A1', E2: '=A1*50%-0.25', F2: '=A1<B1=TRUE', G2: '=A1/4' });
  assert.deepEqual(messages(result), []);
});

test('fixed and variable function calls, optimised SUM and control-flow hints are decoded', async () => {
  const ifTokens = [...ref(0, 0), ...int(0), OP.gt, 0x19, 0x02, ...u16(9), ...text('yes'), 0x19, 0x08, ...u16(10), ...text('no'), 0x19, 0x08, ...u16(3), ...funcVar(3, 1)];
  const records = [number(0, 0, 2), number(1, 0, 3), number(2, 0, 4),
    formula(0, 1, [...area(0, 2, 0, 0), ...funcVar(1, 4)]), formula(1, 1, [...area(0, 2, 0, 0), 0x19, 0x10, ...u16(0)]),
    formula(2, 1, [...ref(0, 0), ...int(2), ...func(27)]), formula(3, 1, ifTokens, { result: RESULT.string }), record(R.STRING, str('yes')),
    formula(4, 1, [...ref(0, 0), OP.missing, ...int(1), ...funcVar(3, 1)]), formula(5, 1, [0x19, 0x40, 0, 1, ...ref(0, 0), 0x19, 0x01, ...u16(0), ...func(24)]),
  ];
  const result = await importFormulas(records);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '2', A2: '3', A3: '4', B1: '=SUM(A1:A3)', B2: '=SUM(A1:A3)', B3: '=ROUND(A1,2)', B4: '=IF(A1>0,"yes","no")', B5: '=IF(A1,,1)', B6: '=ABS(A1)' });
  assert.deepEqual(messages(result), []);
});

test('unions and names are written as text even though the model then keeps their cached result', () => {
  const book = { names: [{ name: 'Total' }, { name: '', builtin: 6 }], externSheets: [], supBooks: [] }, context = { book, sheetNames: [], row: 0, column: 0 };
  assert.equal(formulaText(Uint8Array.from([...area(0, 1, 0, 0), ...ref(2, 0), OP.union, OP.paren, ...funcVar(1, 4)]), undefined, context), 'SUM((A1:A2,A3))');
  assert.equal(formulaText(Uint8Array.from([...name(1), ...int(2), OP.mul]), undefined, context), 'Total*2');
  assert.equal(formulaText(Uint8Array.from(name(2)), undefined, context), undefined);
  assert.equal(formulaText(Uint8Array.from(name(9)), undefined, context), undefined);
});

test('formulas that cannot be expressed keep their cached result and are reported', async () => {
  const records = [
    formula(0, 0, [...int(1), ...func(999)], { result: f64(42) }),
    formula(0, 1, [...int(1), ...func(999)], { result: RESULT.string }), record(R.STRING, str('キャッシュ')),
    formula(0, 2, [...int(1), ...func(999)], { result: RESULT.boolean(true) }),
    formula(0, 3, [...int(1), ...func(999)], { result: RESULT.error(0x2a) }),
    formula(0, 4, [...int(1), ...func(999)], { result: RESULT.empty }),
    formula(0, 5, [0x18, 0x01, 0, 0, 0, 0], { result: f64(7) }), formula(0, 6, [...int(1)], { result: RESULT.string }),
  ];
  const result = await importFormulas(records);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '42', B1: 'キャッシュ', C1: 'TRUE', D1: '#N/A', E1: '', F1: '7', G1: '=1' });
  assert.deepEqual(result.warnings, [{ code: 'unsupported', sheetName: 'Sheet1', message: UNSUPPORTED, count: 6 }]);
});

test('shared formulas are expanded for every cell that refers to them', async () => {
  const shared = record(R.SHRFMLA, u16(0), u16(2), 0, 0, 0, 3, u16(9), ...refN(0, 1), ...int(2), OP.mul);
  const pointer = [0x01, ...u16(0), ...u16(0)];
  const records = [formula(0, 0, pointer), shared, formula(1, 0, pointer), formula(2, 0, pointer), number(0, 1, 1), number(1, 1, 2), number(2, 1, 3),
    formula(4, 0, [0x01, ...u16(9), ...u16(9)], { result: f64(5) })];
  const result = await importFormulas(records);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '=B1*2', A2: '=B2*2', A3: '=B3*2', B1: '1', B2: '2', B3: '3', A5: '5' });
  assert.deepEqual(messages(result), [UNSUPPORTED]);
});

test('relative offsets of shared formulas wrap at the sheet edges', () => {
  const book = { names: [], externSheets: [], supBooks: [] }, context = { book, sheetNames: ['S'], row: 0, column: 0 };
  assert.equal(formulaText(Uint8Array.from(refN(-1, -1)), undefined, context), 'IV65536');
  assert.equal(formulaText(Uint8Array.from(refN(3, 2)), undefined, { ...context, row: 10, column: 4 }), 'G14');
  assert.equal(formulaText(Uint8Array.from([0x4d, ...u16(0), ...u16(1), ...u16(0x4001), ...u16(0x0002)]), undefined, { ...context, row: 4, column: 4 }), 'F$1:$C$2');
});

test('array formulas keep the cached values, as for XLSX', async () => {
  const array = record(R.ARRAY, u16(0), u16(1), 0, 0, u16(0), u32(0), u16(7), ...area(0, 1, 1, 1));
  const pointer = [0x01, ...u16(0), ...u16(0)];
  const result = await importFormulas([formula(0, 0, pointer, { result: f64(10) }), array, formula(1, 0, pointer, { result: f64(20) }), number(0, 1, 10), number(1, 1, 20)]);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '10', A2: '20', B1: '10', B2: '20' });
  assert.deepEqual(result.warnings.map(({ message, count }) => [message, count]), [[UNSUPPORTED, 1]]);
});

test('array constants are written with their own row and column separators', async () => {
  const constant = [0x60, 0, 0, 0, 0, 0, 0, 0], extra = [1, ...u16(1), 0x01, ...f64(1), 0x01, ...f64(2), 0x02, ...str('x'), 0x04, 1, 0, 0, 0, 0, 0, 0, 0];
  const book = { names: [], externSheets: [], supBooks: [] };
  assert.equal(formulaText(Uint8Array.from([...constant, ...funcVar(1, 4)]), Uint8Array.from(extra), { book, sheetNames: [], row: 0, column: 0 }), 'SUM({1,2;"x",TRUE})');
});

test('references to other sheets use the sheet names of this workbook', async () => {
  const links = [record(R.SUPBOOK, u16(3), u16(0x0401)), record(R.EXTERNSHEET, u16(3), u16(0), u16(1), u16(1), u16(0), u16(2), u16(2), u16(0), u16(0), u16(1))];
  const sheets = [
    { name: 'Summary', records: [formula(0, 0, ref3d(0, 0, 0)), formula(0, 1, ref3d(1, 1, 1)), formula(0, 2, [...area3d(2, 0, 1, 0, 0), ...funcVar(1, 4)])] },
    { name: 'Data', records: [number(0, 0, 5), number(1, 0, 6)] }, { name: "It's 2024", records: [number(1, 1, 9)] },
  ];
  const result = await importFormulas([], [...base, ...links], sheets);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '=Data!A1', B1: "='It''s 2024'!B2", C1: "=SUM('Summary:Data'!$A$1:$A$2)" });
});

test('references outside this workbook fall back to the cached result', async () => {
  const links = [record(R.SUPBOOK, u16(1), str('[Other.xls]'), str('Sheet1')), record(R.EXTERNSHEET, u16(1), u16(0), u16(0), u16(0))];
  const result = await importFormulas([formula(0, 0, ref3d(0, 0, 0), { result: f64(3) })], [...base, ...links]);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '3' });
  assert.deepEqual(messages(result), [UNSUPPORTED]);
});

test('add-in functions are named through their external name', () => {
  const book = { names: [], externSheets: [{ book: 0, first: 0xfffe, last: 0xfffe }], supBooks: [{ kind: 'addin', names: ['EDATE'] }] };
  assert.equal(formulaText(Uint8Array.from([...nameX(0, 1), ...ref(0, 0), ...int(1), ...funcVar(3, 255)]), undefined, { book, sheetNames: [], row: 0, column: 0 }), 'EDATE(A1,1)');
  assert.equal(formulaText(Uint8Array.from([...nameX(0, 2), ...funcVar(1, 255)]), undefined, { book, sheetNames: [], row: 0, column: 0 }), undefined);
});

/** NAME record: flags, key, name length, expression length, sheet scope, name characters, expression. */
const nameRecord = (label, tokens, { sheet = 0, flags = 0, builtin } = {}) => record(R.NAME, u16(flags | (builtin === undefined ? 0 : 0x20)), 0,
  builtin === undefined ? label.length : 1, u16(tokens.length), u16(0), u16(sheet), 0, 0, 0, 0, builtin === undefined ? noCch(label) : [0, builtin], tokens);

test('workbook names become named ranges and can be used in formulas', async () => {
  const links = [record(R.SUPBOOK, u16(1), u16(0x0401)), record(R.EXTERNSHEET, u16(1), u16(0), u16(0), u16(0))];
  const names = [nameRecord('Total', area3d(0, 0, 1, 0, 0)), nameRecord('MacroProc', [], { flags: 0x0008 }), nameRecord('Local', area3d(0, 0, 0, 0, 0), { sheet: 1 })];
  const result = await importFormulas([number(0, 0, 1), number(1, 0, 2), formula(0, 1, [...name(1), ...int(2), OP.mul])], [...base, ...links, ...names]);
  assert.deepEqual(result.workbook.namedRanges.map(item => [item.name, item.range]), [['Total', { top: 0, left: 0, bottom: 1, right: 0 }]]);
  // The model has no names in formulas yet, so the reader keeps the cached result exactly as it does for XLSX.
  assert.equal(result.workbook.sheets[0].cells.B1.value, '0');
  assert.deepEqual(messages(result).sort(), ['シート固有・計算式・予約名など未対応の名前定義を省略しました', UNSUPPORTED].sort());
});

test('the built-in print area becomes the print settings of its sheet', async () => {
  const links = [record(R.SUPBOOK, u16(1), u16(0x0401)), record(R.EXTERNSHEET, u16(1), u16(0), u16(0), u16(0))];
  const result = await importFormulas([number(0, 0, 1)], [...base, ...links, nameRecord('', area3d(0, 0, 4, 0, 2), { sheet: 1, builtin: 6 })]);
  assert.deepEqual(result.workbook.sheets[0].printSettings.area, { top: 0, left: 0, bottom: 4, right: 2 });
});

test('text cells that look like formulas stay text, and formula cells with a text format stay formulas', async () => {
  const result = await importFormulas([labelSst(0, 0, 0), formula(0, 1, [...int(1), ...int(2), OP.add])], [...base, sst(['=1+2'])]);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '=1+2', B1: '=1+2' });
  assert.equal(result.workbook.sheets[0].cells.A1.format.numberFormat, 'text');
  assert.notEqual(result.workbook.sheets[0].cells.B1.format.numberFormat, 'text');
});

test('malformed expressions never throw; they keep the cached result', async () => {
  const cases = [[OP.add], [...int(1), ...int(2)], [0x17, 200, 0], [0x44, 1], [...funcVar(5, 4)], [0x7f]];
  const result = await importFormulas(cases.map((tokens, index) => formula(0, index, tokens, { result: f64(index + 1) })));
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '1', B1: '2', C1: '3', D1: '4', E1: '5', F1: '6' });
  assert.equal(result.warnings[0].count, cases.length);
});
