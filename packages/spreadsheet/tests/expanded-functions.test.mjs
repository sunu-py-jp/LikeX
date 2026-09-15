import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/model-entry.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { calculateWorkbook, createWorkbook, setCellValues, normalizeWorkbook, insertRows, insertColumns,
  translateFormula, SPREADSHEET_LIMITS, SUPPORTED_SPREADSHEET_FUNCTIONS } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const fill = values => { const book = createWorkbook(); return setCellValues(book, book.sheets[0].id, values); };
const calculate = values => { const book = fill(values); return calculateWorkbook(book)[book.sheets[0].id]; };
function expectCases(cases, values = {}) {
  // Keep fixtures separate from formula cells so metadata and blanks are deliberate.
  const result = calculate({ ...values, ...Object.fromEntries(cases.map(([formula], i) => [`Z${i + 1}`, formula])) });
  for (let i = 0; i < cases.length; i++) assert.deepEqual(result[`Z${i + 1}`], cases[i][1], cases[i][0]);
}

test('all 57 public catalogue examples evaluate in an otherwise blank workbook', () => {
  assert.equal(SUPPORTED_SPREADSHEET_FUNCTIONS.length, 57);
  assert.equal(new Set(SUPPORTED_SPREADSHEET_FUNCTIONS.map(x => x.name)).size, 57);
  assert.equal(new Set(SUPPORTED_SPREADSHEET_FUNCTIONS.map(x => x.category)).size, 7);
  for (const item of SUPPORTED_SPREADSHEET_FUNCTIONS) {
    const result = calculate({ A1: item.example }).A1;
    assert.ok(!String(result).startsWith('#'), `${item.name}: ${result}`);
    assert.ok(item.syntax.startsWith(`${item.name}(`));
    assert.ok(item.category && item.label && item.description);
  }
});

test('single-condition aggregation preserves interior blanks and independently ignores nonnumeric totals', () => {
  expectCases([
    ['=COUNTIF(A1:A6,"done")', 3], ['=SUMIF(A1:A6,"done",B1:B6)', 40],
    ['=AVERAGEIF(A1:A6,"done",B1:B6)', 20], ['=SUMIF(A1:A6,"",B1:B6)', 70],
    ['=COUNTBLANK(A1:A6)', 2], ['=COUNTBLANK(B1:B6)', 0],
    ['=COUNTIF(B1:B6,">=20")', 4], ['=SUMIF(B1:B6,">=20")', 140],
    ['=AVERAGEIF(B1:B6,">=20")', 35], ['=AVERAGEIF(A1:A6,"missing",B1:B6)', '#DIV/0!'],
    ['=SUMIF(A1:A6,"missing",B1:B6)', 0], ['=COUNTIF(A1:A6,"<>done")', 3],
  ], { A1: 'done', A3: 'DONE', A4: 'pending', A5: '=""', A6: 'done',
    B1: '10', B2: '20', B3: '30', B4: '40', B5: '50', B6: 'text' });
});

test('multiple criteria require every condition, support two-dimensional ranges, and retain blank alignment', () => {
  expectCases([
    ['=COUNTIFS(A1:A5,"done",B1:B5,">=20")', 2],
    ['=SUMIFS(C1:C5,A1:A5,"done",B1:B5,">=20")', 70],
    ['=AVERAGEIFS(C1:C5,A1:A5,"done",B1:B5,">=20")', 35],
    ['=COUNTIFS(A1:B2,">=10",D1:E2,"yes")', 2],
    ['=SUMIFS(F1:G2,D1:E2,"yes",A1:B2,">=10")', 7],
    ['=AVERAGEIFS(C1:C5,A1:A5,"missing")', '#DIV/0!'],
    ['=COUNTIFS(B1:B5,">="&20)', 3],
  ], { A1:'done', A2:'10', A3:'done', A4:'pending', A5:'done', B1:'10', B2:'20', B3:'30', B5:'40',
    C1:'10', C2:'20', C3:'30', C4:'40', C5:'40', D1:'yes', E1:'no', D2:'yes', E2:'yes',
    F1:'1', G1:'2', F2:'3', G2:'4' });
});

