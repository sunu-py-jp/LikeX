import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export * from "./src/model"; export * from "./src/state/features"; export * from "./src/state/commands/stage-spreadsheet-commands"; export * from "./src/state/use-spreadsheet"; export * from "./src/api/use-spreadsheet-handle";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'sheet-order-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { normalizeWorkbook, moveSheet, calculateWorkbook, serializeWorkbook, parseWorkbook, workbooksEqual,
  resolveSpreadsheetFeatures, stageSpreadsheetCommands, useSpreadsheet, useSpreadsheetHandle } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = () => normalizeWorkbook({ sheets: [
  { id: 'one', name: 'One', rowCount: 20, columnCount: 8, cells: { A1: { value: '2' }, B1: { value: '=Two!A1+Three!A1' } },
    comments: { A1: { id: 'comment-one', text: 'Keep this comment' } }, columnWidths: { 0: 150 },
    merges: [{ top: 2, left: 0, bottom: 2, right: 1 }] },
  { id: 'two', name: 'Two', rowCount: 20, columnCount: 8, cells: { A1: { value: '3' } } },
  { id: 'three', name: 'Three', rowCount: 20, columnCount: 8, cells: { A1: { value: '5' } } },
] });
const order = workbook => workbook.sheets.map(sheet => sheet.id);
const move = (sheetId, index) => ({ type: 'sheets.move', sheetId, index });
const stage = (workbook, commands, features) => stageSpreadsheetCommands(workbook, commands, resolveSpreadsheetFeatures(features), () => 'generated-id');

async function mount(t, overrides = {}) {
  let current, renderer;
  const ref = createRef();
  let props = { initialWorkbook: book(), onSave() {}, ...overrides };
  function Probe() { current = useSpreadsheet(props); useSpreadsheetHandle(ref, current); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return current; }, get api() { return ref.current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}

test('moving a sheet uses its final position in either direction and preserves sheet contents, IDs and references', () => {
  const workbook = book(), before = serializeWorkbook(workbook);
  const last = moveSheet(workbook, 'one', 2);
  assert.deepEqual(order(last), ['two', 'three', 'one']);
  assert.deepEqual(order(workbook), ['one', 'two', 'three']);
  for (const sheet of last.sheets) assert.strictEqual(sheet, workbook.sheets.find(original => original.id === sheet.id));
  assert.equal(calculateWorkbook(last).one.B1, 8);
  assert.equal(last.sheets[2].cells.B1.value, '=Two!A1+Three!A1');
  assert.equal(serializeWorkbook(workbook), before);
  assert.equal(Object.isFrozen(last), true);
  assert.equal(Object.isFrozen(last.sheets), true);
  assert.ok(workbooksEqual(last, parseWorkbook(serializeWorkbook(last))));
  assert.ok(workbooksEqual(moveSheet(last, 'one', 0), workbook));
  assert.deepEqual(order(moveSheet(workbook, 'three', 1)), ['one', 'three', 'two']);
  assert.strictEqual(moveSheet(workbook, 'two', 1), workbook);
});

test('sheet movement validates exact command fields, required targets and finite integer positions atomically', () => {
  const workbook = book();
  const invalid = [
    [move('missing', 0), 'INVALID_TARGET'],
    [move('', 0), 'INVALID_COMMAND'],
    [{ type: 'sheets.move', sheetId: 'one' }, 'INVALID_COMMAND'],
    [move('one', '1'), 'INVALID_COMMAND'],
    [{ ...move('one', 1), before: 'two' }, 'INVALID_COMMAND'],
    ...[-1, 3, 0.5, NaN, Infinity].map(index => [move('one', index), 'VALIDATION_FAILED']),
  ];
  for (const [command, code] of invalid) {
    const result = stage(workbook, [move('one', 2), command]);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false);
    assert.equal('results' in result, false);
    assert.deepEqual(order(workbook), ['one', 'two', 'three']);
  }
  for (const index of [-1, 3, 0.5, NaN, Infinity, undefined, '1']) assert.throws(() => moveSheet(workbook, 'one', index));
  assert.throws(() => moveSheet(workbook, 'missing', 0));
});

test('reorderSheets is independent by default and disabled by the sheets master switch', () => {
  assert.equal(resolveSpreadsheetFeatures().reorderSheets, true);
  assert.equal(resolveSpreadsheetFeatures({ createSheet: false, renameSheet: false, deleteSheet: false }).reorderSheets, true);
  const workbook = book();
  for (const features of [{ reorderSheets: false }, { sheets: false, reorderSheets: true }]) {
    assert.equal(resolveSpreadsheetFeatures(features).reorderSheets, false);
    assert.equal(stage(workbook, [move('one', 2)], features).code, 'FEATURE_DISABLED');
  }
  const result = stage(workbook, [move('one', 2), move('three', 0)]);
  assert.equal(result.ok, true);
  assert.deepEqual(order(result.workbook), ['three', 'two', 'one']);
  assert.deepEqual(result.results, [{ type: 'sheets.move', sheetId: 'one' }, { type: 'sheets.move', sheetId: 'three' }]);
  const restored = stage(workbook, [move('one', 2), move('one', 0)]);
  assert.equal(restored.changed, false);
  assert.strictEqual(restored.workbook, workbook);
});

