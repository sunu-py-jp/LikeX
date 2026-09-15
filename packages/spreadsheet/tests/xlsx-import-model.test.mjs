import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { zip, fixture, main } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: 'export * from "./src/import/import-xlsx"; export * from "./src/model/formula"; export * from "./src/export/export-xlsx";', resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-import-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, calculateWorkbook, exportSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const read = options => importSpreadsheetXlsx(zip(fixture(options)));
const get = result => result.workbook.sheets[0];

test('XLSX reads native numeric, boolean, error, inline/shared rich text and literal formulas', async () => {
  const result = await read({ sheets: [{ name: '日本語', xml: '<sheetData><row r="1"><c r="A1"><v>12.5</v></c><c r="B1" t="b"><v>1</v></c><c r="C1" t="inlineStr"><is><t>=WEBSERVICE("https://example.test")</t></is></c><c r="D1" t="s"><v>0</v></c><c r="E1" t="e"><v>#N/A</v></c><c r="F1" t="inlineStr"><is><t>0012</t></is></c></row></sheetData>' }], parts: { 'xl/sharedStrings.xml': `<sst xmlns="${main}"><si><r><t>A</t></r><rPh><t>ignored</t></rPh><r><t>_x005F_x0042_</t></r></si></sst>` }, links: [{ id: 'shared', type: 'sharedStrings', target: 'sharedStrings.xml' }] });
  const sheet = get(result), values = calculateWorkbook(result.workbook)[sheet.id];
  assert.equal(sheet.name, '日本語'); assert.equal(values.A1, 12.5); assert.equal(values.B1, true); assert.equal(values.C1, '=WEBSERVICE("https://example.test")'); assert.equal(values.D1, 'A_x0042_'); assert.equal(values.F1, '0012'); assert.equal(sheet.cells.E1.value, '#N/A');
  assert.equal(sheet.cells.C1.format.numberFormat, 'text'); assert.ok(result.warnings.some(w => w.code === 'adjusted'));
});
test('supported and shared formulas calculate; unsupported formulas use safe cached values', async () => {
  const result = await read({ sheets: [{ name: 'Formula', xml: '<sheetData><row r="1"><c r="A1"><v>2</v></c><c r="B1"><f t="shared" si="0" ref="B1:B2">A1*2</f><v>4</v></c><c r="C1"><f>_xlfn.XLOOKUP(2,A1:A2,B1:B2)</f><v>4</v></c><c r="D1" t="str"><f>WEBSERVICE("https://example.test")</f><v>=1+1</v></c><c r="E1"><f>FILTER(A1:A2,A1:A2&gt;0)</f><v>42</v></c><c r="F1"><f>UNKNOWN()</f></c><c r="G1"><f>IF(FALSE,UNKNOWN(),1)</f><v>7</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="shared" si="0"/><v>6</v></c></row></sheetData>' }] });
  const sheet = get(result), values = calculateWorkbook(result.workbook)[sheet.id];
  assert.equal(sheet.cells.B2.value, '=A2*2'); assert.equal(values.B2, 6); assert.equal(values.C1, 4); assert.equal(values.D1, '=1+1'); assert.equal(sheet.cells.E1.value, '42'); assert.equal(sheet.cells.F1, undefined); assert.equal(sheet.cells.G1.value, '7');
  assert.equal(result.warnings.find(w => w.code === 'unsupported').count, 4);
});
test('sheet order, names, merges and actual dimensions ignore exaggerated usedRange', async () => {
  const result = await read({ sheets: [{ name: 'Second', xml: '<dimension ref="A1:XFD1048576"/><sheetData><row r="501" ht="30"><c r="AA501"><v>1</v></c></row></sheetData><cols><col min="2" max="2" width="20"/></cols><mergeCells><mergeCell ref="B2:C3"/></mergeCells>' }, { name: 'First', xml: '<sheetData/>', state: 'hidden' }], workbookExtra: '<definedNames><definedName name="Data">Second!$AA$501:$AB$502</definedName></definedNames>' });
  assert.deepEqual(result.workbook.sheets.map(s => s.name), ['Second', 'First']); assert.equal(get(result).rowCount, 502); assert.equal(get(result).columnCount, 28); assert.equal(get(result).rowHeights[500], 40); assert.equal(get(result).columnWidths[1], 145); assert.equal(get(result).rowHeights[0], 20); assert.equal(get(result).columnWidths[0], 64);
  assert.deepEqual(get(result).merges[0], { top: 1, left: 1, bottom: 2, right: 2 }); assert.equal(result.workbook.namedRanges[0].name, 'Data');
});
test('fonts, fill, border, alignment, number styles and 1904 dates are converted', async () => {
  const styles = `<styleSheet xmlns="${main}"><fonts><font/><font><b/><i/><u/><name val="Arial"/><sz val="12"/><color rgb="FF123456"/></font></fonts><fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFABCDEF"/></patternFill></fill></fills><borders><border/><border><bottom style="double"><color rgb="FF112233"/></bottom></border></borders><cellXfs><xf/><xf fontId="1" fillId="1" borderId="1" numFmtId="14"><alignment horizontal="right" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const result = await read({ sheets: [{ name: 'Dates', xml: '<sheetData><row r="1"><c r="A1" s="1"><v>0</v></c></row></sheetData>' }], workbookAttributes: '<workbookPr date1904="1"/>', parts: { 'xl/styles.xml': styles }, links: [{ id: 'style', type: 'styles', target: 'styles.xml' }] });
  const cell = get(result).cells.A1; assert.equal(cell.value, '1462'); assert.equal(cell.format.bold, true); assert.equal(cell.format.fontSize, 16); assert.equal(cell.format.fontFamily, 'Arial'); assert.equal(cell.format.color, '#123456'); assert.equal(cell.format.background, '#ABCDEF'); assert.equal(cell.format.borders.bottom.style, 'double'); assert.equal(cell.format.numberFormat, 'date'); assert.equal(cell.format.align, 'right'); assert.equal(cell.format.verticalAlign, 'middle'); assert.equal(cell.format.wrap, true);
});
test('non-XLSX, macros, malformed actual cells and oversized ranges fail atomically', async () => {
  const wrong = fixture(); wrong['[Content_Types].xml'] = wrong['[Content_Types].xml'].replace('spreadsheetml.sheet.main+xml', 'ms-excel.sheet.macroEnabled.main+xml');
  await assert.rejects(importSpreadsheetXlsx(zip(wrong)), /マクロ/);
  for (const xml of ['<sheetData><row r="10001"><c r="A10001"><v>1</v></c></row></sheetData>', '<sheetData><row r="1"><c r="ALM1"><v>1</v></c></row></sheetData>', '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData>', '<sheetData/><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>']) await assert.rejects(read({ sheets: [{ name: 'bad', xml }] }));
});
test('ArrayBuffer, Uint8Array and Blob inputs produce isolated immutable snapshots', async () => {
  const bytes = zip(fixture({ sheets: [{ name: 'Input', xml: '<sheetData><row r="1"><c r="A1"><v>5</v></c></row></sheetData>' }] }));
  for (const input of [new Uint8Array(bytes), new Uint8Array(bytes).buffer, new Blob([bytes])]) {
    const result = await importSpreadsheetXlsx(input); assert.equal(get(result).cells.A1.value, '5'); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.warnings)); assert.ok(Object.isFrozen(result.workbook));
  }
});
test('error cells and unsupported formula caches cannot introduce executable formulas', async () => {
  for (const formula of ['', '<f>UNSUPPORTED()</f>']) await assert.rejects(read({ sheets: [{ name: 'Unsafe', xml: `<sheetData><row r="1"><c r="A1" t="e">${formula}<v>=1+2</v></c></row></sheetData>` }] }), /エラーセル/);
});
test('external workbook and unsupported named-reference formulas retain their caches', async () => {
  const result = await read({ sheets: [{ name: 'Names', xml: '<sheetData><row r="1"><c r="A1"><f>Factor*3</f><v>6</v></c><c r="B1"><f>\'[external.xlsx]Other\'!A1</f><v>42</v></c><c r="C1" t="e"><f>UNSUPPORTED()</f></c></row></sheetData>' }], workbookExtra: '<definedNames><definedName name="Factor">2</definedName></definedNames>' });
  assert.equal(get(result).cells.A1.value, '6'); assert.equal(get(result).cells.B1.value, '42'); assert.equal(get(result).cells.C1, undefined); assert.equal(result.warnings.find(w => w.code === 'unsupported').count, 3);
});
test('shared strings cannot amplify decoded cell text beyond the import budget', async () => {
  const result = read({ sheets: [{ name: 'Amplified', xml: `<sheetData>${Array.from({ length: 400 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="s"><v>0</v></c></row>`).join('')}</sheetData>` }], parts: { 'xl/sharedStrings.xml': `<sst><si><t>${'x'.repeat(100000)}</t></si></sst>` }, links: [{ id: 'strings', type: 'sharedStrings', target: 'sharedStrings.xml' }] });
  await assert.rejects(result, /セル文字数/);
});
test('overlapping column definitions are rejected before repeated range expansion', async () => {
  await assert.rejects(read({ sheets: [{ name: 'Columns', xml: '<cols><col min="1" max="1000" width="8"/><col min="1" max="1000" width="8"/></cols><sheetData/>' }] }), /列の表示設定が重複/);
});
test('existing values survive incompatible Excel validation rules', async () => {
  const result = await read({ sheets: [{ name: 'Rules', xml: '<sheetData><row r="1"><c r="A1"><v>99</v></c><c r="B1"><v>3</v></c></row></sheetData><dataValidations><dataValidation type="whole" sqref="A1:B1" showErrorMessage="1" allowBlank="1"><formula1>1</formula1><formula2>10</formula2></dataValidation></dataValidations>' }] });
  assert.equal(get(result).cells.A1.value, '99'); assert.equal(get(result).cells.A1.validation, undefined); assert.equal(get(result).cells.B1.validation.type, 'number'); assert.ok(result.warnings.some(w => w.message.includes('既存のセル値')));
});
test('sheet-name normalization updates formulas and named ranges with a warning', async () => {
  const result = await read({ sheets: [{ name: ' Spaced ', xml: '<sheetData><row r="1"><c r="A1"><v>8</v></c></row></sheetData>' }, { name: 'Formulas', xml: '<sheetData><row r="1"><c r="A1"><f>\' Spaced \'!A1*2</f><v>16</v></c></row></sheetData>' }], workbookExtra: '<definedNames><definedName name="Named">\' Spaced \'!$A$1</definedName></definedNames>' });
  assert.equal(get(result).name, 'Spaced'); assert.equal(calculateWorkbook(result.workbook)[result.workbook.sheets[1].id].A1, 16); assert.equal(result.workbook.namedRanges[0].sheetId, get(result).id); assert.ok(result.warnings.some(w => w.message.includes('シート名')));
});
test('validated Excel date serials stay numeric for formulas in both date systems', async () => {
  for (const date1904 of [false, true]) {
    const raw = date1904 ? '0.5' : '46281.5', expected = date1904 ? '1462.5' : raw;
    const result = await read({ sheets: [{ name: 'Dates', xml: `<sheetData><row r="1"><c r="A1"><v>${raw}</v></c><c r="B1"><f>A1+1</f><v>${Number(raw) + 1}</v></c></row></sheetData><dataValidations><dataValidation type="date" sqref="A1" allowBlank="1" showErrorMessage="1"><formula1>${date1904 ? 0 : 45000}</formula1><formula2>${date1904 ? 2 : 50000}</formula2></dataValidation></dataValidations>` }], workbookAttributes: date1904 ? '<workbookPr date1904="1"/>' : '', parts: { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>' }, links: [{ id: 'style', type: 'styles', target: 'styles.xml' }] });
    const sheet = get(result); assert.equal(sheet.cells.A1.value, expected); assert.equal(sheet.cells.A1.validation.type, 'date'); assert.equal(calculateWorkbook(result.workbook)[sheet.id].B1, Number(expected) + 1); assert.ok(!result.warnings.some(w => w.message.includes('既存のセル値')));
  }
});
test('own exporter roundtrip retains numeric/formula/text semantics and merges', async () => {
  const workbook = { sheets: [{ id: 's', name: 'Roundtrip', rowCount: 300, columnCount: 26, cells: { A1: { value: '2' }, B1: { value: '=A1*3' }, C1: { value: '=literal', format: { numberFormat: 'text' } }, D1: { value: "''apostrophe", format: { numberFormat: 'text' } } }, merges: [{ top: 2, left: 2, bottom: 3, right: 3 }] }] };
  const result = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(workbook));
  const sheet = get(result), values = calculateWorkbook(result.workbook)[sheet.id]; assert.equal(values.B1, 6); assert.equal(values.C1, '=literal'); assert.equal(values.D1, "'apostrophe"); assert.deepEqual(sheet.merges, workbook.sheets[0].merges);
});