test('criteria are case-insensitive and support comparisons, Unicode wildcards, literal wildcard escaping and blanks', () => {
  expectCases([
    ['=COUNTIF(A1:A9,"a*")', 3], ['=COUNTIF(A1:A9,"A?C")', 3],
    ['=COUNTIF(A1:A9,"a~*c")', 1], ['=COUNTIF(A1:A9,"~?")', 1],
    ['=COUNTIF(A1:A9,"~~")', 1], ['=COUNTIF(A1:A9,"*")', 6],
    ['=COUNTIF(A1:A9,0)', 1], ['=COUNTIF(A1:A9,"")', 2],
    ['=COUNTIF(A1:A9,TRUE)', 1], ['=COUNTIF(A1:A9,B1)', 1],
    ['=COUNTIF(C1:C3,">=b")', 2], ['=COUNTIF(C1:C3,"<>b")', 2],
  ], { A1:'Abc', A2:'a*c', A3:'a😀c', A4:'?', A5:'~', A6:'0', A7:'TRUE', A8:'=""', C1:'a', C2:'B', C3:'c' });
});

test('condition functions reject malformed arguments and mismatched range shapes instead of guessing', () => {
  expectCases([
    ['=COUNTIF(A1:A3)', '#VALUE!'], ['=COUNTIF(A1:A3,1,1)', '#VALUE!'],
    ['=COUNTIF(1,1)', '#VALUE!'], ['=COUNTIFS(A1:A3,1,B1:B3)', '#VALUE!'],
    ['=SUMIFS(A1:A3)', '#VALUE!'], ['=AVERAGEIFS(A1:A3,B1:B3)', '#VALUE!'],
    ['=COUNTIFS(A1:A3,1,B1:B2,1)', '#VALUE!'], ['=COUNTIFS(A1:A3,1,B1:D1,1)', '#VALUE!'],
    ['=SUMIF(A1:A3,1,B1:B2)', '#VALUE!'], ['=AVERAGEIF(A1:A3,1,B1)', '#VALUE!'],
    ['=COUNTBLANK()', '#VALUE!'], ['=COUNTBLANK(2)', '#VALUE!'],
    ['=SUMIFS(A1:A3,B1:B2,1)', '#VALUE!'], ['=COUNTIF(A1:A3,1/0)', '#DIV/0!'],
  ]);
});

test('conditional aggregates count ordinary errors only by explicit criteria and propagate selected total errors', () => {
  expectCases([
    ['=COUNTIF(A1:A3,"#DIV/0!")', 1], ['=COUNTBLANK(A1:A3)', 1],
    ['=SUMIF(B1:B3,"yes",A1:A3)', '#DIV/0!'],
    ['=SUMIF(B1:B3,"no",A1:A3)', 10],
    ['=AVERAGEIF(B1:B3,"no",A1:A3)', 10],
  ], { A1:'=1/0', A2:'10', B1:'yes', B2:'no', B3:'no' });
});

