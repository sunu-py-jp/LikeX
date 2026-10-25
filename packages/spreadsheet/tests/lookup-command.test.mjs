import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry"; export { resolveSpreadsheetLookupWrite } from "./src/model/editing/lookup";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { applySpreadsheetCommands: apply, normalizeWorkbook, serializeWorkbook, parseWorkbook,
  exportSpreadsheetXlsx, importSpreadsheetXlsx, resolveSpreadsheetLookupWrite: resolve, SPREADSHEET_LIMITS } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const rect = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const book = (cells = {}, sheet = {}, workbook = {}) => normalizeWorkbook({ ...workbook, sheets: [
  { id: 'main', name: 'Main', rowCount: 10, columnCount: 8, cells, ...sheet }, ...(workbook.sheets ?? []),
] });
const command = (extra = {}) => ({ type: 'cells.setByLookup', sheetId: 'main', range: 'B3:E6',
  lookup: { column: 0, value: 'A001' }, updates: [{ column: 2, value: '出荷済み' }], ...extra });
const horizontal = (extra = {}) => command({ lookup: { axis: 'columns', row: 0, value: '11月' }, updates: [{ row: 2, value: '1200' }], ...extra });
const both = (extra = {}) => { const value = command({ lookup: { axis: 'both',
  row: { column: 0, value: 'A001' }, column: { row: 0, value: '11月' } }, value: '1500', ...extra }); delete value.updates; return value; };
const success = result => { assert.equal(result.ok, true, result.message); return result; };
const get = (result, address) => success(result).workbook.sheets[0].cells[address]?.value;

test('row lookup defaults to exact case-insensitive display matching and relative columns at a nonzero origin', () => {
  const before = book({ B3: { value: 'code' }, B4: { value: 'a001' }, B5: { value: 'A002' }, D4: { value: 'old' } });
  const input = command({ updates: [{ column: 2, value: '出荷済み' }, { column: 3, value: '確認完了' }] });
  const copied = structuredClone(input), original = serializeWorkbook(before), result = success(apply(before, [input]));
  assert.equal(get(result, 'D4'), '出荷済み'); assert.equal(get(result, 'E4'), '確認完了');
  assert.equal(get(result, 'D5'), undefined); assert.equal(serializeWorkbook(before), original); assert.deepEqual(input, copied);
  assert.deepEqual(result.results[0].lookup, { range: rect(2, 1, 5, 4), matchedRows: [3], matchedColumns: [], addresses: ['D4', 'E4'] });
  assert.equal(result.results[0].write.changedCount, 2);
});

test('horizontal lookup finds columns and writes relative rows without skipping the header automatically', () => {
  const before = book({ B3: { value: '10月' }, C3: { value: '11月' }, D3: { value: '12月' } });
  const result = success(apply(before, [horizontal({ updates: [{ row: 2, value: '1200' }, { row: 0, value: 'November' }] })]));
  assert.equal(get(result, 'C5'), '1200'); assert.equal(get(result, 'C3'), 'November');
  assert.deepEqual(result.results[0].lookup.matchedRows, []); assert.deepEqual(result.results[0].lookup.matchedColumns, [2]);
  assert.deepEqual(result.results[0].lookup.addresses, ['C5', 'C3']);
});

test('both-axis lookup independently selects the row and column and writes their intersection', () => {
  const before = book({ B4: { value: 'A001' }, B5: { value: 'A002' }, C3: { value: '10月' }, D3: { value: '11月' } });
  const result = success(apply(before, [both()]));
  assert.equal(get(result, 'D4'), '1500'); assert.equal(get(result, 'C4'), undefined);
  assert.deepEqual(result.results[0].lookup, { range: rect(2, 1, 5, 4), matchedRows: [3], matchedColumns: [3], addresses: ['D4'] });
});

test('named ranges resolve case-insensitively on the command sheet and retain inclusive single-cell rectangles', () => {
  const before = book({ B4: { value: 'A001' } }, {}, { namedRanges: [{ id: 'n', name: 'Orders', sheetId: 'main', range: rect(3, 1) }] });
  for (const range of [{ namedRange: 'oRDERS' }, '$B$4', rect(3, 1)]) {
    const result = success(apply(before, [command({ range, updates: [{ column: 0, value: 'renamed' }] })]));
    assert.equal(get(result, 'B4'), 'renamed'); assert.deepEqual(result.results[0].lookup.range, rect(3, 1));
  }
  for (const range of [{ namedRange: 'missing' }, { namedRange: 'B4' }, { namedRange: 'Orders', extra: true }, 'Other!B4'])
    assert.equal(apply(before, [command({ range })]).ok, false);
  const other = book({}, {}, { sheets: [{ id: 'other', name: 'Other', rowCount: 10, columnCount: 8, cells: {} }],
    namedRanges: [{ id: 'n', name: 'Orders', sheetId: 'other', range: rect(3, 1) }] });
  assert.equal(apply(other, [command({ range: { namedRange: 'Orders' } })]).ok, false);
});

