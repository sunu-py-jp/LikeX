import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createSpreadsheetSession, applySpreadsheetCommands, createWorkbook, setCellValues, serializeWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const set = (values) => ({ type: 'cells.set', sheetId: 'sheet-1', values });
const initial = () => setCellValues(createWorkbook(), 'sheet-1', { A1: '100', B1: 'source' });
const format = (format) => ({ type: 'cells.format', sheetId: 'sheet-1', addresses: ['A1'], format });

test('conditional value edits preserve intervening formatting and edits in unrelated cells', () => {
  const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
  session.batch([format({ bold: true }), set({ C1: 'user' })]);
  const result = session.execute(set({ A1: '120' }), { expected });
  assert.equal(result.ok, true);
  assert.equal(session.getCell('sheet-1', 'A1').value, '120');
  assert.equal(session.getCell('sheet-1', 'A1').format.bold, true);
  assert.equal(session.getCell('sheet-1', 'C1').value, 'user');
  session.undo();
  assert.equal(session.getCell('sheet-1', 'A1').value, '100');
  assert.equal(session.getCell('sheet-1', 'A1').format.bold, true);
});

test('same-field conflicts reject the whole batch with expected and actual values and no history entry', () => {
  const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
  session.execute(set({ A1: '150' }));
  const before = session.getWorkbook(), history = session.getHistoryState();
  const result = session.batch([set({ C1: 'must not apply' }), set({ A1: '120' })], { expected });
  assert.equal(result.code, 'PRECONDITION_FAILED');
  assert.ok(result.editConflicts.some(conflict => conflict.path.endsWith('.A1.value') && conflict.expected === '100' && conflict.actual === '150'));
  assert.equal(session.getWorkbook(), before);
  assert.deepEqual(session.getHistoryState(), history);
  assert.equal(session.getCell('sheet-1', 'C1'), undefined);
});

test('no-op intent still guards the requested field while partial formatting ignores unrelated value/color changes', () => {
  const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
  session.batch([set({ A1: '150' }), format({ color: '#123456' })]);
  assert.equal(session.execute(set({ A1: '100' }), { expected }).code, 'PRECONDITION_FAILED');
  assert.equal(session.execute(format({ bold: true }), { expected }).ok, true);
  assert.equal(session.getCell('sheet-1', 'A1').value, '150');
  assert.equal(session.getCell('sheet-1', 'A1').format.color, '#123456');
  assert.equal(session.execute(format({ bold: false }), { expected }).code, 'PRECONDITION_FAILED');
});

test('range formatting, comments, and dimension changes guard their own fields', () => {
  const session = createSpreadsheetSession(initial());
  let expected = session.getMutationSnapshot();
  session.execute(set({ B2: 'user' }));
  assert.equal(session.execute({ type: 'cells.format', sheetId: 'sheet-1', addresses: ['A1:B2'], format: { italic: true } }, { expected }).ok, true);
  expected = session.getMutationSnapshot();
  session.execute({ type: 'rows.resize', sheetId: 'sheet-1', row: 1, height: 48 });
  assert.equal(session.execute({ type: 'rows.resize', sheetId: 'sheet-1', row: 0, height: 36 }, { expected }).ok, true);
  assert.equal(session.execute({ type: 'rows.resize', sheetId: 'sheet-1', row: 1, height: 36 }, { expected }).code, 'PRECONDITION_FAILED');
  expected = session.getMutationSnapshot();
  session.execute({ type: 'comments.set', sheetId: 'sheet-1', address: 'A1', comment: { text: 'user note' } });
  assert.equal(session.execute({ type: 'comments.set', sheetId: 'sheet-1', address: 'A1', comment: { text: 'AI note' } }, { expected }).code, 'PRECONDITION_FAILED');
});

test('formula interpretation and validation changes conflict even if the raw value did not change', () => {
  const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
  session.execute(format({ numberFormat: 'text' }));
  assert.equal(session.execute(set({ A1: '=1+1' }), { expected }).code, 'PRECONDITION_FAILED');
});

test('complex commands conservatively guard all workbook data and still execute on a fresh snapshot', () => {
  const operations = [
    { type: 'rows.insert', sheetId: 'sheet-1', index: 2 },
    { type: 'cells.clear', sheetId: 'sheet-1', range: 'A1:B1' },
    { type: 'sheets.rename', sheetId: 'sheet-1', name: 'Renamed' },
    { type: 'cells.fill', sheetId: 'sheet-1', source: { top: 0, left: 0, bottom: 0, right: 0 }, target: { top: 0, left: 0, bottom: 1, right: 0 } },
    { type: 'cells.writeGrid', sheetId: 'sheet-1', target: { row: 2, column: 1 }, headers: ['Name'], data: { type: 'rows', values: [['A']] } },
  ];
  for (const operation of operations) {
    const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
    session.execute(set({ C3: 'concurrent' }));
    assert.equal(session.execute(operation, { expected }).code, 'PRECONDITION_FAILED', operation.type);
    assert.equal(session.execute(operation, { expected: session.getMutationSnapshot() }).ok, true, operation.type);
  }
});

