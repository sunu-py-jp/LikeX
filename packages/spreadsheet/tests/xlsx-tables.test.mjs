import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/export/export-xlsx'; export * from './src/export/xlsx/validation-lists';
export * from './src/commands/apply-spreadsheet-commands';`, resolveDir: new URL('../', import.meta.url).pathname,
  sourcefile: 'xlsx-tables-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { exportSpreadsheetXlsx, applySpreadsheetCommands: apply, createValidationListRegistry } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheet = (id, name = id) => ({ id, name, rowCount: 20, columnCount: 10, cells: {} });
const insert = (sheetId, name, target = { row: 1, column: 1 }, extra = {}) => ({ type: 'tables.insert', sheetId, name, target,
  headers: ['商品', '数量'], data: { type: 'rows', values: [['Apple', '2']] }, ...extra });
const independentReader = { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 is required for ZIP/XML verification' };
async function inspect(blob) {
  const result = spawnSync('python3', ['-c', `
import io, json, sys, zipfile, xml.etree.ElementTree as ET
ns = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    parts = {name:ET.fromstring(archive.read(name)) for name in archive.namelist() if name.endswith(('.xml','.rels'))}
    tables = {path:dict(root.attrib, columns=[dict(item.attrib) for item in root.findall('s:tableColumns/s:tableColumn', ns)], filter=root.find('s:autoFilter', ns).attrib) for path,root in parts.items() if path.startswith('xl/tables/')}
    worksheets = {}
    for path,root in parts.items():
        if not path.startswith('xl/worksheets/sheet') or not path.endswith('.xml'): continue
        worksheets[path] = {'order':[item.tag.split('}')[-1] for item in root],
            'tableParts':[dict(item.attrib) for item in root.findall('s:tableParts/s:tablePart', ns)],
            'cells':{item.get('r'):dict(item.attrib, text=''.join(item.itertext())) for item in root.findall('s:sheetData/s:row/s:c',ns)}}
    workbook = parts['xl/workbook.xml']
    print(json.dumps({'tables':tables, 'worksheets':worksheets,
        'names':[dict(item.attrib,value=item.text) for item in workbook.findall('s:definedNames/s:definedName',ns)],
        'nameContainers':len(workbook.findall('s:definedNames',ns)),
        'relationships':{path:[dict(item.attrib) for item in root] for path,root in parts.items() if path.endswith('.rels')},
        'contentTypes':[dict(item.attrib) for item in parts['[Content_Types].xml']]}))
