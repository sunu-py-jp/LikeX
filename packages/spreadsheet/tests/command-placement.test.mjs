import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pngHeader } from './image-fixtures.mjs';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, createWorkbook, setCellValues, normalizeWorkbook, serializeWorkbook,
  getDrawingPlacement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const command = (type, payload = {}) => ({ type, sheetId, ...payload });
const image = (width, height) => ({ name: 'sample.png', mimeType: 'image/png', width, height,
  dataUrl: `data:image/png;base64,${pngHeader(width, height).toString('base64')}` });
const success = result => { assert.equal(result.ok, true, result.message); return result; };

test('cell placement covers requested sparse targets, including unchanged and empty values, without searching for vacancies', () => {
  const workbook = setCellValues(createWorkbook(), sheetId, { A1: 'same', Z99: 'occupied' });
  const result = success(apply(workbook, [command('cells.set', { values: { A1: 'same', C7: '' } })]));
  assert.equal(result.changed, false);
  assert.deepEqual(result.results[0].placement, { nextRow: 7, nextColumn: 3 });
  assert.equal(result.workbook.sheets[0].cells.C7, undefined);
  assert.equal(Object.isFrozen(result.results[0].placement), true);
  assert.deepEqual(success(apply(workbook, [command('cells.set', { values: { Z100: '' } })])).results[0].placement,
    { nextRow: 100, nextColumn: 26 });
});

test('empty cell and paste payloads omit placement instead of reporting an invented origin', () => {
  for (const item of [command('cells.set', { values: {} }),
    command('cells.paste', { target: { row: 3, column: 4 }, payload: { values: [] } }),
    command('cells.paste', { target: { row: 3, column: 4 }, payload: { values: [[], []] } })]) {
    const result = success(apply(createWorkbook(), [item]));
    assert.equal(result.changed, false);
    assert.equal(Object.hasOwn(result.results[0], 'placement'), false);
  }
});

test('paste uses the rectangular target size for ragged rows, blank cells and format-only transfers', () => {
  for (const extra of [{}, { mode: 'values' }, { mode: 'formats' }]) {
    const result = success(apply(createWorkbook(), [command('cells.paste', { target: { row: 2, column: 3 },
      payload: { values: [['one', '', 'three'], []], formats: [[{ bold: true }], []] }, ...extra })]));
    assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 6 });
  }
});

test('fill returns the complete destination rectangle including a source-only no-op', () => {
  const workbook = setCellValues(createWorkbook(), sheetId, { B2: '1' });
  const source = { top: 1, left: 1, bottom: 1, right: 1 };
  for (const [target, placement] of [[source, { nextRow: 2, nextColumn: 2 }],
    [{ ...source, bottom: 6 }, { nextRow: 7, nextColumn: 2 }],
    [{ ...source, right: 4 }, { nextRow: 2, nextColumn: 5 }]]) {
    const result = success(apply(workbook, [command('cells.fill', { source, target })]));
    assert.deepEqual(result.results[0].placement, placement);
  }
});

test('row and column insertion expose only their applicable axis and honor default or multiple counts', () => {
  for (const [type, axis] of [['rows.insert', 'nextRow'], ['columns.insert', 'nextColumn']]) {
    for (const count of [undefined, 3]) {
      const result = success(apply(createWorkbook(), [command(type, { index: 2, ...(count ? { count } : {}) })]));
      assert.deepEqual(result.results[0].placement, { [axis]: 2 + (count ?? 1) });
    }
  }
});

test('image placement preserves fractional display geometry and provides independent next row/column candidates', () => {
  const result = success(apply(createWorkbook(), [command('images.insert', {
    anchor: { row: 1, column: 2 }, resource: image(3, 2), width: 50,
  })]));
  const receipt = result.results[0];
  const drawing = result.workbook.sheets[0].drawings[0];
  assert.equal(drawing.height, 100 / 3);
  assert.deepEqual(receipt.placement, { nextRow: 3, nextColumn: 3 });
  const next = success(apply(result.workbook, [command('cells.set', { values: { [`C${receipt.placement.nextRow + 1}`]: '表の見出し' } })]));
  assert.equal(next.workbook.sheets[0].cells.C4.value, '表の見出し');
  assert.equal(drawing.anchor.column, 2, 'tables below the image keep its start column, not the independent right-hand candidate');
});

