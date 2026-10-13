import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture, zip, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export { readWorksheetValidations } from './import/extras-validations';
  export { readWorksheetComments, readWorksheetTables } from './import/extras-tables-comments';
  export { parseXml } from './import/xml'; export { importSpreadsheetXlsx } from './import/import-xlsx';
  export { exportSpreadsheetXlsx } from './export/export-xlsx';`, resolveDir: new URL('../src/', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { readWorksheetValidations, readWorksheetComments, readWorksheetTables, parseXml, importSpreadsheetXlsx, exportSpreadsheetXlsx } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes = text => new TextEncoder().encode(text);
const rule = (range, min = 0, max = 5) => `<dataValidation type="whole" sqref="${range}" allowBlank="1"><formula1>${min}</formula1><formula2>${max}</formula2></dataValidation>`;
const worksheet = text => parseXml(bytes(`<worksheet>${text}</worksheet>`));
const comment = (ref, text) => `<comment ref="${ref}"><text><t>${text}</t></text></comment>`;
const comments = text => `<comments><commentList>${text}</commentList></comments>`;
const table = (name = 'Sales', ref = 'A1:A2', column = 'Header') => `<table displayName="${name}" ref="${ref}"><tableColumns><tableColumn name="${column}"/></tableColumns></table>`;
const relation = (id, type, target) => ({ id, type: `${rel}${type}`, target, external: false });
function harness({ cells = {}, files = {}, context: extra = {} } = {}) {
  const warnings = [], reads = [];
  const sheet = { id: 'source', name: '任意機能', rowCount: 3, columnCount: 4, cells };
  const context = { archive: { has: path => Object.hasOwn(files, path), read: async path => { reads.push(path); return bytes(files[path]); } },
    warnings, resources: {}, warn: warning => warnings.push(warning), ...extra };
  return { sheet, context, warnings, reads };
}

test('duplicate table names do not consume the last global slot before a later valid table', async () => {
  const env = harness({ cells: { A1: { value: 'Header' }, B1: { value: 'Header' } },
    files: { duplicate: table('Existing'), good: table('Unique', 'B1:B2') },
    context: { tableCount: 999, tableNames: new Set(['existing']) } });
  const links = new Map(['duplicate', 'good'].map(id => [id, relation(id, 'table', id)]));
  const result = await readWorksheetTables(worksheet('<tableParts><tablePart id="duplicate"/><tablePart id="good"/></tableParts>'), env.sheet, links, env.context);
  assert.deepEqual(result.tables.map(item => item.name), ['Unique']);
  assert.equal(env.context.tableCount, 1000);
  assert.ok(env.warnings.some(item => item.message.includes('名前が重複するテーブル')));
});

test('a huge validation is omitted atomically, preserving values and permitting later small rules', () => {
  const env = harness({ cells: { A1: { value: '99' } } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:K10000')}${rule('B1')}</dataValidations>`), env.sheet, env.context);
  assert.equal(result.cells.A1.value, '99'); assert.equal(result.cells.A1.validation, undefined);
  assert.equal(result.cells.B1.validation.max, 5); assert.deepEqual(Object.keys(result.cells), ['A1', 'B1']);
  assert.equal(result.rowCount, 3); assert.equal(result.columnCount, 4);
  assert.equal(env.warnings[0].sheetName, '任意機能'); assert.match(env.warnings[0].message, /A1:K10000.*110000.*100000/);
});

