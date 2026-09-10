import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const id = 'sheet-1', range = { top: 1, left: 2, bottom: 1, right: 3 };
const ok = result => { assert.equal(result.ok, true, result.message); return result; };
const source = () => m.normalizeWorkbook({ ...m.createWorkbook(), sheets: [{ ...m.createWorkbook().sheets[0],
  cells: { C2: { value: '=F2+1', format: { bold: true }, validation: { type: 'number', min: 0 } }, F2: { value: '5' }, H2: { value: '=C2' } },
  comments: { C2: { id: 'original', text: '確認', author: 'Alice' } }, merges: [range] }] });

test('headless copy captures relative merges, comments without identity, typed values and metadata in a JSON roundtrip', () => {
  const mutable = JSON.parse(m.serializeWorkbook(source())), before = JSON.stringify(mutable);
  const payload = m.copySpreadsheetCells(mutable, id, range);
  assert.deepEqual(payload.source, { sheetId: id, row: 1, column: 2 });
  assert.deepEqual(payload.values, [['=F2+1', '']]);
  assert.deepEqual(payload.displayedValues, [['6', '']]);
  assert.deepEqual(payload.valueTypes, [['number', 'string']]);
  assert.deepEqual(payload.comments, [[{ text: '確認', author: 'Alice' }, null]]);
  assert.deepEqual(payload.merges, [{ top: 0, left: 0, bottom: 0, right: 1 }]);
  assert.equal(Object.hasOwn(payload.comments[0][0], 'id'), false);
  for (const item of [payload, payload.values, payload.values[0], payload.comments, payload.comments[0], payload.comments[0][0], payload.merges[0]])
    assert.equal(Object.isFrozen(item), true);
  assert.equal(Object.isFrozen(mutable), false);
  assert.equal(JSON.stringify(mutable), before);
  const result = ok(m.applySpreadsheetCommands(mutable, [{ type: 'cells.paste', sheetId: id, target: { row: 4, column: 0 },
    payload: JSON.parse(JSON.stringify(payload)) }]));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A5.value, '=D5+1');
  assert.deepEqual(sheet.cells.A5.format, { bold: true });
  assert.deepEqual(sheet.cells.A5.validation, { type: 'number', min: 0 });
  assert.equal(sheet.comments.A5.text, '確認');
  assert.notEqual(sheet.comments.A5.id, 'original');
  assert.equal(sheet.comments.C2.id, 'original');
  assert.deepEqual(sheet.merges, [range, { top: 4, left: 0, bottom: 4, right: 1 }]);
  assert.deepEqual(result.results[0].placement, { nextRow: 5, nextColumn: 2 });
});

test('normal paste replaces fully covered destination merges and clears copied blank comments', () => {
  const workbook = m.normalizeWorkbook({ ...source(), sheets: [{ ...source().sheets[0],
    merges: [range, { top: 4, left: 0, bottom: 5, right: 0 }], comments: { ...source().sheets[0].comments,
      A5: { id: 'old', text: 'old' }, B5: { id: 'blank-destination', text: 'clear' } } }] });
  const payload = { values: [['new', ''], ['', '']], comments: [[{ text: 'new' }, null], [null, null]],
    merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] };
  const result = ok(m.applySpreadsheetCommands(workbook, [{ type: 'cells.paste', sheetId: id, target: { row: 4, column: 0 }, payload }]));
  assert.equal(result.workbook.sheets[0].comments.B5, undefined);
  assert.notEqual(result.workbook.sheets[0].comments.A5.id, 'old');
  assert.deepEqual(result.workbook.sheets[0].merges, [range, { top: 4, left: 0, bottom: 4, right: 1 }]);
});

test('scalar paste resolves a merged target to its anchor and reports the actual placement', () => {
  const result = ok(m.applySpreadsheetCommands(source(), [{ type: 'cells.paste', sheetId: id,
    target: { row: 1, column: 3 }, payload: { values: [['7']] } }]));
  assert.equal(result.workbook.sheets[0].cells.C2.value, '7');
  assert.deepEqual(result.results[0].placement, { nextRow: 2, nextColumn: 3 });
});

test('move command retains metadata identity, clears source and rewrites references instead of copy translation', () => {
  const workbook = source(), before = m.serializeWorkbook(workbook);
  const result = ok(m.applySpreadsheetCommands(workbook, [{ type: 'cells.move', sheetId: id,
    source: { sheetId: id, ...range }, target: { row: 3, column: 5 } }]));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.C2, undefined); assert.equal(sheet.comments.C2, undefined);
  assert.equal(sheet.cells.F4.value, '=F2+1'); assert.equal(sheet.cells.H2.value, '=F4');
  assert.equal(sheet.comments.F4.id, 'original');
  assert.deepEqual(sheet.cells.F4.validation, { type: 'number', min: 0 });
  assert.deepEqual(sheet.merges, [{ top: 3, left: 5, bottom: 3, right: 6 }]);
  assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 7 });
  assert.equal(m.serializeWorkbook(workbook), before);
});

