import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model-entry';
export { stageFormattingCommand } from './src/commands/formatting';
export { fitCellBoxStyle } from './src/ui/grid/cell-box-style';`,
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const source = () => m.normalizeWorkbook({ sheets: [{ id: 'small', name: 'Small dimensions', rowCount: 20, columnCount: 10,
  cells: { A1: { value: 'Preserve the original grid' } }, rowHeights: { 0: 1, 1: 7.5, 2: 10 }, columnWidths: { 0: 1, 1: 8, 2: 12 },
  drawings: [{ id: 'box', type: 'text', anchor: { row: 3, column: 3, offsetX: 0, offsetY: 0 },
    width: 120, height: 30, text: 'Label', fontSize: 12, color: '#000000', background: 'transparent' }] }] });

test('small imported dimensions survive SPON, XLSX and public drawing placement', async () => {
  const workbook = source(), sheet = workbook.sheets[0];
  assert.deepEqual(m.parseWorkbook(m.serializeWorkbook(workbook)), workbook);
  const bounds = m.getDrawingBounds(workbook, 'small', 'box');
  assert.equal(bounds.left, 21); assert.equal(bounds.top, 18.5);
  const { workbook: restored } = await m.importSpreadsheetXlsx(await m.exportSpreadsheetXlsx(workbook));
  for (const [index, height] of Object.entries(sheet.rowHeights)) assert.equal(restored.sheets[0].rowHeights[index], height);
  for (const [index, width] of Object.entries(sheet.columnWidths)) assert.ok(Math.abs(restored.sheets[0].columnWidths[index] - width) < 1);
  const importedBox = restored.sheets[0].drawings[0];
  assert.deepEqual(importedBox.anchor, sheet.drawings[0].anchor);
});

test('dimension commands accept small sizes atomically and reject nonpositive dimensions', () => {
  const workbook = source();
  const resized = m.stageFormattingCommand(workbook, { type: 'dimensions.resize', sheetId: 'small', rowHeights: { 4: 3.5 }, columnWidths: { 4: 2.5 } });
  assert.equal(resized.sheets[0].rowHeights[4], 3.5);
  assert.equal(resized.sheets[0].columnWidths[4], 2.5);
  assert.equal(workbook.sheets[0].rowHeights[4], undefined);
  assert.equal(m.stageFormattingCommand(workbook, { type: 'rows.resize', sheetId: 'small', row: 4, height: 1 }).sheets[0].rowHeights[4], 1);
  assert.equal(m.resizeColumn(workbook, 'small', 4, 2).sheets[0].columnWidths[4], 2);
  for (const invalid of [0, -1, NaN, Infinity, 1001]) {
    assert.throws(() => m.stageFormattingCommand(workbook, { type: 'dimensions.resize', sheetId: 'small', rowHeights: { 4: 3 }, columnWidths: { 4: invalid } }));
    assert.throws(() => m.stageFormattingCommand(workbook, { type: 'rows.resize', sheetId: 'small', row: 4, height: invalid }));
  }
  assert.equal(workbook.sheets[0].rowHeights[4], undefined);
});

test('tiny cell border boxes do not enlarge the imported grid', () => {
  for (const width of [1, 2, 3, 4]) {
    const style = m.fitCellBoxStyle({}, width, 1);
    assert.equal(style.paddingLeft + style.paddingRight + 1, width);
  }
  const original = { borderLeft: '4px solid red', borderRight: '4px solid blue', borderTop: '4px solid red', borderBottom: '4px solid blue' };
  const fitted = m.fitCellBoxStyle(original, 2, 1);
  assert.equal(fitted.borderLeftWidth + fitted.borderRightWidth + fitted.paddingLeft + fitted.paddingRight, 2);
  assert.equal(fitted.borderTopWidth + fitted.borderBottomWidth, 1);
  assert.equal(original.borderRight, '4px solid blue');
  assert.equal(original.borderRightWidth, undefined);
  assert.deepEqual(m.fitCellBoxStyle(original, 100, 30), original);
});
