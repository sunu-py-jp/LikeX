import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const range = { top: 1, left: 1, bottom: 2, right: 2 };
const line = { style: 'solid', width: 1, color: '#808080' };
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet', rowCount: 8, columnCount: 8, cells, ...extra }] });
const edges = (workbook, address) => workbook.sheets[0].cells[address]?.format?.borders ?? {};
const command = (preset, ranges = [range], border) => ({ type: 'cells.borders', sheetId: 's', ranges, preset, ...(border ? { border } : {}) });

test('outside and inside presets use range geometry, keep values/formulas/validation, and share adjacent edges', () => {
  const original = book({ B2: { value: '42', format: { bold: true, background: '#eeeeee' }, validation: { type: 'number', min: 1 } }, C3: { value: '=B2*2' }, B1: { value: 'Above', format: { borders: { bottom: { width: 3, color: '#ff0000' }, top: { style: 'dotted' } } } } });
  const before = m.serializeWorkbook(original), outside = m.setCellBorders(original, 's', [range], 'outside');
  assert.deepEqual(edges(outside, 'B2'), { top: line, left: line });
  assert.deepEqual(edges(outside, 'C3'), { right: line, bottom: line });
  assert.deepEqual(edges(outside, 'B1').bottom, line);
  assert.deepEqual(edges(outside, 'B1').top, { style: 'dotted' });
  assert.equal(outside.sheets[0].cells.B2.format.bold, true);
  assert.equal(outside.sheets[0].cells.B2.format.background, '#eeeeee');
  assert.deepEqual(outside.sheets[0].cells.B2.validation, original.sheets[0].cells.B2.validation);
  assert.equal(outside.sheets[0].cells.C3.value, '=B2*2');
  assert.equal(m.serializeWorkbook(original), before);
  const inside = m.setCellBorders(book(), 's', [range], 'inside');
  assert.deepEqual(edges(inside, 'B2'), { right: line, bottom: line });
  assert.deepEqual(edges(inside, 'C3'), { top: line, left: line });
  assert.deepEqual(edges(inside, 'B1'), {});
});

test('all and directional presets preserve unrelated sides and apply custom border styles', () => {
  const all = m.setCellBorders(book(), 's', [range], 'all');
  assert.deepEqual(edges(all, 'B2'), { top: line, right: line, bottom: line, left: line });
  for (const [preset, target, neighbour, counter] of [['top', 'B2', 'B1', 'bottom'], ['bottom', 'B3', 'B4', 'top'], ['left', 'B2', 'A2', 'right'], ['right', 'C2', 'D2', 'left']]) {
    const border = { style: 'dashed', width: 2, color: '#112233' };
    const styled = m.setCellBorders(book(), 's', [range], preset, border);
    assert.deepEqual(edges(styled, target)[preset], border);
    assert.deepEqual(edges(styled, neighbour)[counter], border);
    assert.equal(Object.keys(edges(styled, target)).length, 1);
  }
});

test('none removes opposite-side borders and returns an unchanged workbook when nothing remains', () => {
  const source = book({ B2: { value: 'keep', format: { italic: true } }, B1: { value: '', format: { borders: { bottom: line, top: { width: 3 } } } } });
  const cleared = m.setCellBorders(source, 's', [range], 'none');
  assert.deepEqual(edges(cleared, 'B1'), { top: { width: 3 } });
  assert.equal(cleared.sheets[0].cells.B2.value, 'keep');
  assert.deepEqual(cleared.sheets[0].cells.B2.format, { italic: true });
  assert.equal(m.setCellBorders(cleared, 's', [range], 'none'), cleared);
  const styled = m.setCellBorders(source, 's', [range], 'all');
  assert.deepEqual(edges(m.setCellBorders(styled, 's', [range], 'outside', { style: 'none' }), 'B2'), { right: line, bottom: line });
});

test('disjoint ranges keep independent outlines and worksheet edge selections never leave bounds', () => {
  const ranges = [{ top: 0, left: 0, bottom: 0, right: 0 }, { top: 7, left: 7, bottom: 7, right: 7 }];
  const result = m.setCellBorders(book(), 's', ranges, 'outside');
  assert.deepEqual(edges(result, 'A1'), { top: line, right: line, bottom: line, left: line });
  assert.deepEqual(edges(result, 'H8'), { top: line, right: line, bottom: line, left: line });
  assert.equal(result.sheets[0].cells.D4, undefined);
  assert.equal(m.setCellBorders(result, 's', [...ranges, ranges[0]], 'outside'), result);
});