test('cross-sheet moves retain references to cells not included in the cut', () => {
  const workbook = m.normalizeWorkbook({ sheets: [{ id: 'from', name: 'From', rowCount: 10, columnCount: 10,
    cells: { A1: { value: '=B1' }, B1: { value: '5' }, C1: { value: '=A1' } } },
  { id: 'to', name: 'To', rowCount: 10, columnCount: 10, cells: {} }] });
  const result = ok(m.applySpreadsheetCommands(workbook, [{ type: 'cells.move', sheetId: 'to',
    source: { sheetId: 'from', top: 0, left: 0, bottom: 0, right: 0 }, target: { row: 1, column: 1 } }]));
  assert.equal(m.calculateWorkbook(result.workbook).to.B2, 5);
  assert.equal(m.calculateWorkbook(result.workbook).from.C1, 5);
  assert.match(result.workbook.sheets[1].cells.B2.value, /From/);
});

test('copy/cut/paste master and individual features have the same independent policies without a GUI', () => {
  const workbook = source();
  assert.throws(() => m.copySpreadsheetCells(workbook, id, range, { features: { copy: false } }));
  assert.doesNotThrow(() => m.copySpreadsheetCells(workbook, id, range, { kind: 'cut', features: { copy: false } }));
  for (const features of [{ cut: false }, { clipboard: false }, { mergeCells: false }])
    assert.throws(() => m.copySpreadsheetCells(workbook, id, range, { kind: 'cut', features }));
  const command = { type: 'cells.move', sheetId: id, source: { sheetId: id, ...range }, target: { row: 4, column: 0 } };
  for (const features of [{ cut: false }, { paste: false }, { clipboard: false }, { mergeCells: false }, { formulas: false }])
    assert.equal(m.applySpreadsheetCommands(workbook, [command], { features }).ok, false);
  assert.equal(m.applySpreadsheetCommands(workbook, [command], { features: { copy: false } }).ok, true);
  const payload = m.copySpreadsheetCells(workbook, id, range);
  assert.equal(m.applySpreadsheetCommands(workbook, [{ type: 'cells.paste', sheetId: id, target: { row: 4, column: 0 }, payload }],
    { features: { mergeCells: false } }).ok, false);
});

test('comments off preserves destination comments and copy omits hidden comments', () => {
  const workbook = m.normalizeWorkbook({ ...m.createWorkbook(), sheets: [{ ...m.createWorkbook().sheets[0],
    cells: { A1: { value: 'one' } }, comments: { A1: { id: 'source', text: 'source' }, B1: { id: 'destination', text: 'keep' } } }] });
  const payload = m.copySpreadsheetCells(workbook, id, { top: 0, left: 0, bottom: 0, right: 0 });
  assert.equal(m.copySpreadsheetCells(workbook, id, { top: 0, left: 0, bottom: 0, right: 0 }, { features: { comments: false } }).comments, undefined);
  const result = ok(m.applySpreadsheetCommands(workbook, [{ type: 'cells.paste', sheetId: id, target: { row: 0, column: 1 }, payload }], { features: { comments: false } }));
  assert.equal(result.workbook.sheets[0].comments.B1.id, 'destination');
});

test('malformed and disallowed transfer inputs fail atomically without partial cells or metadata', () => {
  const workbook = source(), before = m.serializeWorkbook(workbook), target = { row: 4, column: 0 };
  for (const payload of [
    { values: [['value']], comments: [[{ text: 'x', id: 'stolen' }]] },
    { values: [['value']], comments: [[{ text: 7 }]] },
    { values: [['value']], comments: [[{ text: 'x' }], []] },
    { values: [['value']], merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] },
    { values: [['a', 'b']], merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] },
    { values: [['a']], source: { sheetId: id, row: 0, column: 0, arbitrary: true } },
  ]) {
    const result = m.applySpreadsheetCommands(workbook, [{ type: 'rows.insert', sheetId: id, index: 0 },
      { type: 'cells.paste', sheetId: id, target, payload }]);
    assert.equal(result.ok, false, JSON.stringify(payload)); assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false); assert.equal('results' in result, false);
    assert.equal(m.serializeWorkbook(workbook), before);
  }
  for (const options of [{ features: { copy: 'false' } }, { features: { arbitrary: true } }, { features: [] }, { kind: 'unknown' }, new Date()])
    assert.throws(() => m.copySpreadsheetCells(workbook, id, range, options));
  assert.throws(() => m.copySpreadsheetCells(undefined, id, range));
  assert.throws(() => m.copySpreadsheetCells(workbook, id, { ...range, arbitrary: true }));
});

test('source-equal move is a no-op while a partial referenced range move rejects the complete batch', () => {
  const unchanged = ok(m.applySpreadsheetCommands(source(), [{ type: 'cells.move', sheetId: id,
    source: { sheetId: id, ...range }, target: { row: range.top, column: range.left } }]));
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.results[0].placement, { nextRow: 2, nextColumn: 4 });
  const workbook = m.setCellValues(m.createWorkbook(), id, { A1: '1', B1: '2', C1: '=SUM(A1:B1)' });
  const failed = m.applySpreadsheetCommands(workbook, [{ type: 'cells.set', sheetId: id, values: { A2: 'pending' } },
    { type: 'cells.move', sheetId: id, source: { sheetId: id, top: 0, left: 0, bottom: 0, right: 0 }, target: { row: 2, column: 0 } }]);
  assert.equal(failed.ok, false); assert.equal(failed.commandIndex, 1); assert.equal('results' in failed, false);
  assert.equal(workbook.sheets[0].cells.A2, undefined);
});