test('display lookup uses calculated values and inherited number formatting while formulas mode uses saved inputs', () => {
  const before = book({ B3: { value: '=500+500' }, B4: { value: "'A001" } }, {
    formatRanges: [{ range: rect(2, 1, 2, 1), format: { numberFormat: 'number', decimalPlaces: 2 } }],
  });
  const formatted = success(apply(before, [command({ lookup: { column: 0, value: '1,000.00' } })]));
  assert.equal(get(formatted, 'D3'), '出荷済み');
  assert.equal(apply(before, [command({ lookup: { column: 0, value: '1000' } })]).ok, false);
  assert.equal(get(apply(before, [command({ lookup: { column: 0, value: '=500+500' }, lookIn: 'formulas' })]), 'D3'), '出荷済み');
  assert.equal(get(apply(before, [command()]), 'D4'), '出荷済み');
  assert.equal(apply(before, [command({ lookIn: 'formulas' })]).ok, false);
  assert.equal(get(apply(before, [command({ lookIn: 'formulas', lookup: { column: 0, value: "'A001" } })]), 'D4'), '出荷済み');
});

test('lookup is literal and does not trim, coerce numeric input strings, or interpret wildcard/regex syntax', () => {
  const before = book({ B3: { value: ' A001 ' }, B4: { value: 'a.*' }, B5: { value: "'001" }, B6: { value: 'A001x' } });
  for (const text of ['A001', '^a.*', '1']) assert.equal(apply(before, [command({ lookup: { column: 0, value: text } })]).ok, false);
  assert.equal(get(apply(before, [command({ lookup: { column: 0, value: ' A001 ' } })]), 'D3'), '出荷済み');
  assert.equal(get(apply(before, [command({ lookup: { column: 0, value: 'A.*' } })]), 'D4'), '出荷済み');
  assert.equal(apply(before, [command({ lookup: { column: 0, value: 'A.*' }, matchCase: true })]).ok, false);
  assert.equal(get(apply(before, [command({ lookup: { column: 0, value: '001' } })]), 'D5'), '出荷済み');
});

test('missing cells are empty keys and explicit first/all policies determine which blank cells are selected', () => {
  const before = book({ B3: { value: 'occupied' }, B5: { value: 'occupied' } });
  const blank = command({ lookup: { column: 0, value: '' } });
  assert.equal(apply(before, [blank]).ok, false);
  assert.equal(get(apply(before, [{ ...blank, onMultiple: 'first' }]), 'D4'), '出荷済み');
  const all = success(apply(before, [{ ...blank, onMultiple: 'all' }]));
  assert.deepEqual(all.results[0].lookup.addresses, ['D4', 'D6']); assert.equal(get(all, 'D6'), '出荷済み');
});

test('duplicates fail by default and first/all policies preserve pre-write top-to-bottom and left-to-right order', () => {
  const before = book({ B3: { value: 'A001' }, B5: { value: 'A001' }, C3: { value: '11月' }, E3: { value: '11月' } });
  for (const input of [command(), horizontal(), both()]) assert.equal(apply(before, [input]).ok, false);
  const first = success(apply(before, [both({ onMultiple: 'first' })])); assert.equal(get(first, 'C3'), '1500');
  const all = success(apply(before, [both({ onMultiple: 'all' })]));
  assert.deepEqual(all.results[0].lookup.matchedRows, [2, 4]); assert.deepEqual(all.results[0].lookup.matchedColumns, [2, 4]);
  assert.deepEqual(all.results[0].lookup.addresses, ['C3', 'E3', 'C5', 'E5']);
  for (const address of ['C3', 'E3', 'C5', 'E5']) assert.equal(get(all, address), '1500');
});

