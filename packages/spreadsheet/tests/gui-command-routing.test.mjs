import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './src/model-entry';
export { useSpreadsheet } from './src/state/use-spreadsheet';
export { useSpreadsheetClipboard } from './src/state/use-spreadsheet-clipboard';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'gui-routing.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }] });
const { useSpreadsheet, useSpreadsheetClipboard, applySpreadsheetCommands, copySpreadsheetCells, normalizeWorkbook } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
async function mount(t, initialWorkbook) {
  let c, renderer;
  const events = [], changes = [], requests = [];
  function Probe() {
    const current = useSpreadsheet({ initialWorkbook, onSave: () => {}, onChange: next => changes.push(next),
      onEvent: event => events.push(event), onEditRequest: event => { requests.push(event); return true; } });
    c = { ...current, clipboard: useSpreadsheetClipboard(current) };
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return c; }, changes, events, requests };
}
const source = () => normalizeWorkbook({ sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 10, columnCount: 8,
  cells: { A1: { value: '=D1+1', format: { bold: true } }, D1: { value: '5' } },
  comments: { A1: { id: 'note', text: '説明' } }, merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] }] });
function withoutCommentIds(workbook) {
  return JSON.parse(JSON.stringify(workbook), (key, value) => key === 'comments'
    ? Object.fromEntries(Object.entries(value).map(([address, comment]) => [address, { text: comment.text, author: comment.author }])) : value);
}
const copyEvent = () => {
  const values = new Map();
  return { target: null, preventDefault() {}, clipboardData: { getData: key => values.get(key) ?? '',
    setData: (key, value) => values.set(key, value), get types() { return [...values.keys()]; } } };
};

test('GUI editor commits and clear use the same command result and event semantics as headless cell commands', async t => {
  const initial = source(), ui = await mount(t, initial);
  await act(async () => ui.c.beginEdit({ row: 2, column: 2 }, '=D1*2'));
  await act(async () => { assert.equal(await ui.c.commitEdit(), true); });
  const direct = applySpreadsheetCommands(initial, [{ type: 'cells.set', sheetId: 'sheet', values: { C3: '=D1*2' } }]);
  assert.equal(direct.ok, true);
  assert.deepEqual(ui.c.workbook, direct.workbook);
  assert.deepEqual(ui.events.filter(event => event.type === 'change').map(event => event.commands), [['cells.set']]);
  assert.equal(ui.changes.length, 1); assert.equal(ui.requests.length, 1);
  await act(async () => ui.c.select({ row: 2, column: 2 }));
  await act(async () => ui.c.clearCells());
  const cleared = applySpreadsheetCommands(direct.workbook, [{ type: 'cells.clear', sheetId: 'sheet', range: 'C3' }]);
  assert.deepEqual(ui.c.workbook, cleared.workbook);
  assert.deepEqual(ui.events.filter(event => event.type === 'change').at(-1).commands, ['cells.clear']);
  await act(async () => ui.c.undo());
  assert.deepEqual(ui.c.workbook, direct.workbook);
});

for (const cut of [false, true]) test(`GUI ${cut ? 'cut' : 'copy'}/paste equals the public ${cut ? 'cells.move' : 'copy/paste'} API with one undo unit`, async t => {
  const initial = source(), ui = await mount(t, initial), range = { top: 0, left: 0, bottom: 0, right: 1 };
  await act(async () => ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 }));
  const copied = copyEvent();
  await act(async () => cut ? ui.c.clipboard.onCut(copied) : ui.c.clipboard.onCopy(copied));
  await act(async () => ui.c.select({ row: 3, column: 4 }));
  await act(async () => ui.c.clipboard.onPaste(copied));
  const command = cut ? { type: 'cells.move', sheetId: 'sheet', source: { sheetId: 'sheet', ...range }, target: { row: 3, column: 4 } }
    : { type: 'cells.paste', sheetId: 'sheet', target: { row: 3, column: 4 }, payload: copySpreadsheetCells(initial, 'sheet', range) };
  const direct = applySpreadsheetCommands(initial, [command]);
  assert.equal(direct.ok, true);
  assert.deepEqual(withoutCommentIds(ui.c.workbook), withoutCommentIds(direct.workbook));
  assert.deepEqual(ui.events.filter(event => event.type === 'change').map(event => event.commands), [[command.type]]);
  assert.equal(ui.changes.length, 1); assert.equal(ui.requests.length, 1);
  await act(async () => ui.c.undo());
  assert.deepEqual(ui.c.workbook, initial);
});
