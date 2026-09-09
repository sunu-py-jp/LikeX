import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export { useSpreadsheet } from "./src/state/use-spreadsheet"; export { useSpreadsheetClipboard } from "./src/state/use-spreadsheet-clipboard";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'editing-state.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, useSpreadsheetClipboard } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const workbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 12, columnCount: 6, cells: {
  A1: { value: '1', format: { bold: true } }, A2: { value: '2' }, B1: { value: '=A1+A2' },
} }] };
const range = (top, left, bottom = top, right = left) => ({ top, left, bottom, right });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function mount(t, overrides = {}) {
  let current, renderer;
  const events = []; let props = { initialWorkbook: workbook, onSave: () => {}, onEvent: event => events.push(event), ...overrides };
  function Probe() { const controller = useSpreadsheet(props); current = { ...controller, clipboard: useSpreadsheetClipboard(controller) }; return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { events, get current() { return current; },
    async select(row, column) { await act(async () => current.select({ row, column })); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    value(address) { return current.getWorkbook().sheets[0].cells[address]?.value; } };
}
function clipboardFor(t, hook) {
  const data = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    async readText() { return data.get('text/plain') ?? ''; },
    async read() { return [{ types: ['text/plain', 'text/html'], async getType(type) { return new Blob([type === 'text/html'
      ? `<table data-likex-spreadsheet="${data.get('application/x-likex-spreadsheet')}"></table>` : data.get(type) ?? '']); } }]; },
  } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
  return { async copy(cut = false) { await act(async () => hook.current.clipboard[cut ? 'onCut' : 'onCopy']({ target: null, preventDefault() {}, clipboardData: { setData: (type, value) => data.set(type, value) } })); } };
}

test('fill, replacement and duplication travel through the edit lease, one history entry, notifications and saving', async t => {
  const permission = deferred(); let saved;
  const hook = await mount(t, { onEditRequest: () => permission.promise, onSave: next => { saved = next; } });
  let result;
  await act(async () => { result = hook.current.executeCommand({ type: 'cells.fill', sheetId: 'main', source: range(0, 0, 1), target: range(0, 0, 3) }); });
  assert.equal(hook.value('A3'), undefined);
  await act(async () => { permission.resolve(true); await result; });
  assert.equal(hook.value('A3'), '3'); assert.equal(hook.value('A4'), '4');
  await act(async () => hook.current.undo()); assert.equal(hook.value('A3'), undefined);
  await act(async () => hook.current.redo()); assert.equal(hook.value('A3'), '3');
  await act(async () => hook.current.executeCommand({ type: 'cells.replace', sheetId: 'main', query: { text: '3', wholeCell: true, lookIn: 'formulas' }, replacement: '9' }));
  assert.equal(hook.value('A3'), '9');
  await act(async () => hook.current.executeCommand({ type: 'sheets.duplicate', sheetId: 'main' }));
  assert.equal(hook.current.workbook.sheets.length, 2);
  await act(async () => hook.current.save());
  assert.equal(saved.sheets[1].cells.A3.value, '9');
  assert.ok(hook.events.some(event => event.type === 'change' && event.commands?.includes('cells.fill')));
});

test('paste special values uses captured computed results and formatting-only leaves the destination value', async t => {
  const hook = await mount(t); const clipboard = clipboardFor(t, hook);
  await hook.select(0, 1); await clipboard.copy();
  await hook.select(2, 1); await act(async () => hook.current.clipboard.paste('values'));
  assert.equal(hook.value('B3'), '3');
  await hook.select(0, 0); await clipboard.copy();
  await hook.select(2, 1); await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(hook.value('B3'), '3'); assert.equal(hook.current.activeSheet.cells.B3.format.bold, true);
  await act(async () => hook.current.undo());
  assert.equal(hook.value('B3'), '3'); assert.equal(hook.current.activeSheet.cells.B3.format, undefined);
});

test('paste special policy revocation while permission is pending cancels the captured operation', async t => {
  const permission = deferred(); const hook = await mount(t, { onEditRequest: () => permission.promise }); const clipboard = clipboardFor(t, hook);
  await hook.select(0, 1); await clipboard.copy(); await hook.select(2, 1);
  await act(async () => hook.current.clipboard.paste('values'));
  await hook.update({ features: { pasteSpecial: false } });
  await act(async () => permission.resolve(true));
  assert.equal(hook.value('B3'), undefined);
  assert.equal(hook.events.filter(event => event.type === 'clipboard' && event.action === 'paste').length, 0);
});

test('cut keeps normal move semantics; special paste refuses to partially move a cut range', async t => {
  const hook = await mount(t); const clipboard = clipboardFor(t, hook);
  await hook.select(0, 0); await clipboard.copy(true); await hook.select(2, 0);
  await act(async () => hook.current.clipboard.paste('values'));
  assert.equal(hook.value('A1'), '1'); assert.equal(hook.value('A3'), undefined);
  assert.match(hook.current.error, /通常の貼り付け/);
  await act(async () => hook.current.clipboard.paste());
  assert.equal(hook.value('A1'), undefined); assert.equal(hook.value('A3'), '1');
});

test('read-only rejects new operations, but cross-sheet search navigation remains available', async t => {
  const hook = await mount(t, { readOnly: true, initialWorkbook: { sheets: [...workbook.sheets,
    { id: 'other', name: 'Other', rowCount: 5, columnCount: 5, cells: { C3: { value: 'match' } } }] } });
  assert.equal(hook.current.externalExecute({ type: 'sheets.duplicate', sheetId: 'main' }).code, 'READ_ONLY');
  await act(async () => hook.current.selectCellInSheet('other', { row: 2, column: 2 }));
  assert.equal(hook.current.activeSheet.id, 'other'); assert.deepEqual(hook.current.selection.focus, { row: 2, column: 2 });
});

test('a refreshed lease baseline prevents an autofill command from writing obsolete coordinates', async t => {
  const hook = await mount(t, { onEditRequest: () => ({ allowed: true, workbook: { sheets: [{ ...workbook.sheets[0], rowCount: 13 }] } }) });
  let result;
  await act(async () => { result = await hook.current.executeCommand({ type: 'cells.fill', sheetId: 'main', source: range(0, 0, 1), target: range(0, 0, 3) }); });
  assert.equal(result.code, 'STALE_TARGET'); assert.equal(hook.value('A3'), undefined);
});
