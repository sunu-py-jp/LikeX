import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { setCellValues, normalizeWorkbook, calculateWorkbook, createSpreadsheetCalculationCache, renameSheet, addSheet, deleteRows } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const sheet = (id, cells, extra = {}) => ({ id, name: id, rowCount: 20, columnCount: 6,
  cells: Object.fromEntries(Object.entries(cells).map(([address, value]) => [address, { value }])), ...extra });
const book = () => normalizeWorkbook({ sheets: [
  sheet('Top', { A1: '=Middle!A1+1', A2: '=SUM(Middle!A1:B3)', A3: '=Base!A1&"!"', B1: '5', B2: '=B1*2', C1: '=Middle!F20' }),
  sheet('Middle', { A1: '=Base!A1*2', A2: '=Base!A2+B1', B1: '3', B2: '=A1+A2', B3: 'text' }),
  sheet('Base', { A1: '10', A2: '=A1+1', A3: '=Missing!A1' }),
  sheet('Alone', { A1: '1', A2: '=A1+1', A3: '=SUM(A1:A2)' }),
] });
// Model operations keep the objects of untouched sheets, which is what lets their results be reused.
const set = (workbook, sheetId, values) => setCellValues(workbook, sheetId, values);
const plain = values => JSON.parse(JSON.stringify(values));
const same = (calculated, workbook, ids = workbook.sheets.map(item => item.id)) => {
  const expected = calculateWorkbook(workbook);
  for (const id of ids) assert.deepEqual(plain(calculated[id]), plain(expected[id]), id);
};

test('cached calculation equals a full calculation for every sheet in any read order', () => {
  const workbook = book(), calculated = createSpreadsheetCalculationCache().calculate(workbook);
  assert.deepEqual(Object.keys(calculated), ['Top', 'Middle', 'Base', 'Alone']);
  same(calculated, workbook, ['Alone', 'Top', 'Base', 'Middle']);
  assert.equal(calculated.Top.A1, 21); assert.equal(calculated.Top.A3, '10!'); assert.equal(calculated.Base.A3, '#REF!');
  assert.equal(calculated.Unknown, undefined);
  assert.equal(calculated.Top, calculated.Top, 'a sheet is calculated once per version');
});

test('an edit recalculates the edited sheet and the sheets reading it, and reuses every other result', () => {
  const cache = createSpreadsheetCalculationCache();
  const first = book(), before = cache.calculate(first);
  const kept = Object.fromEntries(['Top', 'Middle', 'Base', 'Alone'].map(id => [id, before[id]]));

  // Base is read by Middle directly and by Top both directly and through Middle.
  const second = set(first, 'Base', { A1: '100' }), after = cache.calculate(second);
  same(after, second);
  assert.equal(after.Top.A1, 201); assert.equal(after.Middle.A2, 104);
  assert.equal(after.Alone, kept.Alone, 'an unrelated sheet keeps the same result object');
  for (const id of ['Top', 'Middle', 'Base']) assert.notEqual(after[id], kept[id], id);

  // Top is read by nobody, so only Top is recalculated.
  const third = set(second, 'Top', { B1: '7' }), last = cache.calculate(third);
  same(last, third);
  assert.equal(last.Top.B2, 14);
  for (const id of ['Middle', 'Base', 'Alone']) assert.equal(last[id], after[id], id);

  // Undo-style return to an earlier version is recalculated from that version's sheets.
  same(cache.calculate(first), first);
});

test('a sheet read only through references stays correct when it is opened later or its source changes', () => {
  const cache = createSpreadsheetCalculationCache();
  const first = book(), before = cache.calculate(first);
  assert.equal(before.Top.A2, 20 + 14 + 3 + 34, 'reads part of Middle without opening it');
  const second = set(first, 'Alone', { A1: '2' }), after = cache.calculate(second);
  assert.equal(after.Alone.A3, 5);
  same(after, second, ['Middle', 'Top', 'Base']);
  // The earlier version's lazily read results still describe the earlier version.
  same(before, first);
  const third = set(second, 'Middle', { B1: '30' }), last = cache.calculate(third);
  assert.equal(last.Top.A2, calculateWorkbook(third).Top.A2);
  same(last, third);
  same(after, second);
});

test('renamed, added and resized sheets invalidate references that resolve differently', () => {
  const cache = createSpreadsheetCalculationCache();
  let workbook = book();
  assert.equal(cache.calculate(workbook).Base.A3, '#REF!');
  workbook = addSheet(workbook, 'Missing');
  workbook = set(workbook, workbook.sheets.at(-1).id, { A1: '9' });
  let calculated = cache.calculate(workbook);
  assert.equal(calculated.Base.A3, 9); same(calculated, workbook);

  workbook = renameSheet(workbook, 'Base', 'Renamed');
  calculated = cache.calculate(workbook);
  same(calculated, workbook);

  // Top!C1 reads Middle!F20; shrinking Middle turns it into #REF! although no value changed.
  assert.equal(calculated.Top.C1, 0);
  workbook = deleteRows(workbook, 'Middle', 15, 5);
  calculated = cache.calculate(workbook);
  assert.equal(calculated.Top.C1, '#REF!'); same(calculated, workbook);
});

test('random edits across dependent sheets always match a full calculation', () => {
  const cache = createSpreadsheetCalculationCache();
  let workbook = book(), seed = 12345;
  const random = limit => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
  const ids = ['Top', 'Middle', 'Base', 'Alone'], formulas = ['=Base!A1+1', '=Middle!B2*2', '=Alone!A3', '=A1+B1', '=SUM(A1:B3)', '=Top!B2', '=1/0'];
  const versions = [];
  for (let step = 0; step < 120; step++) {
    const address = `${'ABCD'[random(4)]}${random(6) + 1}`;
    const value = random(3) === 0 ? formulas[random(formulas.length)] : random(4) === 0 ? '' : String(random(50));
    workbook = set(workbook, ids[random(ids.length)], { [address]: value });
    const calculated = cache.calculate(workbook);
    // Read a varying subset in a varying order, so partially read sheets carry over between versions.
    const order = ids.filter(() => random(3) !== 0).sort(() => random(3) - 1);
    same(calculated, workbook, order);
    versions.push([calculated, workbook]);
  }
  for (const [calculated, version] of versions.slice(-10)) same(calculated, version);
});
