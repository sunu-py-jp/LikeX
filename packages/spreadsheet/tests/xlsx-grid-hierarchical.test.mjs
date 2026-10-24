import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const output = await build({
  stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { applySpreadsheetCommands: apply, exportSpreadsheetXlsx, importSpreadsheetXlsx,
  calculateWorkbook, serializeWorkbook, parseWorkbook, getCellFormat } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = (cells = {}, extra = {}) => ({ sheets: [{ id: 'main', name: 'Matrix', rowCount: 30, columnCount: 12, cells, ...extra }] });
const border = { color: '#345678', width: 2, style: 'solid' };
const command = (extra = {}) => ({ type: 'cells.writeGrid', sheetId: 'main', target: { row: 1, column: 1 },
  headers: [{ label: '=2026', children: ['001', 'false'] }, '備考'],
  rowHeaders: [{ label: '東日本', children: ['=東京', '横浜'] }, '大阪'],
  corner: { label: '=地域別実績', style: { background: '#eeeeee', color: '#222222' } },
  headerStyle: { background: '#217346', color: '#ffffff' }, rowHeaderStyle: { background: '#e2f0d9', color: '#333333' },
  border, data: { type: 'rows', values: [['=2*1200', '240', '本店'], ['860', '150', ''], ['1320', '270', '支店']] },
  ...extra });
const sortRanges = ranges => (ranges ?? []).map(item => JSON.stringify(item)).sort();

test('hierarchical matrices round-trip through XLSX as ordinary merges, literal headers, body formulas and grid styles', async () => {
  const created = apply(book({}, { rowHeights: { 1: 36, 3: 48 }, columnWidths: { 1: 120, 3: 160 } }), [command()]);
  assert.equal(created.ok, true, created.message);
  const before = serializeWorkbook(created.workbook), original = created.workbook.sheets[0];
  const blob = await exportSpreadsheetXlsx(created.workbook);
  assert.equal(serializeWorkbook(created.workbook), before);
  const { workbook, warnings } = await importSpreadsheetXlsx(blob), restored = workbook.sheets[0];
  assert.deepEqual(warnings, []); assert.equal(restored.tables, undefined);
  assert.deepEqual(sortRanges(restored.merges), sortRanges(original.merges));
  assert.equal(restored.cells.D4.value, '=2*1200');
  const calculated = calculateWorkbook(workbook)[restored.id];
  for (const [address, value] of Object.entries({ B2: '=地域別実績', D2: '=2026', D3: '001', E3: 'false', C4: '=東京', D4: 2400 }))
    assert.equal(calculated[address], value, address);
  for (const [address, background, color] of [['D2', '#217346', '#ffffff'], ['C4', '#e2f0d9', '#333333'], ['B2', '#eeeeee', '#222222']]) {
    assert.equal(restored.cells[address].format.background.toLowerCase(), background, address);
    assert.equal(restored.cells[address].format.color.toLowerCase(), color, address);
  }
  assert.deepEqual(restored.cells.F6.format.borders, { top: border, right: border, bottom: border, left: border });
  assert.equal(restored.rowHeights[1], 36); assert.equal(restored.rowHeights[3], 48);
  assert.ok(Math.abs(restored.columnWidths[1] - 120) < 1);
  assert.ok(Math.abs(restored.columnWidths[3] - 160) < 1);
});

test('protruding headers preserve untouched holes and existing hole merges after XLSX export and import', async () => {
  const untouchedMerge = { top: 1, left: 1, bottom: 1, right: 2 };
  const created = apply(book({ B2: { value: '備考欄', format: { background: '#ffeecc', bold: true } } }, { merges: [untouchedMerge] }), [command({
    headers: ['商品', '区分', { label: '実績', children: ['4月', '5月'] }], rowHeaders: undefined, corner: undefined,
    headerLayout: 'protruding', onConflict: 'error', data: { type: 'rows', values: [['商品A', '食品', '100', '120']] },
  })]);
  assert.equal(created.ok, true, created.message);
  const { workbook, warnings } = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(created.workbook));
  assert.deepEqual(warnings, []);
  const restored = workbook.sheets[0];
  assert.equal(restored.cells.B2.value, '備考欄'); assert.equal(restored.cells.B2.format.bold, true);
  assert.equal(restored.cells.B2.format.background.toLowerCase(), '#ffeecc');
  assert.equal(restored.cells.B3.value, '商品'); assert.equal(restored.cells.C3.value, '区分');
  assert.equal(restored.cells.D2.value, '実績'); assert.equal(restored.cells.E4.value, '120');
  assert.deepEqual(sortRanges(restored.merges), sortRanges(created.workbook.sheets[0].merges));
});

test('empty and explicitly styled corners preserve borders and optional merging through native and XLSX round-trips', async () => {
  for (const corner of [undefined, { label: null }, { label: '', border: { color: '#aa0000' } },
    { label: '地域', style: { background: '#ffeecc' }, border: { color: '#aa0000' } },
    { merge: true }, { label: '地域', merge: false, style: { background: '#ffeecc' }, border: { color: '#aa0000' } }]) {
    const created = apply(book(), [command({ corner })]); assert.equal(created.ok, true, created.message);
    const serialized = serializeWorkbook(created.workbook), native = parseWorkbook(serialized);
    assert.equal(serializeWorkbook(native), serialized);
    const cornerRange = { top: 1, left: 1, bottom: 2, right: 2 };
    const expectedMerge = corner?.merge ?? Boolean(corner?.label?.trim());
    assert.deepEqual(created.results[0].layout.cornerRange, cornerRange);
    assert.equal(native.sheets[0].merges.some(merge => JSON.stringify(merge) === JSON.stringify(cornerRange)), expectedMerge);
    const { workbook, warnings } = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(native));
    assert.deepEqual(warnings, []);
    const restored = workbook.sheets[0];
    assert.deepEqual(sortRanges(restored.merges), sortRanges(native.sheets[0].merges));
    assert.equal(restored.merges.some(merge => JSON.stringify(merge) === JSON.stringify(cornerRange)), expectedMerge);
    assert.equal(restored.cells.B2?.value ?? '', corner?.label ?? '');
    for (const address of ['C2', 'B3', 'C3']) assert.equal(restored.cells[address]?.value ?? '', '', address);
    const cornerFormat = getCellFormat(restored, 1, 1);
    assert.equal(cornerFormat?.background?.toLowerCase(), corner?.style?.background);
    if (corner?.label) assert.equal(cornerFormat?.color?.toLowerCase(), '#ffffff');
    else assert.notEqual(cornerFormat?.color?.toLowerCase(), '#ffffff');
    for (const [address, row, column] of [['B2', 1, 1], ['C2', 1, 2], ['B3', 2, 1], ['C3', 2, 2]]) {
      const format = getCellFormat(restored, row, column);
      if (corner?.border) {
        const expected = { ...border, ...corner.border };
        const borders = Object.fromEntries(Object.entries(format.borders).map(([edge, value]) => [edge,
          { ...value, color: value.color?.toLowerCase() }]));
        assert.deepEqual(borders,
          { top: expected, right: expected, bottom: expected, left: expected }, address);
      } else assert.deepEqual(format?.borders ?? {}, {}, address);
    }
    assert.deepEqual(restored.cells.D2.format.borders.left, border);
    assert.deepEqual(restored.cells.B4.format.borders.top, border);
    assert.equal(serializeWorkbook(created.workbook), serialized);
  }
});

