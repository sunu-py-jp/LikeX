import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: {
  contents: 'export * from "./src/export/xlsx/worksheet"; export * from "./src/export/xlsx/styles"; export * from "./src/export/xlsx/comments"; export * from "./src/export/xlsx/xml"; export * from "./src/export/xlsx/formula"; export * from "./src/model";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-worksheet-entry.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false });
const { worksheetXml, createXlsxStyles, commentParts, xml, xlsxText, xlsxColor, xlsxFormula, normalizeWorkbook, calculateWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheet = (id = 'one', name = 'Sheet 1', cells = {}) => ({ id, name, rowCount: 10, columnCount: 10, cells });
const book = (cells = {}, extra = {}) => normalizeWorkbook({ sheets: [{ ...sheet('one', 'Sheet 1', cells), ...extra }] });
const render = workbook => worksheetXml(workbook, workbook.sheets[0], createXlsxStyles(workbook), calculateWorkbook(workbook));
const cell = (document, address) => document.match(new RegExp(`<c r="${address}"[^>]*>[\\s\\S]*?</c>`))?.[0];

test('XML escaping preserves Japanese, emoji and spreadsheet escape literals and rejects invalid text', () => {
  assert.equal(xml('<>&"\'日本語😀'), '&lt;&gt;&amp;&quot;&apos;日本語😀');
  assert.equal(xlsxText('literal _x0041_\r\n'), 'literal _x005F_x0041__x000D_\n');
  for (const value of ['\0', '\x01', '\ud800', '\udc00', '\ufffe', '\uffff', Number.NaN, Infinity]) assert.throws(() => xml(value));
});

test('CSS colors become RGB plus alpha with explicit fallbacks', () => {
  assert.deepEqual(xlsxColor('#1234'), { rgb: '112233', alpha: 68 / 255 });
  assert.deepEqual(xlsxColor('rgba(255, 0, 0, 0.5)'), { rgb: 'FF0000', alpha: 0.5 });
  assert.deepEqual(xlsxColor('rgb(100% 0% 0% / 50%)'), { rgb: 'FF0000', alpha: 0.5 });
  assert.deepEqual(xlsxColor('hsl(120 100% 50%)'), { rgb: '00FF00', alpha: 1 });
  assert.deepEqual(xlsxColor('oklab(100% 0 0)'), { rgb: 'FFFFFF', alpha: 1 });
  assert.deepEqual(xlsxColor('oklch(0% 0 0)'), { rgb: '000000', alpha: 1 });
  assert.deepEqual(xlsxColor('navy'), { rgb: '000080', alpha: 1 });
  assert.equal(xlsxColor('transparent').alpha, 0);
  for (const value of ['currentColor', 'var(--host-color)', 'url(https://example.test)', 'rgb(nope)'])
    assert.deepEqual(xlsxColor(value, '123456'), { rgb: '123456', alpha: 1 });
});

test('worksheet writes numbers, booleans and explicit strings without activating arbitrary cell text', () => {
  const workbook = book({ A1: { value: '123.5' }, B1: { value: '00123' }, C1: { value: '1234567890123456' }, D1: { value: "'=SUM(A1)" },
    A2: { value: 'true' }, B2: { value: '<a>&_x0041_\r\n 日本語😀' }, C2: { value: '+cmd|ignored' }, D2: { value: '1e309' } });
  const contents = render(workbook);
  assert.match(cell(contents, 'A1'), /<v>123.5<\/v>/);
  for (const address of ['B1', 'C1', 'D1', 'B2', 'C2', 'D2']) assert.match(cell(contents, address), /t="inlineStr"/);
  assert.match(cell(contents, 'D1'), />=SUM\(A1\)<\/t>/);
  assert.match(cell(contents, 'A2'), /t="b"><v>1<\/v>/);
  assert.match(cell(contents, 'B2'), /&lt;a&gt;&amp;_x005F_x0041__x000D_/);
  assert.match(contents, /xml:space="preserve"/);
});

test('numeric underflow preserves the original value as text while exact zero remains numeric', () => {
  const contents = render(book({ A1: { value: '1e-400' }, B1: { value: '-1e-400' }, C1: { value: '0e-400' } }));
  assert.match(cell(contents, 'A1'), /t="inlineStr"/);
  assert.match(cell(contents, 'A1'), />1e-400<\/t>/);
  assert.match(cell(contents, 'B1'), />-1e-400<\/t>/);
  assert.match(cell(contents, 'C1'), /<v>0<\/v>/);
});

test('formulas use the existing grammar with local references, invariant separators and cached result types', () => {
  const workbook = normalizeWorkbook({ sheets: [sheet('one', 'Sheet 1', {
    A1: { value: '2' }, B1: { value: '=SUM(A1;3)' }, C1: { value: '=A1>1' },
    D1: { value: '=1/0' }, E1: { value: '=CONCAT("日本";"語")' }, F1: { value: "='Other''s sheet'!A1" },
  }), sheet('two', "Other's sheet", { A1: { value: '7' } })] });
  const contents = render(workbook);
  assert.match(cell(contents, 'B1'), /<f>SUM\(A1,3\)<\/f><v>5<\/v>/);
  assert.match(cell(contents, 'C1'), /t="b"><f>A1&gt;1<\/f><v>1<\/v>/);
  assert.match(cell(contents, 'D1'), /t="e"><f>1\/0<\/f><v>#DIV\/0!<\/v>/);
  assert.match(cell(contents, 'E1'), /t="str"><f>_xlfn.CONCAT\(&quot;日本&quot;,&quot;語&quot;\)<\/f><v>日本語<\/v>/);
  assert.match(cell(contents, 'F1'), /<f>&apos;Other&apos;&apos;s sheet&apos;!A1<\/f><v>7<\/v>/);
});

test('unsupported or malformed formulas and external targets fail instead of becoming active Excel content', () => {
  for (const value of ['=WEBSERVICE("https://example.test")', '=HYPERLINK("https://example.test")', '=cmd|\'/C calc\'!A1',
    "='[remote.xlsx]Sheet1'!A1", '=SUM(', '=SUM(A1)junk', '=NamedRange', '=SUM(A99999)', '=Missing!A1', '=#CYCLE!']) {
    assert.throws(() => render(book({ A1: { value } })), /Excelに書き出せない数式/, value);
  }
  const workbook = book({ A1: { value: '=1+2' } });
  assert.equal(xlsxFormula('=SUM(1;2)', workbook, workbook.sheets[0]), 'SUM(1,2)');
});

test('bounded-calculator sentinel values omit only caches and allow Excel to calculate supported formulas', () => {
  const workbook = book({ A1: { value: '=1+2' } }), styles = createXlsxStyles(workbook);
  for (const value of ['#LIMIT!', '#CYCLE!', '#ERROR!']) {
    const contents = worksheetXml(workbook, workbook.sheets[0], styles, { one: { A1: value } });
    assert.match(cell(contents, 'A1'), /<f>1\+2<\/f><\/c>/);
    assert.doesNotMatch(contents, /<v>/);
  }
});

test('formula grouping keeps evaluator precedence and qualified ranges inherit their first sheet', () => {
  const workbook = normalizeWorkbook({ sheets: [{ ...sheet(), rowCount: 1 }, { ...sheet('two', 'Long sheet'), rowCount: 20 }] });
  const first = workbook.sheets[0];
  assert.equal(xlsxFormula('=-2^2', workbook, first), '-(2^2)');
  assert.equal(xlsxFormula('=2^3^2', workbook, first), '2^(3^2)');
  assert.equal(xlsxFormula('=(1+2)*3', workbook, first), '(1+2)*3');
  assert.equal(xlsxFormula("=SUM('Long sheet'!A1:A20)", workbook, first), "SUM('Long sheet'!A1:A20)");
  assert.throws(() => xlsxFormula(`=SUM(${Array(256).fill('1').join(',')})`, workbook, first), /Excelに書き出せない数式/);
  assert.throws(() => xlsxFormula(`=${'ABS('.repeat(65)}1${')'.repeat(65)}`, workbook, first), /Excelに書き出せない数式/);
});

test('worksheet ordering preserves dimensions, merges, drawing links and schema element ordering', () => {
  const workbook = book({ C3: { value: 'last' }, B1: { value: 'first' }, A3: { value: 'middle' } }, {
    columnWidths: { 2: 200 }, rowHeights: { 1: 40 }, merges: [{ top: 4, left: 0, bottom: 4, right: 2 }],
  });
  const before = JSON.stringify(workbook), styles = createXlsxStyles(workbook);
  const contents = worksheetXml(workbook, workbook.sheets[0], styles, calculateWorkbook(workbook), { drawingId: 'rIdDrawing', commentsDrawingId: 'rIdCommentsDrawing' });
  assert.match(contents, /defaultRowHeight="21"/);
  assert.match(contents, /<row r="2" ht="30" customHeight="1"><\/row>/);
  assert.match(contents, /<col min="3" max="3" width="27.85546875" customWidth="1"/);
  assert.match(contents, /<mergeCell ref="A5:C5"/);
  const order = ['<cols>', '<sheetData>', '<mergeCells', '<drawing ', '<legacyDrawing '].map(element => contents.indexOf(element));
  assert.ok(order.every((position, index) => index === 0 || position > order[index - 1]));
  assert.ok(contents.indexOf('r="A3"') < contents.indexOf('r="C3"'));
  assert.equal(JSON.stringify(workbook), before);
});

test('Excel cell and row-height limits fail explicitly without truncating source data', () => {
  for (const workbook of [book({ A1: { value: 'a'.repeat(32768) } }), book({ A1: { value: '\n'.repeat(254) } }),
    book({}, { rowHeights: { 0: 600 } }), book({ A1: { value: '\0' } })]) assert.throws(() => render(workbook));
  assert.ok(render(book({ A1: { value: 'a'.repeat(32767) } })).includes('a'.repeat(32767)));
});

test('styles deduplicate equivalent formats and include all existing model attributes', () => {
  const format = { bold: true, italic: true, underline: true, color: '#f00', background: '#00ff00', align: 'right', numberFormat: 'currency' };
  const workbook = book({ A1: { value: '123', format }, B1: { value: '456', format: { ...format, color: 'red' } }, C1: { value: '', format: {} } });
  const styles = createXlsxStyles(workbook);
  assert.equal(styles.styleId(format), styles.styleId(workbook.sheets[0].cells.B1.format));
  assert.equal(styles.styleId({}), 0);
  assert.match(styles.xml, /<b\/><i\/><u\/>/);
  assert.match(styles.xml, /<color rgb="FFFF0000"/);
  assert.match(styles.xml, /<fgColor rgb="FF00FF00"/);
  assert.match(styles.xml, /numFmtId="165"/);
  assert.match(styles.xml, /horizontal="right"/);
  assert.match(styles.xml, /<cellXfs count="2"/);
});

test('comments use standard notes XML, VML anchors, relationships and content types', async () => {
  const workbook = book({}, { comments: { B2: { id: 'one', text: 'メモ <>&_x0041_', author: '利用者 & A' }, C3: { id: 'two', text: 'Second', author: '利用者 & A' } } });
  const result = commentParts(workbook.sheets[0], 2);
  assert.deepEqual(result.parts.map(part => part.path), ['xl/comments2.xml', 'xl/drawings/comments2.vml']);
  const [comments, drawing] = await Promise.all(result.parts.map(part => part.content.text()));
  assert.equal((comments.match(/<author>/g) ?? []).length, 1);
  assert.match(comments, /メモ &lt;&gt;&amp;_x005F_x0041_/);
  assert.match(comments, /<comment ref="B2" authorId="0"/);
  assert.match(drawing, /<x:Row>1<\/x:Row><x:Column>1<\/x:Column>/);
  assert.equal(result.legacyDrawingId, result.relationships[1].id);
  assert.equal(result.contentTypes[0].partName, '/xl/comments2.xml');
  assert.equal(result.contentTypes[1].extension, 'vml');
  assert.deepEqual(commentParts(book().sheets[0], 1), { parts: [], relationships: [], contentTypes: [] });
});
