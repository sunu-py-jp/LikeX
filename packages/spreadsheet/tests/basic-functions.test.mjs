import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function load(relative) {
  const output = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=basic-functions-model.mjs').toString('base64')}`);
}
const model = await load('../src/model/index.ts');
const { SUPPORTED_SPREADSHEET_FUNCTIONS } = await load('../src/model/function-definitions.ts');
const { createWorkbook, setCellValues, calculateWorkbook, formatCells, normalizeWorkbook,
  translateFormula, insertRows, renameSheet, moveCells, addSheet, SPREADSHEET_LIMITS } = model;
const fill = cells => { const book = createWorkbook(); return setCellValues(book, book.sheets[0].id, cells); };
const calculate = book => calculateWorkbook(book)[book.sheets[0].id];
const formulas = entries => calculate(fill(Object.fromEntries(entries.map(([formula], index) => [`A${index + 1}`, formula]))));

test('all 15 function-picker examples are complete formulas and calculate without references', () => {
  const expected = { SUM: 60, AVERAGE: 20, MIN: 10, MAX: 30, COUNT: 3, COUNTA: 3, ROUND: 12.35,
    ABS: 10, IF: '達成', IFERROR: 0, AND: true, OR: true, NOT: false, LEN: 5, CONCAT: 'LikeX' };
  assert.deepEqual(SUPPORTED_SPREADSHEET_FUNCTIONS.map(item => item.name).sort(), Object.keys(expected).sort());
  for (const item of SUPPORTED_SPREADSHEET_FUNCTIONS) {
    assert.equal(calculate(fill({ A1: item.example })).A1, expected[item.name], item.name);
    assert.ok(item.syntax.startsWith(`${item.name}(`));
    assert.ok(item.label.length && item.description.length);
  }
});

test('ROUND handles decimal halves, negative values, negative places, and values just below a half', () => {
  const cases = [
    ['=ROUND(1.005,2)', 1.01], ['=ROUND(-1.005,2)', -1.01],
    ['=ROUND(2.675,2)', 2.68], ['=ROUND(-2.675,2)', -2.68],
    ['=ROUND(1.0049999999999997,2)', 1], ['=ROUND(1.4999999999999998,0)', 1],
    ['=ROUND(2.5,0)', 3], ['=ROUND(-2.5,0)', -3],
    ['=ROUND(149,-2)', 100], ['=ROUND(150,-2)', 200], ['=ROUND(-150,-2)', -200],
    ['=ROUND(12.345,1.9)', 12.3], ['=ROUND(125,-1.9)', 130],
    ['=ROUND("12.345","2")', 12.35], ['=round(0.000005,5)', 0.00001],
    ['=ROUND(-0.000004,5)', 0], ['=ROUND(0,0)', 0],
  ];
  const result = formulas(cases);
  cases.forEach(([formula, expected], index) => assert.equal(result[`A${index + 1}`], expected, formula));
});

test('ROUND avoids overflow from scaling, returns finite results, and bounds extreme requested places', () => {
  const cases = [['=ROUND(1e308,2)', 1e308], ['=ROUND(1e308,-308)', 1e308],
    ['=ROUND(1.79e308,-308)', '#NUM!'], ['=ROUND(1e308,-309)', 0],
    ['=ROUND(5e-324,324)', 5e-324], ['=ROUND(5e-324,323)', 1e-323],
    ['=ROUND(12.345,1e100)', 12.345], ['=ROUND(12.345,-1e100)', 0]];
  const result = formulas(cases);
  cases.forEach(([formula, expected], index) => assert.equal(result[`A${index + 1}`], expected, formula));
});

test('scalar functions enforce argument counts, reject ranges and invalid numeric input, and preserve errors', () => {
  const cases = [['=ROUND(2)', '#VALUE!'], ['=ROUND(2,0,1)', '#VALUE!'], ['=ROUND(2,"bad")', '#VALUE!'],
    ['=ABS()', '#VALUE!'], ['=ABS(-2,3)', '#VALUE!'], ['=ABS("bad")', '#VALUE!'],
    ['=ABS(1/0)', '#DIV/0!'], ['=LEN()', '#VALUE!'], ['=LEN("a","b")', '#VALUE!'],
    ['=LEN(B1:B2)', '#VALUE!'], ['=NOT()', '#VALUE!'], ['=NOT(TRUE,FALSE)', '#VALUE!'],
    ['=ROUND(B1:B2,2)', '#VALUE!'], ['=ABS(-1.79e308)', 1.79e308],
    ['=ABS("-12.5")', 12.5], ['=ABS(FALSE)', 0], ['=ABS(B1)', 0]];
  const result = formulas(cases);
  cases.forEach(([formula, expected], index) => assert.equal(result[`A${index + 1}`], expected, formula));
});