test('structure tokens reject blank-row ABA, cell shifts, undo, replacement, and another session', () => {
  for (const edit of [
    session => { session.execute({ type: 'rows.insert', sheetId: 'sheet-1', index: 10 }); session.execute({ type: 'rows.delete', sheetId: 'sheet-1', index: 10 }); },
    session => { session.execute({ type: 'cells.insert', sheetId: 'sheet-1', range: 'C3:D4', shift: 'down' }); },
    session => { session.execute(set({ C3: 'user' })); session.undo(); },
    session => session.replaceWorkbook(session.getWorkbook()),
  ]) {
    const session = createSpreadsheetSession(initial()), expected = session.getMutationSnapshot();
    edit(session);
    const result = session.execute(set({ A1: '120' }), { expected });
    assert.equal(result.code, 'PRECONDITION_FAILED');
    assert.ok(result.editConflicts.some(conflict => conflict.path.startsWith('token.')));
  }
  const first = createSpreadsheetSession(initial()), other = createSpreadsheetSession(initial());
  assert.equal(other.execute(set({ A1: '120' }), { expected: first.getMutationSnapshot() }).code, 'PRECONDITION_FAILED');
});

test('UI/session conditional requests require a token and validate the expected workbook without mutations', () => {
  const session = createSpreadsheetSession(initial()), before = session.getWorkbook();
  assert.equal(session.execute(set({ A1: '120' }), { expected: { workbook: before } }).code, 'PRECONDITION_FAILED');
  assert.equal(session.execute(set({ A1: '120' }), { expected: { workbook: null } }).code, 'INVALID_COMMAND');
  assert.equal(session.execute(set({ A1: '120' }), { expected: { workbook: before, token: { sessionId: 'x', structureRevision: -1 } } }).code, 'INVALID_COMMAND');
  assert.equal(session.getWorkbook(), before);
});

test('stateless model API accepts before-data guards, preserves input, and rejects changed/deleted targets', () => {
  const workbook = initial(), expected = { workbook }, before = serializeWorkbook(workbook);
  const changed = applySpreadsheetCommands(workbook, [set({ A1: 'user' })]);
  const conflict = applySpreadsheetCommands(changed.workbook, [set({ A1: 'AI' })], { expected });
  assert.equal(conflict.code, 'PRECONDITION_FAILED');
  const formatted = applySpreadsheetCommands(workbook, [format({ bold: true })]);
  assert.equal(applySpreadsheetCommands(formatted.workbook, [set({ A1: 'AI' })], { expected }).ok, true);
  const deleted = { ...workbook, sheets: [{ ...workbook.sheets[0], id: 'other' }] };
  assert.equal(applySpreadsheetCommands(deleted, [set({ A1: 'AI' })], { expected }).code, 'PRECONDITION_FAILED');
  assert.equal(serializeWorkbook(workbook), before);
});

test('workbook scope protects values read by the agent outside its write targets', () => {
  const session = createSpreadsheetSession(initial()), expected = { ...session.getMutationSnapshot(), scope: 'workbook' };
  session.execute(set({ B1: 'new source' }));
  const result = session.execute(set({ A1: 'derived from source' }), { expected });
  assert.equal(result.code, 'PRECONDITION_FAILED');
  assert.ok(result.editConflicts.some(conflict => conflict.path.includes('B1')));
  assert.equal(session.getCell('sheet-1', 'A1').value, '100');
});

test('drawing text patches preserve concurrent color and geometry but reject deleted or edited text', () => {
  const session = createSpreadsheetSession(initial());
  const inserted = session.execute({ type: 'textBoxes.insert', sheetId: 'sheet-1', anchor: { row: 1, column: 1 }, text: 'before' });
  const drawingId = inserted.results[0].drawingId, expected = session.getMutationSnapshot();
  session.execute({ type: 'textBoxes.update', sheetId: 'sheet-1', drawingId, patch: { color: '#123456', width: 300 } });
  assert.equal(session.execute({ type: 'textBoxes.update', sheetId: 'sheet-1', drawingId, patch: { text: 'after' } }, { expected }).ok, true);
  assert.equal(session.getTextBox('sheet-1', drawingId).color, '#123456');
  assert.equal(session.getTextBox('sheet-1', drawingId).width, 300);
  assert.equal(session.execute({ type: 'textBoxes.update', sheetId: 'sheet-1', drawingId, patch: { text: 'again' } }, { expected }).code, 'PRECONDITION_FAILED');
});

test('stateless field guards detect changed structural targets even without a session token', () => {
  const workbook = initial(), expected = { workbook };
  for (const command of [
    { type: 'rows.insert', sheetId: 'sheet-1', index: 10 },
    { type: 'sheets.rename', sheetId: 'sheet-1', name: 'New Name' },
    { type: 'namedRanges.add', sheetId: 'sheet-1', name: 'Inputs', range: 'A1:B1' },
  ]) {
    const updated = applySpreadsheetCommands(workbook, [command]);
    assert.equal(updated.ok, true);
    assert.equal(applySpreadsheetCommands(updated.workbook, [set({ A1: 'AI' })], { expected }).code, 'PRECONDITION_FAILED');
  }
});