test('new numeric functions handle negative rounding, fractional places, tiny and large magnitudes', () => {
  expectCases([
    ['=ROUNDUP(1.001,2)',1.01], ['=ROUNDUP(-1.001,2)',-1.01], ['=ROUNDDOWN(-1.009,2)',-1],
    ['=ROUNDUP(121,-2)',200], ['=ROUNDDOWN(199,-2)',100], ['=ROUNDUP(1.001,2.9)',1.01],
    ['=ROUNDUP(0.00001,2)',0.01], ['=ROUNDDOWN(-0.00001,2)',0],
    ['=ROUNDUP(1e308,2)',1e308], ['=ROUNDUP(1e308,-309)','#NUM!'],
    ['=ROUNDDOWN(1e308,-309)',0], ['=ROUNDUP(0,2)',0], ['=INT(-1.2)',-2],
    ['=MOD(-3,2)',1], ['=MOD(3,-2)',-1], ['=MOD(-3,-2)',-1], ['=MOD(-4,2)',0],
    ['=MOD(1,0)','#DIV/0!'], ['=PRODUCT(2,3,4)',24], ['=PRODUCT(A1:A5)',6],
    ['=PRODUCT(2,"3",TRUE)',6], ['=PRODUCT(B1:B2)',0], ['=PRODUCT(1e308,10)','#NUM!'],
    ['=PRODUCT(A1:A5,0)',0], ['=PRODUCT()','#VALUE!'], ['=ROUNDUP(1)','#VALUE!'],
    ['=ROUNDDOWN(1,2,3)','#VALUE!'], ['=INT("x")','#VALUE!'], ['=MOD(A1:A2,3)','#VALUE!'],
  ], { A1:'2', A2:'3', A3:'text', A4:'TRUE', A5:'=""' });
});

test('text slicing uses Unicode code points and validates nonnegative lengths and one-based positions', () => {
  expectCases([
    ['=LEFT("A😀BC",2)','A😀'], ['=RIGHT("A😀BC",3)','😀BC'], ['=MID("A😀BC",2,2)','😀B'],
    ['=LEFT("text")','t'], ['=RIGHT("text")','t'], ['=LEFT("text",0)',''], ['=RIGHT("text",0)',''],
    ['=MID("text",10,3)',''], ['=MID("text",2.9,1.9)','e'], ['=LEFT(A1)',''],
    ['=RIGHT(TRUE,2)','UE'], ['=LEFT("text",-1)','#VALUE!'], ['=RIGHT("text",-1)','#VALUE!'],
    ['=MID("text",0,2)','#VALUE!'], ['=MID("text",1,-2)','#VALUE!'], ['=MID("text",2)','#VALUE!'],
    ['=UPPER("LikeX")','LIKEX'], ['=LOWER("LikeX")','likex'],
    ['=TRIM("  Like   X  ")','Like X'], ['=TRIM("　 x  ")','　 x '],
  ]);
});

test('text search and substitution distinguish case, wildcard escaping, occurrence counts and missing matches', () => {
  expectCases([
    ['=SUBSTITUTE("a-b-a","a","x")','x-b-x'], ['=SUBSTITUTE("a-b-a","a","x",2)','a-b-x'],
    ['=SUBSTITUTE("a-b-a","a","x",5)','a-b-a'], ['=SUBSTITUTE("abc","","x")','abc'],
    ['=SUBSTITUTE("aa","a","",1)','a'], ['=SUBSTITUTE("aa","a","$&")','$&$&'],
    ['=SUBSTITUTE("aa","a","x",0)','#VALUE!'], ['=FIND("X","LikeX")',5],
    ['=FIND("x","LikeX")','#VALUE!'], ['=FIND("😀","A😀B")',2], ['=FIND("a","abca",2)',4],
    ['=SEARCH("b","İb")',2], ['=SEARCH("x","LikeX")',5], ['=SEARCH("b?d","aBCdE")',2], ['=SEARCH("~*","a*b")',2],
    ['=SEARCH("b*d","aBCcdE")',2], ['=SEARCH("?c","a😀c")',2],
    ['=SEARCH("","abc",2)',2], ['=SEARCH("a","abc",0)','#VALUE!'],
    ['=SEARCH("a","abc",4)','#VALUE!'], ['=SEARCH("z","abc")','#VALUE!'],
    ['=SEARCH("*","",1)',1], ['=FIND("a","abc",1,2)','#VALUE!'],
  ]);
});