test('search results are fully resolved before lookup keys themselves are overwritten', () => {
  const before = book({ B3: { value: 'A001' }, B4: { value: 'A001' } });
  const result = success(apply(before, [command({ onMultiple: 'all', updates: [{ column: 0, value: 'changed' }, { column: 1, value: '=1+2' }] })]));
  assert.deepEqual(result.results[0].lookup.matchedRows, [2, 3]); assert.equal(get(result, 'B4'), 'changed');
  assert.equal(get(result, 'C3'), '=1+2'); assert.equal(get(result, 'C4'), '=1+2');
});

test('missing-result skip is a successful no-op, including both-axis absence with duplicates on the other axis', () => {
  const before = book({ B4: { value: 'A001' }, B5: { value: 'A001' } });
  assert.equal(apply(before, [both()]).ok, false);
  const skipped = success(apply(before, [both({ onNotFound: 'skip' })]));
  assert.equal(serializeWorkbook(skipped.workbook), serializeWorkbook(before));
  assert.deepEqual(skipped.results[0].lookup.matchedRows, []); assert.deepEqual(skipped.results[0].lookup.matchedColumns, []);
  assert.deepEqual(skipped.results[0].lookup.addresses, []); assert.equal(skipped.results[0].write.changedCount, 0);
});

test('all inputs and relative targets are validated even when missing results would be skipped', () => {
  const before = book();
  const patches = [
    { range: { top: 2, left: 1, bottom: 5, right: 4, extra: true } }, { range: 'B3:E999' }, { range: 'E6:B3' }, { range: null },
    { lookup: null }, { lookup: { column: -1, value: 'x' } }, { lookup: { column: 4, value: 'x' } },
    { lookup: { column: 0.5, value: 'x' } }, { lookup: { column: 0, value: 10 } }, { lookup: { column: 0, value: 'x', regex: true } },
    { lookup: { axis: 'vertical', column: 0, value: 'x' } }, { lookup: { axis: null, column: 0, value: 'x' } }, { updates: [] }, { updates: [{ column: 4, value: 'x' }] },
    { updates: [{ column: 0, value: null }] }, { updates: [{ column: 0, value: 'x', unknown: true }] },
    { updates: [{ column: 0, value: 'a' }, { column: 0, value: 'b' }] }, { value: 'wrong-shape' },
    { matchCase: 1 }, { lookIn: 'display' }, { onMultiple: 'last' }, { onNotFound: 'ignore' }, { onConflict: 'keep' }, { unknown: true },
    { updates: [{ column: 0, value: 'a'.repeat(SPREADSHEET_LIMITS.cellLength + 1) }] },
    { lookup: { column: 0, value: 'a'.repeat(SPREADSHEET_LIMITS.cellLength + 1) } },
  ];
  for (const patch of patches) {
    const input = command({ onNotFound: 'skip', ...patch });
    assert.equal(apply(before, [input]).ok, false, JSON.stringify(patch).slice(0, 200));
    assert.throws(() => resolve(before, input));
  }
  for (const input of [both({ value: undefined, onNotFound: 'skip' }), { ...both({ onNotFound: 'skip' }), updates: [] },
    both({ lookup: { axis: 'both', row: { column: 0, value: 'x' }, column: { row: 4, value: 'y' } }, onNotFound: 'skip' })])
    assert.equal(apply(before, [input]).ok, false);
});

test('non-anchor merged search cells reject even with first mode or missing-result skip', () => {
  const before = book({ B3: { value: 'A001' } }, { merges: [rect(2, 1, 3, 1)] });
  for (const patch of [{}, { onMultiple: 'first' }, { onNotFound: 'skip' }]) {
    const result = apply(before, [command(patch)]); assert.equal(result.ok, false); assert.match(result.message, /結合/);
  }
  const allowed = success(apply(before, [command({ range: 'B3:E3' })])); assert.equal(get(allowed, 'D3'), '出荷済み');
});

test('merged targets only accept the anchor and reject other targets without partial writes', () => {
  const before = book({ B4: { value: 'A001' } }, { merges: [rect(3, 3, 3, 4)] }), original = serializeWorkbook(before);
  const result = apply(before, [command({ updates: [{ column: 1, value: 'staged' }, { column: 3, value: 'invalid' }] })]);
  assert.equal(result.ok, false); assert.match(result.message, /結合/); assert.equal(result.workbook, undefined);
  assert.equal(serializeWorkbook(before), original); assert.equal(get(apply(before, [command()]), 'D4'), '出荷済み');
});

