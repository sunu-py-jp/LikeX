import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { zip, fixture, main, rel } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export * from './src/import/import-xlsx';
  export * from './src/export/export-xlsx'; export * from './src/import/zip'; export * from './src/import/xml';
  export * from './src/model/filters'; export * from './src/model/formula';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-auto-filter-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, openXlsxStreamingArchive, parseXml, child, children,
  getSpreadsheetFilteredRows, getSpreadsheetFilterValues, calculateWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const read = xml => importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: 'Filters', xml }] })));
const basicData = '<sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>種類</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>A</t></is></c></row><row r="4" hidden="1"><c r="B4" t="inlineStr"><is><t>B</t></is></c></row></sheetData>';
const range = { top: 1, left: 1, bottom: 4, right: 2 };
const book = autoFilter => ({ sheets: [{ id: 's', name: "売上'26", rowCount: 8, columnCount: 5, cells: {
  B2: { value: '種類' }, C2: { value: '金額' }, B3: { value: 'A<&"_x0041_' }, C3: { value: '=2*5' },
  B4: { value: 'B' }, C4: { value: '3' }, B5: { value: '' }, C5: { value: '10' }, A8: { value: 'outside' },
}, merges: [{ top: 6, left: 0, bottom: 6, right: 1 }], autoFilter }] });

test('independent openpyxl reads the range, relative column ID, blank option and excluded rows', {
  skip: spawnSync('python3', ['-c', 'import openpyxl']).status !== 0 && 'openpyxl is required for independent reader verification',
}, async () => {
  const bytes = await exportSpreadsheetXlsx(book({ range, columns: [{ column: 1, values: ['', 'A<&"_x0041_'] }] }));
  const result = spawnSync('python3', ['-c', `
import io, json, sys, openpyxl
sheet = openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read())).active
column = sheet.auto_filter.filterColumn[0]
print(json.dumps({'range': sheet.auto_filter.ref, 'column': column.colId,
    'blank': column.filters.blank, 'hidden': [index for index, row in sheet.row_dimensions.items() if row.hidden],
    'kept': sheet['B4'].value}))
`], { input: Buffer.from(await bytes.arrayBuffer()) });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout.toString()), { range: 'B2:C5', column: 0, blank: true, hidden: [4], kept: 'B' });
});

test('sheet filters import absolute columns, blanks, deduped values and preserve supported rows', async () => {
  const result = await read(`${basicData}<autoFilter ref="B2:C5"><filterColumn colId="0"><filters blank="1"><filter val="A"/><filter val="A"/></filters></filterColumn></autoFilter>`);
  const sheet = result.workbook.sheets[0];
  assert.deepEqual(sheet.autoFilter, { range, columns: [{ column: 1, values: ['', 'A'] }] });
  assert.deepEqual([...getSpreadsheetFilteredRows(sheet)], [3]);
  assert.deepEqual(result.warnings, []);
  assert.equal(sheet.cells.B4.value, 'B', 'excluded rows are kept as normal cells');
});

test('XLSX exports the filter before merges, records filter mode/hidden rows and round-trips values', async () => {
  const autoFilter = { range, columns: [{ column: 1, values: ['', 'A<&"_x0041_'] }, { column: 2, values: ['10'] }] };
  const original = book(autoFilter), snapshot = JSON.stringify(original), bytes = await exportSpreadsheetXlsx(original);
  const archive = await openXlsxStreamingArchive(bytes), root = parseXml(await archive.read('xl/worksheets/sheet1.xml'));
  const filter = child(root, 'autoFilter'), ordered = root.children.map(item => item.name);
  assert.equal(filter.attributes.ref, 'B2:C5');
  assert.ok(ordered.indexOf('autoFilter') < ordered.indexOf('mergeCells'));
  assert.equal(child(root, 'sheetPr').attributes.filterMode, '1');
  assert.deepEqual(children(filter, 'filterColumn').map(item => item.attributes.colId), ['0', '1']);
  assert.equal(child(children(filter, 'filterColumn')[0], 'filters').attributes.blank, '1');
  const rows = children(child(root, 'sheetData'), 'row');
  assert.deepEqual(rows.filter(row => row.attributes.hidden === '1').map(row => row.attributes.r), ['4']);
  const workbookXml = parseXml(await archive.read('xl/workbook.xml'));
  const name = child(child(workbookXml, 'definedNames'), 'definedName');
  assert.equal(name.attributes.name, '_xlnm._FilterDatabase'); assert.equal(name.attributes.localSheetId, '0');
  const restored = await importSpreadsheetXlsx(bytes), sheet = restored.workbook.sheets[0];
  assert.deepEqual(sheet.autoFilter, autoFilter); assert.deepEqual(restored.warnings, []);
  assert.deepEqual([...getSpreadsheetFilteredRows(sheet, calculateWorkbook(restored.workbook)[sheet.id])], [3]);
  assert.equal(JSON.stringify(original), snapshot);
});

