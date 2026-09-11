import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({ entryPoints: [fileURLToPath(new URL('../src/model/index.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=spreadsheet-model.mjs').toString('base64')}`);
const { createWorkbook, normalizeWorkbook, setCellValue, setCellValues, formatCells, resizeColumn,
  insertRows, deleteRows, insertColumns, deleteColumns, moveCells, addSheet, renameSheet, deleteSheet,
  calculateWorkbook, translateFormula, cellAddress, parseCellAddress, parseTsv, stringifyTsv, workbooksEqual, SPREADSHEET_LIMITS } = model;
const first = workbook => workbook.sheets[0].id;
const fill = values => { const wb = createWorkbook(); return setCellValues(wb, first(wb), values); };
const values = workbook => calculateWorkbook(workbook)[first(workbook)];

test('new workbooks and added sheets are frozen and sparse, with 300 rows and 26 columns', () => {
  const wb = createWorkbook();
  assert.equal(wb.sheets.length, 1);
  assert.equal(wb.sheets[0].rowCount, 300); assert.equal(wb.sheets[0].columnCount, 26);
  assert.equal(Object.keys(wb.sheets[0].cells).length, 0);
  assert.ok(Object.isFrozen(wb)); assert.ok(Object.isFrozen(wb.sheets[0].cells));
  assert.deepEqual(normalizeWorkbook(), wb);
  const added = addSheet(wb).sheets[1];
  assert.equal(added.rowCount, 300); assert.equal(added.columnCount, 26);
  assert.deepEqual(Object.keys(added.cells), []);
});

test('normalization clones host data, canonicalizes cell addresses, validates limits and keeps formatting-only cells', () => {
  const source = { sheets: [{ id: 'external', name: 'Data', cells: { a1: { value: '12', format: { bold: true } },
    B2: { value: '', format: { background: '#abc' } }, C3: { value: '' } }, rowCount: 10, columnCount: 4,
    columnWidths: { 0: 140 }, rowHeights: { 1: 40 } }] };
  const wb = normalizeWorkbook(source);
  assert.deepEqual(Object.keys(wb.sheets[0].cells), ['A1', 'B2']);
  source.sheets[0].cells.a1.value = 'changed'; source.sheets[0].cells.a1.format.bold = false;
  assert.equal(wb.sheets[0].cells.A1.value, '12'); assert.equal(wb.sheets[0].cells.A1.format.bold, true);
  assert.equal(wb.sheets[0].columnWidths[0], 140);
  for (const invalid of [{ sheets: [] }, { sheets: [{ ...source.sheets[0], rowCount: 0 }] },
    { sheets: [{ ...source.sheets[0], columnCount: SPREADSHEET_LIMITS.columns + 1 }] },
    { sheets: [{ ...source.sheets[0], cells: { Z100: { value: 'bad' } } }] },
    { sheets: [source.sheets[0], { ...source.sheets[0], id: 'duplicate-name' }] },
    { sheets: [{ ...source.sheets[0], cells: { A1: { value: 123 } } }] }]) assert.throws(() => normalizeWorkbook(invalid));
});

test('cell coordinates use zero-based indexes and reject invalid or excessive positions', () => {
  for (const [row, column, address] of [[0, 0, 'A1'], [9, 25, 'Z10'], [1, 26, 'AA2'], [9999, 999, 'ALL10000']]) {
    assert.equal(cellAddress(row, column), address); assert.deepEqual(parseCellAddress(address), { row, column });
  }
  assert.deepEqual(parseCellAddress('$a$2'), { row: 1, column: 0 });
  for (const address of ['A0', 'A01', 'A10001', 'ALM1', 'A1:B2', ' A1', '__proto__']) assert.equal(parseCellAddress(address), null);
  assert.throws(() => cellAddress(-1, 0)); assert.throws(() => cellAddress(0, 1000));
});

test('edits preserve undo snapshots and unchanged cells/sheets; no-ops preserve workbook identity', () => {
  const initial = addSheet(fill({ A1: 'one', B1: 'two' }));
  const next = setCellValue(initial, first(initial), 'a1', 'next');
  assert.notEqual(next, initial); assert.equal(initial.sheets[0].cells.A1.value, 'one');
  assert.equal(next.sheets[0].cells.B1, initial.sheets[0].cells.B1);
  assert.equal(next.sheets[1], initial.sheets[1]);
  assert.equal(setCellValue(next, first(next), 'A1', 'next'), next);
  assert.equal(setCellValue(next, first(next), 'C1', ''), next);
  const cleared = setCellValue(next, first(next), 'B1', '');
  assert.equal(cleared.sheets[0].cells.B1, undefined);
  assert.throws(() => setCellValues(initial, first(initial), { A1: 'would-change', [`A${initial.sheets[0].rowCount + 1}`]: 'bad' }));
  assert.equal(initial.sheets[0].cells.A1.value, 'one', 'failed batches are atomic');
});

test('formatting merges known properties without losing values and bounds column widths', () => {
  const wb = fill({ A1: '12' });
  const bold = formatCells(wb, first(wb), ['A1', 'B2'], { bold: true, color: '#123' });
  const next = formatCells(bold, first(wb), ['A1'], { italic: true, numberFormat: 'currency' });
  assert.deepEqual(next.sheets[0].cells.A1.format, { bold: true, italic: true, color: '#123', numberFormat: 'currency' });
  assert.equal(next.sheets[0].cells.A1.value, '12'); assert.equal(next.sheets[0].cells.B2.value, '');
  assert.equal(formatCells(next, first(wb), ['A1'], { italic: true }), next);
  assert.equal(resizeColumn(wb, first(wb), 0, 100), wb);
  assert.equal(resizeColumn(wb, first(wb), 0, 1).sheets[0].columnWidths[0], 24);
  assert.equal(resizeColumn(wb, first(wb), 0, 2000).sheets[0].columnWidths[0], 1000);
  assert.throws(() => formatCells(wb, first(wb), ['A1'], { background: 'red;position:fixed' }));
});

test('formulas support arithmetic precedence, power, percentages, comparisons and strings', () => {
  const wb = fill({ A1: '10', A2: '=1+2*3', A3: '=(1+2)*3', A4: '=2^3^2', A5: '=-2^2',
    A6: '=A1*10%', A7: '=A1>=10', A8: '="hello "&"world"', A9: '="a"="A"', A10: '=1e2+.5',
    A11: '="a""b"', A12: 'TRUE', A13: "'=1+2" });
  assert.deepEqual({ ...values(wb) }, { A1: 10, A2: 7, A3: 9, A4: 512, A5: -4, A6: 1,
    A7: true, A8: 'hello world', A9: true, A10: 100.5, A11: 'a"b', A12: true, A13: '=1+2' });
});

test('range and single-reference aggregates ignore blanks/text and include zero', () => {
  const wb = fill({ A1: '4', A2: '0', A4: 'label', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A4)',
    B3: '=MIN(A1:A4)', B4: '=MAX(A1:A4)', B5: '=COUNT(A1:A4)', B6: '=COUNT(A3)',
    B7: '=AVERAGE(A3)', B8: '=AVERAGE(A1,A3,A4)', B9: '=SUM(A4)', B10: '=COUNT(A1,A2,A3,A4)',
    B11: '=SUM(A4:A1)', B12: '=A3+1' });
  const result = values(wb);
  assert.equal(result.B1, 4); assert.equal(result.B2, 2); assert.equal(result.B3, 0); assert.equal(result.B4, 4);
  assert.equal(result.B5, 2); assert.equal(result.B6, 0); assert.equal(result.B7, '#DIV/0!');
  assert.equal(result.B8, 4); assert.equal(result.B9, 0); assert.equal(result.B10, 2); assert.equal(result.B11, 4); assert.equal(result.B12, 1);
});

test('IF evaluates only the chosen branch and error values propagate predictably', () => {
  const result = values(fill({ A1: '=IF(TRUE,42,1/0)', A2: '=IF(FALSE,A2,7)', A3: '=IF(1<2,"yes","no")',
    A4: '=1/0', A5: '=A4+1', A6: '=SUM(A4:A5)', A7: '=UNKNOWN(1)', A8: '="x"*2', A9: '=10^1000',
    A10: '=IF(FALSE,1)', A11: '=SUM(Z10000)', A12: '=IF(1)', A13: '=1+' }));
  assert.equal(result.A1, 42); assert.equal(result.A2, 7); assert.equal(result.A3, 'yes');
  assert.equal(result.A4, '#DIV/0!'); assert.equal(result.A5, '#DIV/0!'); assert.equal(result.A6, '#DIV/0!');
  assert.equal(result.A7, '#NAME?'); assert.equal(result.A8, '#VALUE!'); assert.equal(result.A9, '#NUM!');
  assert.equal(result.A10, false); assert.equal(result.A11, '#REF!'); assert.equal(result.A12, '#VALUE!'); assert.equal(result.A13, '#ERROR!');
});

test('sheet references resolve case-insensitively, including spaces and escaped apostrophes', () => {
  let wb = addSheet(fill({ A1: '5' }), "Team's Data");
  const id = wb.sheets[1].id;
  wb = setCellValues(wb, id, { A1: '2', A2: '3', B1: '=sheet1!A1+SUM(\'Team\'\'s Data\'!A1:A2)', B2: '=Missing!A1' });
  const result = calculateWorkbook(wb);
  assert.equal(result[id].B1, 10); assert.equal(result[id].B2, '#REF!');
});

test('cycles and resource bounds return spreadsheet errors without executing JavaScript or HTML', () => {
  globalThis.__spreadsheetExecutionProbe = 0;
  const result = values(fill({ A1: '=A2', A2: '=A1', A3: '=globalThis.__spreadsheetExecutionProbe=1',
    A4: '=fetch("https://invalid.example")', A5: '<img src=x onerror=alert(1)>',
    A6: '=' + '('.repeat(150) + '1' + ')'.repeat(150), A7: '=' + '1+'.repeat(2100) + '1' }));
  assert.equal(result.A1, '#CYCLE!'); assert.equal(result.A2, '#CYCLE!');
  assert.ok(['#NAME?', '#ERROR!'].includes(result.A3)); assert.equal(result.A4, '#NAME?');
  assert.equal(result.A5, '<img src=x onerror=alert(1)>'); assert.equal(globalThis.__spreadsheetExecutionProbe, 0);
  assert.equal(result.A6, '#LIMIT!'); assert.equal(result.A7, '#LIMIT!');
  delete globalThis.__spreadsheetExecutionProbe;
  const huge = normalizeWorkbook({ sheets: [{ ...createWorkbook().sheets[0], rowCount: 1000, columnCount: 100,
    cells: { A1: { value: '=SUM(B1:CV1000)' } } }] });
  assert.equal(values(huge).A1, '#LIMIT!');
  const growing = { A1: 'x'.repeat(1000) };
  for (let index = 2; index <= 30; index++) growing[`A${index}`] = `=A${index - 1}&A${index - 1}`;
  assert.equal(values(fill(growing)).A30, '#LIMIT!', 'reference chains cannot exponentially allocate text');
});

test('copy translation honors mixed absolute references, sheet qualifiers and quoted string literals', () => {
  assert.equal(translateFormula('=A1+$B2+C$3+$D$4+SUM(A1:B2)+"A1"', 2, 1), '=B3+$B4+D$3+$D$4+SUM(B3:C4)+"A1"');
  assert.equal(translateFormula("='Other Sheet'!A1+Sheet2!$B2", 1, 2), "='Other Sheet'!C2+Sheet2!$B3");
  assert.equal(translateFormula('=SUM(A1:B2)', -1, 0), '=SUM(#REF!)');
  assert.equal(translateFormula('plain A1', 2, 2), 'plain A1');
  assert.equal(translateFormula('=A1', 0, -1), '=#REF!');
});

test('inserting rows moves cells and expands same-sheet and cross-sheet ranges, including absolute references', () => {
  let wb = addSheet(fill({ A1: '1', A2: '2', A3: '3', B1: '=SUM(A1:A3)+$A$2', B2: '="A2"' }));
  wb = setCellValue(wb, wb.sheets[1].id, 'A1', '=SUM(Sheet1!A1:A3)');
  const next = insertRows(wb, first(wb), 1, 2);
  assert.equal(next.sheets[0].rowCount, wb.sheets[0].rowCount + 2); assert.equal(next.sheets[0].cells.A4.value, '2');
  assert.equal(next.sheets[0].cells.B1.value, '=SUM(A1:A5)+$A$4'); assert.equal(next.sheets[0].cells.B4.value, '="A2"');
  assert.equal(next.sheets[1].cells.A1.value, '=SUM(Sheet1!A1:A5)');
  assert.equal(values(next).B1, 8); assert.equal(calculateWorkbook(next)[next.sheets[1].id].A1, 6);
  assert.equal(wb.sheets[0].cells.A2.value, '2');
});

test('deleting rows shrinks partly overlapping ranges and invalidates deleted single/full-range references', () => {
  const wb = fill({ A1: '1', A2: '2', A3: '3', A4: '4', B1: '=SUM(A2:A4)', C1: '=A2',
    D1: '=SUM(A2:A2)', E1: '=SUM(A4:A2)' });
  const next = deleteRows(wb, first(wb), 1);
  assert.equal(next.sheets[0].cells.B1.value, '=SUM(A2:A3)'); assert.equal(values(next).B1, 7);
  assert.equal(next.sheets[0].cells.C1.value, '=#REF!'); assert.equal(values(next).C1, '#REF!');
  assert.equal(next.sheets[0].cells.D1.value, '=SUM(#REF!)'); assert.equal(values(next).D1, '#REF!');
  assert.equal(next.sheets[0].cells.E1.value, '=SUM(A3:A2)');
  assert.equal(next.sheets[0].rowCount, wb.sheets[0].rowCount - 1);
});

test('column structure updates dimensions, widths, formulas and preserves unaffected sheets', () => {
  let wb = addSheet(fill({ A1: '1', B1: '2', C1: '=SUM(A1:B1)' }));
  wb = resizeColumn(wb, first(wb), 1, 180);
  const inserted = insertColumns(wb, first(wb), 1);
  assert.equal(inserted.sheets[0].columnCount, 27); assert.equal(inserted.sheets[0].columnWidths[2], 180);
  assert.equal(inserted.sheets[0].cells.D1.value, '=SUM(A1:C1)');
  assert.equal(inserted.sheets[1], wb.sheets[1]);
  const deleted = deleteColumns(inserted, first(wb), 1);
  assert.deepEqual({ ...deleted.sheets[0].cells }, { ...wb.sheets[0].cells });
  assert.equal(deleted.sheets[0].columnWidths[1], 180);
  assert.throws(() => deleteRows(wb, first(wb), 0, wb.sheets[0].rowCount));
  assert.throws(() => insertColumns(wb, first(wb), -1));
});

test('rename and delete sheets update quoted references, preserve IDs, and reject invalid names or the last deletion', () => {
  let wb = addSheet(fill({ A1: '3' }), 'Totals');
  const second = wb.sheets[1].id;
  wb = setCellValues(wb, second, { A1: '=Sheet1!A1', A2: '=SUM(Sheet1!A1:A3)' });
  const renamed = renameSheet(wb, first(wb), "New's Data");
  assert.equal(renamed.sheets[0].id, first(wb)); assert.equal(renamed.sheets[1].cells.A1.value, "='New''s Data'!A1");
  assert.equal(calculateWorkbook(renamed)[second].A2, 3);
  const removed = deleteSheet(renamed, first(wb));
  assert.equal(removed.sheets[0].cells.A2.value, '=SUM(#REF!)');
  assert.equal(calculateWorkbook(removed)[second].A2, '#REF!');
  assert.throws(() => renameSheet(wb, first(wb), 'totals'));
  for (const name of ['', 'a/b', 'x'.repeat(32)]) assert.throws(() => renameSheet(wb, first(wb), name));
  assert.throws(() => deleteSheet(createWorkbook(), 'sheet-1'));
});

test('TSV round-trips tabs, multiline cells, quotes and CRLF clipboard endings', () => {
  const rows = [['name', 'notes'], ['A\tB', 'line 1\nline "2"'], ['', '=SUM(A1:A2)']];
  assert.deepEqual(parseTsv(stringifyTsv(rows)), rows);
  assert.deepEqual(parseTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseTsv(''), [['']]); assert.deepEqual(parseTsv('a\t'), [['a', '']]);
});

test('clipboard parsing rejects oversized input and cell counts before returning a giant matrix', () => {
  assert.throws(() => parseTsv('x'.repeat(SPREADSHEET_LIMITS.clipboardCharacters + 1)));
  assert.throws(() => parseTsv('x'.repeat(SPREADSHEET_LIMITS.cellLength + 1)));
  assert.throws(() => parseTsv('x\t'.repeat(SPREADSHEET_LIMITS.clipboardCells)));
  assert.equal(parseTsv('x\t'.repeat(SPREADSHEET_LIMITS.clipboardCells - 1) + 'x')[0].length, SPREADSHEET_LIMITS.clipboardCells);
  assert.throws(() => parseTsv('"unfinished'));
  assert.throws(() => stringifyTsv([Array(SPREADSHEET_LIMITS.clipboardCells + 1).fill('x')]));
});

test('cut/paste follows moved cells across all formulas without translating unrelated or fixed references', () => {
  let wb = fill({ A1: '2', B1: '=A1*3+$D$1', C1: '=A1', D1: '10', E1: '=SUM(A1:B1)' });
  wb = formatCells(wb, first(wb), ['A1'], { bold: true });
  const next = moveCells(wb, { sheetId: first(wb), top: 0, left: 0, bottom: 0, right: 1 },
    { sheetId: first(wb), row: 2, column: 0 });
  assert.equal(next.sheets[0].cells.A1, undefined); assert.equal(next.sheets[0].cells.A3.value, '2');
  assert.equal(next.sheets[0].cells.A3.format.bold, true);
  assert.equal(next.sheets[0].cells.B3.value, '=A3*3+$D$1');
  assert.equal(next.sheets[0].cells.C1.value, '=A3'); assert.equal(next.sheets[0].cells.E1.value, '=SUM(A3:B3)');
  assert.equal(values(next).B3, 16); assert.equal(values(next).E1, 18);
  assert.equal(wb.sheets[0].cells.A1.value, '2');
});

test('cross-sheet cut retains outside source references and updates remote dependents', () => {
  let wb = addSheet(fill({ A1: '2', B1: '=A1+$D$1', D1: '10' }), 'Destination');
  const destinationId = wb.sheets[1].id;
  wb = setCellValue(wb, destinationId, 'D1', '=Sheet1!A1');
  const next = moveCells(wb, { sheetId: first(wb), top: 0, left: 0, bottom: 0, right: 1 },
    { sheetId: destinationId, row: 2, column: 0 });
  assert.equal(next.sheets[1].cells.B3.value, "=A3+'Sheet1'!$D$1");
  assert.equal(next.sheets[1].cells.D1.value, "='Destination'!A3");
  assert.equal(calculateWorkbook(next)[destinationId].B3, 12);
  assert.equal(calculateWorkbook(next)[destinationId].D1, 2);
});

test('overlapping cut reads the original snapshot and blank source cells clear their destination', () => {
  const wb = fill({ A1: 'one', A2: 'two', A4: 'will-clear', B1: '=A2' });
  const next = moveCells(wb, { sheetId: first(wb), top: 0, left: 0, bottom: 2, right: 0 },
    { sheetId: first(wb), row: 1, column: 0 });
  assert.equal(next.sheets[0].cells.A1, undefined); assert.equal(next.sheets[0].cells.A2.value, 'one');
  assert.equal(next.sheets[0].cells.A3.value, 'two'); assert.equal(next.sheets[0].cells.A4, undefined);
  assert.equal(next.sheets[0].cells.B1.value, '=A3'); assert.equal(values(next).B1, 'two');
});

test('a partial range cut is rejected atomically, while the complete reference range can move', () => {
  const wb = fill({ A1: '1', A2: '2', A3: '3', B1: '=SUM(A1:A3)' });
  assert.throws(() => moveCells(wb, { sheetId: first(wb), top: 1, left: 0, bottom: 1, right: 0 },
    { sheetId: first(wb), row: 5, column: 0 }), /参照範囲全体/);
  assert.equal(wb.sheets[0].cells.A2.value, '2');
  const next = moveCells(wb, { sheetId: first(wb), top: 0, left: 0, bottom: 2, right: 0 },
    { sheetId: first(wb), row: 5, column: 0 });
  assert.equal(next.sheets[0].cells.B1.value, '=SUM(A6:A8)'); assert.equal(values(next).B1, 6);
  assert.throws(() => moveCells(wb, { sheetId: first(wb), top: 0, left: 0, bottom: 2, right: 0 },
    { sheetId: first(wb), row: SPREADSHEET_LIMITS.rows - 1, column: 0 }));
});

test('workbook equality ignores cell insertion order when manually restoring deleted values', () => {
  const original = fill({ A1: '1', B1: '2' });
  const removed = setCellValue(original, first(original), 'A1', '');
  const restored = setCellValue(removed, first(original), 'A1', '1');
  assert.notDeepEqual(Object.keys(original.sheets[0].cells), Object.keys(restored.sheets[0].cells));
  assert.equal(workbooksEqual(original, original), true);
  assert.equal(workbooksEqual(original, removed), false);
  assert.equal(workbooksEqual(original, restored), true);
  assert.equal(workbooksEqual(restored, original), true);
});

test('workbook equality includes ordered sheets, values, formats, dimensions and size overrides', () => {
  const original = addSheet(fill({ A1: '1', B1: '=A1' }));
  const changed = [setCellValue(original, first(original), 'A1', '2'),
    formatCells(original, first(original), ['A1'], { italic: true }),
    formatCells(original, first(original), ['A1'], { align: 'center' }),
    formatCells(original, first(original), ['A1'], { color: '#f00' }),
    resizeColumn(original, first(original), 0, 140), insertRows(original, first(original), 99),
    renameSheet(original, first(original), 'Renamed'), deleteSheet(original, original.sheets[1].id),
    normalizeWorkbook({ sheets: [...original.sheets].reverse() }),
    normalizeWorkbook({ sheets: original.sheets.map((sheet, index) => index ? sheet : { ...sheet, rowHeights: { 0: 40 } }) })];
  for (const next of changed) {
    assert.equal(workbooksEqual(original, next), false);
    assert.equal(workbooksEqual(next, original), false);
  }
  assert.equal(workbooksEqual(original, normalizeWorkbook(original)), true);
});

test('restoring default formatting and dimensions does not create false unsaved changes', () => {
  const original = fill({ A1: '1' });
  const styled = formatCells(original, first(original), ['A1', 'B1'], { bold: true });
  const unstyled = formatCells(styled, first(original), ['A1', 'B1'], { bold: false, numberFormat: 'general' });
  assert.equal(workbooksEqual(original, unstyled), true);
  const wider = resizeColumn(original, first(original), 0, 200);
  const restored = resizeColumn(wider, first(original), 0, 100);
  assert.equal(workbooksEqual(original, restored), true);
  const defaultHeight = normalizeWorkbook({ sheets: [{ ...original.sheets[0], rowHeights: { 0: 28 } }] });
  assert.equal(workbooksEqual(original, defaultHeight), true);
});
