import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export { useSpreadsheet } from "./src/state/use-spreadsheet"; export { useSpreadsheetClipboard } from "./src/state/use-spreadsheet-clipboard";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'clipboard-features.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetClipboard } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const workbook = () => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 12, columnCount: 6,
  cells: { A1: { value: '2' }, B1: { value: 'source', format: { bold: true } } },
  comments: { B1: { id: 'comment-source', text: 'original comment' } },
}] });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function clipboardEvent(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { target: null, prevented: false, preventDefault() { this.prevented = true; }, clipboardData: {
    getData: type => data.get(type) ?? '', setData: (type, value) => data.set(type, value),
    get types() { return [...data.keys()]; },
  } };
}
function globalValue(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
}
async function mount(t, overrides = {}) {
  let current, renderer;
  let props = { initialWorkbook: workbook(), onSave: () => {}, ...overrides };
  function Probe() { const controller = useSpreadsheet(props); current = { ...controller, clipboard: useSpreadsheetClipboard(controller) }; return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get current() { return current; },
    async select(row, column) { await act(async () => current.select({ row, column })); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}
const clipboardActions = events => events.filter(event => event.type === 'clipboard').map(event => event.action);

function denyClipboardRead(t, name = 'NotAllowedError') {
  let reads = 0;
  const denied = async () => { reads++; throw Object.assign(new Error('Permission denied'), { name }); };
  globalValue(t, 'navigator', { clipboard: { readText: denied, read: denied } });
  return () => reads;
}
async function copySource(hook, cut = false) {
  await hook.select(0, 1);
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard[cut ? 'onCut' : 'onCopy'](copied));
  await hook.select(0, 0);
  return copied;
}

test('formats paste uses the copied cell snapshot without OS read, keeps values and comments, and undoes once', async t => {
  const reads = denyClipboardRead(t), events = [], hook = await mount(t, { onEvent: event => events.push(event) });
  const before = hook.current.workbook;
  await copySource(hook);
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(hook.current.error, null);
  assert.equal(hook.current.activeSheet.cells.A1.value, '2'); assert.equal(hook.current.activeSheet.cells.A1.format.bold, true);
  assert.equal(hook.current.activeSheet.comments.A1, undefined); assert.equal(hook.current.activeSheet.comments.B1.id, 'comment-source');
  assert.deepEqual(clipboardActions(events), ['copy', 'paste']);
  await act(async () => hook.current.undo());
  assert.equal(hook.current.workbook, before); assert.equal(hook.current.dirty, false); assert.equal(hook.current.canUndo, false);
});

test('formats paste without an internal cell copy gives copy instructions without reading OS data or requesting edit', async t => {
  const reads = denyClipboardRead(t); let requests = 0;
  const hook = await mount(t, { onEditRequest: () => { requests++; return true; } }), before = hook.current.workbook;
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(requests, 0); assert.equal(hook.current.workbook, before);
  assert.match(hook.current.error, /コピー/); assert.match(hook.current.error, /Ctrl|⌘|ショートカット/);
});

test('formats paste rejects a cut snapshot and leaves that cut available for ordinary paste', async t => {
  const reads = denyClipboardRead(t), hook = await mount(t), before = hook.current.workbook;
  const copied = await copySource(hook, true);
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(hook.current.workbook, before);
  assert.match(hook.current.error, /通常/);
  await act(async () => hook.current.clipboard.onPaste(copied));
  assert.equal(hook.current.activeSheet.cells.A1.value, 'source'); assert.equal(hook.current.activeSheet.cells.B1, undefined);
});

test('formats paste rejects a copied drawing without OS reads or cell changes', async t => {
  const reads = denyClipboardRead(t), initial = workbook();
  initial.sheets[0].drawings = [{ id: 'shape', type: 'shape', shape: 'ellipse', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 },
    width: 100, height: 70, fill: '#ffffff', stroke: '#217346', strokeWidth: 2, text: 'shape' }];
  const hook = await mount(t, { initialWorkbook: initial }), before = hook.current.workbook;
  await act(async () => hook.current.selectDrawing('shape'));
  await act(async () => hook.current.clipboard.onCopy(clipboardEvent()));
  await hook.select(0, 0);
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(hook.current.workbook, before); assert.match(hook.current.error, /通常/);
});

