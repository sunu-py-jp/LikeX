import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { zip, fixture } from './helpers/xlsx-import-fixtures.mjs';

const bundle = await build({ stdin: { contents: `export * from './src/model-entry';
  export * from './src/import/zip'; export * from './src/import/xml';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xlsx-print-entry.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXlsx: read, exportSpreadsheetXlsx: write, openXlsxStreamingArchive, parseXml, child, children,
  normalizeWorkbook, getSheetPrintSettings } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=xlsx-print-settings-test-bundle.mjs').toString('base64')}`);
const settings = { area: { top: 1, left: 2, bottom: 70, right: 8 }, paperSize: 'A3', orientation: 'landscape', scale: 75,
  margins: { top: .25, bottom: .5, left: .4, right: .3 }, rowBreaks: [12, 45], columnBreaks: [6] };
const book = () => normalizeWorkbook({ sheets: [{ id: 's', name: "売上'26", rowCount: 100, columnCount: 26,
  cells: { C2: { value: 'kept' }, D4: { value: '=1+2' } }, printSettings: settings },
  { id: 'second', name: 'Other', rowCount: 10, columnCount: 10, cells: {} }],
  namedRanges: [{ id: 'named', name: 'Report', sheetId: 's', range: settings.area }] });
const content = '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>kept</t></is></c></row></sheetData>';
const fixtureBook = (value, metadata = '', extraNames = '') => zip(fixture({ sheets: [{ name: 'Print', xml: content + metadata }],
  workbookExtra: `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${value}</definedName>${extraNames}</definedNames>` }));

test('XLSX preserves print settings, scoped Print_Area and existing named ranges without warnings', async () => {
  const blob = await write(book()), archive = await openXlsxStreamingArchive(blob);
  const workbook = parseXml(await archive.read('xl/workbook.xml'));
  const names = children(child(workbook, 'definedNames'), 'definedName');
  const area = names.find(item => item.attributes.name === '_xlnm.Print_Area');
  assert.equal(area.attributes.localSheetId, '0'); assert.equal(area.text, "'売上''26'!$C$2:$I$71");
  assert.ok(names.some(item => item.attributes.name === 'Report'));
  const sheet = parseXml(await archive.read('xl/worksheets/sheet1.xml'));
  assert.equal(child(sheet, 'pageSetup').attributes.paperSize, '8');
  assert.equal(child(sheet, 'pageMargins').attributes.left, '.4'.replace(/^\./, '0.'));
  assert.deepEqual(children(child(sheet, 'rowBreaks'), 'brk').map(item => item.attributes.id), ['12', '45']);
  const restored = await read(blob);
  assert.deepEqual(restored.workbook.sheets[0].printSettings, settings); assert.deepEqual(restored.warnings, []);
  assert.equal(restored.workbook.sheets[1].printSettings, undefined);
  assert.equal(restored.workbook.sheets[0].cells.D4.value, '=1+2');
  assert.equal(restored.workbook.namedRanges[0].name, 'Report');
});

test('independent openpyxl reads paper, area, margins and zero-based manual break IDs', {
  skip: spawnSync('python3', ['-c', 'import openpyxl']).status !== 0 && 'openpyxl is required for independent reader verification',
}, async () => {
  const blob = await write(book());
  const result = spawnSync('python3', ['-c', `
import io, json, sys, openpyxl
sheet = openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read())).active
assert '$C$2:$I$71' in str(sheet.print_area), sheet.print_area
print(json.dumps({'paper': sheet.page_setup.paperSize, 'orientation': sheet.page_setup.orientation,
 'scale': sheet.page_setup.scale, 'left': sheet.page_margins.left, 'rows': [b.id for b in sheet.row_breaks.brk],
 'columns': [b.id for b in sheet.col_breaks.brk]}))
`], { input: Buffer.from(await blob.arrayBuffer()) });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout.toString()), { paper: 8, orientation: 'landscape', scale: 75, left: .4, rows: [12, 45], columns: [6] });
});

test('import grows sparse sheets for a valid print area and breaks using source default dimensions', async () => {
  const result = await read(fixtureBook("Print!$A$1:$AI$501", '<pageSetup paperSize="9"/>' +
    '<rowBreaks count="1" manualBreakCount="1"><brk id="600" max="16383" man="1"/></rowBreaks>'));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.rowCount, 601); assert.equal(sheet.columnCount, 35);
  assert.deepEqual(sheet.printSettings.area, { top: 0, left: 0, bottom: 500, right: 34 });
  assert.deepEqual(sheet.printSettings.rowBreaks, [600]); assert.equal(sheet.rowHeights[500], 20);
  assert.deepEqual(result.warnings, []);
});

test('invalid/unsupported areas preserve cells and supported layout with an omission warning', async () => {
  for (const value of ["Print!$A$1:$C$9,Print!$F$1:$G$9", "Print!$A:$C", "Other!$A$1:$C$9", "Print!$A$1:$XFD$1048576", 'bad']) {
    const result = await read(fixtureBook(value, '<pageSetup paperSize="8" orientation="landscape" scale="80"/>'));
    assert.equal(result.workbook.sheets[0].cells.A1.value, 'kept');
    assert.equal(result.workbook.sheets[0].printSettings.area, undefined);
    assert.equal(result.workbook.sheets[0].printSettings.paperSize, 'A3');
    assert.ok(result.warnings.some(item => item.message.includes('印刷範囲')));
  }
});

test('invalid print metadata recovers independently, automatic breaks are not promoted to manual breaks', async () => {
  const result = await read(fixtureBook('Print!$A$1:$F$20', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<pageSetup paperSize="9" orientation="landscape" scale="999" fitToWidth="1"/>' +
    '<pageMargins top="1" bottom="1" left="-1" right="1"/>' +
    '<rowBreaks><brk id="5" max="16383" man="1"/><brk id="10" max="16383"/><brk id="12" min="2" max="4" man="1"/><brk id="999999" max="16383" man="1"/></rowBreaks>'));
  const sheet = result.workbook.sheets[0];
  assert.deepEqual(sheet.printSettings.rowBreaks, [5]); assert.equal(sheet.printSettings.scale, undefined);
  assert.equal(sheet.printSettings.margins, undefined); assert.equal(sheet.printSettings.orientation, 'landscape');
  assert.ok(result.warnings.length >= 3); assert.equal(sheet.cells.A1.value, 'kept');
});

test('Print_Area remains sheet-scoped after renaming, reordering, duplicating and clearing', async () => {
  const { applySpreadsheetCommands: apply } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=xlsx-print-settings-test-bundle.mjs').toString('base64')}`);
  let changed = apply(book(), [{ type: 'sheets.rename', sheetId: 's', name: 'Renamed' }, { type: 'sheets.move', sheetId: 's', index: 1 },
    { type: 'sheets.duplicate', sheetId: 's', name: 'Copy' }]);
  assert.equal(changed.ok, true, changed.message);
  let restored = await read(await write(changed.workbook));
  for (const sheet of restored.workbook.sheets.filter(item => item.name !== 'Other')) assert.deepEqual(sheet.printSettings, settings);
  changed = apply(changed.workbook, [{ type: 'print.clearArea', sheetId: 's' }]);
  restored = await read(await write(changed.workbook));
  const renamed = restored.workbook.sheets.find(sheet => sheet.name === 'Renamed');
  assert.equal(getSheetPrintSettings(restored.workbook, renamed.id).area, undefined);
  assert.equal(renamed.printSettings.scale, 75);
});
