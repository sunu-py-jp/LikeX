import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/model'; export * from './src/model/data-validation';
export * from './src/model/workbook/data-validation'; export * from './src/commands/stage-spreadsheet-commands';
export * from './src/api/resolve-features'; export * from './src/export/xlsx/data-validation';
export * from './src/state/clipboard/cell-transfer';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'data-validation-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createWorkbook, normalizeWorkbook, parseWorkbook, serializeWorkbook, setCellValues, formatCells, workbooksEqual,
  insertRows, deleteRows, insertColumns, deleteColumns, addSheet, renameSheet, moveCells, mergeCells,
  setCellDataValidation, normalizeDataValidation, dataValidationError, dataValidationsEqual, dataValidationsXml,
  stageSpreadsheetCommands, resolveSpreadsheetFeatures, calculateWorkbook, captureCopiedCells, prepareCellPaste } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const rule = { type: 'list', values: ['未着手', '進行中', '完了'] };
const sheet = workbook => workbook.sheets[0];
const applyRule = (workbook, addresses, input = rule) => setCellDataValidation(workbook, sheet(workbook).id, addresses, input);
const write = (workbook, values) => setCellValues(workbook, sheet(workbook).id, values);
const applyPaste = (paste, workbook) => {
  const result = stageSpreadsheetCommands(workbook, paste.commands, resolveSpreadsheetFeatures(), () => 'note');
  if (!result.ok) throw new Error(result.message);
  return result.workbook;
};

test('rule normalization is strict, bounded, immutable and backward-compatible', () => {
  const input = { ...rule, values: [...rule.values] }, normalized = normalizeDataValidation(input);
  input.values[0] = 'changed'; assert.equal(normalized.values[0], '未着手');
  assert.ok(Object.isFrozen(normalized)); assert.ok(Object.isFrozen(normalized.values));
  assert.equal(normalizeDataValidation(normalized), normalized);
  assert.equal(dataValidationsEqual(normalized, { ...normalized, allowBlank: true, message: '' }), true);
  for (const input of [null, [], { type: 'formula', formula: '=TRUE' }, { type: 'checkbox', extra: 1 },
    { type: 'list', values: [] }, { type: 'list', values: new Array(1) }, { type: 'list', values: ['A', 'a'] },
    { type: 'list', values: [null] }, { type: 'list', values: [''] }, { type: 'list', values: ['x'.repeat(1001)] },
    { type: 'number', min: '0' }, { type: 'number', min: Infinity }, { type: 'number', min: 3, max: 2 },
    { type: 'number', integer: 'true' }, { type: 'textLength', min: -1 }, { type: 'textLength', max: 0.5 },
    { type: 'date', min: '2026-02-29' }, { type: 'date', min: '2026-10-01', max: '2026-09-01' },
    { type: 'checkbox', allowBlank: null }, { type: 'checkbox', message: 'x'.repeat(256) }])
    assert.throws(() => normalizeDataValidation(input), JSON.stringify(input));
  const original = createWorkbook();
  assert.equal(workbooksEqual(original, parseWorkbook(serializeWorkbook(original))), true);
  assert.equal(Object.hasOwn(sheet(original).cells, 'A1'), false);
});

test('all rule kinds validate literals, blank policy and effective formula results', () => {
  const cases = [
    [{ type: 'list', values: ['Draft', '=literal'] }, ['Draft', 'draft', "'=literal"], ['Other']],
    [{ type: 'number', min: -2, max: 3 }, ['-2', '3', '2.5', '2e0'], ['4', '12px', 'TRUE', 'NaN']],
    [{ type: 'number', integer: true }, ['-2', '0', '3e1'], ['2.5']],
    [{ type: 'textLength', min: 2, max: 3 }, ['日本', 'abc', '😀a'], ['a', 'abcd']],
    [{ type: 'date', min: '2024-01-01', max: '2024-12-31' }, ['2024-02-29', '2024-12-31'], ['2026-02-29', '2023-12-31', '2024-1-1']],
    [{ type: 'checkbox' }, ['TRUE', 'FALSE', 'true'], ['yes', '1']],
  ];
  for (const [rule, good, bad] of cases) {
    for (const value of good) assert.equal(dataValidationError(rule, value), null, `${rule.type}:${value}`);
    for (const value of bad) assert.ok(dataValidationError(rule, value), `${rule.type}:${value}`);
    assert.equal(dataValidationError(rule, ''), null);
    assert.ok(dataValidationError({ ...rule, allowBlank: false }, ''));
  }
  assert.equal(dataValidationError({ type: 'number', min: 2 }, '=1+1', 2), null);
  assert.equal(dataValidationError({ type: 'checkbox' }, '=1<2', true), null);
  assert.equal(dataValidationError({ type: 'list', values: ['yes'], message: '選んでください' }, 'no'), '選んでください');
});