test('TEXTJOIN retains blank positions when requested, joins row-major matrices and bounds its result', () => {
  expectCases([
    ['=TEXTJOIN(",",TRUE,A1:B3)','1,TRUE,x'], ['=TEXTJOIN(",",FALSE,A1:B3)','1,TRUE,,x,,'],
    ['=TEXTJOIN("",TRUE,"Like","X")','LikeX'], ['=TEXTJOIN(1,FALSE,A2,B3)','1'],
    ['=TEXTJOIN(",",TRUE,A2:B3)','x'], ['=TEXTJOIN(",",TRUE,A2:A3)',''],
    ['=TEXTJOIN(",",FALSE,1/0)','#DIV/0!'], ['=TEXTJOIN(",",TRUE)','#VALUE!'],
    ['=VALUE(" -12.5e2 ")',-1250], ['=VALUE("1,000")','#VALUE!'], ['=VALUE("$12")','#VALUE!'],
    ['=VALUE("2026-01-01")','#VALUE!'], ['=VALUE("x")','#VALUE!'],
  ], { A1:'1', B1:'TRUE', B2:'x', A3:'=""' });
  const huge = 'x'.repeat(SPREADSHEET_LIMITS.cellLength);
  expectCases([['=TEXTJOIN(",",FALSE,A1,"x")','#LIMIT!'], ['=SUBSTITUTE("xx","x",A1)','#LIMIT!'],
    ['=IFERROR(TEXTJOIN(",",FALSE,A1,"x"),0)','#LIMIT!']], { A1:huge });
});

test('type checks do not coerce values and IFNA/IFS evaluate only the selected branch', () => {
  expectCases([
    ['=ISBLANK(A1)',true], ['=ISBLANK(A2)',false], ['=ISBLANK(A3)',false],
    ['=ISNUMBER("1")',false], ['=ISNUMBER(1)',true], ['=ISTEXT("1")',true],
    ['=ISTEXT(A1)',false], ['=ISTEXT(A2)',true], ['=ISNUMBER(TRUE)',false],
    ['=ISERROR(A3)',true], ['=ISERROR(1/0)',true], ['=ISBLANK(1/0)',false],
    ['=ISERROR(Missing!A1)',true], ['=ISNUMBER(Missing!A1)',false],
    ['=IFNA(#N/A,"missing")','missing'], ['=IFNA(42,1/0)',42], ['=IFNA(1/0,0)','#DIV/0!'],
    ['=IFNA(A1,"missing")',''], ['=IFS(FALSE,1/0,TRUE,42)',42], ['=IFS(FALSE,1)','#N/A'],
    ['=IFS(TRUE,1,FALSE)', '#VALUE!'], ['=IFS(TRUE,42,1/0,0)',42],
    ['=IFNA(1)','#VALUE!'], ['=ISERROR(1,2)','#VALUE!'], ['=ISBLANK()','#VALUE!'],
  ], { A2:'=""', A3:'=1/0' });
});

const lookupValues = { A1:'a', B1:'10', A3:'b', B3:'20', A4:'B', B4:'30', A5:'c', B5:'40',
  D1:'1', E1:'2', F1:'3', D2:'10', E2:'20', F2:'30' };
test('INDEX, MATCH and exact V/H lookups keep row and column alignment through empty cells', () => {
  expectCases([
    ['=INDEX(A1:B5,3,2)',20], ['=INDEX(A1:B5,2,2)',0], ['=INDEX(D1:F1,2)',2], ['=INDEX(B1:B5,3)',20],
    ['=MATCH("b",A1:A5,0)',3], ['=MATCH("b*",A1:A5,0)',3], ['=MATCH("missing",A1:A5,0)','#N/A'],
    ['=VLOOKUP("b",A1:B5,2,FALSE)',20], ['=HLOOKUP(2,D1:F2,2,FALSE)',20],
    ['=VLOOKUP(0,A1:B5,2,FALSE)',0], ['=INDEX(A1:B5,0,1)','#VALUE!'],
    ['=INDEX(A1:B5,2)','#VALUE!'], ['=INDEX(A1:B5,6,1)','#REF!'],
    ['=MATCH("a",A1:B5,0)','#VALUE!'], ['=VLOOKUP("a",A1:B5,3,FALSE)','#REF!'],
    ['=HLOOKUP(2,D1:F2,0,FALSE)','#VALUE!'], ['=MATCH(1,D1:F1,7)','#VALUE!'],
  ], lookupValues);
});

