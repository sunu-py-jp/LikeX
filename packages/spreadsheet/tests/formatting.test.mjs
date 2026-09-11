import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: `export * from './src/model'; export * from './src/model/formatting'; export * from './src/model/conditional-formatting'; export * from './src/state/sizing/auto-fit'; export * from './src/ui/grid/cell-style'; export * from './src/commands/formatting'; export * from './src/commands/stage-spreadsheet-commands'; export * from './src/api/resolve-features'; export * from './src/export/xlsx/styles'; export * from './src/export/xlsx/conditional-formatting';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const range = { top: 0, left: 0, bottom: 4, right: 1 };
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet1', rowCount: 10, columnCount: 5, cells, ...extra }] });
const rule = (extra = {}) => ({ id: 'r', ranges: [range], type: 'comparison', operator: 'gt', value: 10, format: { background: '#ff0000' }, ...extra });

test('all format fields survive normalized JSON and immutable nested border copies', () => {
  const format = { fontFamily: 'Noto Sans JP', fontSize: 24, wrap: true, verticalAlign: 'bottom', decimalPlaces: 4, useGrouping: false, negativeFormat: 'red-parentheses', numberFormat: 'number', borders: { top: { style: 'dashed', width: 2, color: '#123456' }, bottom: { style: 'double', width: 3 } } };
  const workbook = book({ A1: { value: '15.3', format } });
  assert.deepEqual(workbook.sheets[0].cells.A1.format, format);
  assert.ok(Object.isFrozen(workbook.sheets[0].cells.A1.format.borders.top));
  format.borders.top.width = 3;
  assert.equal(workbook.sheets[0].cells.A1.format.borders.top.width, 2);
  assert.ok(m.workbooksEqual(workbook, m.normalizeWorkbook(JSON.parse(JSON.stringify(workbook)))));
  for (const patch of [{ fontSize: 0 }, { fontSize: Infinity }, { fontSize: 201 }, { fontFamily: 'x; color:red' }, { fontFamily: '' }, { wrap: 1 }, { decimalPlaces: 1.1 }, { decimalPlaces: 11 }, { verticalAlign: 'center' }, { borders: { diagonal: {} } }, { borders: { top: { width: 9 } } }, { borders: { top: { color: 'url(x);' } } }]) assert.throws(() => m.normalizeCellFormat(patch));
});

test('format equality includes new attributes and retains default false semantics', () => {
  assert.ok(m.formatsEqual(undefined, { wrap: false, verticalAlign: 'middle', negativeFormat: 'minus', borders: {} }));
  for (const patch of [{ fontSize: 18 }, { fontFamily: 'Arial' }, { wrap: true }, { verticalAlign: 'bottom' }, { decimalPlaces: 0 }, { useGrouping: false }, { negativeFormat: 'red' }, { borders: { top: { width: 2 } } }]) assert.equal(m.formatsEqual(undefined, patch), false);
});

test('numeric display groups, fixes decimal places, formats negative values and uses shared Excel codes', () => {
  assert.equal(m.formatCellValue(12345.5, { numberFormat: 'number', decimalPlaces: 3 }), '12,345.500');
  assert.equal(m.formatCellValue(-12345.5, { numberFormat: 'number', decimalPlaces: 1, useGrouping: false, negativeFormat: 'red-parentheses' }), '(12345.5)');
  assert.equal(m.formatCellValue(0.125, { numberFormat: 'percent', decimalPlaces: 1 }), '12.5%');
  assert.equal(m.isNegativeRed(-3, { negativeFormat: 'red' }), true);
  assert.equal(m.isNegativeRed(3, { negativeFormat: 'red' }), false);
  assert.equal(m.cellNumberFormatCode({ numberFormat: 'number', decimalPlaces: 2, negativeFormat: 'red-parentheses' }), '#,##0.00;[Red](#,##0.00)');
  assert.equal(m.formatCellValue('0012', { numberFormat: 'number' }), '0012');
});

test('ISO date/time display and Excel serials are timezone independent, with Excel leap-day compatibility', () => {
  assert.equal(m.excelDateSerial('1900-01-01', 'date'), 1);
  assert.equal(m.excelDateSerial('1900-02-28', 'date'), 59);
  assert.equal(m.excelDateSerial('1900-03-01', 'date'), 61);
  assert.equal(m.formatCellValue(60, { numberFormat: 'date' }), '1900/02/29');
  assert.equal(m.formatCellValue('2026-09-10T03:04:05Z', { numberFormat: 'datetime' }), '2026/09/10 03:04:05');
  assert.equal(m.formatCellValue('2026-09-10T12:04:05+09:00', { numberFormat: 'datetime' }), '2026/09/10 03:04:05');
  assert.equal(m.formatCellValue('12:30:00', { numberFormat: 'time' }), '12:30:00');
  assert.equal(m.excelDateSerial('12:00', 'time'), 0.5);
  for (const value of ['2026-02-30', '2026-13-01', '2026-09-10T25:00', '2026-09-10T12:00+29:00', '1899-01-01']) assert.equal(m.excelDateSerial(value, 'datetime'), undefined, value);
});

test('conditional rules normalize without sharing arrays and reject ambiguous/outside input', () => {
  const source = rule(); const workbook = book({}, { conditionalFormats: [source] });
  assert.ok(Object.isFrozen(workbook.sheets[0].conditionalFormats[0].ranges[0]));
  source.ranges[0] = { ...range, bottom: 2 };
  assert.equal(workbook.sheets[0].conditionalFormats[0].ranges[0].bottom, 4);
  for (const rules of [[rule(), rule()], [rule({ ranges: [] })], [rule({ ranges: [{ ...range, bottom: 10 }] })], [rule({ value: Infinity })], [rule({ operator: 'between' })], [rule({ operator: 'between', value: 20, secondValue: 10 })], [rule({ type: 'dataBar', min: 3, max: 2, color: '#00f' })], [rule({ type: 'colorScale', colors: ['#f00'] })]]) assert.throws(() => book({}, { conditionalFormats: rules }));
});

test('conditional evaluation covers comparisons/text, precedence, stop, data bars and color scales', () => {
  const sheet = book({}, { conditionalFormats: [rule(), rule({ id: 'r2', format: { background: '#00f', bold: true } })] }).sheets[0];
  const apply = m.createConditionalFormatter(sheet, { A1: 15 });
  assert.deepEqual(apply(0, 0, 15, { italic: true }).format, { italic: true, background: '#ff0000', bold: true });
  assert.equal(apply(8, 0, 15).format, undefined);
  const stop = m.createConditionalFormatter(book({}, { conditionalFormats: [rule({ stopIfTrue: true }), rule({ id: 'r2', format: { bold: true } })] }).sheets[0], {});
  assert.equal(stop(0, 0, 15).format.bold, undefined);
  const text = m.createConditionalFormatter(book({}, { conditionalFormats: [rule({ type: 'text', operator: 'contains', value: 'A*' })] }).sheets[0], {});
  assert.ok(text(0, 0, 'a*literal').format); assert.equal(text(0, 0, 'abc').format, undefined);
  const visuals = m.createConditionalFormatter(book({}, { conditionalFormats: [{ id: 'bar', ranges: [range], type: 'dataBar', color: '#00f' }, { id: 'scale', ranges: [range], type: 'colorScale', colors: ['#f00', '#ff0', '#0f0'] }] }).sheets[0], { A1: -10, A2: 0, A3: 10 });
  assert.deepEqual(visuals(0, 0, -10).dataBar, { color: '#00f', start: 0, width: 50 });
  assert.deepEqual(visuals(1, 0, 0).dataBar, { color: '#00f', start: 50, width: 0 });
  assert.match(visuals(2, 0, 10).format.background, /#0f0 100%/);
});

test('row height and conditional commands create immutable undoable snapshots and reject invalid bounds', () => {
  const source = book();
  const sized = m.stageFormattingCommand(source, { type: 'rows.resize', sheetId: 's', row: 2, height: 60 });
  assert.equal(source.sheets[0].rowHeights, undefined); assert.equal(sized.sheets[0].rowHeights[2], 60);
  assert.equal(m.stageFormattingCommand(sized, { type: 'rows.resize', sheetId: 's', row: 2, height: 60 }), sized);
  assert.throws(() => m.stageFormattingCommand(source, { type: 'rows.resize', sheetId: 's', row: 10, height: 60 }));
  const styled = m.stageFormattingCommand(source, { type: 'conditionalFormats.set', sheetId: 's', rules: [rule()] });
  assert.equal(m.stageFormattingCommand(styled, { type: 'conditionalFormats.set', sheetId: 's', rules: [rule()] }), styled);
  assert.equal(m.workbooksEqual(source, styled), false);
});

test('conditional ranges move/expand/shrink on structural changes and disappear when fully removed', () => {
  const source = book({}, { conditionalFormats: [rule()] });
  const inserted = m.insertRows(source, 's', 2, 2);
  assert.equal(inserted.sheets[0].conditionalFormats[0].ranges[0].bottom, 6);
  const removed = m.deleteRows(inserted, 's', 0, 7);
  assert.deepEqual(removed.sheets[0].conditionalFormats, []);
  assert.equal(m.insertColumns(source, 's', 0).sheets[0].conditionalFormats[0].ranges[0].left, 1);
});

test('automatic sizing honors font metrics, explicit newline, wrapping, merged width and bounded dimensions', () => {
  const sheet = book({ A1: { value: 'ab\ncd', format: { fontSize: 20 } }, B2: { value: '0123456789'.repeat(10), format: { wrap: true } } }).sheets[0];
  assert.equal(m.autoFitRowHeight(sheet, 0, {}), 62);
  assert.ok(m.autoFitRowHeight(sheet, 1, {}) > 100);
  assert.equal(m.autoFitColumnWidth(sheet, 0, {}, text => text.length * 10), 36);
  assert.equal(m.autoFitColumnWidth(book({ A1: { value: 'a'.repeat(10000) } }).sheets[0], 0, {}), 1000);
  assert.equal(m.autoFitColumnWidth(book({ A1: { value: 'long title' } }, { merges: [{ top: 0, bottom: 0, left: 0, right: 2 }] }).sheets[0], 0, {}), 24);
});

test('XLSX serializes independent border edges, font, vertical wrap, negative/date codes and native CF', () => {
  const format = { fontFamily: 'Noto Sans JP', fontSize: 24, verticalAlign: 'bottom', wrap: true, numberFormat: 'number', decimalPlaces: 3, negativeFormat: 'red-parentheses', borders: { left: { style: 'dashed', width: 2, color: '#123456' }, bottom: { style: 'double' } } };
  const workbook = book({ A1: { value: '-15', format }, B1: { value: '2026-09-10', validation: { type: 'date' } } }, { conditionalFormats: [rule(), rule({ id: 'txt', type: 'text', operator: 'contains', value: 'A*<"' }), { id: 'bar', ranges: [range], type: 'dataBar', color: '#00f' }, { id: 'scale', ranges: [range], type: 'colorScale', colors: ['#f00', '#ff0', '#0f0'] }] });
  const styles = m.createXlsxStyles(workbook), xml = m.conditionalFormattingXml(workbook.sheets[0], styles);
  assert.match(styles.xml, /<sz val="18"/); assert.match(styles.xml, /<name val="Noto Sans JP"/); assert.match(styles.xml, /vertical="bottom" wrapText="1"/);
  assert.match(styles.xml, /left style="mediumDashed"/); assert.match(styles.xml, /bottom style="double"/); assert.match(styles.xml, /FF123456/);
  assert.match(styles.xml, /\[Red\]\(#,##0.000\)/); assert.match(styles.xml, /yyyy\/mm\/dd/);
  assert.ok(styles.styleId(m.xlsxCellFormat(workbook.sheets[0].cells.B1)) > 0);
  assert.match(xml, /type="cellIs"/); assert.match(xml, /FIND\(LOWER/); assert.match(xml, /A\*&lt;/); assert.match(xml, /type="dataBar"/); assert.match(xml, /type="colorScale"/);
  assert.match(xml, /cfvo type="percent" val="50"/);
});


test('bulk dimension command sizes all rows atomically without per-row transactions', () => {
  const source = m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet1', rowCount: 10000, columnCount: 2, cells: { A1: { value: 'x' } } }] });
  const rowHeights = Object.fromEntries(Array.from({ length: 10000 }, (_, row) => [row, 30]));
  const result = m.stageFormattingCommand(source, { type: 'dimensions.resize', sheetId: 's', rowHeights, columnWidths: { 0: 180 } });
  assert.equal(result.sheets[0].rowHeights[9999], 30);
  assert.equal(result.sheets[0].columnWidths[0], 180);
  assert.equal(source.sheets[0].rowHeights, undefined);
  assert.equal(m.stageFormattingCommand(result, { type: 'dimensions.resize', sheetId: 's', rowHeights, columnWidths: { 0: 180 } }), result);
  assert.throws(() => m.stageFormattingCommand(source, { type: 'dimensions.resize', sheetId: 's', rowHeights: { 0: 30 }, columnWidths: { 0: -1 } }));
});


test('sparse rules, ranges and scale colors fail at model and command boundaries without changing the workbook', () => {
  const trailingRuleHole = [rule()]; trailingRuleHole.length = 2;
  const partialRange = new Array(2); partialRange[0] = range;
  const partialColors = new Array(2); partialColors[0] = '#f00';
  const missingMiddleColor = new Array(3); missingMiddleColor[0] = '#f00'; missingMiddleColor[2] = '#0f0';
  const invalid = [
    new Array(1), trailingRuleHole, [undefined], [null],
    [rule({ ranges: new Array(1) })], [rule({ ranges: partialRange })],
    [rule({ type: 'colorScale', colors: new Array(2) })],
    [rule({ type: 'colorScale', colors: partialColors })],
    [rule({ type: 'colorScale', colors: missingMiddleColor })],
  ];
  const source = book({ A1: { value: 'unchanged' } }), before = JSON.stringify(source);
  for (const rules of invalid) {
    assert.throws(() => book({}, { conditionalFormats: rules }));
    assert.throws(() => book({}, { conditionalFormats: JSON.parse(JSON.stringify(rules)) }));
    const staged = m.stageSpreadsheetCommands(source, [
      { type: 'cells.set', sheetId: 's', values: { A1: 'must not publish' } },
      { type: 'conditionalFormats.set', sheetId: 's', rules },
    ], m.resolveSpreadsheetFeatures(), () => 'unused');
    assert.equal(staged.ok, false);
    assert.equal(staged.code, 'VALIDATION_FAILED');
    assert.equal(JSON.stringify(source), before);
    assert.doesNotThrow(() => m.createConditionalFormatter(source.sheets[0], {}));
  }
});
