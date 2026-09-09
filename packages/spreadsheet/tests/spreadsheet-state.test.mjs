import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/state/use-spreadsheet-clipboard"; export * from "./src/model";', resolveDir: packageRoot, sourcefile: 'state-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetClipboard, setCellValue, deleteRows, deleteColumns,
  addDrawing, updateDrawing, insertImage, setCellComment, serializeWorkbook, parseWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const book = () => ({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 20, columnCount: 10, cells: { A1: { value: '2' }, B1: { value: '=A1*3' } } }] });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
async function mount(t, options = {}) {
  let current, renderer;
  let props = { initialWorkbook: book(), onSave: value => value, ...options };
  function Probe({ props }) {
    const state = useSpreadsheet(props);
    current = { ...state, clipboard: useSpreadsheetClipboard(state) };
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe, { props })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    get current() { return current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe, { props }))); },
    async unmount() { await act(async () => renderer.unmount()); },
  };
}

test('editing stays local, recalculates dependants and undo restores the saved state', async t => {
  const initialWorkbook = book();
  const changes = [];
  let saves = 0;
  const hook = await mount(t, { initialWorkbook, onChange: wb => changes.push(wb), onSave: () => { saves++; } });
  await act(async () => hook.current.writeValues({ A1: '4' }));
  assert.equal(hook.current.calculated.one.B1, 12);
  assert.equal(hook.current.dirty, true);
  assert.equal(initialWorkbook.sheets[0].cells.A1.value, '2');
  assert.equal(changes.length, 1);
  assert.equal(saves, 0);
  await act(async () => hook.current.undo());
  assert.equal(hook.current.calculated.one.B1, 6);
  assert.equal(hook.current.dirty, false);
  await act(async () => hook.current.redo());
  assert.equal(hook.current.calculated.one.B1, 12);
});

test('omitting onSave or explicitly setting readOnly blocks every state mutation', async t => {
  const hook = await mount(t, { onSave: undefined });
  await act(async () => { hook.current.writeValues({ A1: '99' }); hook.current.beginEdit(); });
  assert.equal(hook.current.readOnly, true);
  assert.equal(hook.current.editing, null);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '2');
  await hook.update({ onSave: value => value, readOnly: true });
  await act(async () => hook.current.apply(wb => setCellValue(wb, 'one', 'A1', '99')));
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '2');
});

test('initialWorkbook prop changes never overwrite an active draft', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({ A1: '5' }));
  await hook.update({ initialWorkbook: { sheets: [{ ...book().sheets[0], cells: { A1: { value: '99' } } }] } });
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '5');
});

test('saving commits the editor, prevents overlapping saves and blocks changes until completion', async t => {
  const pending = deferred();
  const calls = [];
  const hook = await mount(t, { onSave: value => { calls.push(value); return pending.promise; } });
  await act(async () => hook.current.beginEdit({ row: 0, column: 0 }, '8'));
  let savePromise;
  await act(async () => { savePromise = hook.current.save(); });
  assert.equal(calls[0].sheets[0].cells.A1.value, '8');
  assert.equal(hook.current.saving, true);
  await act(async () => { hook.current.writeValues({ A1: '200' }); void hook.current.save(); hook.current.undo(); });
  assert.equal(calls.length, 1);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '8');
  await act(async () => { pending.resolve(); await savePromise; });
  assert.equal(hook.current.saving, false);
  assert.equal(hook.current.dirty, false);
});

test('save failure preserves the draft and allows retry', async t => {
  let fail = true;
  const hook = await mount(t, { onSave: () => { if (fail) throw new Error('保存先に接続できません'); } });
  await act(async () => hook.current.writeValues({ A1: '7' }));
  await act(async () => hook.current.save());
  assert.equal(hook.current.error, '保存先に接続できません');
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '7');
  fail = false;
  await act(async () => hook.current.save());
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.error, null);
});

test('save accepts canonical host data and invalid responses preserve the draft', async t => {
  const hook = await mount(t, { onSave: wb => setCellValue(wb, 'one', 'A1', '10') });
  await act(async () => hook.current.writeValues({ A1: '3' }));
  await act(async () => hook.current.save());
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '10');
  assert.equal(hook.current.dirty, false);
  await hook.update({ onSave: () => ({ sheets: [] }) });
  await act(async () => hook.current.writeValues({ A1: '11' }));
  await act(async () => hook.current.save());
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '11');
  assert.ok(hook.current.error);
});

test('formula feature rejects formulas atomically while allowing plain text', async t => {
  const hook = await mount(t, { features: { formulas: false } });
  await act(async () => hook.current.writeValues({ A1: '100', C1: '=1+1' }));
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '2');
  assert.ok(hook.current.error);
  await act(async () => hook.current.writeValues({ C1: 'plain text' }));
  assert.equal(hook.current.workbook.sheets[0].cells.C1.value, 'plain text');
});