test('resolved writes honor conflict error/skip and preserve cell formatting, validation and comments', () => {
  const before = book({ B4: { value: 'A001' }, D4: { value: 'old', format: { bold: true, background: '#ff0000' },
    validation: { type: 'textLength', min: 0, max: 20 } } }, { comments: { D4: { id: 'comment', text: 'keep' } } });
  const error = apply(before, [command({ onConflict: 'error' })]); assert.equal(error.ok, false); assert.equal(error.code, 'WRITE_CONFLICT');
  const skipped = success(apply(before, [command({ onConflict: 'skip' })])); assert.equal(get(skipped, 'D4'), 'old');
  assert.deepEqual(skipped.results[0].lookup.addresses, ['D4']); assert.deepEqual(skipped.results[0].write.skippedAddresses, ['D4']);
  const result = success(apply(before, [command()]));
  assert.deepEqual(result.workbook.sheets[0].cells.D4.format, before.sheets[0].cells.D4.format);
  assert.deepEqual(result.workbook.sheets[0].cells.D4.validation, before.sheets[0].cells.D4.validation);
  assert.deepEqual(result.workbook.sheets[0].comments, before.sheets[0].comments);
});

test('write failures roll back the entire command batch and formula feature gates remain effective', () => {
  const before = book({ B4: { value: 'A001' }, D4: { value: 'occupied' } }), original = serializeWorkbook(before);
  const failure = apply(before, [{ type: 'cells.set', sheetId: 'main', values: { A1: 'staged' } }, command({ onConflict: 'error' })]);
  assert.equal(failure.ok, false); assert.equal(failure.commandIndex, 1); assert.equal(failure.workbook, undefined);
  assert.equal(serializeWorkbook(before), original);
  const disabled = apply(before, [command({ updates: [{ column: 2, value: '=1+2' }] })], { features: { formulas: false } });
  assert.equal(disabled.ok, false); assert.equal(disabled.code, 'FEATURE_DISABLED');
});

test('a large sparse rectangle is searched along its axes and result capacity is bounded by written cells', () => {
  const before = book({ A1: { value: 'key' } }, { rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns });
  const large = command({ range: rect(0, 0, SPREADSHEET_LIMITS.rows - 1, SPREADSHEET_LIMITS.columns - 1),
    lookup: { column: 0, value: 'key' }, updates: [{ column: 1, value: 'done' }], onMultiple: 'first' });
  assert.equal(get(apply(before, [large]), 'B1'), 'done');
  const capacity = apply(before, [{ ...large, lookup: { column: 0, value: '' }, onMultiple: 'all',
    updates: [{ column: 1, value: 'one' }, { column: 2, value: 'two' }] }]);
  assert.equal(capacity.ok, false); assert.match(capacity.message, /10,000/);
  const skipped = success(apply(before, [both({ range: large.range, lookup: { axis: 'both', row: { column: 0, value: '' },
    column: { row: 0, value: 'absent' } }, onMultiple: 'all', onNotFound: 'skip' })]));
  assert.deepEqual(skipped.results[0].lookup.addresses, []);
});

test('resolved target and report snapshots are deeply immutable', () => {
  const before = book({ B4: { value: 'A001' } }); const resolved = resolve(before, command());
  assert.ok(Object.isFrozen(resolved)); assert.ok(Object.isFrozen(resolved.values)); assert.ok(Object.isFrozen(resolved.lookup));
  for (const value of Object.values(resolved.lookup)) assert.ok(Object.isFrozen(value));
  assert.throws(() => { resolved.values.D4 = 'wrong'; }, TypeError);
  assert.throws(() => { resolved.lookup.addresses.push('A1'); }, TypeError);
});

test('lookup writes persist as ordinary cells through SPON and XLSX without storing execution instructions', async () => {
  const before = book({ B4: { value: 'A001' }, C3: { value: '11月' } }, {}, {
    namedRanges: [{ id: 'n', name: 'Monthly', sheetId: 'main', range: rect(2, 1, 5, 4) }],
  });
  const result = success(apply(before, [both({ range: { namedRange: 'Monthly' }, value: '=40+2' })]));
  const saved = serializeWorkbook(result.workbook), native = parseWorkbook(saved);
  assert.equal(serializeWorkbook(native), saved); assert.doesNotMatch(saved, /setByLookup|onMultiple|matchedRows/);
  const restored = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(native));
  assert.deepEqual(restored.warnings, []);
  assert.equal(restored.workbook.sheets[0].cells.C4.value, '=40+2'); assert.equal(restored.workbook.namedRanges[0].name, 'Monthly');
  assert.deepEqual(restored.workbook.namedRanges[0].range, rect(2, 1, 5, 4));
});