test('merged targets expand selection and store both visible-anchor and XLSX-perimeter borders', () => {
  const merge = { top: 1, left: 1, bottom: 2, right: 2 };
  const source = book({ B2: { value: 'Merged' } }, { merges: [merge] });
  const styled = m.setCellBorders(source, 's', [{ top: 2, left: 2, bottom: 2, right: 2 }], 'all');
  assert.deepEqual(edges(styled, 'B2'), { top: line, right: line, bottom: line, left: line });
  assert.deepEqual(edges(styled, 'C3'), { right: line, bottom: line });
  assert.equal(edges(styled, 'C2').left, undefined);
  assert.equal(edges(styled, 'B3').top, undefined);
  assert.equal(m.setCellBorders(source, 's', [merge], 'inside'), source);
  const cleared = m.setCellBorders(styled, 's', [{ top: 2, left: 2, bottom: 2, right: 2 }], 'none');
  for (const address of ['B2', 'B3', 'C2', 'C3', 'B1', 'C4', 'A2', 'D3']) assert.deepEqual(edges(cleared, address), {});
  assert.equal(cleared.sheets[0].cells.B2.value, 'Merged');
});

test('a touched adjacent merged edge stays coherent across the whole visible edge', () => {
  const source = book({ B1: { value: 'Merged', format: { borders: { left: { width: 3, color: '#ff0000' } } } } }, { merges: [{ top: 0, left: 1, bottom: 3, right: 2 }] });
  const result = m.setCellBorders(source, 's', [{ top: 1, left: 0, bottom: 1, right: 0 }], 'right');
  for (const address of ['A1', 'A2', 'A3', 'A4']) assert.deepEqual(edges(result, address).right, line);
  for (const address of ['B1', 'B2', 'B3', 'B4']) assert.deepEqual(edges(result, address).left, line);
  assert.deepEqual(edges(result, 'C1'), {});
});

test('invalid requests and oversized merged expansion fail atomically', () => {
  const original = book(), before = m.serializeWorkbook(original);
  for (const [ranges, preset, border] of [[[], 'all'], [[range, { ...range, bottom: 8 }], 'all'], [[range], 'diagonal'], [[range], 'all', { width: 4 }], [[range], 'none', { color: 'red; color:blue' }]]) assert.throws(() => m.setCellBorders(original, 's', ranges, preset, border));
  const large = book({}, { rowCount: 200, columnCount: 200 });
  assert.throws(() => m.setCellBorders(large, 's', [{ top: 0, left: 0, bottom: 100, right: 100 }], 'all'), /10,000/);
  const merged = book({}, { rowCount: 200, columnCount: 200, merges: [{ top: 0, left: 0, bottom: 100, right: 100 }] });
  assert.throws(() => m.setCellBorders(merged, 's', [{ top: 0, left: 0, bottom: 0, right: 0 }], 'outside'), /10,000/);
  assert.equal(m.serializeWorkbook(original), before);
});

test('public commands keep formatting feature checks, batch atomicity, and one-step undo/redo', () => {
  const original = book({ B2: { value: 'Keep' } });
  const disabled = m.applySpreadsheetCommands(original, [command('all')], { features: { formatting: false } });
  assert.equal(disabled.ok, false); assert.equal(disabled.code, 'FEATURE_DISABLED');
  const failed = m.applySpreadsheetCommands(original, [command('all'), command('outside', [{ top: 0, left: 0, bottom: 8, right: 0 }])]);
  assert.equal(failed.ok, false); assert.equal(failed.commandIndex, 1); assert.equal('workbook' in failed, false);
  const session = m.createSpreadsheetSession(original);
  assert.equal(session.execute(command('all')).changed, true);
  assert.equal(session.execute(command('all')).changed, false);
  assert.equal(session.undo(), true); assert.deepEqual(session.getWorkbook(), original);
  assert.equal(session.redo(), true); assert.deepEqual(edges(session.getWorkbook(), 'B2'), { top: line, right: line, bottom: line, left: line });
});

test('native JSON and XLSX round-trip the generated borders, including merged perimeters', async () => {
  const original = book({ B2: { value: 'Merged', format: { bold: true } } }, { merges: [range] });
  const styled = m.setCellBorders(original, 's', [range], 'outside', { style: 'dashed', width: 2, color: '#112233' });
  assert.equal(m.serializeWorkbook(m.parseWorkbook(m.serializeWorkbook(styled))), m.serializeWorkbook(styled));
  const imported = (await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(styled))).workbook;
  for (const address of ['B2', 'B3', 'C2', 'C3']) assert.deepEqual(imported.sheets[0].cells[address]?.format?.borders, styled.sheets[0].cells[address]?.format?.borders);
  assert.equal(imported.sheets[0].cells.B2.value, 'Merged');
  assert.equal(imported.sheets[0].cells.B2.format.bold, true);
});