test('validation reserves global cells before applying, counts overlapping references once, and does not spend rejected reservations', () => {
  const env = harness({ cells: { A1: { value: '2' } }, context: { remainingExtraCells: 1 } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:C1', 1, 2)}${rule('D1')}${rule('A1', 0, 10)}</dataValidations>`), env.sheet, env.context);
  assert.equal(result.cells.A1.validation.max, 10); assert.equal(result.cells.B1, undefined); assert.equal(result.cells.C1, undefined);
  assert.equal(result.cells.D1.validation.max, 5); assert.equal(env.context.remainingExtraCells, 0);
  assert.deepEqual(env.sheet.cells, { A1: { value: '2' } }); assert.match(env.warnings[0].message, /A1:C1.*追加セル数 2.*残り保存可能セル数 1/);
  const overlap = harness({ context: { remainingExtraCells: 3 } });
  const expanded = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:A2 A2:A3')}</dataValidations>`), overlap.sheet, overlap.context);
  assert.equal(Object.keys(expanded.cells).length, 3); assert.equal(overlap.context.remainingExtraCells, 0); assert.equal(overlap.warnings.length, 0);
});

test('validation processing remains bounded even when many rules target existing cells', () => {
  const env = harness({ context: { remainingExtraCells: 100000 } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:J10000')}${rule('A1:J10000', 1, 2)}</dataValidations>`), env.sheet, env.context);
  assert.equal(Object.keys(result.cells).length, 100000); assert.equal(result.cells.A1.validation.min, 0);
  assert.equal(env.context.remainingExtraCells, 0); assert.equal(env.warnings.length, 1); assert.match(env.warnings[0].message, /累計処理上限 100000/);
});

test('invalid optional comment parts and comments cannot discard neighboring valid comments', async () => {
  const env = harness({ files: { broken: '<comments><invalid>', wrong: '<worksheet/>',
    valid: comments(comment('bad', 'bad') + comment('A1', 'x'.repeat(10001)) + comment('B1', 'keep') + comment('B1', 'duplicate')) } });
  const links = new Map(['broken', 'missing', 'wrong', 'valid'].map(id => [id, relation(id, 'comments', id)]));
  const result = await readWorksheetComments(env.sheet, links, env.context);
  assert.equal(result.comments.B1.text, 'keep'); assert.deepEqual(Object.keys(result.comments), ['B1']);
  assert.equal(env.context.commentCount, 1); assert.equal(env.warnings.length, 6);
  assert.ok(env.warnings.every(warning => warning.sheetName === '任意機能'));
  assert.ok(env.warnings.some(warning => /A1.*文字数/.test(warning.message)));
});

test('comments keep a global success count and omit only excess items across sheets', async () => {
  const env = harness({ files: { comments: comments(comment('A1', 'keep') + comment('B1', 'excess')) }, context: { commentCount: 9999 } });
  const links = new Map([['comments', relation('comments', 'comments', 'comments')]]);
  const result = await readWorksheetComments(env.sheet, links, env.context);
  assert.equal(result.comments.A1.text, 'keep'); assert.equal(result.comments.B1, undefined); assert.equal(env.context.commentCount, 10000);
  const next = await readWorksheetComments({ ...env.sheet, id: 'next', name: '次' }, links, env.context);
  assert.equal(next.comments, undefined); assert.equal(env.warnings.at(-1).count, 2); assert.equal(env.warnings.at(-1).sheetName, '次');
});

test('invalid table XML or definitions are omitted individually; valid tables and all cell values survive', async () => {
  const env = harness({ cells: { A1: { value: 'Header' }, A2: { value: '42' } }, files: {
    broken: '<table>', wrong: '<comments/>', invalid: table('Bad', 'A1:A2', 'different'), valid: table(), overlap: table('Overlaps') } });
  const ids = ['broken', 'wrong', 'missing', 'invalid', 'valid', 'overlap'];
  const links = new Map(ids.map(id => [id, relation(id, 'table', id)]));
  const result = await readWorksheetTables(worksheet(`<tableParts>${ids.map(id => `<tablePart r:id="${id}"/>`).join('')}</tableParts>`), env.sheet, links, env.context);
  assert.equal(result.tables.length, 1); assert.equal(result.tables[0].name, 'Sales'); assert.equal(env.context.tableCount, 1);
  assert.deepEqual(result.cells, env.sheet.cells); assert.equal(env.warnings.length, 5); assert.ok(env.warnings.some(warning => /A1:A2.*列名/.test(warning.message)));
});

test('table capacity omits only excess definitions and avoids reading their parts', async () => {
  const env = harness({ cells: { A1: { value: 'Header' } }, files: { a: table('Sales'), b: table('Unused') }, context: { tableCount: 999 } });
  const links = new Map(['a', 'b'].map(id => [id, relation(id, 'table', id)]));
  const node = worksheet('<tableParts><tablePart r:id="a"/><tablePart r:id="b"/></tableParts>');
  const result = await readWorksheetTables(node, env.sheet, links, env.context);
  assert.equal(result.tables.length, 1); assert.equal(env.context.tableCount, 1000); assert.deepEqual(env.reads, ['a']);
  assert.match(env.warnings[0].message, /b.*1000/);
  const next = await readWorksheetTables(node, { ...env.sheet, id: 'next' }, links, env.context);
  assert.equal(next.tables, undefined); assert.deepEqual(env.reads, ['a']); assert.equal(env.warnings.at(-1).count, 2);
});

test('optional recovery never swallows aborts or ZIP integrity failures', async () => {
  const env = harness({ files: { comments: comments(comment('A1', 'keep')) } });
  const links = new Map([['comments', relation('comments', 'comments', 'comments')]]);
  const zipError = new Error('Excelファイルを読み込めません: 実際の展開サイズが上限を超えています');
  env.context.archive.read = async () => { throw zipError; };
  await assert.rejects(readWorksheetComments(env.sheet, links, env.context), error => error === zipError);
  const abort = new DOMException('cancelled', 'AbortError'); env.context.archive.read = async () => { throw abort; };
  await assert.rejects(readWorksheetComments(env.sheet, links, env.context), error => error === abort);
  env.context.resolveListValues = () => { throw abort; };
  assert.throws(() => readWorksheetValidations(worksheet('<dataValidations><dataValidation type="list" sqref="A1"><formula1>Named</formula1></dataValidation></dataValidations>'), env.sheet, env.context), error => error === abort);
  assert.equal(env.warnings.length, 0);
});

test('public XLSX import and export preserve usable cells around damaged optional parts', async () => {
  const input = fixture({ sheets: [{ name: 'Recovered', xml: `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row><row r="2"><c r="A2"><v>42</v></c></row></sheetData><tableParts><tablePart r:id="table"/></tableParts><dataValidations>${rule('A1:K10000')}${rule('B1')}</dataValidations>` }], parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships><Relationship Id="table" Type="${rel}table" Target="../tables/table1.xml"/><Relationship Id="comments" Type="${rel}comments" Target="../comments1.xml"/></Relationships>`,
    'xl/tables/table1.xml': '<table>', 'xl/comments1.xml': '<comments><bad>',
  } });
  const result = await importSpreadsheetXlsx(zip(input)), sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A2.value, '42'); assert.equal(sheet.cells.B1.validation.max, 5); assert.equal(sheet.tables, undefined); assert.equal(sheet.comments, undefined);
  assert.equal(result.warnings.filter(warning => warning.code === 'omitted').length, 3);
  const roundtrip = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.equal(roundtrip.workbook.sheets[0].cells.A2.value, '42'); assert.equal(roundtrip.workbook.sheets[0].cells.B1.validation.max, 5);
});


test('public import enforces the comment budget across sheets without losing any cell contents', async () => {
  const sheetComments = Array.from({ length: 6000 }, (_, index) => comment(`A${index + 1}`, 'note')).join('');
  const result = await importSpreadsheetXlsx(zip(fixture({
    sheets: [{ name: 'First', xml: '<sheetData><row r="1"><c r="B1"><v>10</v></c></row></sheetData>' },
      { name: 'Second', xml: '<sheetData><row r="1"><c r="B1"><v>20</v></c></row></sheetData>' }],
    parts: Object.fromEntries([1, 2].flatMap(index => [
      [`xl/comments${index}.xml`, comments(sheetComments)],
      [`xl/worksheets/_rels/sheet${index}.xml.rels`, `<Relationships><Relationship Id="comments" Type="${rel}comments" Target="../comments${index}.xml"/></Relationships>`],
    ])),
  })));
  assert.equal(Object.keys(result.workbook.sheets[0].comments).length, 6000);
  assert.equal(Object.keys(result.workbook.sheets[1].comments).length, 4000);
  assert.equal(result.workbook.sheets[0].cells.B1.value, '10'); assert.equal(result.workbook.sheets[1].cells.B1.value, '20');
  const warning = result.warnings.find(warning => /コメント.*ブック全体の上限/.test(warning.message));
  assert.equal(warning.sheetName, 'Second'); assert.equal(warning.count, 2000); assert.match(warning.message, /A4001/);
});


test('incompatible blank rules do not exhaust capacity before valid rules on a later sheet', async () => {
  const result = await importSpreadsheetXlsx(zip(fixture({ sheets: [
    { name: 'Invalid blanks', xml: `<sheetData/><dataValidations>${rule('A1:J10000').replace('allowBlank="1"', 'allowBlank="0"')}</dataValidations>` },
    { name: 'Keep rule', xml: `<sheetData/><dataValidations>${rule('B1')}</dataValidations>` },
  ] })));
  assert.equal(Object.keys(result.workbook.sheets[0].cells).length, 0);
  assert.equal(result.workbook.sheets[1].cells.B1.validation.max, 5);
  const warning = result.warnings.find(warning => /既存のセル値に適合しない/.test(warning.message));
  assert.equal(warning.sheetName, 'Invalid blanks'); assert.equal(warning.count, 100000);
  assert.equal(result.warnings.some(warning => /残り保存可能セル数/.test(warning.message)), false);
});

test('an incompatible replacement removes the old rule and returns validation-only cell capacity', () => {
  const env = harness({ context: { remainingExtraCells: 1 } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1')}${rule('A1').replace('allowBlank="1"', 'allowBlank="0"')}${rule('B1')}</dataValidations>`), env.sheet, env.context);
  assert.equal(result.cells.A1, undefined); assert.equal(result.cells.B1.validation.max, 5);
  assert.equal(env.context.remainingExtraCells, 0); assert.equal(env.warnings.length, 1);
  assert.match(env.warnings[0].message, /A1.*既存のセル値に適合しない/);
});

test('an incompatible replacement preserves literal values and formatting while removing earlier validation', () => {
  const validation = { type: 'number', allowBlank: true, min: 0, max: 5 };
  const env = harness({ cells: { A1: { value: '', format: { bold: true }, validation }, B1: { value: '', validation }, C1: { value: '2', validation } }, context: { remainingExtraCells: 0 } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:C1', 10, 20).replace('allowBlank="1"', 'allowBlank="0"')}${rule('D1')}</dataValidations>`), env.sheet, env.context);
  assert.deepEqual(result.cells.A1, { value: '', format: { bold: true } }); assert.equal(result.cells.B1, undefined);
  assert.deepEqual(result.cells.C1, { value: '2' }); assert.equal(result.cells.D1.validation.max, 5);
  assert.equal(env.context.remainingExtraCells, 0); assert.equal(env.warnings[0].count, 3);
  assert.equal(env.sheet.cells.B1.validation, validation);
});

test('a rule rejected for capacity does not partially remove incompatible existing validation', () => {
  const validation = { type: 'number', allowBlank: true, min: 0, max: 5 };
  const env = harness({ cells: { A1: { value: '2', validation } }, context: { remainingExtraCells: 0 } });
  const result = readWorksheetValidations(worksheet(`<dataValidations>${rule('A1:C1', 10, 20)}</dataValidations>`), env.sheet, env.context);
  assert.equal(result.cells.A1.validation, validation); assert.equal(result.cells.B1, undefined); assert.equal(result.cells.C1, undefined);
  assert.equal(env.context.remainingExtraCells, 0); assert.equal(env.warnings.length, 1); assert.match(env.warnings[0].message, /残り保存可能セル数/);
});
