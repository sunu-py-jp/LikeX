import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/state/use-spreadsheet-clipboard";', resolveDir: packageRoot, sourcefile: 'multi-selection-clipboard-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetClipboard } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const message = 'コピー・切り取り・貼り付けは、1つの連続した範囲を選択してください';
const position = (row, column) => ({ row, column });
const range = (row, column) => ({ anchor: position(row, column), focus: position(row, column) });
const multiple = () => ({ sheetId: 'one', ...range(2, 2), ranges: [range(0, 0), range(2, 2)] });
const single = (row = 0, column = 0) => ({ sheetId: 'one', ...range(row, column) });
const book = () => ({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 20, columnCount: 10,
  cells: { A1: { value: '2' }, B1: { value: '=A1*3', format: { bold: true } }, C3: { value: 'outside' } },
  comments: { B1: { id: 'source-comment', text: 'keep this comment' } },
}] });

async function mount(t, initialSelection = single()) {
  let current, renderer;
  function Probe({ selection }) {
    const state = useSpreadsheet({ initialWorkbook: book(), onSave: value => value });
    const controller = { ...state, selection };
    current = { ...controller, clipboard: useSpreadsheetClipboard(controller) };
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe, { selection: initialSelection })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    get current() { return current; },
    async select(selection) { await act(async () => renderer.update(createElement(Probe, { selection }))); },
  };
}

function clipboardEvent(initial = {}, target) {
  const values = new Map(Object.entries(initial));
  return { target, prevented: false, preventDefault() { this.prevented = true; }, clipboardData: {
    getData: type => values.get(type) ?? '', setData: (type, value) => values.set(type, value),
    get types() { return [...values.keys()]; },
  } };
}

function mockGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('native copy, cut and paste reject disjoint ranges without reading or modifying the gaps', async t => {
  const hook = await mount(t, multiple());
  const before = hook.current.workbook;
  for (const method of ['onCopy', 'onCut', 'onPaste']) {
    const event = clipboardEvent(method === 'onPaste' ? { 'text/plain': 'overwrite' } : {});
    await act(async () => hook.current.clipboard[method](event));
    assert.equal(event.prevented, true);
    assert.equal(hook.current.error, message);
    if (method !== 'onPaste') assert.equal(event.clipboardData.getData('text/plain'), '');
    assert.equal(hook.current.workbook, before);
    assert.equal(hook.current.dirty, false);
  }
});

test('toolbar copy, cut and paste reject disjoint ranges before accessing the OS clipboard', async t => {
  let accesses = 0;
  mockGlobal(t, 'navigator', { clipboard: { writeText() { accesses++; }, readText() { accesses++; return 'overwrite'; } } });
  const hook = await mount(t, multiple());
  await act(async () => hook.current.clipboard.copy());
  assert.equal(hook.current.error, message);
  await act(async () => hook.current.clipboard.copy(true));
  assert.equal(hook.current.error, message);
  await act(async () => hook.current.clipboard.paste());
  assert.equal(hook.current.error, message);
  assert.equal(accesses, 0);
  assert.equal(hook.current.dirty, false);
});

test('text controls and cell editing retain native clipboard shortcuts with multiple ranges', async t => {
  const hook = await mount(t, multiple());
  const textTarget = { closest: () => ({ classList: { contains: () => false } }) };
  for (const method of ['onCopy', 'onCut', 'onPaste']) {
    const event = clipboardEvent({ 'text/plain': 'editor text' }, textTarget);
    await act(async () => hook.current.clipboard[method](event));
    assert.equal(event.prevented, false);
    assert.equal(hook.current.error, null);
  }
  await act(async () => hook.current.beginEdit(position(0, 0), 'editor draft'));
  for (const method of ['onCopy', 'onCut', 'onPaste']) {
    const event = clipboardEvent({ 'text/plain': 'editor text' });
    await act(async () => hook.current.clipboard[method](event));
    assert.equal(event.prevented, false);
    assert.equal(hook.current.error, null);
  }
  assert.equal(hook.current.dirty, false);
});