test('empty validated cells persist through JSON and formatting, and rule-only changes are detectable', () => {
  const original = createWorkbook(), validated = applyRule(original, ['A1', 'B1']);
  assert.equal(sheet(validated).cells.A1.value, ''); assert.equal(sheet(original).cells.A1, undefined);
  assert.equal(workbooksEqual(original, validated), false);
  assert.equal(workbooksEqual(validated, parseWorkbook(serializeWorkbook(validated))), true);
  const formatted = formatCells(validated, sheet(validated).id, ['A1'], { bold: true });
  const cleared = formatCells(formatted, sheet(formatted).id, ['A1'], { bold: undefined });
  assert.equal(workbooksEqual(cleared, validated), true);
  assert.equal(applyRule(validated, ['A1', 'B1'], { ...rule, allowBlank: true }), validated);
  assert.equal(workbooksEqual(applyRule(validated, ['A1', 'B1'], null), original), true);
  assert.throws(() => applyRule(validated, ['A1'], { ...rule, allowBlank: false }), /空白/);
});

test('invalid multi-cell writes reject the entire change, including deletion with allowBlank false', () => {
  let workbook = write(createWorkbook(), { A1: '進行中', B1: '完了', C1: 'original' });
  workbook = applyRule(workbook, ['A1', 'B1'], { ...rule, allowBlank: false });
  assert.throws(() => write(workbook, { A1: '完了', B1: '不正', C1: 'changed' }), /B1/);
  assert.equal(sheet(workbook).cells.A1.value, '進行中'); assert.equal(sheet(workbook).cells.C1.value, 'original');
  assert.throws(() => write(workbook, { A1: '' }), /空白/);
  const valid = write(workbook, { A1: '完了', B1: '未着手' });
  assert.equal(sheet(valid).cells.A1.validation, sheet(workbook).cells.A1.validation);
  const permissive = applyRule(valid, ['A1'], rule);
  assert.ok(sheet(write(permissive, { A1: '' })).cells.A1.validation);
  const bulk = applyRule(createWorkbook(), Array.from({ length: 2000 }, (_, i) => `${String.fromCharCode(65 + i % 20)}${Math.floor(i / 20) + 1}`));
  assert.equal(Object.keys(sheet(bulk).cells).length, 2000);
  assert.throws(() => write(bulk, { A1: '完了', T100: 'bad' }), /T100/);
});

test('formula validation checks the final candidate and changes to dependencies cannot bypass rules', () => {
  let workbook = write(createWorkbook(), { A1: '4', B1: '=A1*2' });
  workbook = applyRule(workbook, ['B1'], { type: 'number', min: 1, max: 10 });
  assert.equal(sheet(write(workbook, { A1: '5' })).cells.A1.value, '5');
  assert.throws(() => write(workbook, { A1: '6' }), /B1/);
  assert.throws(() => write(workbook, { B1: '=B1' }), /計算結果/);
  assert.throws(() => write(workbook, { B1: '=1/0' }), /計算結果/);
  assert.throws(() => normalizeWorkbook({ sheets: [{ ...sheet(workbook), cells: { ...sheet(workbook).cells, A1: { value: '99' } } }] }), /B1/);
  const changed = write(workbook, { A1: '99', B1: '=1+1' });
  assert.equal(sheet(changed).cells.B1.value, '=1+1');
});

test('row/column operations and cut preserve rules and remove them only with the removed cells', () => {
  let original = write(createWorkbook(), { B2: '進行中' });
  original = applyRule(original, ['B2'], rule);
  let moved = insertRows(original, sheet(original).id, 0);
  moved = insertColumns(moved, sheet(moved).id, 0);
  assert.deepEqual(sheet(moved).cells.C3.validation, rule);
  moved = deleteColumns(moved, sheet(moved).id, 0); moved = deleteRows(moved, sheet(moved).id, 0);
  assert.equal(workbooksEqual(moved, original), true);
  const cut = moveCells(original, { sheetId: sheet(original).id, top: 1, left: 1, bottom: 1, right: 1 }, { sheetId: sheet(original).id, row: 3, column: 3 });
  assert.equal(sheet(cut).cells.B2, undefined); assert.deepEqual(sheet(cut).cells.D4.validation, rule);
  assert.equal(sheet(deleteRows(cut, sheet(cut).id, 3)).cells.D4, undefined);
  const required = applyRule(write(createWorkbook(), { A1: '1', B1: '2' }), ['B1'], { type: 'number', allowBlank: false });
  assert.throws(() => mergeCells(required, sheet(required).id, { top: 0, left: 0, bottom: 0, right: 1 }, { discardValues: true }), /空白/);
});