test('COUNTA distinguishes empty cells, formatting-only cells, formula empty text, and ordinary errors', () => {
  let book = fill({ A1: '7', A2: '0', A3: 'TRUE', A4: 'text', A5: '=""', A6: '=1/0',
    B1: '=COUNTA(A1:A8)', B2: '=COUNTA(A7,A8)', B3: '=COUNTA(A5)',
    B4: '=COUNTA(1,TRUE,"",1/0)', B5: '=COUNTA("")', B6: '=COUNT(A1:A5)',
    B7: '=COUNTA(Missing!A1)', B8: '=COUNTA()' });
  book = formatCells(book, book.sheets[0].id, ['A7'], { bold: true });
  const result = calculate(book);
  assert.equal(result.B1, 6); assert.equal(result.B2, 0); assert.equal(result.B3, 1);
  assert.equal(result.B4, 4); assert.equal(result.B5, 1); assert.equal(result.B6, 2);
  assert.equal(result.B7, 1); assert.equal(result.B8, '#VALUE!');
});

test('IFERROR evaluates only the needed branch and treats a blank reference as empty text', () => {
  const result = calculate(fill({ A1: '=IFERROR(42,1/0)', A2: '=IFERROR(42,A2)',
    A3: '=IFERROR(1/0,"fallback")', A4: '=IFERROR(B1,"fallback")', A5: '=IFERROR(1/0,B1)',
    A6: '=IFERROR(IFERROR(1/0,2/0),"nested")', A7: '=IFERROR(MISSING,"unknown name")',
    A8: '=IFERROR(UNKNOWN(1),"unknown function")', A9: '=IFERROR(B1:B2,"scalar only")',
    A10: '=IFERROR(1)', A11: '=IFERROR(1,2,3)', A12: '=IFERROR(1/0,2/0)' }));
  assert.equal(result.A1, 42); assert.equal(result.A2, 42); assert.equal(result.A3, 'fallback');
  assert.equal(result.A4, ''); assert.equal(result.A5, ''); assert.equal(result.A6, 'nested');
  assert.equal(result.A7, 'unknown name'); assert.equal(result.A8, 'unknown function');
  assert.equal(result.A9, 'scalar only'); assert.equal(result.A10, '#VALUE!');
  assert.equal(result.A11, '#VALUE!'); assert.equal(result.A12, '#DIV/0!');
});

test('IFERROR catches supported ordinary errors but never hides cycles, parse errors or safety limits', () => {
  for (const code of ['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#NUM!', '#N/A']) {
    assert.equal(calculate(fill({ A1: `=IFERROR(${code},"handled")` })).A1, 'handled', code);
  }
  const result = calculate(fill({ A1: '=IFERROR(A1,"hidden")', A2: '=1+',
    A3: '=IFERROR(A2,"hidden")', A4: '=IFERROR(#LIMIT!,"hidden")', A5: '=IFERROR(#CYCLE!,"hidden")',
    A6: '=COUNTA(A1)', A7: '=COUNTA(#LIMIT!)', A8: '=IFERROR((,"hidden")' }));
  assert.equal(result.A1, '#CYCLE!'); assert.equal(result.A3, '#ERROR!'); assert.equal(result.A4, '#LIMIT!');
  assert.equal(result.A5, '#CYCLE!'); assert.equal(result.A6, '#CYCLE!');
  assert.equal(result.A7, '#LIMIT!'); assert.equal(result.A8, '#ERROR!');
});

test('AND, OR and NOT compose with IF and ignore text or blank values only in references', () => {
  const result = calculate(fill({ A1: 'TRUE', A2: '2', A3: 'note', A4: '=""', A5: '0',
    B1: '=AND(A1:A4)', B2: '=AND(A1:A5)', B3: '=OR(A1:A5)', B4: '=OR(A4:A5)',
    B5: '=AND(A3:A4)', B6: '=OR(C1:C2)', B7: '=NOT(FALSE)', B8: '=NOT(2)',
    B9: '=IF(AND(A1,A2>1,NOT(A5)),"yes","no")', B10: '=OR(FALSE,3>2)',
    B11: '=AND("not a condition")', B12: '=AND("TRUE",TRUE)', B13: '=NOT("false")',
    B14: '=AND()', B15: '=OR()' }));
  assert.equal(result.B1, true); assert.equal(result.B2, false); assert.equal(result.B3, true);
  assert.equal(result.B4, false); assert.equal(result.B5, '#VALUE!'); assert.equal(result.B6, '#VALUE!');
  assert.equal(result.B7, true); assert.equal(result.B8, false); assert.equal(result.B9, 'yes');
  assert.equal(result.B10, true); assert.equal(result.B11, '#VALUE!'); assert.equal(result.B12, true);
  assert.equal(result.B13, true); assert.equal(result.B14, '#VALUE!'); assert.equal(result.B15, '#VALUE!');
});

