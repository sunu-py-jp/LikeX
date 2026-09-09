import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/state/use-spreadsheet-clipboard"; export * from "./src/model";', resolveDir: packageRoot, sourcefile: 'merged-clipboard-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useSpreadsheet, useSpreadsheetClipboard, mergeCells, serializeWorkbook, parseWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const position = (row, column) => ({ row, column });
const merge = (top, left, bottom, right) => ({ top, left, bottom, right });
const sourceMerge = merge(0, 2, 1, 3);
const pastedMerge = merge(3, 5, 4, 6);
const book = () => ({ sheets: [{ id: 'one', name: 'One', rowCount: 12, columnCount: 12,
  cells: {
    A1: { value: '2', format: { italic: true } },
    C1: { value: '=A1*3', format: { bold: true } },
    D1: { value: '', format: { background: '#abcdef' } },
    C2: { value: '', format: { underline: true } },
    A5: { value: '=C1' },
  },
  comments: { A1: { id: 'plain-comment', text: 'plain source' }, C1: { id: 'merged-comment', text: 'merged source' } },
  merges: [sourceMerge],
}, { id: 'two', name: 'Two', rowCount: 12, columnCount: 12, cells: { D4: { value: '7' } } }] });

async function mount(t, options = {}) {
  let current, renderer;
  let props = { initialWorkbook: book(), onSave: value => value, ...options };
  let selectionOverride;
  function Probe({ props, selectionOverride }) {
    const state = useSpreadsheet(props);
    const controller = selectionOverride ? { ...state, selection: selectionOverride } : state;
    current = { ...controller, clipboard: useSpreadsheetClipboard(controller) };
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe, { props })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const render = async () => { await act(async () => renderer.update(createElement(Probe, { props, selectionOverride }))); };
  return {
    get c() { return current; },
    async update(patch) { props = { ...props, ...patch }; await render(); },
    async overrideSelection(value) { selectionOverride = value; await render(); },
    async select(row, column) { await act(async () => current.select(position(row, column))); },
    async sheet(id) { await act(async () => current.switchSheet(id)); },
    async copy(cut = false) {
      const event = clipboardEvent();
      await act(async () => cut ? current.clipboard.onCut(event) : current.clipboard.onCopy(event));
      return event;
    },
    async paste(event) { await act(async () => current.clipboard.onPaste(event)); },
  };
}

function clipboardEvent(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { preventDefault() {}, clipboardData: {
    getData: type => values.get(type) ?? '', setData: (type, value) => values.set(type, value),
    get types() { return [...values.keys()]; },
  } };
}

function mockClipboard(t, clipboard) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('copy preserves merged geometry, relative formulas, covered formats, and copied comment identity', async t => {
  const ui = await mount(t);
  await ui.select(1, 3);
  const copied = await ui.copy();
  await ui.select(3, 5);
  await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, pastedMerge]);
  assert.equal(ui.c.activeSheet.cells.F4.value, '=D4*3');
  assert.equal(ui.c.activeSheet.cells.F4.format.bold, true);
  assert.equal(ui.c.activeSheet.cells.G4.format.background, '#abcdef');
  assert.equal(ui.c.activeSheet.cells.F5.format.underline, true);
  assert.equal(ui.c.activeSheet.comments.F4.text, 'merged source');
  assert.notEqual(ui.c.activeSheet.comments.F4.id, 'merged-comment');
  assert.equal(ui.c.activeSheet.comments.C1.id, 'merged-comment');
});

test('copy across sheets preserves merge geometry and resolves translated formulas in the destination sheet', async t => {
  const ui = await mount(t);
  await ui.select(0, 2);
  const copied = await ui.copy();
  await ui.sheet('two'); await ui.select(3, 5); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [pastedMerge]);
  assert.equal(ui.c.activeSheet.cells.F4.value, '=D4*3');
  assert.equal(ui.c.calculated.two.F4, 21);
  assert.equal(ui.c.workbook.sheets[0].comments.C1.id, 'merged-comment');
  assert.notEqual(ui.c.activeSheet.comments.F4.id, 'merged-comment');
});

