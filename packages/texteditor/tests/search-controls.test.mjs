import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './helpers/build.mjs';
import { act, createElement, useImperativeHandle, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const result = await build({
  stdin: { contents: `export { useTextEditorSearch, normalizeTextEditorSearchResults } from './src/state/use-text-editor-search'; export { ExternalSearchPanel } from './src/ui/external-search-panel';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(?:react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const temporary = await mkdtemp(join(tmpdir(), 'likex-text-search-controls-'));
const bundlePath = join(temporary, 'bundle.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const { useTextEditorSearch, normalizeTextEditorSearchResults, ExternalSearchPanel } = await import(pathToFileURL(bundlePath).href);
await rm(temporary, { recursive: true, force: true });

const document = { format: 'likex.texteditor', version: 1, id: 'document-1', title: 'Search', mode: 'text', text: 'alpha beta alpha' };
const first = { id: 'first', title: 'First', target: { from: 0, to: 5 } };
const second = { id: 'second', title: 'Second', target: { from: 11, to: 16 } };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(t, input = {}, strict = false) {
  const ref = createRef(), navigations = [];
  let props = { document, enabled: true, onNavigate: result => { navigations.push(result); return true; }, ...input }, renderer;
  function Harness({ options, forwardedRef }) { const controls = useTextEditorSearch(options); useImperativeHandle(forwardedRef, () => controls); return createElement(ExternalSearchPanel, { context: controls.context }); }
  const render = () => strict ? createElement(StrictMode, null, createElement(Harness, { options: props, forwardedRef: ref })) : createElement(Harness, { options: props, forwardedRef: ref });
  const nodes = [];
  await act(async () => { renderer = create(render(), { createNodeMock: element => { const node = { focus() {}, querySelector() { return null; } }; nodes.push({ element, node }); return node; } }); });
  let mounted = true;
  t.after(async () => { if (mounted) await act(async () => renderer.unmount()); });
  return { ref, renderer, navigations, nodes, get controls() { return ref.current; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(render())); },
    async unmount() { mounted = false; await act(async () => renderer.unmount()); },
  };
}

test('host result validation keeps order and zero-length offsets, and detaches host data', () => {
  const entry = { id: 'zero', target: { from: 16, to: 16 } };
  const normalized = normalizeTextEditorSearchResults([first, { ...first }, entry, { id: 'negative', target: { from: -1, to: 1 } }, { id: 'past-end', target: { from: 16, to: 17 } }, { id: 'reversed', target: { from: 3, to: 2 } }, { id: 'fraction', target: { from: 1.5, to: 2 } }], 16);
  assert.deepEqual(normalized.map(result => result.id), ['first', 'zero']);
  entry.target.from = 4;
  assert.equal(normalized[1].target.from, 16);
  assert.ok(Object.isFrozen(normalized[1].target));
});

test('initial external search navigates the requested result and does not populate the keyword', async t => {
  const selected = [];
  const ui = await mount(t, { initialSearchOpen: true, externalSearch: { results: [first, second], initialResultId: 'second', onResultSelect: item => selected.push(item.id) } });
  assert.equal(ui.controls.context.open, true);
  assert.equal(ui.controls.context.mode, 'external');
  assert.equal(ui.controls.context.query.query, '');
  assert.equal(ui.controls.context.activeResultId, 'second');
  assert.deepEqual(ui.navigations.map(item => item.id), ['second']);
  assert.deepEqual(selected, ['second']);
  assert.equal(ui.renderer.root.findByProps({ role: 'dialog' }).props['aria-modal'], false);
  await act(async () => assert.equal(await ui.controls.context.next(), true));
  assert.equal(ui.controls.context.activeResultId, 'first');
  await act(async () => assert.equal(ui.controls.closeSearch(), true));
  await act(async () => assert.equal(ui.controls.openExternalSearch('unknown'), false));
  assert.equal(ui.controls.context.open, false);
  await act(async () => assert.equal(ui.controls.openExternalSearch(), true));
  assert.equal(ui.controls.context.activeResultId, 'first');
});

test('strict effect replay preserves initial external navigation', async t => {
  const selected = [];
  const ui = await mount(t, { initialSearchOpen: true, externalSearch: { results: [first, second], initialResultId: 'second', onResultSelect: item => selected.push(item.id) } }, true);
  assert.equal(ui.controls.context.activeResultId, 'second');
  assert.deepEqual(selected, ['second']);
});

test('changing or closing search aborts stale host requests and catches their rejection', async t => {
  const requests = [];
  const onSearchRequest = (request, context) => { const result = deferred(); requests.push({ request, context, result }); return result.promise; };
  const ui = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'alpha', onSearchRequest, searchParams: { category: 'notes' } });
  assert.equal(requests.length, 1); assert.equal(ui.controls.context.busy, true);
  assert.equal(requests[0].request.document, document); assert.deepEqual(requests[0].request.params, { category: 'notes' });
  await act(async () => ui.controls.setQuery({ query: 'beta', caseSensitive: true }));
  assert.equal(requests[0].context.signal.aborted, true); assert.equal(requests.length, 2);
  await act(async () => { requests[0].result.resolve([first]); await Promise.resolve(); });
  assert.equal(ui.controls.context.results.length, 0); assert.equal(ui.controls.context.busy, true);
  await act(async () => { requests[1].result.resolve([{ id: 'beta', target: { from: 6, to: 10 } }]); await Promise.resolve(); });
  assert.equal(ui.controls.context.results[0].id, 'beta'); assert.equal(ui.controls.context.busy, false);
  await act(async () => ui.controls.openSearch());
  assert.equal(requests.length, 3, 'same-query explicit reopen starts a fresh request');
  await act(async () => ui.controls.closeSearch());
  assert.equal(requests[2].context.signal.aborted, true);
  await act(async () => { requests[2].result.reject(new Error('obsolete')); await Promise.resolve(); });
  assert.equal(ui.controls.context.error, null); assert.equal(ui.controls.context.open, false);
});

test('document changes, disabling search and unmount reject obsolete results and navigation', async t => {
  const requests = [], navigation = deferred(), selected = [];
  const ui = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'alpha', onSearchRequest: (_request, context) => { const result = deferred(); requests.push({ context, result }); return result.promise; }, externalSearch: { results: [first], onResultSelect: result => selected.push(result.id) }, onNavigate: () => navigation.promise });
  await ui.update({ document: { ...document, text: 'alpha' } });
  assert.equal(requests[0].context.signal.aborted, true);
  await act(async () => { requests[0].result.resolve([second]); requests[1].result.resolve([second, first]); await Promise.resolve(); });
  assert.deepEqual(ui.controls.context.results.map(result => result.id), ['first']);
  await act(async () => ui.controls.openExternalSearch());
  await ui.update({ enabled: false });
  assert.equal(ui.controls.context.open, false); assert.equal(ui.controls.openSearch('alpha'), false); assert.equal(ui.controls.openExternalSearch(), false);
  await act(async () => { navigation.resolve(true); await Promise.resolve(); });
  assert.deepEqual(selected, []);
  const retained = ui.controls;
  await ui.unmount();
  assert.equal(retained.openSearch(), false); assert.equal(await retained.selectResult('first'), false);
});

test('custom search UI uses local model search and reports invalid regular expressions', async t => {
  const ui = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'alpha', renderSearch: () => null });
  assert.deepEqual(ui.controls.context.results.map(result => result.target), [{ from: 0, to: 5 }, { from: 11, to: 16 }]);
  await act(async () => assert.equal(await ui.controls.context.next(), true));
  assert.equal(ui.navigations[0].target.from, 0);
  await act(async () => ui.controls.setQuery({ query: '[', regex: true }));
  assert.match(ui.controls.context.error, /正規表現/);
  await act(async () => ui.controls.setQuery({ query: 'beta' }));
  assert.equal(ui.controls.context.error, null); assert.equal(ui.controls.context.results.length, 1);
});

test('native query synchronization respects external mode and invalid queries retain state', async t => {
  const ui = await mount(t, { initialSearchQuery: 'kept', externalSearch: { results: [first] } });
  await act(async () => ui.controls.openSearch());
  assert.equal(ui.controls.context.query.query, 'kept');
  await act(async () => ui.controls.syncSearch({ query: { query: 'native', wholeWord: true }, open: true }));
  assert.equal(ui.controls.context.query.query, 'native');
  assert.equal(ui.controls.openSearch('x'.repeat(4097)), false);
  assert.equal(ui.controls.setQuery({ query: 'bad', caseSensitive: 'yes' }), false);
  await act(async () => ui.controls.openExternalSearch());
  await act(async () => ui.controls.syncSearch({ query: { query: 'wrong' }, open: false }));
  assert.equal(ui.controls.context.mode, 'external'); assert.equal(ui.controls.context.open, true); assert.equal(ui.controls.context.query.query, 'native');
  await act(async () => ui.controls.openSearch(''));
  assert.equal(ui.controls.context.query.query, '');
});

test('retained search getters reflect synchronous updates before React renders', async t => {
  const ui = await mount(t, { externalSearch: { results: [first] } }), retained = ui.controls;
  await act(async () => {
    assert.equal(retained.openSearch('new query'), true);
    assert.equal(retained.getState().query.query, 'new query');
    assert.equal(retained.getContext().open, true);
    retained.closeSearch();
    assert.equal(retained.getState().open, false);
    retained.openExternalSearch();
    assert.equal(retained.getContext().mode, 'external');
    assert.equal(retained.getContext().results[0].id, 'first');
  });
  await ui.unmount();
  assert.equal(retained.getContext().open, false);
});

test('external result replacement aborts delayed navigation before the caller mutates selection', async t => {
  const ready = deferred(), navigated = []; let context;
  const ui = await mount(t, { externalSearch: { results: [first] }, onNavigate: async (result, operation) => {
    context = operation;
    await ready.promise;
    if (operation.signal.aborted) return false;
    navigated.push(result.target); return true;
  } });
  await act(async () => ui.controls.openExternalSearch());
  assert.equal(context.signal.aborted, false);
  await ui.update({ externalSearch: { results: [{ ...first, target: { from: 11, to: 16 } }] } });
  assert.equal(context.signal.aborted, true);
  await act(async () => { ready.resolve(); await Promise.resolve(); });
  assert.deepEqual(navigated, []);
});

test('cancelPending aborts the signal without hiding search and Escape closes the panel', async t => {
  const pending = deferred(); let signal;
  const ui = await mount(t, { initialSearchOpen: true, initialSearchQuery: 'alpha', onSearchRequest: (_request, context) => { signal = context.signal; return pending.promise; } });
  await act(async () => ui.controls.cancelPending());
  assert.equal(signal.aborted, true); assert.equal(ui.controls.context.open, true); assert.equal(ui.controls.context.busy, false);
  await act(async () => { pending.resolve([first]); await Promise.resolve(); });
  assert.equal(ui.controls.context.results.length, 0);
  let prevented = false, stopped = false;
  await act(async () => ui.renderer.root.findByProps({ role: 'dialog' }).props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
  assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(ui.controls.context.open, false);
});