test('approximate lookups implement sorted ascending/descending defaults and duplicate positions', () => {
  expectCases([
    ['=MATCH(25,A1:A5)',3], ['=MATCH(20,A1:A5,1)',3], ['=MATCH(5,A1:A5,1)','#N/A'],
    ['=MATCH(25,D1:D4,-1)',2], ['=VLOOKUP(25,A1:B5,2)',300],
    ['=VLOOKUP(20,A1:B5,2,TRUE)',300], ['=VLOOKUP(5,A1:B5,2,TRUE)','#N/A'],
    ['=HLOOKUP(2.5,F1:I2,2)',200],
  ], { A1:'10',A2:'20',A3:'20',A4:'30',A5:'40',B1:'100',B2:'200',B3:'300',B4:'400',B5:'500',
    D1:'40',D2:'30',D3:'20',D4:'10',F1:'1',G1:'2',H1:'3',I1:'4',F2:'100',G2:'200',H2:'300',I2:'400' });
});

test('XLOOKUP supports exact/nearest/wildcard modes, reverse direction, omitted defaults and lazy missing values', () => {
  expectCases([
    ['=XLOOKUP("b",A1:A5,B1:B5)',20], ['=XLOOKUP("b",A1:A5,B1:B5,,0,-1)',30],
    ['=XLOOKUP("none",A1:A5,B1:B5,"missing")','missing'], ['=XLOOKUP("a",A1:A5,B1:B5,1/0)',10],
    ['=XLOOKUP("none",A1:A5,B1:B5)','#N/A'], ['=XLOOKUP("b*",A1:A5,B1:B5,,2)',20],
    ['=XLOOKUP("b*",A1:A5,B1:B5,,2,-1)',30], ['=XLOOKUP(2.5,D1:F1,D2:F2,,-1)',20],
    ['=XLOOKUP(2.5,D1:F1,D2:F2,,1)',30], ['=XLOOKUP(9,D1:F1,D2:F2,"none",1)','none'],
    ['=XLOOKUP("b",A1:A5,B1:B4)','#VALUE!'], ['=XLOOKUP("b",A1:A5,B1:C5)','#VALUE!'],
    ['=XLOOKUP("b",A1:A5,B1:B5,,0,2)','#VALUE!'], ['=XLOOKUP("b",A1:A5,B1:B5,,3)','#VALUE!'],
    ['=XLOOKUP(2,D1:F1,D2:F2,,0,-1)',20],
  ], lookupValues);
});

test('lookups escape literal wildcards and propagate selected error values without evaluating fallback branches', () => {
  expectCases([
    ['=MATCH("a~*",A1:A3,0)',1], ['=VLOOKUP("a~?",A1:B3,2,FALSE)',2],
    ['=XLOOKUP("a?",A1:A3,B1:B3,,0)',2], ['=INDEX(B1:B3,3)','#DIV/0!'],
    ['=XLOOKUP("bad",A1:A3,B1:B3)', '#DIV/0!'], ['=VLOOKUP("bad",A1:B3,2,FALSE)','#DIV/0!'],
    ['=INDEX(B1:B3,1)',1], ['=XLOOKUP("a*",A1:A3,B1:B3,1/0)',1],
  ], { A1:'a*',A2:'a?',A3:'bad',B1:'1',B2:'2',B3:'=1/0' });
});

