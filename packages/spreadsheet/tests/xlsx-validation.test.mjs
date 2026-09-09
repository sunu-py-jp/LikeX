import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/export/export-xlsx'; export * from './src/export/xlsx/data-validation';
export * from './src/export/xlsx/validation-lists'; export * from './src/model';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-validation-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { exportSpreadsheetXlsx, normalizeWorkbook, dataValidationsXml, createValidationListRegistry } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheet = (name, cells = {}, id = name) => ({ id, name, rowCount: 10, columnCount: 10, cells });
const hasPython = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const independentReader = { skip: !hasPython && 'python3 is required for independent ZIP/XML verification' };
async function inspect(blob) {
  const result = spawnSync('python3', ['-c', `
import io, json, sys, zipfile, xml.etree.ElementTree as ET
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    parts = {name: ET.fromstring(archive.read(name)) for name in archive.namelist() if name.endswith(('.xml', '.rels'))}
    workbook = parts['xl/workbook.xml']
    sheets = [dict(item.attrib) for item in workbook.findall('s:sheets/s:sheet', ns)]
    names = [dict(item.attrib, value=item.text) for item in workbook.findall('s:definedNames/s:definedName', ns)]
    worksheets = {}
    for path, root in parts.items():
        if not path.startswith('xl/worksheets/sheet') or not path.endswith('.xml'): continue
        cells = {}
        for cell in root.findall('s:sheetData/s:row/s:c', ns):
            value = cell.find('s:v', ns)
            text = ''.join(item.text or '' for item in cell.findall('s:is/s:t', ns))
            cells[cell.get('r')] = dict(cell.attrib, value=value.text if value is not None else text, formula=cell.findtext('s:f', None, ns))
        validations = [dict(item.attrib, formula1=item.findtext('s:formula1', None, ns), formula2=item.findtext('s:formula2', None, ns)) for item in root.findall('s:dataValidations/s:dataValidation', ns)]
        worksheets[path] = {'cells': cells, 'validations': validations, 'order': [item.tag.split('}')[-1] for item in root]}
    print(json.dumps({'sheets': sheets, 'names': names, 'worksheets': worksheets,
        'relationships': [dict(item.attrib) for item in parts['xl/_rels/workbook.xml.rels']],
        'contentTypes': [dict(item.attrib) for item in parts['[Content_Types].xml']]}))
`], { input: Buffer.from(await blob.arrayBuffer()), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return JSON.parse(result.stdout.toString());
}

test('XLSX uses one collision-free hidden helper and literal named lists without altering the workbook', independentReader, async () => {
  const values = ['長'.repeat(1000), 'with, comma', 'a "quote"', '=SUM(A1)', '00123', '_x0041_', '  padded  '];
  const validation = { type: 'list', values, allowBlank: false, message: '一覧 "から" 選択 <必須>' };
  const input = { sheets: [sheet('_LikeX_lists', { A1: { value: '00123', validation }, B1: { value: "'=SUM(A1)", validation } }), sheet('_LIKEX_LISTS_1')] };
  const before = JSON.stringify(input), result = await inspect(await exportSpreadsheetXlsx(input));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.sheets.map(item => item.name), ['_LikeX_lists', '_LIKEX_LISTS_1', '_LikeX_lists_2']);
  assert.equal(result.sheets[2].state, 'hidden');
  assert.equal(result.names.length, 1);
  assert.equal(result.names[0].value, "'_LikeX_lists_2'!$A$1:$A$7");
  const main = result.worksheets['xl/worksheets/sheet1.xml'], helper = result.worksheets['xl/worksheets/sheet3.xml'];
  assert.deepEqual(Object.values(helper.cells).map(cell => cell.value), values.map(value => value === '_x0041_' ? '_x005F_x0041_' : value));
  assert.ok(Object.values(helper.cells).every(cell => cell.t === 'inlineStr' && cell.formula === null));
  assert.equal(main.cells.A1.t, 'inlineStr'); assert.equal(main.cells.A1.value, '00123');
  assert.equal(main.cells.B1.value, '=SUM(A1)'); assert.equal(main.cells.B1.formula, null);
  assert.equal(main.validations.length, 2);
  assert.ok(main.validations.every(rule => rule.formula1 === result.names[0].name && rule.allowBlank === '0' && rule.errorStyle === 'stop'));
  assert.equal(main.validations[0].error, validation.message);
  assert.ok(result.relationships.some(item => item.Id === 'rId3' && item.Target === 'worksheets/sheet3.xml'));
  assert.ok(result.contentTypes.some(item => item.PartName === '/xl/worksheets/sheet3.xml' && item.ContentType.endsWith('worksheet+xml')));
});

test('XLSX retains checkbox booleans, blank rule cells and serial date constraints with ordered validation XML', independentReader, async () => {
  const input = { sheets: [{ ...sheet('Controls', {
    A1: { value: 'TRUE', validation: { type: 'checkbox' } }, A2: { value: 'FALSE', validation: { type: 'checkbox' } },
    A3: { value: '', validation: { type: 'checkbox' } },
    B1: { value: '2024-01-01', validation: { type: 'date', min: '2024-01-01', max: '2024-12-31' } },
    C1: { value: '3', validation: { type: 'number', integer: true, min: 0, max: 10 } },
    D1: { value: 'abc', validation: { type: 'textLength', min: 2, max: 5 } },
  }), merges: [{ top: 4, left: 0, bottom: 4, right: 1 }] }] };
  const result = await inspect(await exportSpreadsheetXlsx(input)), main = result.worksheets['xl/worksheets/sheet1.xml'];
  assert.equal(main.cells.A1.t, 'b'); assert.equal(main.cells.A1.value, '1');
  assert.equal(main.cells.A2.t, 'b'); assert.equal(main.cells.A2.value, '0');
  assert.equal(main.cells.A3.t, undefined); assert.equal(main.cells.A3.value, '');
  assert.equal(main.cells.B1.value, '45292');
  assert.deepEqual(Object.values(result.worksheets['xl/worksheets/sheet2.xml'].cells).map(cell => cell.value), ['TRUE', 'FALSE']);
  const date = main.validations.find(rule => rule.sqref === 'B1');
  assert.equal(date.type, 'date'); assert.equal(date.formula1, '45292'); assert.equal(date.formula2, '45657');
  assert.equal(main.validations.find(rule => rule.sqref === 'C1').type, 'whole');
  assert.equal(main.validations.find(rule => rule.sqref === 'D1').type, 'textLength');
  assert.ok(main.order.indexOf('dataValidations') > main.order.indexOf('mergeCells'));
});

test('workbooks without list rules do not gain helper sheets or defined names', independentReader, async () => {
  const result = await inspect(await exportSpreadsheetXlsx({ sheets: [sheet('Plain', { A1: { value: 'plain' } })] }));
  assert.equal(result.sheets.length, 1); assert.equal(result.names.length, 0);
  assert.equal(result.worksheets['xl/worksheets/sheet1.xml'].validations.length, 0);
});

test('unsupported Excel number and date boundaries fail instead of reversing or rounding constraints', () => {
  const renderRule = validation => dataValidationsXml(normalizeWorkbook({ sheets: [sheet('Limits', { A1: { value: '', validation } })] }).sheets[0]);
  for (const value of [1e308, -1e308, Number.MIN_VALUE, -Number.MIN_VALUE]) {
    assert.throws(() => renderRule({ type: 'number', min: value }), /Excelで表現できません/);
    assert.throws(() => renderRule({ type: 'number', max: value }), /Excelで表現できません/);
  }
  assert.match(renderRule({ type: 'number', min: -9.99999999999999e307, max: 9.99999999999999e307 }), /operator="between"/);
  assert.match(renderRule({ type: 'number', min: 0, max: 0 }), /<formula1>0<\/formula1><formula2>0<\/formula2>/);
  assert.throws(() => renderRule({ type: 'date', min: '1899-12-31' }), /1900年以降/);
});

test('helper candidate limits count deduplicated lists and reject excess before emitting sheets', () => {
  const values = Array.from({ length: 1000 }, (_, index) => `value-${index}`);
  const cells = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`A${index + 1}`, { value: '', validation: { type: 'list', values } }]));
  assert.equal(createValidationListRegistry({ sheets: [sheet('Limits', cells)] }).hasLists, true);
  const unique = Object.fromEntries(Object.entries(cells).map(([address, cell], index) => [address, { ...cell, validation: { type: 'list', values: values.map(value => `${index}-${value}`) } }]));
  assert.throws(() => createValidationListRegistry({ sheets: [sheet('Limits', unique)] }), /100,000件/);
});
