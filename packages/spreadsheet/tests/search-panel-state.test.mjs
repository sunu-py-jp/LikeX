import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export {default as Spreadsheet} from './src/spreadsheet';
  export {useSpreadsheet} from './src/state/use-spreadsheet'; export {useSpreadsheetHandle} from './src/api/use-spreadsheet-handle';`,
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/spreadsheet-(?:dialog|floating-window)$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
      'import {createElement} from "react"; export const SpreadsheetDialog=({children,actions,title,onClose})=>createElement("div",{role:"dialog","aria-label":title},children,actions,createElement("button",{"aria-label":"閉じる",onClick:onClose},"閉じる")); export const SpreadsheetFloatingWindow=SpreadsheetDialog;', loader: 'js' }));
  } }] });
const { Spreadsheet, useSpreadsheet, useSpreadsheetHandle } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const workbook = () => ({ sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 5,
  cells: { A1: { value: 'Alpha' }, A2: { value: 'Beta' } } }] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
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

test('initial search visibility and text apply on the first render only, including closed and invalid inputs', async t => {
  for (const [initial, mode, query] of [[{}, null, ''], [{ initialSearchOpen: true, initialSearchQuery: 'Alpha' }, 'find', 'Alpha'],
    [{ initialSearchQuery: 'Beta' }, null, 'Beta'], [{ initialSearchOpen: true, initialSearchQuery: 123 }, 'find', ''],
    [{ initialSearchOpen: true, initialSearchQuery: 'x'.repeat(4097) }, 'find', ''],
    [{ initialSearchOpen: true, initialSearchQuery: 'Alpha', features: { search: false } }, null, 'Alpha']]) {
    const app = await mount(t, initial);
    assert.equal(app.frames[0].mode, mode); assert.equal(app.frames[0].query, query);
    assert.equal(app.c.searchPanel.mode, mode); assert.equal(app.c.searchPanel.query, query);
    await app.update({ initialSearchOpen: mode === null, initialSearchQuery: 'Changed initial value' });
    assert.equal(app.c.searchPanel.mode, mode); assert.equal(app.c.searchPanel.query, query);
    assert.deepEqual(app.changes, []); assert.deepEqual(app.editRequests, []);
    await app.unmount();
  }
});

test('the stable handle preserves queries across close/reopen and rejects invalid requests without changing state', async t => {
  const app = await mount(t), api = app.ref.current;
  await act(async () => {
    assert.equal(api.openSearch('Alpha'), true);
    api.closeSearch();
    assert.equal(api.openSearch(), true);
  });
  assert.equal(app.c.searchPanel.mode, 'find'); assert.equal(app.c.searchPanel.query, 'Alpha');
  const before = app.c.searchPanel;
  for (const invalid of [null, false, 123, {}, [], 'x'.repeat(4097)]) assert.equal(await app.open(invalid), false);
  assert.deepEqual(app.c.searchPanel, before);
  assert.equal(await app.open('x'.repeat(4096)), true);
  assert.equal(app.c.searchPanel.query.length, 4096);
  assert.equal(await app.open(''), true); assert.equal(app.c.searchPanel.query, '');
  await act(async () => app.c.setSearchPanelQuery('Typed value'));
  await app.close(); assert.equal(app.c.searchPanel.mode, null);
  await app.open(); assert.equal(app.c.searchPanel.query, 'Typed value');
  assert.equal(app.ref.current, api);
  await app.unmount(); assert.equal(api.openSearch('after unmount'), false); api.closeSearch();
});

test('search disabling closes and does not reopen when reenabled; replace honors readonly and feature guards', async t => {
  const app = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'Alpha' }), api = app.ref.current;
  await app.update({ features: { search: false } }); assert.equal(app.c.searchPanel.mode, null);
  assert.equal(api.openSearch('Beta'), false);
  await act(async () => assert.equal(app.c.openReplace(), false));
  await app.update({ features: { search: true } }); assert.equal(app.c.searchPanel.mode, null);
  await app.open(); assert.equal(app.c.searchPanel.query, 'Alpha');
  await act(async () => assert.equal(app.c.openReplace(), true)); assert.equal(app.c.searchPanel.mode, 'replace');
  await app.update({ readOnly: true }); assert.equal(app.c.searchPanel.mode, null);
  await act(async () => assert.equal(app.c.openReplace(), false));
  assert.equal(await app.open(), true); assert.equal(app.c.searchPanel.mode, 'find');
  await app.update({ readOnly: false, features: { replace: false } });
  await act(async () => assert.equal(app.c.openReplace(), false));
});

test('search is view-only with hidden ribbon and read-only, and never commits an unfinished cell edit', async t => {
  const app = await mount(t, { readOnly: true, onSave: undefined, initialRibbonDisplayMode: 'hidden' }), api = app.ref.current;
  const source = api.getWorkbook(), history = api.getHistoryState();
  assert.equal(await app.open('Alpha'), true);
  assert.equal(api.getWorkbook(), source); assert.deepEqual(api.getHistoryState(), history);
  assert.deepEqual(app.changes, []); assert.deepEqual(app.editRequests, []); assert.equal(app.c.dirty, false);
  await app.update({ readOnly: false, onSave() {} });
  await act(async () => app.c.beginEdit({ row: 0, column: 0 }, 'Uncommitted value'));
  const pending = app.c.editing;
  assert.equal(await app.open('Beta'), true); await app.close();
  assert.equal(app.c.editing, pending); assert.equal(api.getWorkbook(), source);
  assert.deepEqual(app.changes, []); assert.deepEqual(app.editRequests, []);
});

test('real root shows initial search independently of the ribbon, caches typed queries and opens with Ctrl/Cmd+F', async t => {
  const app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden', initialSearchOpen: true, initialSearchQuery: 'Alpha' }, true);
  assert.equal(app.dialogs().length, 1); assert.equal(app.ctx.query.text, 'Alpha'); assert.equal(app.ctx.results.length, 1);
  await act(async () => app.ctx.setQuery({ ...app.ctx.query, text: 'Beta' }));
  await app.close(); assert.equal(app.dialogs().length, 0);
  await app.open(); assert.equal(app.ctx.query.text, 'Beta'); assert.equal(app.ctx.results[0].address, 'A2');
  const longUiQuery = 'x'.repeat(4097);
  await act(async () => app.ctx.setQuery({ ...app.ctx.query, text: longUiQuery }));
  await app.close(); await app.open(); assert.equal(app.ctx.query.text, longUiQuery, 'advanced spreadsheet input keeps its existing longer-query support');
  await app.close();
  const shortcut = async extra => {
    const event = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, nativeEvent: {},
      target: { closest() { return null; } }, preventDefault() { this.defaultPrevented = true; }, ...extra };
    await act(async () => app.root.findByProps({ 'data-likex-spreadsheet': true }).props.onKeyDown(event)); return event;
  };
  assert.equal((await shortcut()).defaultPrevented, true); assert.equal(app.dialogs().length, 1); await app.close();
  assert.equal((await shortcut({ ctrlKey: false, metaKey: true })).defaultPrevented, true); await app.close();
  for (const extra of [{ altKey: true }, { ctrlKey: true, metaKey: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
    assert.notEqual((await shortcut(extra)).defaultPrevented, true); assert.equal(app.dialogs().length, 0);
  }
  await app.update({ features: { search: false } });
  assert.notEqual((await shortcut()).defaultPrevented, true); assert.equal(app.dialogs().length, 0);
});

test('API reopen and close abort external searches and late results never replace the current query', async t => {
  const requests = [], app = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'Alpha',
    onSearchRequest(request, { signal }) { const wait = deferred(); requests.push({ request, signal, ...wait }); return wait.promise; } }, true);
  const alpha = requests.at(-1); assert.equal(alpha.request.query.text, 'Alpha');
  await app.open('Beta'); assert.equal(alpha.signal.aborted, true);
  const beta = requests.at(-1); assert.equal(beta.request.query.text, 'Beta');
  await act(async () => alpha.resolve([{ sheetId: 'main', address: 'A1', value: 'Alpha', matchedText: 'Alpha' }]));
  assert.equal(app.ctx.query.text, 'Beta'); assert.deepEqual(app.ctx.results, []);
  await act(async () => beta.resolve([{ sheetId: 'main', address: 'A2', value: 'Beta', matchedText: 'Beta' }]));
  assert.equal(app.ctx.results[0].address, 'A2');
  await app.open('Alpha'); const last = requests.at(-1);
  await app.close(); assert.equal(last.signal.aborted, true); assert.equal(app.dialogs().length, 0);
  await act(async () => last.resolve([{ sheetId: 'main', address: 'A1', value: 'Alpha', matchedText: 'Alpha' }]));
  assert.equal(app.dialogs().length, 0);
});

test('initial and API query injection preserve the configured submit trigger', async t => {
  const requests = [], app = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'Alpha', search: { trigger: 'submit' },
    onSearchRequest(request) { requests.push(request); return []; } }, true);
  assert.equal(requests.length, 0); assert.equal(app.ctx.pending, true);
  await act(async () => app.ctx.submit()); assert.equal(requests.length, 1); assert.equal(requests[0].query.text, 'Alpha');
  await app.open('Beta'); assert.equal(requests.length, 1); assert.equal(app.ctx.pending, true);
  await act(async () => app.ctx.submit()); assert.equal(requests.length, 2); assert.equal(requests[1].query.text, 'Beta');
});

test('closing, reopening or disabling search cancels a pending replacement permission request', async t => {
  for (const action of ['close', 'reopen', 'disable']) {
    const requests = [], app = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'Alpha',
      onEditRequest(request, context) { const wait = deferred(); requests.push({ request, context, ...wait }); return wait.promise; } }, true);
    const source = app.ref.current.getWorkbook();
    await act(async () => app.root.findByProps({ 'data-likex-spreadsheet': true }).props.onKeyDown({ key: 'h', ctrlKey: true, metaKey: false,
      nativeEvent: {}, target: { closest() { return null; } }, preventDefault() {} }));
    assert.equal(app.ctx.mode, 'replace');
    await act(async () => app.ctx.setReplacement('Changed value'));
    await act(async () => app.root.findAllByType('button').find(node => node.children.join('') === 'すべて置換').props.onClick());
    assert.equal(requests.length, 1);
    if (action === 'close') await app.close();
    else if (action === 'reopen') await app.open('Beta');
    else await app.update({ features: { search: false } });
    assert.equal(requests[0].context.signal.aborted, true, `${action} releases the pending replacement request`);
    await act(async () => requests[0].resolve(true));
    assert.equal(app.ref.current.getWorkbook(), source); assert.deepEqual(app.changes, []);
    assert.equal(app.ref.current.getHistoryState().canUndo, false);
    await app.unmount();
  }
});

test('moving cell or formula focus into search preserves unfinished input and blocks result navigation', async t => {
  for (const label of ['A1の値', 'セルの値・数式']) {
    const app = await mount(t, {}, true), source = app.ref.current.getWorkbook();
    await act(async () => app.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value: 'Unfinished cell input' } }));
    await app.open('Beta');
    await act(async () => app.root.findByProps({ 'aria-label': label }).props.onBlur({ relatedTarget: {
      closest(selector) { return selector.includes('.lxs-search-dialog') ? {} : null; },
    } }));
    assert.equal(app.ref.current.getWorkbook(), source, `${label} must not commit when search receives focus`);
    assert.equal(app.root.findByProps({ 'aria-label': label }).props.value, 'Unfinished cell input');
    assert.deepEqual(app.changes, []); assert.deepEqual(app.editRequests, []);
    const next = app.root.findAllByType('button').find(node => node.children.join('') === '次を検索');
    assert.equal(next.props.disabled, true);
    await act(async () => next.props.onClick());
    assert.equal(app.ref.current.getSelection().focus.row, 0);
    await app.close(); assert.equal(app.ref.current.getWorkbook(), source);
    await app.unmount();
  }
});

test('the open search window follows edits, Undo and sheet navigation performed in the workbook', async t => {
  const initialWorkbook = workbook();
  initialWorkbook.sheets.push({ id: 'other', name: 'Other', rowCount: 10, columnCount: 5, cells: { B2: { value: 'Alpha on another sheet' } } });
  const app = await mount(t, { initialWorkbook, initialSearchOpen: true, initialSearchQuery: 'Alpha' }, true);
  assert.equal(app.ctx.results[0].sheetId, 'main');
  const formula = () => app.root.findByProps({ 'aria-label': 'セルの値・数式' });
  await act(async () => formula().props.onChange({ target: { value: 'Changed in the workbook' } }));
  assert.equal(app.ctx.disabled, true, 'unfinished cell input still prevents stale search selection');
  await act(async () => formula().props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} }));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, 'Changed in the workbook');
  assert.equal(app.dialogs().length, 1); assert.equal(app.ctx.query.text, 'Alpha'); assert.equal(app.ctx.disabled, false);
  assert.equal(app.ctx.results.length, 0);
  await act(async () => app.ref.current.undo());
  assert.equal(app.ctx.results[0].address, 'A1'); assert.equal(app.dialogs().length, 1);
  await act(async () => app.root.findByProps({ 'data-lxs-sheet-id': 'other' }).props.onClick({ detail: 1 }));
  assert.equal(app.ref.current.getSelection().sheetId, 'other');
  assert.equal(app.ctx.results.length, 1); assert.equal(app.ctx.results[0].address, 'B2');
  assert.equal(app.ctx.results[0].sheetId, 'other'); assert.equal(app.dialogs().length, 1);
  await act(async () => app.root.findAllByType('button').find(node => node.children.join('') === '次を検索').props.onClick());
  assert.deepEqual(app.ref.current.getSelection().focus, { row: 1, column: 1 });
  await act(async () => app.ctx.setScope('workbook'));
  assert.equal(app.ctx.results.length, 2);
  await act(async () => app.root.findByProps({ 'data-lxs-sheet-id': 'main' }).props.onClick({ detail: 1 }));
  assert.equal(app.ctx.results.length, 2, 'workbook search remains scoped to every sheet');
  assert.equal(app.dialogs().length, 1);
});

test('changing the background sheet aborts its old external search and ignores its late response', async t => {
  const initialWorkbook = workbook();
  initialWorkbook.sheets.push({ id: 'other', name: 'Other', rowCount: 10, columnCount: 5, cells: { B2: { value: 'Alpha elsewhere' } } });
  const requests = [], app = await mount(t, { initialWorkbook, initialSearchOpen: true, initialSearchQuery: 'Alpha',
    onSearchRequest(request, { signal }) { const wait = deferred(); requests.push({ request, signal, ...wait }); return wait.promise; } }, true);
  const previous = requests.at(-1);
  await act(async () => app.root.findByProps({ 'data-lxs-sheet-id': 'other' }).props.onClick({ detail: 1 }));
  const current = requests.at(-1);
  assert.equal(previous.signal.aborted, true); assert.equal(current.request.sheetId, 'other');
  assert.equal(app.ctx.searching, true); assert.deepEqual(app.ctx.results, []);
  await act(async () => previous.resolve([{ sheetId: 'main', address: 'A1', value: 'Alpha', matchedText: 'Alpha' }]));
  assert.deepEqual(app.ctx.results, []); assert.equal(app.ref.current.getSelection().sheetId, 'other');
  await act(async () => current.resolve([{ sheetId: 'other', address: 'B2', value: 'Alpha elsewhere', matchedText: 'Alpha elsewhere' }]));
  assert.equal(app.ctx.results[0].sheetId, 'other'); assert.equal(app.ctx.searching, false); assert.equal(app.dialogs().length, 1);
});

test('Escape from the background grid or formula bar cancels unfinished edits first, then closes search', async t => {
  for (const label of ['A1の値', 'セルの値・数式']) {
    const app = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'Alpha' }, true);
    const source = app.ref.current.getWorkbook();
    const input = () => app.root.findByProps({ 'aria-label': label });
    const press = async (extra = {}) => {
      const event = { key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, nativeEvent: {},
        target: { closest() { return null; } }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      await act(async () => {
        // Reproduce bubbling before React publishes state updates from the editor handler.
        const rootKey = app.root.findByProps({ 'data-likex-spreadsheet': true }).props.onKeyDown;
        input().props.onKeyDown(event);
        if (!event.stopped) rootKey(event);
      });
      return event;
    };
    for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
      assert.notEqual((await press(extra)).defaultPrevented, true);
      assert.equal(app.dialogs().length, 1);
    }
    await act(async () => input().props.onChange({ target: { value: 'Unfinished' } }));
    assert.equal(input().props.value, 'Unfinished');
    assert.equal((await press()).defaultPrevented, true);
    assert.equal(input().props.value, 'Alpha'); assert.equal(app.dialogs().length, 1, 'first Escape only cancels editing');
    assert.equal((await press()).defaultPrevented, true);
    assert.equal(app.dialogs().length, 0, 'next Escape closes the window from the sheet');
    assert.equal(app.ref.current.getWorkbook(), source); assert.deepEqual(app.changes, []);
    await app.unmount();
  }
});