for (const change of ['copy', 'formatting-cycle', 'multi-range', 'readOnly']) test(`pending formats paste is cancelled after ${change}`, async t => {
  const reads = denyClipboardRead(t), permission = deferred(), events = [];
  let requests = 0;
  const hook = await mount(t, { onEditRequest: () => { requests++; return permission.promise; }, onEvent: event => events.push(event) });
  const before = hook.current.workbook;
  await copySource(hook);
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(requests, 1); assert.equal(hook.current.workbook, before);
  if (change === 'copy') await act(async () => hook.current.clipboard.onCopy(clipboardEvent()));
  else if (change === 'formatting-cycle') { await hook.update({ features: { formatting: false } }); await hook.update({ features: {} }); }
  else if (change === 'multi-range') await act(async () => hook.current.select({ row: 2, column: 2 }, false, true));
  else await hook.update({ readOnly: true });
  await act(async () => permission.resolve(true));
  assert.equal(reads(), 0); assert.equal(hook.current.workbook, before); assert.equal(hook.current.canUndo, false);
  assert.equal(clipboardActions(events).includes('paste'), false);
});

for (const mode of ['all', 'values', 'formulas']) for (const name of ['NotAllowedError', 'SecurityError'])
  test(`${mode} paste rejected with ${name} never applies the old internal snapshot`, async t => {
    const reads = denyClipboardRead(t, name), hook = await mount(t), before = hook.current.workbook;
    await copySource(hook);
    await act(async () => hook.current.clipboard.paste(mode));
    assert.equal(reads(), 1); assert.equal(hook.current.workbook, before); assert.equal(hook.current.canUndo, false);
    assert.match(hook.current.error, /貼り付け/); assert.match(hook.current.error, /Ctrl\+V/);
    assert.doesNotMatch(hook.current.error, /Permission denied/);
    if (mode !== 'all') assert.match(hook.current.error, /通常の貼り付け/);
  });

for (const feature of ['clipboard', 'paste', 'pasteSpecial', 'formatting']) test(`${feature} off prevents local formats paste without OS read`, async t => {
  const reads = denyClipboardRead(t), hook = await mount(t), before = hook.current.workbook;
  await copySource(hook);
  await hook.update({ features: { [feature]: false } });
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(hook.current.workbook, before); assert.equal(hook.current.canUndo, false);
});

test('readonly mode permits copy but cannot apply its stored formatting', async t => {
  const reads = denyClipboardRead(t), hook = await mount(t, { readOnly: true }), before = hook.current.workbook;
  await copySource(hook);
  await act(async () => hook.current.clipboard.paste('formats'));
  assert.equal(reads(), 0); assert.equal(hook.current.workbook, before); assert.equal(hook.current.canUndo, false);
});

test('copy off still permits native cut and applies an authorized paste as one undoable change', async t => {
  const permission = deferred(), events = [], changes = [];
  let requests = 0;
  const hook = await mount(t, { features: { copy: false }, onEditRequest: () => { requests++; return permission.promise; },
    onEvent: event => events.push(event), onChange: value => changes.push(value) });
  await hook.select(0, 1);
  const deniedCopy = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(deniedCopy));
  assert.equal(deniedCopy.prevented, true); assert.equal(deniedCopy.clipboardData.getData('text/plain'), '');
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(copied));
  assert.equal(copied.clipboardData.getData('text/plain'), 'source');
  assert.equal(requests, 0, 'cut does not mutate the workbook until paste');
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(copied));
  assert.equal(requests, 1); assert.equal(changes.length, 0);
  assert.equal(hook.current.activeSheet.cells.B1.value, 'source');
  assert.deepEqual(clipboardActions(events), ['cut']);
  await act(async () => permission.resolve(true));
  assert.equal(hook.current.activeSheet.cells.B1?.value ?? '', '');
  assert.equal(hook.current.activeSheet.cells.B4.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4.format.bold, true);
  assert.equal(hook.current.activeSheet.comments.B4.id, 'comment-source');
  assert.deepEqual(clipboardActions(events), ['cut', 'paste']);
  assert.equal(changes.length, 1);
  await act(async () => hook.current.undo());
  assert.equal(hook.current.activeSheet.cells.B1.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4, undefined);
});