test('all drawing insert/update commands use offsets, resized dimensions and the shared placement helper', () => {
  const sized = success(apply(createWorkbook(), [command('dimensions.resize', {
    rowHeights: { 0: 40, 1: 60 }, columnWidths: { 0: 50, 1: 75 },
  })])).workbook;
  for (const [insertType, updateType, payload] of [
    ['images.insert', 'images.update', { resource: image(1, 1) }],
    ['shapes.insert', 'shapes.update', { shape: 'rectangle' }],
    ['textBoxes.insert', 'textBoxes.update', { text: '見出し' }],
  ]) {
    const result = success(apply(sized, [command(insertType, { ...payload,
      anchor: { row: 1, column: 1, offsetX: 5, offsetY: 6 }, width: 75, height: 62 })]));
    const receipt = result.results[0];
    assert.deepEqual(receipt.placement, { nextRow: 3, nextColumn: 3 });
    const calculated = getDrawingPlacement(result.workbook, sheetId, receipt.drawingId);
    assert.deepEqual(receipt.placement, { nextRow: calculated.nextRow, nextColumn: calculated.nextColumn });
    assert.deepEqual(Object.keys(receipt.placement).sort(), ['nextColumn', 'nextRow']);
    const update = success(apply(result.workbook, [command(updateType, { drawingId: receipt.drawingId,
      patch: { anchor: { row: 0, column: 0 }, width: 50, height: 40 } })]));
    assert.deepEqual(update.results[0].placement, { nextRow: 1, nextColumn: 1 });
    assert.equal(update.results[0].drawingId, receipt.drawingId);
    const same = success(apply(update.workbook, [command(updateType, { drawingId: receipt.drawingId, patch: {} })]));
    assert.equal(same.changed, false);
    assert.deepEqual(same.results[0].placement, { nextRow: 1, nextColumn: 1 });
  }
});

test('receipts retain each command poststate when later commands move targets or resize the grid', () => {
  const result = success(apply(createWorkbook(), [
    command('shapes.insert', { shape: 'rectangle', anchor: { row: 0, column: 0 }, width: 100, height: 56 }),
    command('rows.resize', { row: 0, height: 84 }),
    command('cells.set', { values: { A2: 'value' } }),
    command('rows.insert', { index: 0, count: 2 }),
  ]));
  assert.deepEqual(result.results[0].placement, { nextRow: 2, nextColumn: 1 });
  assert.deepEqual(result.results[2].placement, { nextRow: 2, nextColumn: 1 });
  assert.deepEqual(result.results[3].placement, { nextRow: 2 });
  assert.equal(result.workbook.sheets[0].cells.A4.value, 'value');
  const current = getDrawingPlacement(result.workbook, sheetId, result.results[0].drawingId);
  assert.equal(current.nextRow, 3);
});

test('drawing placement may extend beyond current dimensions and does not silently add rows or columns', () => {
  const workbook = normalizeWorkbook({ ...createWorkbook(), sheets: [{ ...createWorkbook().sheets[0], rowCount: 2, columnCount: 2 }] });
  const result = success(apply(workbook, [command('textBoxes.insert', {
    anchor: { row: 1, column: 1 }, width: 300, height: 100,
  })]));
  assert.deepEqual(result.results[0].placement, { nextRow: 5, nextColumn: 4 });
  assert.equal(result.workbook.sheets[0].rowCount, 2);
  assert.equal(result.workbook.sheets[0].columnCount, 2);
});

test('deletion, formatting, structure, comments and sheet operations never invent a placement', () => {
  let workbook = success(apply(createWorkbook(), [command('textBoxes.insert', { anchor: { row: 0, column: 0 } })])).workbook;
  const drawingId = workbook.sheets[0].drawings[0].id;
  const merge = { top: 2, left: 2, bottom: 2, right: 3 };
  const items = [
    command('cells.format', { addresses: ['A1'], format: { bold: true } }),
    command('cells.validation', { addresses: ['A1'], validation: null }),
    command('conditionalFormats.set', { rules: [] }),
    command('cells.merge', { range: merge }), command('cells.unmerge', { range: merge }),
    command('cells.replace', { query: { text: 'unused' }, replacement: 'replacement' }),
    command('rows.resize', { row: 0, height: 40 }), command('columns.resize', { column: 0, width: 150 }),
    command('dimensions.resize', { rowHeights: { 1: 40 } }),
    command('rows.delete', { index: 5 }), command('columns.delete', { index: 5 }),
    command('comments.set', { address: 'A1', comment: { text: 'note' } }),
    command('drawings.delete', { drawingId }), command('sheets.rename', { name: 'Renamed' }),
    { type: 'sheets.add', name: 'New' }, command('sheets.duplicate', { name: 'Copy' }),
    command('sheets.move', { index: 1 }), command('sheets.delete'),
  ];
  for (const item of items) {
    const result = success(apply(workbook, [item]));
    assert.equal(Object.hasOwn(result.results[0], 'placement'), false, item.type);
    workbook = result.workbook;
  }
});

test('later errors still discard placement receipts together with all partially applied changes', () => {
  const workbook = createWorkbook(), before = serializeWorkbook(workbook);
  const result = apply(workbook, [command('rows.insert', { index: 0, count: 2 }),
    command('images.insert', { resource: image(3, 2), anchor: { row: 1, column: 2 }, width: 50 }),
    command('cells.set', { values: { A99999: 'invalid target' } })]);
  assert.equal(result.ok, false); assert.equal(result.commandIndex, 2);
  assert.equal(Object.hasOwn(result, 'results'), false); assert.equal(Object.hasOwn(result, 'workbook'), false);
  assert.equal(serializeWorkbook(workbook), before);
});