test('row and column deletion keep the active selection inside the grid', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.select({ row: 19, column: 9 }));
  await act(async () => hook.current.apply(wb => deleteRows(wb, 'one', 18, 2)));
  await act(async () => hook.current.apply(wb => deleteColumns(wb, 'one', 8, 2)));
  assert.ok(hook.current.selection.focus.row < hook.current.activeSheet.rowCount);
  assert.ok(hook.current.selection.focus.column < hook.current.activeSheet.columnCount);
});

test('changes with undo disabled cannot expose obsolete history when re-enabled', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({ A1: '3' }));
  await hook.update({ features: { undoRedo: false } });
  await act(async () => hook.current.writeValues({ A1: '4' }));
  await hook.update({ features: { undoRedo: true } });
  await act(async () => hook.current.undo());
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '4');
});

test('a save without changes does not call the host', async t => {
  let calls = 0;
  const hook = await mount(t, { onSave: () => { calls++; } });
  await act(async () => hook.current.save());
  assert.equal(calls, 0);
});

test('deleting and restoring the same cell does not create a false unsaved change', async t => {
  let saves = 0;
  const hook = await mount(t, { onSave() { saves++; } });
  await act(async () => hook.current.writeValues({ A1: '' }));
  await act(async () => hook.current.writeValues({ A1: '2' }));
  assert.equal(hook.current.dirty, false);
  await act(async () => hook.current.save());
  assert.equal(saves, 0);
});

function clipboardEvent(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { preventDefault() {}, clipboardData: {
    getData: type => values.get(type) ?? '', setData: (type, value) => values.set(type, value),
    get types() { return [...values.keys()]; },
  } };
}

test('internal copy shifts relative formula references and retains absolute references', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({ B1: '=A1+$A$1' }));
  await act(async () => hook.current.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const clipboard = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(clipboard));
  await act(async () => hook.current.select({ row: 2, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(clipboard));
  assert.equal(hook.current.workbook.sheets[0].cells.B3.value, '=A3+$A$1');
  assert.equal(hook.current.calculated.one.B3, 4);
});

test('matching external clipboard text never reuses an old internal cut or formula', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const clipboard = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(clipboard));
  const external = clipboardEvent({ 'text/plain': clipboard.clipboardData.getData('text/plain') });
  await act(async () => hook.current.select({ row: 2, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(external));
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '2');
  assert.equal(hook.current.workbook.sheets[0].cells.B3.value, '6');
});

test('cutting a range moves its formulas and updates other cells that refer to it', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.writeValues({ C1: '=B1+1' }));
  await act(async () => hook.current.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const clipboard = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(clipboard));
  await act(async () => hook.current.select({ row: 2, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(clipboard));
  assert.equal(hook.current.workbook.sheets[0].cells.A1, undefined);
  assert.equal(hook.current.workbook.sheets[0].cells.B3.value, '=A3*3');
  assert.equal(hook.current.workbook.sheets[0].cells.C1.value, '=B3+1');
  assert.equal(hook.current.calculated.one.C1, 7);
});

test('a paste that would exceed the sheet is rejected atomically', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.select({ row: 19, column: 9 }));
  await act(async () => hook.current.clipboard.onPaste(clipboardEvent({ 'text/plain': 'left\tright' })));
  assert.equal(hook.current.dirty, false);
  assert.ok(hook.current.error);
});

test('clipboard feature off blocks native copy and paste independently of editing', async t => {
  const hook = await mount(t, { features: { clipboard: false } });
  const clipboard = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(clipboard));
  assert.equal(clipboard.clipboardData.getData('text/plain'), '');
  await act(async () => hook.current.clipboard.onPaste(clipboardEvent({ 'text/plain': 'changed' })));
  assert.equal(hook.current.dirty, false);
});

test('selection notifications cannot mutate the internal range', async t => {
  const hook = await mount(t, { onSelectionChange(selection) { selection.anchor.row = 999; selection.focus.column = 999; } });
  assert.equal(hook.current.selection.anchor.row, 0);
  assert.equal(hook.current.selection.focus.column, 0);
  await act(async () => hook.current.select({ row: 2, column: 3 }));
  assert.equal(hook.current.selection.focus.column, 3);
});

function mockClipboard(t, clipboard) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
}

test('an awaited paste obeys the current formula feature setting', async t => {
  const pending = deferred();
  mockClipboard(t, { readText: () => pending.promise });
  const hook = await mount(t);
  let paste;
  await act(async () => { paste = hook.current.clipboard.paste(); });
  await hook.update({ features: { formulas: false } });
  await act(async () => { pending.resolve('=1+1'); await paste; });
  assert.equal(hook.current.workbook.sheets[0].cells.A1.value, '2');
  assert.equal(hook.current.dirty, false);
  assert.ok(hook.current.error);
});

test('an awaited paste cannot notify or modify after unmount', async t => {
  const pending = deferred();
  mockClipboard(t, { readText: () => pending.promise });
  let changes = 0;
  const hook = await mount(t, { onChange() { changes++; } });
  let paste;
  await act(async () => { paste = hook.current.clipboard.paste(); });
  await hook.unmount();
  await act(async () => { pending.resolve('99'); await paste; });
  assert.equal(changes, 0);
});