test('an independent ZIP/XML reader sees exact merge addresses and no structured table parts', {
  skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 is required for independent ZIP/XML verification',
}, async () => {
  const created = apply(book(), [command()]); assert.equal(created.ok, true, created.message);
  const blob = await exportSpreadsheetXlsx(created.workbook);
  const result = spawnSync('python3', ['-c', `
import io, json, sys, zipfile, xml.etree.ElementTree as ET
ns = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    root = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    print(json.dumps({
        'merges':[item.get('ref') for item in root.findall('s:mergeCells/s:mergeCell',ns)],
        'tables':[name for name in archive.namelist() if name.startswith('xl/tables/')],
        'cells':{item.get('r'):{'type':item.get('t'),'text':''.join(item.itertext()),'formula':item.findtext('s:f',namespaces=ns)}
            for item in root.findall('s:sheetData/s:row/s:c',ns)}
    }))
`], { input: Buffer.from(await blob.arrayBuffer()), maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  const xml = JSON.parse(result.stdout.toString());
  assert.deepEqual(xml.tables, []);
  assert.deepEqual(xml.merges.sort(), ['B2:C3', 'D2:E2', 'F2:F3', 'B4:B5', 'B6:C6'].sort());
  for (const address of ['B2', 'D2', 'D3', 'E3', 'C4']) {
    assert.equal(xml.cells[address].type, 'inlineStr', address); assert.equal(xml.cells[address].formula, null, address);
  }
  assert.equal(xml.cells.D3.text, '001'); assert.equal(xml.cells.D4.formula, '2*1200');
});
