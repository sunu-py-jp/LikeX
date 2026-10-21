import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `
  export * from './src/model/workbook';
  export * from './src/model/query-reader';
  export * from './src/model/query';
  export * from './src/model/format-ranges';
  export * from './src/commands/apply-spreadsheet-commands';
  export * from './src/model/formula';
  export * from './src/model/editing/search';
  export * from './src/model/sizing/auto-fit';
  export * from './src/ui/thumbnail/prepare-thumbnail';
  export * from './src/state/use-spreadsheet';
  export * from './src/ui/spreadsheet-format-toolbar';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const area = (top, left, bottom, right, format) => ({ range: { top, left, bottom, right }, format });
function book() {
  return api.normalizeWorkbook({ sheets: [{ id: 's', name: 'Sheet', rowCount: 10000, columnCount: 1000,
    cells: { I1: { value: '0.25' }, J1: { value: '2' }, I2: { value: '=1+2' } },
    formatRanges: [area(0, 8, 0, 24, { background: '#fff2cc', align: 'center', numberFormat: 'percent' }),
      area(0, 25, 0, 25, { background: '#fff2cc', borders: { right: { style: 'solid', color: '#000000', width: 2 } } }),
      area(1, 8, 1, 25, { numberFormat: 'text', fontSize: 24 })] }] });
}

test('resolved read API and scoped facade expose sparse formatting without creating cells', () => {
  const workbook = book(), sheet = workbook.sheets[0], reader = api.createSpreadsheetReader(() => workbook);
  assert.equal(reader.getCell('s', 'K1'), undefined);
  assert.equal(reader.getRange('s', 'K1:L1')[0][0], null);
  assert.equal(reader.getCellFormat('s', 'K1').background, '#fff2cc');
  assert.equal(reader.sheet('s').getCellFormat('K1').align, 'center');
  assert.equal(reader.getFormatRanges('s').length, 3);
  assert.deepEqual(reader.sheet('s').getFormatRanges(), reader.getFormatRanges('s'));
  assert.equal(Object.keys(sheet.cells).length, 3);
  assert.ok(Object.isFrozen(reader.getCellFormat('s', 'K1')));
  assert.ok(Object.isFrozen(reader.getFormatRanges('s')[0].range));
  assert.throws(() => reader.getCellFormat('s', 'BAD0'));
});

test('range formatting drives calculation, search, thumbnail and automatic sizing consistently', () => {
  const workbook = book(), sheet = workbook.sheets[0];
  assert.equal(api.calculateWorkbook(workbook).s.I2, '=1+2', 'text format prevents formula interpretation');
  assert.equal(api.findSpreadsheetCells(workbook, { text: '25%', wholeCell: true })[0].address, 'I1');
  const scene = api.prepareSpreadsheetThumbnail(workbook);
  const i1 = scene.cells.find(cell => cell.address === 'I1');
  assert.equal(i1.text, '25%'); assert.equal(i1.style.backgroundColor, '#fff2cc');
  assert.equal(i1.format.align, 'center');
  const seen = [];
  api.autoFitColumnWidth(sheet, 8, api.calculateWorkbook(workbook).s, (text, format) => { seen.push([text, format]); return text.length * 8; });
  assert.ok(seen.some(([text, format]) => text === '=1+2' && format.fontSize === 24));
  assert.equal(Object.keys(sheet.cells).length, 3);
});

test('live readers see host changes to mutable range definitions', () => {
  const workbook = { sheets: [{ id: 's', name: 'S', rowCount: 10, columnCount: 10, cells: {}, formatRanges: [area(0, 0, 2, 2, { bold: true })] }] };
  const reader = api.createSpreadsheetReader(() => workbook);
  assert.equal(reader.getCellFormat('s', 'A1').bold, true);
  workbook.sheets[0].formatRanges[0].range.left = 1;
  assert.equal(reader.getCellFormat('s', 'A1'), undefined);
  workbook.sheets[0].formatRanges[0].format.bold = false;
  assert.equal(reader.getCellFormat('s', 'B1').bold, false);
});

test('literal replacement and grid writes honor inherited text formats when formulas are disabled', () => {
  const workbook = api.normalizeWorkbook({ sheets: [{ id: 's', name: 'S', rowCount: 10, columnCount: 10,
    cells: { A1: { value: 'literal' } }, formatRanges: [area(0, 0, 9, 9, { numberFormat: 'text' })] }] });
  const options = { features: { formulas: false } };
  const replaced = api.applySpreadsheetCommands(workbook, [{ type: 'cells.replace', sheetId: 's',
    query: { text: 'literal', lookIn: 'formulas' }, replacement: '=1+2' }], options);
  assert.equal(replaced.ok, true);
  assert.equal(api.calculateWorkbook(replaced.workbook).s.A1, '=1+2');
  const written = api.applySpreadsheetCommands(workbook, [{ type: 'cells.writeGrid', sheetId: 's',
    target: { row: 2, column: 0 }, headers: ['Literal'], data: { type: 'rows', values: [['=1+2']] } }], options);
  assert.equal(written.ok, true);
  assert.equal(api.calculateWorkbook(written.workbook).s.A4, '=1+2');
});

test('toolbar reads inherited style and formats whole columns without materializing their cells; undo restores ranges', async t => {
  let c, renderer;
  function Probe() { c = api.useSpreadsheet({ initialWorkbook: book(), onSave() {} }); return h(api.SpreadsheetFormatToolbar, { controller: c }); }
  await act(async () => { renderer = create(h(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  await act(async () => c.selectRangeInSheet('s', { row: 0, column: 8 }, { row: 9999, column: 9 }, { row: 0, column: 8 }, 'column'));
  assert.equal(renderer.root.findByProps({ 'aria-label': '中央揃え' }).props['aria-pressed'], true);
  const before = c.workbook;
  await act(async () => renderer.root.findByProps({ 'aria-label': '太字' }).props.onClick());
  assert.equal(c.error, null);
  assert.equal(api.getCellFormat(c.activeSheet, 9999, 9).bold, true);
  assert.equal(Object.keys(c.activeSheet.cells).length, 3);
  assert.ok(c.activeSheet.formatRanges.some(item => item.range.bottom === 'end'));
  await act(async () => c.undo()); assert.equal(c.workbook, before);
  await act(async () => c.redo()); assert.equal(api.getCellFormat(c.activeSheet, 9999, 9).bold, true);
});
