import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { normalizeWorkbook, applySpreadsheetCommands: apply, serializeWorkbook, parseWorkbook, getSpreadsheetPrintLayout: layout,
  getSheetPrintSettings: settings, createSpreadsheetSession, workbooksEqual } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + "\n//# sourceURL=print-settings-test-bundle.mjs").toString('base64')}`);
const area = { top: 2, left: 1, bottom: 12, right: 7 };
const book = printSettings => normalizeWorkbook({ sheets: [{ id: 's', name: 'Main', rowCount: 100, columnCount: 26,
  cells: { B3: { value: 'kept' } }, ...(printSettings ? { printSettings } : {}) }] });
const run = (input, commands, options) => { const result = apply(input, commands, options); assert.equal(result.ok, true, result.message); return result; };
const set = range => ({ type: 'print.setArea', sheetId: 's', range });

test('commands copy print settings, normalize defaults/breaks and round-trip SPON without modifying cells', () => {
  const source = book(), margins = { top: .3, bottom: .4, left: .2, right: .6 };
  const result = run(source, [set(area), { type: 'print.setLayout', sheetId: 's', paperSize: 'A3', orientation: 'landscape', scale: 80, margins },
    { type: 'print.setBreaks', sheetId: 's', rows: [8, 4, 8], columns: [4] }]);
  const saved = settings(result.workbook, 's');
  assert.deepEqual(saved, { area, paperSize: 'A3', orientation: 'landscape', scale: 80, margins, rowBreaks: [4, 8], columnBreaks: [4] });
  margins.left = 2; assert.equal(saved.margins.left, .2);
  assert.ok(Object.isFrozen(saved)); assert.ok(Object.isFrozen(saved.area)); assert.ok(Object.isFrozen(saved.rowBreaks));
  assert.equal(settings(source, 's'), null);
  const json = serializeWorkbook(result.workbook); assert.equal(serializeWorkbook(parseWorkbook(json)), json);
  assert.equal(settings(parseWorkbook(json), 's').scale, 80); assert.equal(result.workbook.sheets[0].cells.B3.value, 'kept');
  assert.equal(run(result.workbook, [set(area)]).changed, false);
  assert.equal(run(book(), [{ type: 'print.setLayout', sheetId: 's', paperSize: 'A4', orientation: 'portrait', scale: 100 }]).changed, false);
  assert.equal(workbooksEqual(source, result.workbook), false);
  assert.throws(() => settings(source, 'missing'), /シート/);
});

test('clear area retains layout, and commands are atomic and feature controlled', () => {
  const source = book({ area, paperSize: 'Letter', rowBreaks: [5] });
  const cleared = run(source, [{ type: 'print.clearArea', sheetId: 's' }]);
  assert.deepEqual(settings(cleared.workbook, 's'), { paperSize: 'Letter', rowBreaks: [5] });
  assert.equal(layout(cleared.workbook.sheets[0]), null);
  assert.equal(apply(source, [set(area)], { features: { printArea: false } }).code, 'FEATURE_DISABLED');
  const failed = apply(source, [{ type: 'cells.set', sheetId: 's', values: { A1: 'changed' } }, set({ ...area, bottom: 101 })]);
  assert.equal(failed.ok, false); assert.equal(failed.commandIndex, 1); assert.equal(failed.workbook, undefined);
  assert.equal(source.sheets[0].cells.A1, undefined);
  assert.equal(apply(source, [{ type: 'print.setArea', sheetId: 's' }]).code, 'INVALID_COMMAND');
  const expected = book({ area });
  assert.equal(apply(source, [set(area)], { expected: { workbook: expected } }).code, 'PRECONDITION_FAILED');
});

test('invalid ranges, layout, margins and manual breaks fail validation without coercion', () => {
  for (const printSettings of [{ area: { ...area, left: -1 } }, { area: { ...area, top: 13 } }, { area: { ...area, right: 26 } },
    { scale: 9 }, { scale: 401 }, { scale: 33.5 }, { scale: '80' }, { paperSize: 'A5' }, { orientation: 'sideways' },
    { margins: { top: 0, bottom: 0, left: 8, right: 8 } }, { margins: { top: 0 } }, { margins: { top: NaN, bottom: 0, left: 0, right: 0 } },
    { rowBreaks: [0] }, { rowBreaks: [100] }, { columnBreaks: [1.2] }, { columnBreaks: ['2'] }, { unknown: true }]) assert.throws(() => book(printSettings));
  assert.throws(() => layout({ ...book().sheets[0], rowCount: Infinity, printSettings: { area: { ...area, bottom: 1e9 } } }));
});

test('sparse manual break arrays are rejected by normalization and atomic headless commands', () => {
  const source = book({ area });
  for (const breaks of [new Array(2), Object.assign(new Array(3), { 0: 1, 2: 3 })]) {
    for (const [setting, axis] of [['rowBreaks', 'rows'], ['columnBreaks', 'columns']]) {
      assert.throws(() => book({ area, [setting]: breaks }), /印刷/);
      const result = apply(source, [{ type: 'cells.set', sheetId: 's', values: { A1: 'changed' } },
        { type: 'print.setBreaks', sheetId: 's', [axis]: breaks }]);
      assert.equal(result.ok, false); assert.equal(result.commandIndex, 1);
      assert.equal(result.workbook, undefined); assert.equal(source.sheets[0].cells.A1, undefined);
    }
  }
});

test('public pagination validates raw row and column sizes with the workbook rules', () => {
  const sheet = book({ area }).sheets[0];
  for (const key of ['rowHeights', 'columnWidths']) {
    for (const overrides of [{ 0: NaN }, { 0: Infinity }, { 0: -Infinity }, { 0: 0 }, { 0: 1001 },
      { 0: '20' }, { '-1': 20 }, { '0.5': 20 }, { 100: 20 }, [20]]) {
      const invalid = { ...sheet, [key]: overrides };
      assert.throws(() => normalizeWorkbook({ sheets: [invalid] }), /サイズ|高さ|幅/);
      assert.throws(() => layout(invalid), /サイズ|高さ|幅/);
    }
  }
  const valid = { ...sheet, rowHeights: { 0: 1.5 }, columnWidths: { 0: 1000 } };
  assert.deepEqual(layout(valid), layout(normalizeWorkbook({ sheets: [valid] }).sheets[0]));
});

test('whole axis insertion/deletion follows the area and breaks; deleting its entire span clears it', () => {
  const source = book({ area, rowBreaks: [4, 8], columnBreaks: [4] });
  let next = run(source, [{ type: 'rows.insert', sheetId: 's', index: 2, count: 3 },
    { type: 'columns.insert', sheetId: 's', index: 4, count: 2 }]).workbook;
  assert.deepEqual(settings(next, 's'), { area: { top: 5, bottom: 15, left: 1, right: 9 }, rowBreaks: [7, 11], columnBreaks: [6] });
  next = run(next, [{ type: 'rows.delete', sheetId: 's', index: 6, count: 3 }]).workbook;
  assert.deepEqual(settings(next, 's').area, { top: 5, bottom: 12, left: 1, right: 9 });
  assert.deepEqual(settings(next, 's').rowBreaks, [6, 8]);
  next = run(next, [{ type: 'columns.delete', sheetId: 's', index: 1, count: 9 }]).workbook;
  assert.equal(settings(next, 's').area, undefined);
});

test('pagination combines paper capacity, scale, manual breaks, variable sizes and hidden rows', () => {
  const sheet = book({ area: { top: 0, left: 0, bottom: 99, right: 9 }, rowBreaks: [10], columnBreaks: [2] }).sheets[0];
  const pages = layout(sheet);
  assert.deepEqual(pages.rows.slice(0, 2).map(item => [item.start, item.end]), [[0, 9], [10, 43]]);
  assert.deepEqual(pages.columns.map(item => [item.start, item.end]), [[0, 1], [2, 7], [8, 9]]);
  assert.equal(pages.rows[1].offset, 280); assert.equal(pages.pageCount, pages.rows.length * pages.columns.length);
  const hidden = layout(sheet, { hiddenRows: new Set(Array.from({ length: 20 }, (_, i) => i + 10)) });
  assert.equal(hidden.rows[1].end, 63);
  const zoom = layout({ ...sheet, printSettings: { ...sheet.printSettings, scale: 200 } });
  assert.ok(zoom.pageCount > pages.pageCount);
  const landscape = layout({ ...sheet, printSettings: { ...sheet.printSettings, orientation: 'landscape' } });
  assert.ok(landscape.paperWidth > landscape.paperHeight);
  const huge = layout({ ...sheet, rowCount: 10_000, columnCount: 1000, printSettings: { area: { top: 0, left: 0, bottom: 9999, right: 999 }, scale: 400 } });
  assert.ok(huge.rows.length + huge.columns.length <= 11000); assert.ok(!('pages' in huge));
  const narrow = { ...sheet, printSettings: { area: { top: 0, left: 0, bottom: 9, right: 1 }, rowBreaks: [2, 4, 6, 8] } };
  const mostlyHidden = layout(narrow, { hiddenRows: new Set([0, 1, 2, 3, 4, 5, 7, 8, 9]) });
  assert.equal(mostlyHidden.pageCount, 1); assert.equal(mostlyHidden.rows[0].end, 9);
  assert.equal(layout(narrow, { hiddenRows: new Set(Array.from({ length: 10 }, (_, row) => row)) }).pageCount, 0);
});

test('session history and feature checks use the common command path', () => {
  const session = createSpreadsheetSession(book());
  const sheetReader = session.sheet('s');
  assert.equal(session.getPrintSettings('s'), null); assert.equal(sheetReader.getPrintSettings(), null);
  assert.equal(session.execute(set(area)).ok, true);
  assert.deepEqual(settings(session.getWorkbook(), 's').area, area);
  const saved = sheetReader.getPrintSettings();
  assert.deepEqual(session.getPrintSettings('s'), saved); assert.deepEqual(saved.area, area);
  assert.equal(layout(session.getSheet('s')).area.bottom, area.bottom);
  assert.equal(session.undo(), true); assert.equal(settings(session.getWorkbook(), 's'), null);
  assert.equal(sheetReader.getPrintSettings(), null); assert.deepEqual(saved.area, area);
  assert.equal(session.redo(), true); assert.deepEqual(settings(session.getWorkbook(), 's').area, area);
  assert.deepEqual(sheetReader.getPrintSettings(), saved); assert.ok(Object.isFrozen(saved.area));
  const disabled = createSpreadsheetSession(book(), { features: { printArea: false } });
  assert.equal(disabled.execute(set(area)).code, 'FEATURE_DISABLED');
});
