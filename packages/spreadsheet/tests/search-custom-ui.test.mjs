import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, Fragment } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './model-entry'; export {useSpreadsheet} from './state/use-spreadsheet'; export {SpreadsheetSearchDialog} from './ui/spreadsheet-search-dialog';`, resolveDir: new URL('../src/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'ui', setup(b) { b.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); b.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'import {createElement, Fragment} from "react"; export const SpreadsheetDialog=({children,actions})=>createElement(Fragment,null,children,actions);', loader: 'js' })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const workbook = { sheets: [{ id: 's', name: 'Sales', rowCount: 20, columnCount: 8, cells: { A1: { value: 'Alpha 123' }, A2: { value: 'alpha 456' }, B1: { value: '=1+2' }, C1: { value: 'unrelated' } } }, { id: 't', name: 'Other', rowCount: 20, columnCount: 8, cells: { A1: { value: 'Alpha elsewhere' } } }] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const match = (address, value, sheetId = 's', matchedText = value) => ({ sheetId, address, value, matchedText });
async function mount(t, overrides = {}, mode = 'find') {
  let c, context, renderer, props = { initialWorkbook: workbook, onSave() {}, ...overrides };
  const renderSearch = value => { context = value; if (props.renderSearch) return props.renderSearch(value); return createElement(Fragment, null, value.defaultInput, value.defaultOptions, value.defaultReplacement, createElement('aside', { 'data-custom-search': true }, value.query.text)); };
  function Probe() { c = m.useSpreadsheet({ ...props, renderSearch }); return createElement(m.SpreadsheetSearchDialog, { controller: c, initialMode: mode, onClose() {} }); }
  await act(async () => { renderer = create(createElement(Probe)); });
  let mounted = true;
  const close = async () => { if (mounted) { mounted = false; await act(async () => renderer.unmount()); } };
  t.after(close);
  return { get c() { return c; }, get ctx() { return context; }, get root() { return renderer.root; },
    async query(patch) { await act(async () => context.setQuery({ ...context.query, ...patch })); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async submit() { await act(async () => context.submit()); }, close,
    async click(label) { await act(async () => renderer.root.findAllByType('button').find(node => node.children.join('') === label).props.onClick()); },
    async tick(ms = 20) { await act(async () => new Promise(resolve => setTimeout(resolve, ms))); } };
}

test('custom slots retain standard inputs, regex controls, invalid-pattern feedback and result navigation', async t => {
  const ui = await mount(t);
  assert.equal(ui.root.findAllByProps({ 'data-custom-search': true }).length, 1);
  await ui.query({ text: '^alpha \\d+$', useRegex: true });
  assert.equal(ui.ctx.results.length, 2);
  await ui.query({ matchCase: true }); assert.equal(ui.ctx.results.length, 1);
  await ui.query({ matchCase: true }); assert.equal(ui.ctx.results.length, 1);
  await ui.click('次を検索'); assert.equal(ui.c.selection.focus.row, 1);
  await ui.query({ text: '[' }); assert.ok(ui.ctx.error); assert.equal(ui.ctx.results.length, 0);
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 1);
  await act(async () => ui.ctx.clear()); assert.equal(ui.ctx.query.text, ''); assert.equal(ui.ctx.error, null);
});

test('submit keeps confirmed results while draft conditions change and refreshes them on workbook edits', async t => {
  const requests = [];
  const handler = (request, { signal }) => { requests.push({ request, signal }); return m.findSpreadsheetCells(request.workbook, request.query, { sheetId: request.sheetId }); };
  const ui = await mount(t, { search: { trigger: 'submit', params: { min: 1 } }, onSearchRequest: handler }, 'replace');
  await ui.query({ text: 'Alpha' }); assert.equal(requests.length, 0); assert.equal(ui.ctx.pending, true);
  await ui.submit(); assert.equal(requests.length, 1); assert.equal(ui.ctx.results.length, 2); assert.equal(ui.ctx.pending, false);
  assert.ok(Object.isFrozen(requests[0].request.workbook.sheets[0])); assert.deepEqual(requests[0].request.params, { min: 1 });
  await ui.query({ text: 'unrelated' }); assert.equal(ui.ctx.results.length, 2); assert.equal(ui.ctx.pending, true);
  assert.equal(ui.root.findAllByType('button').find(node => node.children.join('') === 'すべて置換').props.disabled, true);
  await act(async () => ui.c.externalExecute({ type: 'cells.set', sheetId: 's', values: { A1: 'Changed' } }));
  assert.equal(requests.length, 2); assert.equal(requests[1].request.query.text, 'Alpha'); assert.equal(ui.ctx.results.length, 1);
  await ui.update({ search: { trigger: 'submit', params: { min: 2 } } }); assert.equal(requests.length, 2);
  await ui.submit(); assert.equal(requests.length, 3); assert.deepEqual(requests[2].request.params, { min: 2 }); assert.equal(ui.ctx.results[0].address, 'C1');
});

test('external input search debounces custom input and IME while handler identity changes never cause loops', async t => {
  const calls = [], makeHandler = () => request => { calls.push(request); return m.findSpreadsheetCells(request.workbook, request.query, { sheetId: request.sheetId }); };
  const ui = await mount(t, { search: { debounceMs: 15, params: { category: 'sales', extra: 1 } }, onSearchRequest: makeHandler() });
  await ui.query({ text: 'A' }); await ui.query({ text: 'Al' }); assert.equal(calls.length, 0);
  await ui.tick(25); assert.equal(calls.length, 1); assert.equal(calls[0].query.text, 'Al');
  await ui.update({ onSearchRequest: makeHandler(), search: { debounceMs: 15, params: { extra: 1, category: 'sales' } } });
  await ui.tick(25); assert.equal(calls.length, 1);
  await act(async () => ui.ctx.onCompositionStart()); await ui.query({ text: 'Alpha' }); await ui.tick(25); assert.equal(calls.length, 1);
  await act(async () => ui.ctx.onCompositionEnd()); await ui.tick(25); assert.equal(calls.length, 2);
});

test('external stale requests cancel on query, scope, workbook and unmount changes; rejection surfaces as error', async t => {
  const requests = [];
  const ui = await mount(t, { search: { debounceMs: 0 }, onSearchRequest: (request, { signal }) => { const pending = deferred(); requests.push({ request, signal, ...pending }); return pending.promise; } });
  await ui.query({ text: 'Alpha' }); const first = requests[0];
  await ui.query({ text: 'unrelated' }); assert.equal(first.signal.aborted, true);
  await act(async () => first.resolve([match('A1', 'Alpha 123')])); assert.equal(ui.ctx.results.length, 0);
  await act(async () => ui.ctx.setScope('workbook')); assert.equal(requests[1].signal.aborted, true); assert.equal(requests[2].request.sheetId, undefined);
  await act(async () => ui.c.externalExecute({ type: 'cells.set', sheetId: 's', values: { C1: 'changed' } })); assert.equal(requests[2].signal.aborted, true);
  await act(async () => requests.at(-1).reject(new Error('Search unavailable'))); assert.equal(ui.ctx.error, 'Search unavailable');
  await ui.query({ text: 'Alpha' }); const last = requests.at(-1); await ui.close(); assert.equal(last.signal.aborted, true);
  await act(async () => last.resolve([match('A1', 'Alpha 123')]));
});

test('external results reject nonexistent, stale, wrong-scope, and fabricated display data', async t => {
  for (const result of [match('Z999', 'bad'), match('A1', 'old'), match('A1', 'Alpha elsewhere', 't'), match('B1', '=1+2', 's', 'fabricated')]) {
    const ui = await mount(t, { search: { debounceMs: 0 }, onSearchRequest: () => [result] });
    await ui.query({ text: 'Alpha' }); assert.ok(ui.ctx.error); assert.equal(ui.ctx.results.length, 0); await ui.close();
  }
});

test('external results cannot replace unrelated cells; regex replacement remains literal and undoable', async t => {
  const ui = await mount(t, { search: { debounceMs: 0 }, onSearchRequest: () => [match('A1', 'Alpha 123'), match('C1', 'unrelated')] }, 'replace');
  await ui.query({ text: 'Alpha \\d+', useRegex: true });
  await act(async () => ui.ctx.setReplacement('$1/$&')); await ui.click('すべて置換');
  assert.equal(ui.c.workbook.sheets[0].cells.A1.value, '$1/$&'); assert.equal(ui.c.workbook.sheets[0].cells.C1.value, 'unrelated');
  await act(async () => ui.c.undo()); assert.equal(ui.c.workbook.sheets[0].cells.A1.value, 'Alpha 123');
});

test('replacement lease cannot apply after host conditions change', async t => {
  const permission = deferred();
  const ui = await mount(t, { search: { debounceMs: 0, params: { current: 1 } }, onEditRequest: () => permission.promise,
    onSearchRequest: request => m.findSpreadsheetCells(request.workbook, request.query, { sheetId: request.sheetId }) }, 'replace');
  await ui.query({ text: 'Alpha' }); await act(async () => ui.ctx.setReplacement('Changed'));
  await ui.click('すべて置換'); await ui.update({ search: { debounceMs: 0, params: { current: 2 } } });
  await act(async () => permission.resolve(true)); assert.equal(ui.c.workbook.sheets[0].cells.A1.value, 'Alpha 123');
});


test('null slot returns standard controls and field Enter never hijacks custom buttons or selects', async t => {
  const ui = await mount(t, { search: { trigger: 'submit' }, renderSearch: () => null });
  assert.equal(ui.root.findAllByType('input').length, 4);
  await ui.query({ text: 'Alpha' });
  const fields = ui.root.findByProps({ className: 'lxs-search-fields' });
  let prevented = false;
  for (const target of [{ tagName: 'BUTTON' }, { tagName: 'SELECT' }, { tagName: 'INPUT', type: 'checkbox' }]) {
    await act(async () => fields.props.onKeyDown({ target, key: 'Enter', nativeEvent: {}, keyCode: 13, preventDefault() { prevented = true; } }));
    assert.equal(prevented, false); assert.equal(ui.ctx.results.length, 0);
  }
  await act(async () => fields.props.onKeyDown({ target: { tagName: 'INPUT', type: 'text' }, key: 'Enter', nativeEvent: {}, keyCode: 13, preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.equal(ui.ctx.results.length, 2);
});

test('default external search is immediate and params reject non-JSON data', async t => {
  const calls = [];
  const ui = await mount(t, { onSearchRequest: request => { calls.push(request); return []; } });
  await ui.query({ text: 'Alpha' }); assert.equal(calls.length, 1);
  await ui.update({ search: { params: { unsupported() {} } } });
  assert.ok(ui.ctx.error); assert.equal(calls.length, 1);
});


test('search identity hides previous errors during a new request and keeps IME and clear idle', async t => {
  const requests = [];
  const ui = await mount(t, { onSearchRequest: (request, { signal }) => { const pending = deferred(); requests.push({ request, signal, ...pending }); return pending.promise; } });
  await ui.query({ text: 'Alpha' });
  await act(async () => requests[0].reject(new Error('Previous failure')));
  assert.equal(ui.ctx.error, 'Previous failure'); assert.equal(ui.ctx.searching, false);
  await ui.query({ text: 'unrelated' });
  assert.equal(ui.ctx.error, null); assert.equal(ui.ctx.searching, true); assert.equal(ui.ctx.results.length, 0);
  await act(async () => ui.ctx.onCompositionStart());
  assert.equal(requests[1].signal.aborted, true); assert.equal(ui.ctx.searching, false);
  await act(async () => requests[1].reject(new Error('Obsolete failure')));
  assert.equal(ui.ctx.error, null);
  await act(async () => ui.ctx.onCompositionEnd()); assert.equal(ui.ctx.searching, true);
  await act(async () => ui.ctx.clear());
  assert.equal(requests[2].signal.aborted, true); assert.equal(ui.ctx.searching, false); assert.equal(ui.ctx.error, null);
});

test('condition changes reset selected-result feedback without discarding confirmed submit results', async t => {
  const ui = await mount(t, { search: { trigger: 'submit' } });
  await ui.query({ text: 'Alpha' }); await ui.submit(); await ui.click('次を検索');
  assert.equal(ui.root.findAllByProps({ 'aria-current': 'true' }).length, 1);
  await ui.query({ matchCase: true });
  assert.equal(ui.ctx.results.length, 2); assert.equal(ui.ctx.pending, true);
  assert.equal(ui.root.findAllByProps({ 'aria-current': 'true' }).length, 0);
  await ui.submit(); assert.equal(ui.ctx.results.length, 1);
  await ui.click('次を検索'); assert.equal(ui.root.findAllByProps({ 'aria-current': 'true' }).length, 1);
  await act(async () => ui.ctx.setScope('workbook'));
  assert.equal(ui.ctx.results.length, 1); assert.equal(ui.root.findAllByProps({ 'aria-current': 'true' }).length, 0);
  await act(async () => ui.ctx.setScope('sheet'));
  assert.equal(ui.root.findAllByProps({ 'aria-current': 'true' }).length, 0);
});
