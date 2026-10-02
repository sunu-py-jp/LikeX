import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = await build({ stdin: { contents: `
  export * from './apps/playground/src/demo/spreadsheet-design-template.ts';
  export * from './packages/spreadsheet/src/model-entry.ts';
`, resolveDir: root }, alias: { '@likex/spreadsheet/model': `${root}/packages/spreadsheet/src/model-entry.ts` },
  bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createDesignTemplateWorkbook, isDesignTemplateWorkbook, DESIGN_TEMPLATE_PROMPT,
  normalizeWorkbook, serializeWorkbook, parseWorkbook, calculateWorkbook, applySpreadsheetCommands,
  exportSpreadsheetXlsx, importSpreadsheetXlsx } = model;
const sheetByName = (workbook, name) => workbook.sheets.find(sheet => sheet.name === name);
const expectedNames = ['表紙・変更履歴', '画面レイアウト', '画面項目一覧', 'チェック一覧', '処理仕様', '処理フロー', '参照マスタ', '要件資料'];

test('template keeps requirements separate from 50 editable field slots and preserves stable source IDs', () => {
  const workbook = normalizeWorkbook(createDesignTemplateWorkbook());
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), expectedNames);
  assert.equal(isDesignTemplateWorkbook(workbook), true);
  assert.ok(workbook.sheets.every(sheet => !sheet.tables?.length));
  const fields = sheetByName(workbook, '画面項目一覧'), source = sheetByName(workbook, '要件資料');
  const ids = Array.from({ length: 48 }, (_, index) => fields.cells[`A${index + 6}`].value);
  assert.equal(new Set(ids).size, 48);
  assert.deepEqual(ids, Array.from({ length: 48 }, (_, index) => source.cells[`A${index + 15}`].value));
  assert.ok(ids.every(id => /^(?:H\d{2}|D\d{2}|T\d{2}|A\d{2})$/.test(id)));
  for (let row = 6; row <= 55; row++) {
    assert.equal(fields.cells[`C${row}`].value, '');
    assert.equal(fields.cells[`K${row}`].value, '');
    assert.equal(fields.cells[`K${row}`].format.borders.bottom.style, 'solid');
  }
  assert.equal(fields.cells.A54.value, ''); assert.equal(fields.cells.A55.value, '');
  for (let row = 66; row <= 89; row++) {
    assert.equal(source.cells[`A${row}`].value, `C${String(row - 65).padStart(2, '0')}`);
    assert.ok(source.cells[`E${row}`].value); assert.ok(source.cells[`F${row}`].value); assert.ok(source.cells[`G${row}`].value);
  }
  assert.ok(source.cells.B10.value.includes('要確認'));
  assert.ok(DESIGN_TEMPLATE_PROMPT.length < 16_000);
  assert.ok(!/41,?160/.test(DESIGN_TEMPLATE_PROMPT), 'the request must derive totals from the current source, not a hard-coded demo amount');
  assert.ok(DESIGN_TEMPLATE_PROMPT.includes('人手で記入・修正した内容'));
  assert.ok(DESIGN_TEMPLATE_PROMPT.includes('矛盾する場合は勝手に書き換えず'));
  assert.ok(DESIGN_TEMPLATE_PROMPT.includes('そのシートを記入・確認→次のシート'));
  const initial = calculateWorkbook(workbook)[sheetByName(workbook, '表紙・変更履歴').id];
  assert.deepEqual(['B15', 'B16', 'B17', 'B18', 'B19', 'B20'].map(address => initial[address]), [0, 0, 0, 0, 0, 0]);
});

test('native round trip keeps scaffold formulas, merges, formatting and bound flow connections', () => {
  const workbook = createDesignTemplateWorkbook();
  const copy = parseWorkbook(serializeWorkbook(workbook));
  assert.equal(isDesignTemplateWorkbook(copy), true);
  assert.deepEqual(copy, workbook);
  const flow = sheetByName(copy, '処理フロー');
  const nodes = flow.drawings.filter(drawing => drawing.shape !== 'line');
  const lines = flow.drawings.filter(drawing => drawing.shape === 'line');
  assert.equal(nodes.length, 8); assert.equal(lines.length, 10);
  const nodeIds = new Set(nodes.map(drawing => drawing.id));
  assert.ok(lines.every(line => nodeIds.has(line.line?.start.binding?.targetId)
    && nodeIds.has(line.line?.end.binding?.targetId) && line.endArrow === 'triangle'));
  assert.ok(nodes.every(node => node.text.includes('記入待ち')));
  assert.ok(sheetByName(copy, '画面レイアウト').merges.length > 40);
  assert.equal(sheetByName(copy, '画面レイアウト').rowHeights[16], 72);
  assert.ok(sheetByName(copy, '画面項目一覧').columnWidths[9] >= 300);
});