test('AND and OR evaluate every argument so a decisive earlier value cannot hide an error', () => {
  const result = calculate(fill({ A1: '=AND(FALSE,1/0)', A2: '=OR(TRUE,1/0)',
    A3: '=OR(TRUE,A3)', A4: '=AND(FALSE,#LIMIT!)', A5: '=IFERROR(AND(FALSE,1/0),"handled")' }));
  assert.equal(result.A1, '#DIV/0!'); assert.equal(result.A2, '#DIV/0!');
  assert.equal(result.A3, '#CYCLE!'); assert.equal(result.A4, '#LIMIT!'); assert.equal(result.A5, 'handled');
});

test('LEN counts spaces and Unicode code points and reads blank cells without producing a zero character', () => {
  const result = calculate(fill({ A1: '=LEN("日本語")', A2: '=LEN("A😀 B")', A3: '=LEN("é")',
    A4: '=LEN("")', A5: '=LEN(B1)', A6: '=LEN(TRUE)', A7: '=LEN(120.5)', A8: '=LEN(1/0)' }));
  assert.equal(result.A1, 3); assert.equal(result.A2, 4); assert.equal(result.A3, 2);
  assert.equal(result.A4, 0); assert.equal(result.A5, 0); assert.equal(result.A6, 4);
  assert.equal(result.A7, 5); assert.equal(result.A8, '#DIV/0!');
});

test('CONCAT combines mixed scalar and range values in row order while omitting empty cells', () => {
  const result = calculate(fill({ A1: 'Like', B1: 'X', A2: '12', B2: 'TRUE', A3: '=""',
    D1: '=CONCAT(A1:B3)', D2: '=CONCAT("[",A1," ",B1,"]")', D3: '=CONCAT(C1)',
    D4: '=CONCAT(FALSE,12.5)', D5: '=CONCAT(1/0)', D6: '=CONCAT()',
    D7: '=CONCAT("a""b", "c")', D8: '=concat(A1;B1)' }));
  assert.equal(result.D1, 'LikeX12TRUE'); assert.equal(result.D2, '[Like X]'); assert.equal(result.D3, '');
  assert.equal(result.D4, 'FALSE12.5'); assert.equal(result.D5, '#DIV/0!'); assert.equal(result.D6, '#VALUE!');
  assert.equal(result.D7, 'a"bc'); assert.equal(result.D8, 'LikeX');
});

test('new functions keep existing range, text, token and recursion limits effective', () => {
  for (const expression of ['COUNTA(B1:CV1000)', 'AND(B1:CV1000)', 'OR(B1:CV1000)', 'CONCAT(B1:CV1000)']) {
    const book = normalizeWorkbook({ sheets: [{ ...createWorkbook().sheets[0], rowCount: 1000, columnCount: 100,
      cells: { A1: { value: `=IFERROR(${expression},"hidden")` } } }] });
    assert.equal(calculate(book).A1, '#LIMIT!', expression);
  }
  const result = calculate(fill({ A1: 'x'.repeat(SPREADSHEET_LIMITS.cellLength),
    A2: '=CONCAT(A1,"x")', A3: '=IFERROR(A2,"hidden")',
    A4: '=' + 'IFERROR('.repeat(150) + '1' + ',0)'.repeat(150),
    A5: '=CONCAT(' + '"x",'.repeat(2100) + '"x")' }));
  assert.equal(result.A2, '#LIMIT!'); assert.equal(result.A3, '#LIMIT!');
  assert.equal(result.A4, '#LIMIT!'); assert.equal(result.A5, '#LIMIT!');
});

test('new formulas retain mixed references during copying, structural edits, renaming, and moving cells', () => {
  const formula = '=IFERROR(ROUND(A1/$B$1,2),CONCAT("A1",C$2))';
  assert.equal(translateFormula(formula, 2, 1), '=IFERROR(ROUND(B3/$B$1,2),CONCAT("A1",D$2))');
  let book = fill({ A1: '1.005', B1: '1', C1: '=ROUND(A1/$B$1,2)', D1: '=COUNTA(A1:A3)' });
  const mainId = book.sheets[0].id;
  book = addSheet(book, 'Results');
  const otherId = book.sheets[1].id;
  book = setCellValues(book, otherId, { A1: '=IFERROR(ROUND(Sheet1!A1,2),0)' });
  book = renameSheet(book, mainId, '入力 データ');
  assert.equal(book.sheets[1].cells.A1.value, "=IFERROR(ROUND('入力 データ'!A1,2),0)");
  book = insertRows(book, mainId, 0);
  assert.equal(calculate(book).C2, 1.01); assert.equal(calculate(book).D2, 1);
  assert.equal(calculateWorkbook(book)[otherId].A1, 1.01);
  book = moveCells(book, { sheetId: mainId, top: 1, left: 0, bottom: 3, right: 0 },
    { sheetId: mainId, row: 4, column: 0 });
  assert.equal(calculate(book).C2, 1.01);
  assert.equal(book.sheets[1].cells.A1.value, "=IFERROR(ROUND('入力 データ'!A5,2),0)");
  assert.equal(calculateWorkbook(book)[otherId].A1, 1.01);
});
