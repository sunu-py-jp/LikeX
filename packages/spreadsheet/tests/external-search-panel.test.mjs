import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export {default as Spreadsheet} from './src/spreadsheet';
  export {serializeWorkbook} from './src/model/serialization';
  export {useSpreadsheet} from './src/state/use-spreadsheet'; export {useSpreadsheetHandle} from './src/api/use-spreadsheet-handle';`,
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/import\/import-xlsx$/ }, () => ({ path: 'decoder', namespace: 'external-search-decoder' }));
    builder.onLoad({ filter: /.*/, namespace: 'external-search-decoder' }, () => ({ contents: 'export const importSpreadsheetXlsx = (...args) => globalThis.__externalSearchWorkbookDecoder(...args);', loader: 'js' }));
    builder.onResolve({ filter: /\/spreadsheet-(?:dialog|floating-window)$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
      'import {createElement} from "react"; export const SpreadsheetDialog=({children,actions,title,onClose})=>createElement("div",{role:"dialog","aria-label":title},children,actions,createElement("button",{"aria-label":"閉じる",onClick:onClose},"閉じる")); export const SpreadsheetFloatingWindow=SpreadsheetDialog;', loader: 'js' }));
  } }] });
const { Spreadsheet, useSpreadsheet, useSpreadsheetHandle, serializeWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const workbook = () => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 1000, columnCount: 30, cells: { A1: { value: 'Alpha' } } }, { id: 'other', name: 'Other', rowCount: 1000, columnCount: 30, cells: {} }] });
async function mount(t, overrides = {}, full = false) {
  const ref = createRef(), frames = [], changes = [], editRequests = [];
  let c, context, renderer, active = true;
  let props = { ref, initialWorkbook: workbook(), onSave() {}, onChange: value => changes.push(value),
    onEditRequest: request => { editRequests.push(request); return true; },
    renderSearch(value) { context = value; return h('div', { 'data-search-fields': true }, value.defaultInput, value.defaultOptions, value.defaultReplacement); }, ...overrides };
  function Probe() { c = useSpreadsheet(props); frames.push({ ...c.searchPanel }); useSpreadsheetHandle(ref, c); return null; }
  const render = () => h(StrictMode, null, full ? h(Spreadsheet, props) : h(Probe));
  await act(async () => { renderer = create(render()); });
  const unmount = async () => { if (active) { active = false; await act(async () => renderer.unmount()); } };
  t.after(unmount);
  return { ref, frames, changes, editRequests, unmount,
    get c() { return c; }, get ctx() { return context; }, get root() { return renderer.root; },
    dialogs() { return renderer.root.findAllByProps({ role: 'dialog', 'aria-label': '検索' }); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
    async open(query) { let accepted; await act(async () => { accepted = ref.current.openSearch(query); }); return accepted; },
    async close() { await act(async () => ref.current.closeSearch()); },
  };
}

const results = () => [
  { id: 'a', title: 'First', snippet: 'Main result', target: { sheetId: 'main', range: 'B2:C4' } },
  { id: 'b', title: 'Second', snippet: 'Other result', target: { sheetId: 'other', range: '$D$7:$Z$999' } },
];
const call = async (app, method, ...args) => { let value; await act(async () => { value = app.ref.current[method](...args); }); return value; };
const click = async (app, label) => act(async () => app.root.findAllByType('button').find(node => node.children.join('') === label).props.onClick());

test('external mode is initial by default, chooses the requested id once and reveals the range beginning without zoom', async t => {
  const selected = [], app = await mount(t, { initialSearchOpen: true, initialZoom: 150,
    externalSearch: { results: results(), initialResultId: 'b', onResultSelect: result => selected.push(result.id) } });
  assert.equal(app.c.searchPanel.mode, 'external'); assert.equal(app.c.searchPanel.externalResultId, 'b');
  assert.equal(app.ref.current.getSelection().sheetId, 'other');
  assert.deepEqual(app.ref.current.getSelection().focus, { row: 6, column: 3 });
  assert.deepEqual(app.ref.current.getSelection().ranges[0].anchor, { row: 998, column: 25 });
  assert.equal(app.c.selectionReveal, true); assert.equal(app.c.selectionFocus, false);
  assert.equal(app.ref.current.getZoom(), 150); assert.deepEqual(selected, ['b']);
  assert.deepEqual(app.changes, []); assert.deepEqual(app.editRequests, []);
});

test('initial local query and explicit mode precedence, initial closed panel and empty results defer initial selection', async t => {
  for (const [options, mode] of [[{ initialSearchQuery: 'Alpha' }, 'find'], [{ initialSearchMode: 'local' }, 'find'],
    [{ initialSearchQuery: 'Alpha', initialSearchMode: 'external' }, 'external']]) {
    const app = await mount(t, { initialSearchOpen: true, externalSearch: { results: results() }, ...options });
    assert.equal(app.c.searchPanel.mode, mode); await app.unmount();
  }
  const app = await mount(t, { externalSearch: { results: [], initialResultId: 'b' } });
  assert.equal(app.c.searchPanel.mode, null); assert.deepEqual(app.ref.current.getSelection().focus, { row: 0, column: 0 });
  await call(app, 'openSearch'); assert.equal(app.c.searchPanel.mode, 'external');
  await app.update({ externalSearch: { results: results(), initialResultId: 'b' } });
  assert.equal(app.c.searchPanel.externalResultId, 'b');
});

test('an explicit initial result waits through partial streaming and navigates only once when it arrives', async t => {
  const supplied = results(), selected = [];
  const options = { initialResultId: 'b', onResultSelect: result => selected.push(result.id) };
  const app = await mount(t, { initialSearchOpen: true, externalSearch: { ...options, results: [supplied[0]] } });
  assert.equal(app.c.searchPanel.mode, 'external'); assert.equal(app.c.searchPanel.externalResultId, null);
  assert.deepEqual(app.ref.current.getSelection().focus, { row: 0, column: 0 });
  assert.deepEqual(selected, []);
  await app.update({ externalSearch: { ...options, results: [...supplied] } });
  assert.equal(app.c.searchPanel.externalResultId, 'b'); assert.equal(app.ref.current.getSelection().sheetId, 'other');
  assert.deepEqual(selected, ['b']);
  await call(app, 'selectCell', 'main', { row: 20, column: 20 });
  const selection = app.ref.current.getSelection();
  await app.update({ externalSearch: { ...options, results: [...supplied] } });
  await app.close(); await app.open();
  assert.deepEqual(app.ref.current.getSelection(), selection); assert.deepEqual(selected, ['b']);
});

test('background navigation, result updates, local switching and close/reopen do not steal the current cell', async t => {
  const supplied = results(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results: supplied } });
  await call(app, 'selectCell', 'other', { row: 20, column: 20 });
  const selection = app.ref.current.getSelection();
  await app.update({ externalSearch: { results: [supplied[1], { ...supplied[0], target: { sheetId: 'main', range: 'E5' } }] } });
  assert.deepEqual(app.ref.current.getSelection(), selection); assert.equal(app.c.searchPanel.externalResultId, 'a');
  await app.close(); await app.open(); assert.equal(app.c.searchPanel.mode, 'external');
  assert.deepEqual(app.ref.current.getSelection(), selection);
  await app.open('Alpha'); assert.equal(app.c.searchPanel.mode, 'find');
  await call(app, 'openExternalSearch'); assert.equal(app.c.searchPanel.mode, 'external');
  assert.deepEqual(app.ref.current.getSelection(), selection);
  await call(app, 'openExternalSearch', 'a'); assert.deepEqual(app.ref.current.getSelection().focus, { row: 4, column: 4 });
  await app.open(''); assert.equal(app.c.searchPanel.mode, 'find');
  await app.close(); await app.open(); assert.equal(app.c.searchPanel.mode, 'find');
});

test('destinations are checked against current sheets and ranges, retain valid order and isolate host exceptions', async t => {
  const supplied = results(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results: [
    null, ...supplied, { ...supplied[0], title: 'duplicate' }, { id: 'bad', target: { sheetId: 'main', range: 'A0' } },
    { id: 'far', target: { sheetId: 'main', range: 'ZZ9999' } }, { id: 'wrong', target: 'unexpected' }],
    onResultSelect() { throw new Error('host'); } } });
  assert.deepEqual(app.c.externalSearchResults.map(result => result.id), ['a', 'b', 'bad', 'far', 'wrong']);
  const source = app.ref.current.getWorkbook(), selection = app.ref.current.getSelection();
  for (const id of ['bad', 'far', 'wrong', 'unknown']) assert.equal(await call(app, 'openExternalSearch', id), false);
  assert.deepEqual(app.ref.current.getSelection(), selection); assert.equal(app.ref.current.getWorkbook(), source);
  await act(async () => assert.equal((await app.ref.current.executeAsync({ type: 'sheets.delete', sheetId: 'other' })).ok, true));
  assert.equal(await call(app, 'openExternalSearch', 'b'), false); assert.match(app.c.searchPanel.externalError, /見つかりません/);
});

test('external navigation honors features and unfinished edits but works in readonly with hidden ribbon', async t => {
  const app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden', externalSearch: { results: results() } });
  assert.equal(await call(app, 'openExternalSearch', 'b'), true);
  await app.update({ features: { sheets: false } });
  assert.equal(await call(app, 'openExternalSearch', 'a'), false);
  await app.update({ features: { search: false } }); assert.equal(app.c.searchPanel.mode, null);
  assert.equal(await call(app, 'openExternalSearch'), false);
  await app.update({ features: {}, readOnly: false });
  await act(async () => app.c.beginEdit({ row: 6, column: 3 }, 'unfinished'));
  const pending = app.c.editing;
  assert.equal(await call(app, 'openExternalSearch', 'a'), false); assert.equal(app.c.editing, pending);
  await act(async () => app.c.cancelEdit());
  assert.equal(await call(app, 'openExternalSearch', 'a'), true);
  await act(async () => app.c.setPendingObjectEdit(true));
  assert.equal(await call(app, 'openExternalSearch', 'b'), false);
  const api = app.ref.current; await app.unmount(); assert.equal(api.openExternalSearch(), false);
});

test('external result UI hides query and replacement, navigates with arrows, preserves tabs and returns to the selected result', async t => {
  const supplied = results(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results: supplied } }, true);
  assert.equal(app.root.findAllByProps({ role: 'dialog', 'aria-label': '外部検索結果' }).length, 1);
  assert.equal(app.ctx, undefined); assert.equal(app.root.findAllByProps({ 'data-search-fields': true }).length, 0);
  await click(app, '次の結果'); assert.equal(app.ref.current.getSelection().sheetId, 'other');
  await call(app, 'selectCell', 'main', { row: 0, column: 0 });
  await click(app, '選択した結果に戻る'); assert.equal(app.ref.current.getSelection().sheetId, 'other');
  const event = { key: 'ArrowUp', nativeEvent: {}, preventDefault() { this.defaultPrevented = true; } };
  await act(async () => app.root.findByProps({ role: 'list', 'aria-label': '外部検索結果' }).props.onKeyDown(event));
  assert.equal(event.defaultPrevented, true); assert.equal(app.ref.current.getSelection().sheetId, 'main');
  for (const extra of [{ nativeEvent: { isComposing: true } }, { ctrlKey: true }]) {
    await act(async () => app.root.findByProps({ role: 'list', 'aria-label': '外部検索結果' }).props.onKeyDown({ ...event, defaultPrevented: false, key: 'ArrowDown', ...extra }));
    assert.equal(app.ref.current.getSelection().sheetId, 'main');
  }
  await click(app, '文書内を検索'); assert.equal(app.dialogs().length, 1);
  const retainedQuery = 'x'.repeat(4097);
  await act(async () => app.ctx.setQuery({ ...app.ctx.query, text: retainedQuery }));
  await click(app, '外部検索結果'); assert.equal(app.root.findAllByProps({ role: 'dialog', 'aria-label': '外部検索結果' }).length, 1);
  await click(app, '文書内を検索'); assert.equal(app.ctx.query.text, retainedQuery);
  await click(app, '外部検索結果');
  await act(async () => app.root.findByProps({ 'data-likex-spreadsheet': true }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {} }));
  assert.equal(app.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('removed selected results and external options do not select unrelated destinations', async t => {
  const supplied = results(), app = await mount(t, { initialSearchOpen: true, externalSearch: { results: supplied } }, true);
  const selected = app.ref.current.getSelection();
  await app.update({ externalSearch: { results: [supplied[1]] } });
  assert.deepEqual(app.ref.current.getSelection(), selected);
  assert.equal(app.root.findAllByType('button').find(node => node.children.join('') === '選択した結果に戻る').props.disabled, true);
  await app.update({ externalSearch: undefined }); assert.equal(app.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(await call(app, 'openExternalSearch'), false);
  await app.open(); assert.equal(app.dialogs().length, 1);
});

test('replacing a workbook invalidates old destinations even when sheet ids and addresses are reused', async t => {
  for (const operation of ['native', 'excel', 'refresh', 'discard', 'same-native']) {
    const supplied = results(), selected = [], replacement = workbook();
    replacement.sheets[0].cells.A1.value = 'Different workbook';
    globalThis.__externalSearchWorkbookDecoder = async () => ({ workbook: replacement, warnings: [] });
    const options = { results: supplied, onResultSelect: result => selected.push(result.id) };
    const app = await mount(t, { initialSearchOpen: true, externalSearch: options, onRefresh: () => replacement });
    if (operation === 'native' || operation === 'same-native') await call(app, 'importNative', new Blob([serializeWorkbook(operation === 'same-native' ? app.ref.current.getWorkbook() : replacement)]));
    if (operation === 'excel') await call(app, 'importExcel', new Blob(['test decoder input']));
    if (operation === 'refresh') assert.equal(await call(app, 'refresh'), true);
    if (operation === 'discard') {
      assert.equal((await call(app, 'executeAsync', { type: 'cells.set', sheetId: 'main', values: { A1: 'Changed' } })).ok, true);
      assert.equal(await call(app, 'discard', { discardChanges: true }), true);
    }
    await call(app, 'selectCell', 'main', { row: 8, column: 0 });
    const selection = app.ref.current.getSelection(), notified = selected.length;
    assert.equal(await call(app, 'openExternalSearch', 'b'), false, operation);
    assert.deepEqual(app.ref.current.getSelection(), selection, operation);
    assert.equal(selected.length, notified); assert.match(app.c.searchPanel.externalError, /ブックが切り替わりました/);
    await app.update({ externalSearch: { ...options } });
    assert.equal(await call(app, 'openExternalSearch', 'b'), false, 'an unchanged result array stays bound to its original workbook');
    await app.update({ externalSearch: { ...options, results: [...supplied] } });
    assert.equal(await call(app, 'openExternalSearch', 'b'), true, 'a fresh result array binds to the new workbook');
    assert.equal(app.ref.current.getSelection().sheetId, 'other');
    await app.unmount();
  }
});

test('ordinary edits, Undo, Redo, save and failed imports retain external result source binding', async t => {
  const app = await mount(t, { initialSearchOpen: true, externalSearch: { results: results() } });
  assert.equal((await call(app, 'executeAsync', { type: 'cells.set', sheetId: 'main', values: { A1: 'Edited' } })).ok, true);
  for (const operation of ['edit', 'undo', 'redo', 'save']) {
    if (operation !== 'edit') assert.equal(await call(app, operation), true);
    assert.equal(await call(app, 'openExternalSearch', 'b'), true, operation);
    assert.equal(await call(app, 'openExternalSearch', 'a'), true, operation);
  }
  await act(async () => { await assert.rejects(app.ref.current.importNative(new Blob(['broken json']))); });
  assert.equal(await call(app, 'openExternalSearch', 'b'), true);
});