test('date functions use the shared timezone-independent 1900 system including serial 0 and fictitious leap day', () => {
  expectCases([
    ['=DATE(1900,1,1)',1], ['=DATE(1900,2,28)',59], ['=DATE(1900,2,29)',60],
    ['=DATE(1900,3,1)',61], ['=DATE(1900,3,0)',60], ['=DATE(1900,1,60)',60],
    ['=DATE(2024,2,29)',45351], ['=DATE(2024,14,1)',45689], ['=DATE(2024,0,1)',45261],
    ['=DATE(108,1,2)',39449], ['=YEAR(DATE(2026,9,15))',2026], ['=MONTH(60)',2], ['=DAY(60)',29],
    ['=YEAR(0)',1900], ['=MONTH(0)',1], ['=DAY(0)',0], ['=DAY(61.9)',1],
    ['=DATE(-1,1,1)','#NUM!'], ['=DATE(10000,1,1)','#NUM!'], ['=DATE(9999,12,31)',2958465],
    ['=DATE(9999,12,32)','#NUM!'], ['=DATE(1900,1,-1)','#NUM!'], ['=DATE(2024,1e100,1)','#NUM!'],
    ['=YEAR(-0.1)','#NUM!'], ['=YEAR(2958466)','#NUM!'], ['=MONTH("2026-09-15")','#VALUE!'],
    ['=DATE(2024,1)','#VALUE!'], ['=DAY(1,2)','#VALUE!'],
  ]);
});

test('ROW/COLUMN use the formula cell position; reference metadata never calculates the cells being described', () => {
  const result = calculate({ D5:'=ROW()', E6:'=COLUMN()', A1:'=A1', A2:'=1/0',
    G1:'=ROW(A1:A2)', G2:'=ROWS(A1:A2)', G3:'=COLUMN(A1:A2)', G4:'=COLUMNS(A1:A2)',
    G5:'=ROW(G5)', G6:'=COLUMN(G6)', G7:'=ROWS(G7:H7)', G8:'=COLUMNS(G8:H8)' });
  assert.equal(result.D5,5); assert.equal(result.E6,5); assert.equal(result.A1,'#CYCLE!');
  assert.equal(result.G1,1); assert.equal(result.G2,2); assert.equal(result.G3,1); assert.equal(result.G4,1);
  assert.equal(result.G5,5); assert.equal(result.G6,7); assert.equal(result.G7,1); assert.equal(result.G8,2);
  expectCases([['=ROW(3)','#VALUE!'],['=COLUMN(A1,B1)','#VALUE!'],['=ROWS()','#VALUE!'],
    ['=COLUMNS(1)','#VALUE!'],['=ROW(Missing!A1)','#REF!'],['=ROWS(A1:ZZ300)','#REF!']]);
  const book = normalizeWorkbook({ sheets:[{...createWorkbook().sheets[0],rowCount:1000,columnCount:100,
    cells:{ A1:{value:'=ROWS(B1:CV1000)'}, A2:{value:'=COLUMNS(B1:CV1000)'} }}]});
  const values = calculateWorkbook(book)[book.sheets[0].id]; assert.equal(values.A1,1000); assert.equal(values.A2,99);
});

test('new function references translate and follow row/column insertions without freezing ROW() to its old position', () => {
  const formula = '=XLOOKUP($A1,B$1:B$3,C1:C3,,0,-1)';
  assert.equal(translateFormula(formula,2,1),'=XLOOKUP($A3,C$1:C$3,D3:D5,,0,-1)');
  let book = fill({ A1:'=ROW()', B1:'=COLUMN()', C1:'=ROWS(A1:A3)' });
  const id = book.sheets[0].id;
  book = insertRows(book,id,0); book = insertColumns(book,id,0);
  const result = calculateWorkbook(book)[id]; assert.equal(result.B2,2); assert.equal(result.C2,3); assert.equal(result.D2,3);
});