`], { input: Buffer.from(await blob.arrayBuffer()), maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  return JSON.parse(result.stdout.toString());
}

test('real table parts have unique numeric IDs, worksheet relationships, columns and content types across sheets', independentReader, async () => {
  const created = apply({ sheets: [sheet('one'), sheet('two')] }, [insert('one', 'Orders'), insert('one', 'Archive', { row: 7, column: 1 }), insert('two', 'Other')]);
  assert.equal(created.ok, true, created.message);
  const before = JSON.stringify(created.workbook), result = await inspect(await exportSpreadsheetXlsx(created.workbook));
  assert.equal(JSON.stringify(created.workbook), before);
  assert.deepEqual(Object.keys(result.tables), ['xl/tables/table1.xml', 'xl/tables/table2.xml', 'xl/tables/table3.xml']);
  assert.deepEqual(Object.values(result.tables).map(table => table.id), ['1', '2', '3']);
  assert.deepEqual(Object.values(result.tables).map(table => table.name), ['Orders', 'Archive', 'Other']);
  const first = result.tables['xl/tables/table1.xml'];
  assert.equal(first.ref, 'B2:C3'); assert.equal(first.headerRowCount, '1'); assert.equal(first.totalsRowShown, '0');
  assert.deepEqual(first.columns, [{ id: '1', name: '商品' }, { id: '2', name: '数量' }]);
  assert.equal(first.filter.ref, 'B2:C3');
  const relationships = result.relationships['xl/worksheets/_rels/sheet1.xml.rels'];
  assert.deepEqual(relationships.map(link => link.Target), ['../tables/table1.xml', '../tables/table2.xml']);
  assert.ok(relationships.every(link => link.Type.endsWith('/table')));
  assert.deepEqual(result.worksheets['xl/worksheets/sheet1.xml'].tableParts.map(part => Object.values(part)[0]), relationships.map(link => link.Id));
  assert.equal(result.worksheets['xl/worksheets/sheet1.xml'].order.at(-1), 'tableParts');
  assert.equal(result.contentTypes.filter(item => item.ContentType.endsWith('table+xml')).length, 3);
});

test('one definedNames element combines quoted absolute user ranges and hidden validation lists', independentReader, async () => {
  const input = { sheets: [{ ...sheet('main', "Sales' 2026"), cells: { F1: { value: '選択', validation: { type: 'list', values: ['選択', 'Other'] } } } }],
    namedRanges: [{ id: 'n1', name: '売上明細', sheetId: 'main', range: { top: 1, left: 1, bottom: 3, right: 2 } },
      { id: 'n2', name: '選択セル', sheetId: 'main', range: { top: 0, left: 5, bottom: 0, right: 5 } }] };
  const result = await inspect(await exportSpreadsheetXlsx(input));
  assert.equal(result.nameContainers, 1); assert.equal(result.names.length, 3);
  assert.deepEqual(result.names.slice(0, 2), [
    { name: '売上明細', value: "'Sales'' 2026'!$B$2:$C$4" }, { name: '選択セル', value: "'Sales'' 2026'!$F$1" },
  ]);
  assert.equal(result.names[2].hidden, '1');
  assert.equal(result.names[2].value, "'_LikeX_lists'!$A$1:$A$2");
  assert.deepEqual(result.tables, {});
});

test('table headers are inline strings, escaped XML retains names, and header-only tables retain their exact range', independentReader, async () => {
  const labels = ['123', 'true', '=literal', '日本<&"'];
  const created = apply({ sheets: [sheet('main')] }, [insert('main', '売上', { row: 0, column: 0 }, {
    headers: labels, data: { type: 'rows', values: [] }, headerStyle: { background: '#ffeecc' },
  })]);
  assert.equal(created.ok, true, created.message);
  const result = await inspect(await exportSpreadsheetXlsx(created.workbook));
  const table = result.tables['xl/tables/table1.xml'];
  assert.equal(table.ref, 'A1:D1'); assert.equal(table.name, '売上');
  assert.deepEqual(table.columns.map(column => column.name), labels);
  const cells = result.worksheets['xl/worksheets/sheet1.xml'].cells;
  assert.deepEqual(Object.values(cells).map(cell => cell.text), labels);
  assert.ok(Object.values(cells).every(cell => cell.t === 'inlineStr' && cell.s !== '0'));
});

test('bordered table writes export only cell formatting and no structured table parts', independentReader, async () => {
  const command = insert('main', 'Unused'); delete command.name;
  const created = apply({ sheets: [sheet('main')] }, [{ ...command, type: 'cells.writeTable' }]);
  assert.equal(created.ok, true, created.message);
  const result = await inspect(await exportSpreadsheetXlsx(created.workbook));
  assert.deepEqual(result.tables, {}); assert.deepEqual(result.worksheets['xl/worksheets/sheet1.xml'].tableParts, []);
  assert.ok(Object.values(result.worksheets['xl/worksheets/sheet1.xml'].cells).every(cell => cell.s !== '0'));
});

test('hidden list name allocation avoids user name and table name collisions case-insensitively', () => {
  const registry = createValidationListRegistry({ sheets: [{ ...sheet('main'),
    cells: { A1: { value: '', validation: { type: 'list', values: ['A', 'B'] } } }, tables: [{ name: '_LIKEX_LIST_2' }] }],
    namedRanges: [{ name: '_likex_list_1' }] });
  assert.equal(registry.formulaForList(['A', 'B']), '_LikeX_list_3');
});