const note = () => ({ id: 'note', type: 'text', text: 'JSONのメモ', fontSize: 16, color: '#333333', background: 'transparent',
  anchor: { row: 2, column: 2, offsetX: 5, offsetY: 10 }, width: 200, height: 80 });

test('drawing edits use the shared history and cell selection clears object selection', async t => {
  const hook = await mount(t);
  await act(async () => { hook.current.apply(wb => addDrawing(wb, 'one', note())); hook.current.selectDrawing('note'); });
  assert.equal(hook.current.selectedDrawingId, 'note');
  assert.equal(hook.current.dirty, true);
  await act(async () => hook.current.apply(wb => updateDrawing(wb, 'one', 'note', { text: '変更済み' })));
  await act(async () => hook.current.undo());
  assert.equal(hook.current.activeSheet.drawings[0].text, 'JSONのメモ');
  await act(async () => hook.current.undo());
  assert.equal(hook.current.activeSheet.drawings, undefined);
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.redo(); hook.current.selectDrawing('note'); });
  await act(async () => hook.current.select({ row: 0, column: 1 }));
  assert.equal(hook.current.selectedDrawingId, null);
});

test('save round trips embedded image data, comments, text, and cell formulas as one JSON snapshot', async t => {
  let json;
  const hook = await mount(t, { onSave: value => { json = serializeWorkbook(value); return parseWorkbook(json); } });
  const resource = { name: 'pixel.png', mimeType: 'image/png', width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  await act(async () => hook.current.apply(wb => insertImage(addDrawing(wb, 'one', note()), 'one', 'pixel', resource,
    { id: 'picture', type: 'image', resourceId: 'pixel', alt: '画像', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 }, width: 40, height: 40 })));
  await act(async () => hook.current.apply(wb => setCellComment(wb, 'one', 'A1', { id: 'review', text: '要確認' })));
  await act(async () => hook.current.save());
  const restored = JSON.parse(json);
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.resources.images.pixel.dataUrl, resource.dataUrl);
  assert.equal(restored.sheets[0].drawings.length, 2);
  assert.equal(restored.sheets[0].comments.A1.text, '要確認');
  assert.equal(restored.sheets[0].cells.B1.value, '=A1*3');
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.canUndo, false);
});

test('uncommitted object editors prevent a misleading successful save', async t => {
  let calls = 0;
  const hook = await mount(t, { onSave() { calls++; } });
  await act(async () => { hook.current.writeValues({ A1: '9' }); hook.current.setPendingObjectEdit(true); });
  await act(async () => hook.current.save());
  assert.equal(calls, 0);
  assert.equal(hook.current.dirty, true);
  assert.match(hook.current.error, /確定/);
  await act(async () => { hook.current.setPendingObjectEdit(false); await hook.current.save(); });
  assert.equal(calls, 1);
});

test('object selection never copies, cuts or overwrites the underlying cells', async t => {
  const hook = await mount(t);
  await act(async () => { hook.current.apply(wb => addDrawing(wb, 'one', note())); hook.current.selectDrawing('note'); });
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(copied));
  assert.equal(copied.clipboardData.getData('text/plain'), '');
  await act(async () => hook.current.clipboard.onPaste(clipboardEvent({ 'text/plain': 'overwrite' })));
  assert.equal(hook.current.activeSheet.cells.A1.value, '2');
});

test('cell copy duplicates comments with a new identity; cut keeps the original identity', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.apply(wb => setCellComment(wb, 'one', 'A1', { id: 'comment-one', text: 'review', author: 'Team' })));
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(copied));
  await act(async () => hook.current.select({ row: 1, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(copied));
  assert.equal(hook.current.activeSheet.comments.A2.text, 'review');
  assert.notEqual(hook.current.activeSheet.comments.A2.id, 'comment-one');
  await act(async () => hook.current.select({ row: 0, column: 0 }));
  const cut = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(cut));
  await act(async () => hook.current.select({ row: 2, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(cut));
  assert.equal(hook.current.activeSheet.comments.A1, undefined);
  assert.equal(hook.current.activeSheet.comments.A3.id, 'comment-one');
});

test('disabled annotations are not selected or copied, but remain in the saved workbook', async t => {
  const hook = await mount(t);
  await act(async () => hook.current.apply(wb => setCellComment(addDrawing(wb, 'one', note()), 'one', 'A1', { id: 'c1', text: 'hidden' })));
  await hook.update({ features: { textBoxes: false, comments: false } });
  await act(async () => { hook.current.selectDrawing('note'); hook.current.setCommentOpen(true); });
  assert.equal(hook.current.selectedDrawingId, null);
  assert.equal(hook.current.commentOpen, false);
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(copied));
  await act(async () => hook.current.select({ row: 1, column: 0 }));
  await act(async () => hook.current.clipboard.onPaste(copied));
  assert.equal(hook.current.activeSheet.comments.A1.text, 'hidden');
  assert.equal(hook.current.activeSheet.comments.A2, undefined);
  await act(async () => hook.current.save());
  assert.equal(hook.current.activeSheet.drawings[0].text, 'JSONのメモ');
});