test('a sheet move preserves the selected sheet and cell ranges, notifies once, and participates in undo, redo and save', async t => {
  const changes = [], events = [], saves = [];
  const ui = await mount(t, { onChange: workbook => changes.push(workbook), onEvent: event => events.push(event), onSave: workbook => { saves.push(workbook); } });
  await act(async () => ui.c.switchSheet('two'));
  await act(async () => {
    ui.c.selectRange({ row: 3, column: 1 }, { row: 5, column: 2 });
    ui.c.selectRange({ row: 7, column: 4 }, { row: 8, column: 5 }, true);
  });
  const selection = structuredClone(ui.c.selection), active = ui.c.activeSheet;
  const revision = ui.c.getStructureRevision();
  await act(async () => { assert.equal(ui.api.execute(move('one', 2)).changed, true); });
  assert.deepEqual(order(ui.api.getWorkbook()), ['two', 'three', 'one']);
  assert.strictEqual(ui.c.activeSheet, active);
  assert.deepEqual(ui.c.selection, selection);
  assert.equal(ui.c.getStructureRevision(), revision + 1);
  assert.equal(ui.c.dirty, true);
  assert.equal(ui.c.canUndo, true);
  assert.equal(changes.length, 1);
  assert.deepEqual(events.filter(event => event.type === 'change').map(event => [event.source, event.commands]), [['api', ['sheets.move']]]);
  await act(async () => ui.c.undo());
  assert.deepEqual(order(ui.api.getWorkbook()), ['one', 'two', 'three']);
  assert.equal(ui.c.activeSheet.id, 'two');
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.canUndo, false);
  await act(async () => ui.c.redo());
  assert.deepEqual(order(ui.api.getWorkbook()), ['two', 'three', 'one']);
  await act(async () => { assert.equal(ui.api.execute(move('two', 2)).ok, true); });
  assert.equal(ui.c.activeSheet.id, 'two', 'moving the active sheet keeps it selected');
  await act(async () => { assert.equal(await ui.api.save(), true); });
  assert.deepEqual(order(saves[0]), ['three', 'one', 'two']);
  assert.equal(ui.c.dirty, false);
});

test('same-position and net-zero moves do not request editing, change selection, publish events or create history', async t => {
  const events = [];
  let requests = 0, changes = 0;
  const ui = await mount(t, { onEditRequest: () => { requests++; return true; }, onChange: () => { changes++; }, onEvent: event => events.push(event) });
  const workbook = ui.api.getWorkbook(), selection = ui.c.selection, revision = ui.c.getStructureRevision();
  const eventCount = events.length;
  await act(async () => {
    assert.equal(ui.api.execute(move('one', 0)).changed, false);
    assert.equal((await ui.api.batchAsync([move('one', 2), move('one', 0)])).changed, false);
  });
  assert.strictEqual(ui.api.getWorkbook(), workbook);
  assert.strictEqual(ui.c.selection, selection);
  assert.equal(ui.c.getStructureRevision(), revision);
  assert.equal(ui.c.getEditState().mode, 'view');
  assert.equal(ui.c.canUndo, false);
  assert.equal(ui.c.dirty, false);
  assert.equal(requests, 0);
  assert.equal(changes, 0);
  assert.equal(events.length, eventCount);
});

test('sheet moves honor readonly, pending edits and current feature flags through a retained handle', async t => {
  const ui = await mount(t, { readOnly: true });
  const api = ui.api, workbook = api.getWorkbook();
  assert.equal(api.execute(move('one', 2)).code, 'READ_ONLY');
  await ui.update({ readOnly: false, onSave: undefined });
  assert.equal(api.execute(move('one', 2)).code, 'READ_ONLY');
  await ui.update({ onSave() {}, features: { reorderSheets: false } });
  assert.equal(api.execute(move('one', 2)).code, 'FEATURE_DISABLED');
  await ui.update({ features: { sheets: false, reorderSheets: true } });
  assert.equal(api.execute(move('one', 2)).code, 'FEATURE_DISABLED');
  await ui.update({ features: {} });
  await act(async () => {
    ui.c.beginEdit({ row: 0, column: 0 }, 'unfinished');
    assert.equal(api.execute(move('one', 2)).code, 'PENDING_EDIT');
    ui.c.cancelEdit();
  });
  assert.strictEqual(api.getWorkbook(), workbook);
  assert.equal(ui.c.canUndo, false);
});

test('sheet moves wait for editing permission, retain order on denial and commit once on approval', async t => {
  const requests = [], decisions = [], changes = [];
  const ui = await mount(t, { onEditRequest: request => { requests.push(request); return new Promise(resolve => decisions.push(resolve)); },
    onChange: workbook => changes.push(workbook) });
  const before = ui.api.getWorkbook();
  assert.equal(ui.api.execute(move('one', 2)).code, 'EDIT_REQUIRED');
  let denied;
  await act(async () => { denied = ui.api.executeAsync(move('one', 2)); });
  assert.strictEqual(ui.api.getWorkbook(), before);
  assert.equal(ui.c.requesting, true);
  assert.equal(requests[0].action, 'sheets.move');
  assert.equal(requests[0].sheetId, 'one');
  await act(async () => { decisions[0](false); assert.equal((await denied).code, 'EDIT_DENIED'); });
  assert.strictEqual(ui.api.getWorkbook(), before);
  assert.equal(ui.c.canUndo, false);
  let accepted;
  await act(async () => { accepted = ui.api.executeAsync(move('one', 2)); });
  await act(async () => { decisions[1](true); assert.equal((await accepted).changed, true); });
  assert.deepEqual(order(ui.api.getWorkbook()), ['two', 'three', 'one']);
  assert.equal(changes.length, 1);
  assert.equal(ui.c.canUndo, true);
});