test('filling through public commands updates progress and reconciles realistic price calculations', () => {
  const initial = createDesignTemplateWorkbook(), source = sheetByName(initial, '要件資料');
  const commands = [];
  for (const [targetName, start, end, sourceStart, targetColumn, sourceColumn] of [
    ['画面項目一覧', 6, 53, 15, 'C', 'C'], ['チェック一覧', 6, 29, 66, 'E', 'E'],
    ['処理仕様', 6, 13, 93, 'B', 'B'], ['参照マスタ', 6, 13, 104, 'B', 'B'],
  ]) {
    commands.push({ type: 'cells.set', sheetId: sheetByName(initial, targetName).id,
      values: Object.fromEntries(Array.from({ length: end - start + 1 }, (_, index) => [`${targetColumn}${start + index}`, source.cells[`${sourceColumn}${sourceStart + index}`].value])) });
  }
  const processing = sheetByName(initial, '処理仕様'), values = {};
  for (let index = 0; index < 3; index++) {
    const row = index + 18, sourceRow = index + 115;
    for (const col of ['B', 'C', 'D', 'E']) values[`${col}${row}`] = source.cells[`${col}${sourceRow}`].value;
    values[`F${row}`] = `=ROUNDDOWN(B${row}*C${row},0)-D${row}`;
    values[`G${row}`] = `=ROUNDDOWN(F${row}*E${row},0)`;
    values[`H${row}`] = `=F${row}+G${row}`;
    for (const [target, from] of [['I', 'F'], ['J', 'G'], ['K', 'H']]) values[`${target}${row}`] = source.cells[`${from}${sourceRow}`].value;
  }
  for (const [target, from] of [['I', 'F'], ['J', 'G'], ['K', 'H']]) values[`${target}22`] = source.cells[`${from}118`].value;
  commands.push({ type: 'cells.set', sheetId: processing.id, values });
  const result = applySpreadsheetCommands(initial, commands);
  assert.equal(result.ok, true, result.message);
  const calculations = calculateWorkbook(result.workbook), cover = calculations[sheetByName(initial, '表紙・変更履歴').id];
  assert.deepEqual(['B15', 'B16', 'B17', 'B18', 'B19', 'B20'].map(address => cover[address]), [48, 24, 8, 8, 88, 4]);
  assert.deepEqual(['L18', 'L19', 'L20', 'L22'].map(address => calculations[processing.id][address]), ['OK', 'OK', 'OK', 'OK']);
  assert.equal(calculations[processing.id].F22, 37500);
  assert.equal(calculations[processing.id].G22, 3660);
  assert.equal(calculations[processing.id].H22, 41160);
  assert.deepEqual(sheetByName(result.workbook, '要件資料'), source);
  assert.deepEqual(sheetByName(result.workbook, '画面項目一覧').cells.C6.format, sheetByName(initial, '画面項目一覧').cells.C6.format);
});

test('XLSX export and import retain usable scaffold cells, formats, dimensions and formula totals', async () => {
  const workbook = createDesignTemplateWorkbook();
  const file = await exportSpreadsheetXlsx(workbook);
  const result = await importSpreadsheetXlsx(new Uint8Array(await file.arrayBuffer()));
  const imported = result.workbook;
  assert.deepEqual(imported.sheets.map(sheet => sheet.name), expectedNames);
  assert.equal(isDesignTemplateWorkbook(imported), true);
  const before = sheetByName(workbook, '画面項目一覧'), after = sheetByName(imported, '画面項目一覧');
  assert.equal(after.cells.A6.value, 'H01');
  assert.equal(after.cells.C6.value, '');
  assert.equal(after.cells.C6.format.borders.bottom.style, 'solid');
  assert.equal(after.cells.C5.format.background.toLowerCase(), '#127c80');
  assert.ok(Math.abs(after.columnWidths[9] - before.columnWidths[9]) < 2);
  assert.ok(Math.abs(after.rowHeights[5] - before.rowHeights[5]) < 1);
  assert.deepEqual(after.merges, before.merges);
  assert.equal(sheetByName(imported, '処理仕様').cells.F22.value, '=SUM(F18:F20)');
  const flow = sheetByName(imported, '処理フロー');
  assert.equal(flow.drawings.length, 18);
  const importedNodeIds = new Set(flow.drawings.filter(drawing => drawing.shape !== 'line').map(drawing => drawing.id));
  const importedLines = flow.drawings.filter(drawing => drawing.shape === 'line');
  assert.equal(importedLines.length, 10);
  assert.ok(importedLines.every(line => importedNodeIds.has(line.line?.start.binding?.targetId)
    && importedNodeIds.has(line.line?.end.binding?.targetId) && line.endArrow === 'triangle'));
  const calculated = calculateWorkbook(imported)[sheetByName(imported, '表紙・変更履歴').id];
  assert.equal(calculated.B19, 0);
});