for (const crossSheet of [false, true]) test(`cut ${crossSheet ? 'across sheets' : 'within the sheet'} moves the merge and retains comment identity`, async t => {
  const ui = await mount(t);
  await ui.select(0, 2);
  const copied = await ui.copy(true);
  if (crossSheet) await ui.sheet('two');
  await ui.select(3, 5); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [pastedMerge]);
  assert.equal(ui.c.activeSheet.comments.F4.id, 'merged-comment');
  assert.equal(ui.c.workbook.sheets[0].comments.C1, undefined);
  assert.equal(ui.c.workbook.sheets[0].cells.C1?.value ?? '', '');
  if (crossSheet) assert.equal(ui.c.workbook.sheets[0].merges, undefined);
});

test('cut may overlap its own merge while shifting the complete geometry', async t => {
  const ui = await mount(t);
  await ui.select(0, 2);
  const copied = await ui.copy(true);
  // B1:C2 overlaps the old merge, but the cut removes the old C1:D2 first.
  await ui.select(0, 1); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [merge(0, 1, 1, 2)]);
  assert.equal(ui.c.activeSheet.comments.B1.id, 'merged-comment');
});

test('copy rejects a source slice through a merge without exporting hidden cells', async t => {
  const ui = await mount(t);
  const anchor = position(0, 2);
  await ui.overrideSelection({ sheetId: 'one', anchor, focus: anchor, ranges: [{ anchor, focus: anchor }] });
  const copied = await ui.copy();
  assert.match(ui.c.error, /結合全体/);
  assert.equal(copied.clipboardData.getData('text/plain'), '');
  assert.equal(ui.c.dirty, false);
});

for (const cut of [false, true]) test(`${cut ? 'cut' : 'copy'} rejects a partially overlapping destination merge atomically`, async t => {
  const initialWorkbook = book();
  initialWorkbook.sheets[0].merges.push(merge(3, 6, 5, 7));
  const ui = await mount(t, { initialWorkbook });
  await ui.select(0, 2);
  const copied = await ui.copy(cut);
  await ui.select(3, 5);
  const before = ui.c.workbook;
  await ui.paste(copied);
  assert.match(ui.c.error, /一部/);
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.activeSheet.comments.C1.id, 'merged-comment');
});

test('internal copy replaces only fully contained destination merges', async t => {
  const initialWorkbook = book();
  initialWorkbook.sheets[0].merges.push(merge(3, 5, 3, 6), merge(4, 5, 4, 6));
  initialWorkbook.sheets[0].cells.F4 = { value: 'old first' };
  initialWorkbook.sheets[0].cells.F5 = { value: 'old second' };
  initialWorkbook.sheets[0].comments.F5 = { id: 'old-destination', text: 'replace' };
  const ui = await mount(t, { initialWorkbook });
  await ui.select(0, 2); const copied = await ui.copy();
  await ui.select(3, 5); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, pastedMerge]);
  assert.equal(ui.c.activeSheet.cells.F5?.value ?? '', '');
  assert.equal(ui.c.activeSheet.comments.F5, undefined);
});

test('ordinary rectangular copy can remove fully covered destination merge geometry', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectRange(position(3, 5), position(4, 6)));
  const copied = await ui.copy();
  await ui.select(0, 2); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.equal(ui.c.activeSheet.merges, undefined);
  assert.equal(ui.c.activeSheet.cells.C1?.value ?? '', '');
});

test('copy cannot silently discard a hidden destination comment when the comments feature is off', async t => {
  const initialWorkbook = book();
  initialWorkbook.sheets[0].comments.G5 = { id: 'hidden-destination', text: 'preserve while hidden' };
  const ui = await mount(t, { initialWorkbook, features: { comments: false } });
  await ui.select(0, 2); const copied = await ui.copy();
  await ui.select(3, 5);
  const before = ui.c.workbook;
  await ui.paste(copied);
  assert.match(ui.c.error, /コメントが失われ/);
  assert.equal(ui.c.workbook, before);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.activeSheet.comments.G5.id, 'hidden-destination');
});

for (const mergeCellsEnabled of [true, false]) test(`external scalar edits the merged anchor and preserves layout with merge feature ${mergeCellsEnabled ? 'on' : 'off'}`, async t => {
  const ui = await mount(t, { features: { mergeCells: mergeCellsEnabled } });
  await ui.select(1, 3);
  await ui.paste(clipboardEvent({ 'text/plain': 'changed' }));
  assert.equal(ui.c.error, null);
  assert.equal(ui.c.activeSheet.cells.C1.value, 'changed');
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge]);
  assert.equal(ui.c.activeSheet.comments.C1.id, 'merged-comment');
});