test('button-only ranges stay exact, and an empty value list hides all data including absent cells', async () => {
  for (const autoFilter of [{ range: { top: 1, left: 1, bottom: 1, right: 2 } },
    { range, columns: [{ column: 1, values: [] }] }]) {
    const bytes = await exportSpreadsheetXlsx(book(autoFilter));
    const restored = await importSpreadsheetXlsx(bytes);
    assert.deepEqual(restored.workbook.sheets[0].autoFilter, autoFilter);
    assert.deepEqual(restored.warnings, []);
    const archive = await openXlsxStreamingArchive(bytes), root = parseXml(await archive.read('xl/worksheets/sheet1.xml'));
    const hidden = children(child(root, 'sheetData'), 'row').filter(row => row.attributes.hidden === '1').map(row => Number(row.attributes.r));
    assert.deepEqual(hidden, autoFilter.columns ? [3, 4, 5] : []);
  }
});

test('numeric list filters use displayed strings, including custom formats, dates and formula results', async () => {
  for (const format of [{ numberFormat: 'percent' }, { numberFormat: 'currency' }, { numberFormat: 'date' },
    { numberFormat: 'number', formatCode: '#,##0.00' }]) {
    const input = { sheets: [{ id: 's', name: 'Values', rowCount: 10, columnCount: 3,
      cells: { A1: { value: 'Value' }, A2: { value: '45200', format }, A3: { value: '=45200+1', format } },
      autoFilter: { range: { top: 0, left: 0, bottom: 2, right: 0 } } }] };
    const candidates = getSpreadsheetFilterValues(input.sheets[0], 0, calculateWorkbook(input).s);
    input.sheets[0].autoFilter.columns = [{ column: 0, values: [candidates[0]] }];
    const bytes = await exportSpreadsheetXlsx(input), archive = await openXlsxStreamingArchive(bytes);
    const root = parseXml(await archive.read('xl/worksheets/sheet1.xml'));
    assert.equal(child(child(child(root, 'autoFilter'), 'filterColumn'), 'filters').children[0].attributes.val, candidates[0]);
    const restored = await importSpreadsheetXlsx(bytes), sheet = restored.workbook.sheets[0];
    assert.deepEqual(sheet.autoFilter, input.sheets[0].autoFilter);
    assert.deepEqual([...getSpreadsheetFilteredRows(sheet, calculateWorkbook(restored.workbook)[sheet.id])], [2]);
  }
});

test('unsupported and malformed criteria are omitted per column without narrowing partial OR groups', async () => {
  for (const unsupported of ['<customFilters><customFilter operator="greaterThan" val="2"/></customFilters>',
    '<dynamicFilter type="today"/>', '<top10 val="10"/>', '<colorFilter dxfId="0"/>',
    '<filters><filter val="A"/><dateGroupItem year="2026" dateTimeGrouping="year"/></filters>',
    '<filters blank="invalid"><filter val="A"/></filters>', '<filters><filter/></filters>']) {
    const result = await read(`${basicData}<autoFilter ref="B2:C5"><filterColumn colId="0">${unsupported}</filterColumn><filterColumn colId="1"><filters blank="1"/></filterColumn></autoFilter>`);
    assert.deepEqual(result.workbook.sheets[0].autoFilter, { range, columns: [{ column: 2, values: [''] }] });
    assert.ok(result.warnings.some(item => item.code === 'omitted' && item.message.includes('フィルター')));
    assert.ok(result.warnings.some(item => item.message.includes('非表示')));
    assert.equal(result.workbook.sheets[0].cells.B4.value, 'B');
  }
});