test('formula rewrites during sheet rename retain validation rules', () => {
  let workbook = addSheet(createWorkbook(), 'Other');
  workbook = setCellValues(workbook, workbook.sheets[1].id, { A1: '4' });
  workbook = write(workbook, { A1: "='Other'!A1" });
  workbook = applyRule(workbook, ['A1'], { type: 'number', min: 0, max: 10 });
  const renamed = renameSheet(workbook, workbook.sheets[1].id, 'Revised');
  assert.deepEqual(sheet(renamed).cells.A1.validation, { type: 'number', min: 0, max: 10 });
  assert.match(sheet(renamed).cells.A1.value, /Revised/);
});

test('API commands enforce feature switches while existing rules still reject writes', () => {
  const original = createWorkbook(), sheetId = sheet(original).id;
  const command = { type: 'cells.validation', sheetId, addresses: ['A1'], validation: rule };
  const execute = (workbook, commands, features) => stageSpreadsheetCommands(workbook, commands, resolveSpreadsheetFeatures(features), () => 'generated');
  assert.equal(execute(original, [command], { dataValidation: false }).code, 'FEATURE_DISABLED');
  assert.equal(execute(original, [{ ...command, validation: { type: 'checkbox' } }], { checkboxes: false }).code, 'FEATURE_DISABLED');
  const validated = execute(original, [command]); assert.equal(validated.ok, true);
  const invalid = execute(validated.workbook, [{ type: 'cells.set', sheetId, values: { A1: 'bad' } }], { dataValidation: false });
  assert.equal(invalid.ok, false); assert.equal(invalid.code, 'VALIDATION_FAILED');
  const batch = execute(original, [{ type: 'cells.set', sheetId, values: { B1: 'changed' } }, { ...command, validation: { ...rule, allowBlank: false } }]);
  assert.equal(batch.ok, false); assert.equal(batch.commandIndex, 1); assert.equal(sheet(original).cells.B1, undefined);
});

test('XLSX validation constraints support numeric/date ranges and registry-backed long lists', () => {
  let workbook = write(createWorkbook(), { A1: '3', B1: '2024-02-29', C1: 'a', D1: 'TRUE', E1: 'New, York' });
  workbook = applyRule(workbook, ['A1'], { type: 'number', integer: true, min: 1, max: 10, message: '1〜10 & <確認>' });
  workbook = applyRule(workbook, ['B1'], { type: 'date', min: '2024-01-01', max: '2024-12-31' });
  workbook = applyRule(workbook, ['C1'], { type: 'textLength', min: 1, max: 5 });
  workbook = applyRule(workbook, ['D1'], { type: 'checkbox' });
  workbook = applyRule(workbook, ['E1'], { type: 'list', values: ['New, York', 'x'.repeat(300)] });
  assert.throws(() => dataValidationsXml(sheet(workbook)), /参照範囲/);
  const lists = [], xml = dataValidationsXml(sheet(workbook), { formulaForList: values => { lists.push(values); return `list_${lists.length}`; } });
  assert.match(xml, /count="5"/); assert.match(xml, /type="whole" operator="between"/);
  assert.match(xml, /1〜10 &amp; &lt;確認&gt;/); assert.match(xml, /type="date"/); assert.match(xml, /<formula1>45292<\/formula1>/);
  assert.match(xml, /type="textLength"/); assert.match(xml, /<formula1>list_2<\/formula1>/);
  assert.deepEqual(lists, [['TRUE', 'FALSE'], ['New, York', 'x'.repeat(300)]]);
  assert.equal(dataValidationsXml(sheet(createWorkbook())), '');
});

test('clipboard all copies a rule with its value atomically while values-only obeys the destination rule', () => {
  let workbook = write(createWorkbook(), { A1: '完了', B1: '5' });
  workbook = applyRule(workbook, ['A1']); workbook = applyRule(workbook, ['B1'], { type: 'number', min: 0, max: 10 });
  const context = column => ({ workbook, activeSheet: sheet(workbook), calculated: calculateWorkbook(workbook),
    selection: { sheetId: sheet(workbook).id, anchor: { row: 0, column }, focus: { row: 0, column } }, features: resolveSpreadsheetFeatures() });
  const captured = { ...captureCopiedCells(context(0), false), token: 'copy' };
  assert.deepEqual(captured.validations, [[rule]]);
  const pasted = applyPaste(prepareCellPaste(context(1), captured.text, captured), workbook);
  assert.equal(sheet(pasted).cells.B1.value, '完了'); assert.deepEqual(sheet(pasted).cells.B1.validation, rule);
  assert.throws(() => applyPaste(prepareCellPaste(context(1), captured.text, captured, 'values'), workbook), /B1/);
  assert.throws(() => applyPaste(prepareCellPaste(context(1), 'bad', null), workbook), /B1/);
  assert.equal(sheet(workbook).cells.B1.value, '5');
  const formatted = applyPaste(prepareCellPaste(context(1), captured.text, captured, 'formats'), workbook);
  assert.equal(sheet(formatted).cells.B1.value, '5'); assert.deepEqual(sheet(formatted).cells.B1.validation, { type: 'number', min: 0, max: 10 });
});
