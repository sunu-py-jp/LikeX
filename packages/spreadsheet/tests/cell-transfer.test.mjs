import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({
  stdin: { contents: 'export * from "./model"; export * from "./state/clipboard/cell-transfer"; export * from "./commands/stage-spreadsheet-commands"; export * from "./api/resolve-features";',
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
});
const core = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const context = (workbook, anchor, focus = anchor) => ({
  workbook, activeSheet: workbook.sheets[0], calculated: core.calculateWorkbook(workbook),
  selection: { sheetId: workbook.sheets[0].id, anchor, focus },
  features: { mergeCells: true, formulas: true, formatting: true, comments: true },
});
const applyPaste = (paste, workbook, nextId, features) => {
  const result = core.stageSpreadsheetCommands(workbook, paste.commands, core.resolveSpreadsheetFeatures(features), nextId);
  if (!result.ok) throw new Error(result.message);
  return result.workbook;
};

test('cell transfer works without React or browser adapters, including formulas, formatting, comments and merges', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(Object.keys(output.metafile.inputs).some(path => /node_modules|\/ui\/|browser-clipboard|use-spreadsheet/.test(path)), false);
  let workbook = core.createWorkbook();
  const sheetId = workbook.sheets[0].id;
  workbook = core.setCellValues(workbook, sheetId, { A1: '=C1+1', C1: '5' });
  workbook = core.formatCells(workbook, sheetId, ['A1'], { bold: true });
  workbook = core.setCellComment(workbook, sheetId, 'A1', { id: 'original-comment', text: '確認' });
  workbook = core.mergeCells(workbook, sheetId, { top: 0, left: 0, bottom: 0, right: 1 });
  const copied = { ...core.captureCopiedCells(context(workbook, { row: 0, column: 0 }, { row: 0, column: 1 }), false), token: 'test-copy' };
  assert.equal(copied.text, '6\t');
  const paste = core.prepareCellPaste(context(workbook, { row: 2, column: 0 }), copied.text, copied);
  const next = applyPaste(paste, workbook, () => 'copied-comment');
  assert.equal(next.sheets[0].cells.A3.value, '=C3+1');
  assert.deepEqual(next.sheets[0].cells.A3.format, { bold: true });
  assert.equal(next.sheets[0].comments.A3.id, 'copied-comment');
  assert.equal(next.sheets[0].comments.A1.id, 'original-comment');
  assert.deepEqual(next.sheets[0].merges, [
    { top: 0, left: 0, bottom: 0, right: 1 }, { top: 2, left: 0, bottom: 2, right: 1 },
  ]);
  assert.equal(workbook.sheets[0].cells.A3, undefined, 'preparation and application preserve the source snapshot');
});

test('transfer validation fails before publishing any workbook changes', () => {
  const workbook = core.createWorkbook();
  const source = context(workbook, { row: 0, column: 0 });
  source.features.formulas = false;
  const paste = core.prepareCellPaste(source, '=1+2', null);
  assert.throws(() => applyPaste(paste, workbook, () => assert.fail('no identity should be allocated'), { formulas: false }), /formulas|数式/);
  assert.deepEqual(workbook.sheets[0].cells, {});
  assert.throws(() => core.prepareCellPaste(context(workbook, { row: 0, column: 999 }), 'a\tb', null), /行数または列数が上限/);
  const merged = core.mergeCells(workbook, workbook.sheets[0].id, { top: 0, left: 0, bottom: 1, right: 1 });
  assert.throws(() => core.captureCopiedCells(context(merged, { row: 1, column: 1 }), false), /結合/);
});