test('invalid filter ranges and columns recover while preserving values', async () => {
  for (const ref of ['B2:A5', 'A1:XFD1048576', 'no range']) {
    const result = await read(`${basicData}<autoFilter ref="${ref}"/>`);
    assert.equal(result.workbook.sheets[0].autoFilter, undefined);
    assert.equal(result.workbook.sheets[0].cells.B3.value, 'A');
    assert.ok(result.warnings.some(item => item.message.includes('フィルター範囲')));
  }
  const result = await read(`${basicData}<autoFilter ref="B2:C5"><filterColumn colId="1"><filters blank="1"/></filterColumn><filterColumn colId="1"><filters><filter val="bad"/></filters></filterColumn><filterColumn colId="9"><filters/></filterColumn><sortState ref="B2:C5"/></autoFilter>`);
  assert.deepEqual(result.workbook.sheets[0].autoFilter, { range, columns: [{ column: 2, values: [''] }] });
  assert.ok(result.warnings.some(item => item.message.includes('重複')));
  assert.ok(result.warnings.some(item => item.message.includes('並べ替え')));
});

test('manually hidden matching rows are warned and shown; unsupported table filters stay explicitly omitted', async () => {
  const manual = await read(`${basicData.replace('r="3"', 'r="3" hidden="1"')}<autoFilter ref="B2:C5"><filterColumn colId="0"><filters><filter val="A"/></filters></filterColumn></autoFilter>`);
  assert.equal(manual.warnings.filter(item => item.message.includes('非表示'))[0].count, 1);
  const table = await importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: 'Filters', xml: `${basicData}<tableParts><tablePart r:id="t"/></tableParts>` }], parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="t" Type="${rel}table" Target="../tables/table1.xml"/></Relationships>`,
    'xl/tables/table1.xml': `<table xmlns="${main}" name="Example" displayName="Example" ref="B2:B4"><autoFilter ref="B2:B4"><filterColumn colId="0"><filters><filter val="A"/></filters></filterColumn></autoFilter><tableColumns count="1"><tableColumn id="1" name="種類"/></tableColumns></table>`,
  } })));
  assert.equal(table.workbook.sheets[0].tables.length, 1);
  assert.equal(table.workbook.sheets[0].autoFilter, undefined);
  assert.ok(table.warnings.some(item => item.message.includes('テーブルのフィルター')));
});

test('overlapping imported sheet filters are recovered after table definitions without losing table data', async () => {
  const result = await importSpreadsheetXlsx(zip(fixture({ sheets: [{ name: 'Overlap', xml: `${basicData}<autoFilter ref="B2:C5"><filterColumn colId="0"><filters><filter val="A"/></filters></filterColumn></autoFilter><tableParts><tablePart r:id="t"/></tableParts>` }], parts: {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="t" Type="${rel}table" Target="../tables/table1.xml"/></Relationships>`,
    'xl/tables/table1.xml': `<table xmlns="${main}" name="Example" displayName="Example" ref="B2:B4"><autoFilter ref="B2:B4"/><tableColumns count="1"><tableColumn id="1" name="種類"/></tableColumns></table>`,
  } })));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.autoFilter, undefined);
  assert.equal(sheet.tables[0].name, 'Example'); assert.equal(sheet.cells.B4.value, 'B');
  assert.ok(result.warnings.some(item => item.message.includes('テーブルと重なるシートのフィルター')));
  const exported = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  assert.equal(exported.workbook.sheets[0].tables[0].name, 'Example');
});