test('denied paste leaves the cut armed for an explicit retry and emits no successful paste', async t => {
  let decide;
  const events = [];
  const hook = await mount(t, { onEditRequest: () => new Promise(resolve => { decide = resolve; }), onEvent: event => events.push(event) });
  await hook.select(0, 1);
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(copied));
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(copied));
  await act(async () => decide(false));
  assert.equal(hook.current.activeSheet.cells.B1.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4, undefined);
  assert.deepEqual(clipboardActions(events), ['cut']);
  await act(async () => hook.current.clipboard.onPaste(copied));
  await act(async () => decide(true));
  assert.equal(hook.current.activeSheet.cells.B1?.value ?? '', '');
  assert.equal(hook.current.activeSheet.cells.B4.format.bold, true);
  assert.deepEqual(clipboardActions(events), ['cut', 'paste']);
});

for (const feature of ['cut', 'paste']) test(`${feature} off while permission is pending invalidates the captured cut operation`, async t => {
  const permission = deferred(), events = [];
  const hook = await mount(t, { onEditRequest: () => permission.promise, onEvent: event => events.push(event) });
  await hook.select(0, 1);
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCut(copied));
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(copied));
  await hook.update({ features: { [feature]: false } });
  await act(async () => permission.resolve(true));
  assert.equal(hook.current.activeSheet.cells.B1.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4, undefined);
  assert.deepEqual(clipboardActions(events), ['cut']);
});

test('formula policy is rechecked after asynchronous paste permission', async t => {
  const permission = deferred();
  const hook = await mount(t, { onEditRequest: () => permission.promise });
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(clipboardEvent({ 'text/plain': '=1+2' })));
  await hook.update({ features: { formulas: false } });
  await act(async () => permission.resolve(true));
  assert.equal(hook.current.activeSheet.cells.B4, undefined);
});

for (const cut of [false, true]) test(`an in-flight ${cut ? 'cut' : 'copy'} write is invalidated even if its disabled feature is re-enabled`, async t => {
  const written = deferred(), events = [];
  let item;
  globalValue(t, 'ClipboardItem', class { constructor(values) { this.values = values; } });
  globalValue(t, 'navigator', { clipboard: { writeText: async () => {}, write: items => { item = items[0]; return written.promise; } } });
  const hook = await mount(t, { onEvent: event => events.push(event) });
  await hook.select(0, 1);
  let pending;
  await act(async () => { pending = hook.current.clipboard.copy(cut); });
  await hook.update({ features: { [cut ? 'cut' : 'copy']: false } });
  await hook.update({ features: {} });
  await act(async () => { written.resolve(); await pending; });
  assert.deepEqual(clipboardActions(events), []);
  const event = clipboardEvent({ 'text/plain': await item.values['text/plain'].text(), 'text/html': await item.values['text/html'].text() });
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(event));
  assert.equal(hook.current.activeSheet.cells.B1.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4.value, 'source');
  assert.equal(hook.current.activeSheet.cells.B4.format, undefined, 'expired tokens must fall back to plain text');
});

test('an in-flight clipboard read is invalidated by paste off even if it becomes enabled again', async t => {
  const reading = deferred(), events = [];
  globalValue(t, 'navigator', { clipboard: { readText: () => reading.promise } });
  const hook = await mount(t, { onEvent: event => events.push(event) });
  await hook.select(3, 1);
  let pending;
  await act(async () => { pending = hook.current.clipboard.paste(); });
  await hook.update({ features: { paste: false } });
  await hook.update({ features: {} });
  await act(async () => { reading.resolve('late'); await pending; });
  assert.equal(hook.current.activeSheet.cells.B4, undefined);
  assert.deepEqual(clipboardActions(events), []);
});

test('mutating event selection payloads cannot alter internal selection or clipboard destinations', async t => {
  const hook = await mount(t, { onEvent: event => {
    if (event.type !== 'clipboard') return;
    event.selection.anchor.row = 11;
    event.selection.focus.column = 5;
    event.selection.ranges[0].focus.row = 11;
  } });
  await hook.select(0, 1);
  const copied = clipboardEvent();
  await act(async () => hook.current.clipboard.onCopy(copied));
  assert.deepEqual(hook.current.selection.focus, { row: 0, column: 1 });
  assert.deepEqual(hook.current.selection.anchor, { row: 0, column: 1 });
  await hook.select(3, 1);
  await act(async () => hook.current.clipboard.onPaste(copied));
  assert.equal(hook.current.activeSheet.cells.B4.value, 'source');
  assert.equal(hook.current.activeSheet.cells.F12, undefined);
  assert.deepEqual(hook.current.selection.focus, { row: 3, column: 1 });
  assert.deepEqual(hook.current.selection.anchor, { row: 3, column: 1 });
});