test('new handlers cannot suppress cycles, malformed formulas, range limits or computation limits', () => {
  for (const fn of ['ISBLANK','ISNUMBER','ISTEXT','ISERROR','COUNTBLANK']) {
    assert.equal(calculate({ A1:`=${fn}(A1)` }).A1,'#CYCLE!',fn);
  }
  for (const formula of ['=IFNA(#CYCLE!,0)','=IFS(TRUE,#LIMIT!,TRUE,0)','=ISERROR(#LIMIT!)',
    '=IFERROR(SEARCH("*a*a*a*a*a*b",A1),0)']) {
    const result = calculate({ A1:'a'.repeat(1000),B1:formula }).B1;
    assert.ok(['#CYCLE!','#LIMIT!'].includes(result),formula+': '+result);
  }
  for (const formula of ['=SUMIF(B1:CV1000,">0")','=XLOOKUP(0,B1:B1000,C1:C1000)','=COUNTBLANK(B1:CV1000)']) {
    const book = normalizeWorkbook({sheets:[{...createWorkbook().sheets[0],rowCount:1000,columnCount:100,
      cells:{ A1:{value:formula}, B1:{value:'=A1'} }}]});
    assert.ok(['#CYCLE!','#LIMIT!'].includes(calculateWorkbook(book)[book.sheets[0].id].A1),formula);
  }
  assert.equal(calculate({ A1:'=ISERROR((1)' }).A1,'#ERROR!');
});

test('lookup reads only its selected return cell and only the keys needed by an exact search', () => {
  const values = calculate({ A1:'=INDEX(A1:B1,1,2)', B1:'42', A2:'k', A3:'x',
    B2:'42', B3:'=XLOOKUP("k",A2:A3,B2:B3)',
    C1:'=MATCH("k",A2:C2,0)', C2:'=C2',
    D1:'=VLOOKUP("k",A2:D3,2,FALSE)', D2:'=D2',
    E1:'=HLOOKUP("k",A2:D3,2,FALSE)' });
  assert.equal(values.A1,42); assert.equal(values.B3,42); assert.equal(values.C1,1);
  assert.equal(values.D1,42); assert.equal(values.E1,'x');
});

test('text wildcard does not turn error values or truly empty cells into text; VALUE distinguishes blank cells', () => {
  expectCases([
    ['=COUNTIF(A1:A5,"*")',2], ['=COUNTIF(A1:A5,"#N/A")',1],
    ['=COUNTBLANK(A1:A5)',2], ['=VALUE("")','#VALUE!'], ['=VALUE(" ")','#VALUE!'],
    ['=VALUE(A5)',0], ['=VALUE(A3)','#VALUE!'],
  ], { A1:'text',A2:'=#N/A',A3:'=""',A4:'12' });
});

test('separator-looking string arguments remain text when parsing omitted function arguments', () => {
  expectCases([
    ['=CONCAT(",",";","(",")")',',;()'], ['=TEXTJOIN(",",FALSE,"a","b")','a,b'],
    ['=IF(TRUE,,1)',0], ['=IF(FALSE,1,)',0], ['=XLOOKUP(1,A1:A2,B1:B2,,0,-1)',20],
  ], { A1:'1',A2:'1',B1:'10',B2:'20' });
});

test('numeric criteria distinguish real blanks, numeric text and actual numeric cells', () => {
  expectCases([
    ['=COUNTIF(A1:A6,0)',1], ['=COUNTIF(A1:A6,"<>0")',5],
    ['=COUNTIF(A1:A6,6)',2], ['=COUNTIF(A1:A6,">5")',1],
    ['=SUMIF(A1:A6,">5",B1:B6)',40], ['=COUNTIF(A1:A6,"<>6")',5],
  ], { A2:'0', A3:"'6", A4:'6', A5:'=""',A6:'text',B3:'30',B4:'40' });
});

test('repeated long text operations participate in the workbook computation budget', () => {
  const values = { A1:'x'.repeat(SPREADSHEET_LIMITS.cellLength) };
  for (let row = 1; row <= 300; row++) values[`B${row}`] = '=IFERROR(LEN($A$1),0)';
  const results = calculate(values);
  assert.equal(results.B1,SPREADSHEET_LIMITS.cellLength);
  assert.equal(results.B300,'#LIMIT!');
});