test('internal unmerged scalar copy edits a merged anchor with formatting and comments while merge feature is off', async t => {
  const ui = await mount(t, { features: { mergeCells: false } });
  await ui.select(0, 0); const copied = await ui.copy();
  await ui.select(1, 3); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.equal(ui.c.activeSheet.cells.C1.value, '2');
  assert.equal(ui.c.activeSheet.cells.C1.format.italic, true);
  assert.equal(ui.c.activeSheet.comments.C1.text, 'plain source');
  assert.notEqual(ui.c.activeSheet.comments.C1.id, 'plain-comment');
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge]);
});

test('internal scalar cut into a merged cell is rejected without deleting its source', async t => {
  const ui = await mount(t);
  await ui.select(0, 0); const copied = await ui.copy(true);
  await ui.select(1, 3); await ui.paste(copied);
  assert.match(ui.c.error, /一部/);
  assert.equal(ui.c.activeSheet.cells.A1.value, '2');
  assert.equal(ui.c.dirty, false);
});

test('external rectangular paste cannot replace a merged region even when its entire geometry matches', async t => {
  const ui = await mount(t);
  await ui.select(0, 2);
  await ui.paste(clipboardEvent({ 'text/plain': 'a\tb\nc\td' }));
  assert.match(ui.c.error, /先に結合を解除/);
  assert.equal(ui.c.dirty, false);
  assert.equal(ui.c.activeSheet.cells.C1.value, '=A1*3');
});

test('merge feature off prevents new merge layout, replacing existing layout, and cutting merged source cells', async t => {
  const ui = await mount(t, { features: { mergeCells: false } });
  await ui.select(0, 2); const copied = await ui.copy();
  await ui.select(3, 5); await ui.paste(copied);
  assert.match(ui.c.error, /結合の変更は無効/);
  assert.equal(ui.c.dirty, false);
  await ui.select(0, 2); const cut = await ui.copy(true);
  assert.equal(cut.clipboardData.getData('text/plain'), '');
  await act(async () => ui.c.selectRange(position(3, 5), position(4, 6)));
  const plain = await ui.copy();
  await ui.select(0, 2); await ui.paste(plain);
  assert.match(ui.c.error, /結合の変更は無効/);
  assert.equal(ui.c.dirty, false);
});

test('paste respects a merge feature disabled after the internal clipboard was populated', async t => {
  const ui = await mount(t);
  await ui.select(0, 2); const copied = await ui.copy();
  await ui.select(3, 5); await ui.update({ features: { mergeCells: false } });
  await ui.paste(copied);
  assert.match(ui.c.error, /結合の変更は無効/);
  assert.equal(ui.c.dirty, false);
});

test('undo and JSON save round trip a copied merge without separating its history transaction', async t => {
  let json;
  const ui = await mount(t, { onSave: wb => { json = serializeWorkbook(wb); return parseWorkbook(json); } });
  await ui.select(0, 2); const copied = await ui.copy();
  await ui.select(3, 5); await ui.paste(copied);
  assert.equal(ui.c.dirty, true);
  await act(async () => ui.c.undo());
  assert.equal(ui.c.dirty, false);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge]);
  assert.equal(ui.c.activeSheet.cells.F4, undefined);
  await act(async () => ui.c.redo());
  await act(async () => ui.c.save());
  assert.deepEqual(JSON.parse(json).sheets[0].merges, [sourceMerge, pastedMerge]);
  assert.equal(JSON.parse(json).sheets[0].cells.G4.format.background, '#abcdef');
  assert.equal(ui.c.dirty, false);
});

test('awaited external paste ignores a stale destination after merge geometry changes', async t => {
  const pending = deferred();
  mockClipboard(t, { readText: () => pending.promise });
  const ui = await mount(t);
  await ui.select(3, 5);
  let pasted;
  await act(async () => { pasted = ui.c.clipboard.paste(); });
  await act(async () => ui.c.apply(wb => mergeCells(wb, 'one', pastedMerge)));
  await act(async () => { pending.resolve('stale'); await pasted; });
  assert.equal(ui.c.activeSheet.cells.F4, undefined);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, pastedMerge]);
});