test('an awaited paste rejects the current disjoint selection instead of using its old destination', async t => {
  const pending = deferred();
  mockGlobal(t, 'navigator', { clipboard: { readText: () => pending.promise } });
  const hook = await mount(t);
  let pasted;
  await act(async () => { pasted = hook.current.clipboard.paste(); });
  await hook.select(multiple());
  await act(async () => { pending.resolve('99'); await pasted; });
  assert.equal(hook.current.error, message);
  assert.equal(hook.current.activeSheet.cells.A1.value, '2');
  assert.equal(hook.current.dirty, false);
});

test('passing through a disjoint selection cancels an awaited paste even when a single range returns', async t => {
  const pending = deferred();
  mockGlobal(t, 'navigator', { clipboard: { readText: () => pending.promise } });
  const hook = await mount(t);
  let pasted;
  await act(async () => { pasted = hook.current.clipboard.paste(); });
  await hook.select(multiple());
  await hook.select(single());
  await act(async () => { pending.resolve('99'); await pasted; });
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.activeSheet.cells.A1.value, '2');
});

test('entering a disjoint selection disarms previous cut data before returning to a single destination', async t => {
  const hook = await mount(t, single(0, 1));
  const event = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(event));
  await hook.select(multiple());
  await hook.select(single(3, 1));
  await act(async () => hook.current.clipboard.onPaste(event));
  assert.equal(hook.current.activeSheet.cells.B1.value, '=A1*3');
  assert.equal(hook.current.activeSheet.comments.B1.id, 'source-comment');
  assert.equal(hook.current.activeSheet.cells.B4.value, '6');
  assert.equal(hook.current.activeSheet.cells.B4.format, undefined);
  assert.equal(hook.current.activeSheet.comments.B4, undefined);
});

test('an awaited copy cannot restore a stale cut after the user changes to multiple ranges', async t => {
  const pending = deferred();
  let payload;
  mockGlobal(t, 'ClipboardItem', class { constructor(data) { this.data = data; } });
  mockGlobal(t, 'navigator', { clipboard: { writeText() {}, write(items) { payload = items[0].data; return pending.promise; } } });
  const hook = await mount(t, single(0, 1));
  let copied;
  await act(async () => { copied = hook.current.clipboard.copy(true); });
  await hook.select(multiple());
  await hook.select(single(3, 1));
  await act(async () => { pending.resolve(); await copied; });
  const event = clipboardEvent({ 'text/plain': await payload['text/plain'].text(), 'text/html': await payload['text/html'].text() });
  await act(async () => hook.current.clipboard.onPaste(event));
  assert.equal(hook.current.activeSheet.cells.B1.value, '=A1*3');
  assert.equal(hook.current.activeSheet.comments.B1.id, 'source-comment');
  assert.equal(hook.current.activeSheet.cells.B4.value, '6');
});

test('ordinary single-range destination changes while copying preserve internal formula and format data', async t => {
  const pending = deferred();
  let payload;
  mockGlobal(t, 'ClipboardItem', class { constructor(data) { this.data = data; } });
  mockGlobal(t, 'navigator', { clipboard: { writeText() {}, write(items) { payload = items[0].data; return pending.promise; } } });
  const hook = await mount(t, single(0, 1));
  let copied;
  await act(async () => { copied = hook.current.clipboard.copy(); });
  await hook.select(single(3, 1));
  await act(async () => { pending.resolve(); await copied; });
  const event = clipboardEvent({ 'text/plain': await payload['text/plain'].text(), 'text/html': await payload['text/html'].text() });
  await act(async () => hook.current.clipboard.onPaste(event));
  assert.equal(hook.current.activeSheet.cells.B4.value, '=A4*3');
  assert.equal(hook.current.activeSheet.cells.B4.format.bold, true);
  assert.equal(hook.current.activeSheet.comments.B4.text, 'keep this comment');
});

test('a fresh copy after returning to a single range retains formula, format and comment behavior', async t => {
  const hook = await mount(t, multiple());
  await act(async () => hook.current.clipboard.onCopy(clipboardEvent()));
  await hook.select(single(0, 1));
  const event = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(event));
  await hook.select(single(3, 1));
  await act(async () => hook.current.clipboard.onPaste(event));
  assert.equal(hook.current.activeSheet.cells.B4.value, '=A4*3');
  assert.equal(hook.current.activeSheet.cells.B4.format.bold, true);
  assert.equal(hook.current.activeSheet.comments.B4.text, 'keep this comment');
  assert.notEqual(hook.current.activeSheet.comments.B4.id, 'source-comment');
});
