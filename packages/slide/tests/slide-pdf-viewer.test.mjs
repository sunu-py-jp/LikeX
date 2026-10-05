import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { LikeSlidePdfViewer } from './src/pdf/pdf-viewer';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlidePdfViewer } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async action => { await act(async () => { await action(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function pdf(pageCount = 20, renderPage) {
  const loads = [], pages = [], renders = [];
  const document = { pageCount, destroyed: 0, async destroy() { document.destroyed++; }, async getPage(number, { signal } = {}) {
    pages.push({ number, signal });
    return { width: number % 2 ? 800 : 600, height: number % 2 ? 600 : 800, async render(options) {
      const render = { ...options, number, width: options.canvas.width, height: options.canvas.height };
      renders.push(render); options.canvas.marker = number;
      await renderPage?.(render);
    } };
  } };
  return { document, loads, pages, renders, async loadPdf({ signal }) { loads.push(signal); return document; } };
}

async function mount(t, supplied = {}, options = {}) {
  let renderer, active = true, focused = false;
  const ref = createRef(), events = [], selections = [], zooms = [], errors = [], loads = [], canvases = [], scratch = [], rootListeners = new Map();
  const document = { defaultView: { devicePixelRatio: 3, ResizeObserver: class { observe() {} disconnect() {} }, addEventListener() {}, removeEventListener() {} },
    createElement(type) { assert.equal(type, 'canvas'); const canvas = makeCanvas('scratch'); scratch.push(canvas); return canvas; } };
  function makeCanvas(label) { return { label, ownerDocument: document, width: 0, height: 0, draws: [], getContext() { return { drawImage: source => { this.draws.push({ marker: source.marker, width: source.width, height: source.height }); } }; } }; }
  const rootNode = { ownerDocument: document, focus() { focused = true; }, addEventListener(type, fn) { rootListeners.set(type, fn); }, removeEventListener(type, fn) { if (rootListeners.get(type) === fn) rootListeners.delete(type); } };
  const listNode = { ownerDocument: document, scrollTop: 0, clientHeight: 350 };
  const viewportNode = { ownerDocument: document, scrollTop: 0, scrollLeft: 0, clientWidth: options.width ?? 800, clientHeight: options.height ?? 600 };
  let props = { loadPdf: pdf().loadPdf, onPageChange: value => events.push(value), onSelectionChange: value => selections.push(value), onZoomChange: value => zooms.push(value), onError: value => errors.push(value),
    onLoad: value => loads.push({ ...value, pageNumber: ref.current.getPageNumber() }), ...supplied };
  const render = () => h(LikeSlidePdfViewer, { ...props, ref });
  await change(() => { renderer = create(render(), { createNodeMock(element) {
    if (element.props['data-likex-slide-pdf'] !== undefined) return rootNode;
    if (element.props.className === 'lxp-pdf-page-list') return listNode;
    if (element.props.className === 'lxp-canvas-viewport lxp-pdf-viewport') return viewportNode;
    if (element.type === 'canvas') { const canvas = makeCanvas(element.props['aria-label']); canvases.push(canvas); return canvas; }
    return null;
  } }); });
  const unmount = async () => { if (active) { active = false; await change(() => renderer.unmount()); } }; t.after(unmount);
  return { ref, events, selections, zooms, errors, loads, canvases, scratch, listNode, viewportNode, unmount, get focused() { return focused; }, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); },
    label(value) { return renderer.root.findAllByProps({ 'aria-label': value }).filter(node => typeof node.type === 'string'); },
    async click(value, modifiers = {}) { await change(() => this.label(value)[0].props.onClick(modifiers)); },
    async key(key, extra = {}) { const event = { key, nativeEvent: {}, target: { closest() { return null; } }, preventDefault() { this.defaultPrevented = true; }, ...extra };
      await change(() => renderer.root.findByProps({ 'data-likex-slide-pdf': '' }).props.onKeyDown(event)); return event; },
    async wheel(deltaY, extra = {}) { const event = { ctrlKey: true, deltaY, target: { closest() { return true; } }, preventDefault() { this.defaultPrevented = true; }, ...extra };
      await change(() => rootListeners.get('wheel')?.(event)); return event; },
  };
}

test('PDF navigation, numeric input, zoom and fit share the public handle', async t => {
  const source = pdf(6), ui = await mount(t, { loadPdf: source.loadPdf, title: 'Review', initialPageNumber: 2 }), api = ui.ref.current;
  assert.deepEqual(ui.loads, [{ pageCount: 6, pageNumber: 2 }]); assert.equal(api.getPageNumber(), 2); assert.equal(api.getZoom(), 100);
  assert.equal(ui.label('保存').length, 0); assert.equal(ui.root.findAllByProps({ role: 'tablist' }).length, 0);
  await ui.click('次のページ'); assert.equal(api.getPageNumber(), 3);
  await change(() => ui.label('ページ番号')[0].props.onChange({ target: { value: '5' } }));
  await change(() => ui.label('ページ番号')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} })); assert.equal(api.getPageNumber(), 5);
  assert.equal((await ui.key('Home')).defaultPrevented, true); assert.equal(api.getPageNumber(), 1); assert.equal(ui.focused, true);
  await ui.key('End'); assert.equal(api.getPageNumber(), 6); await ui.key('PageUp'); assert.equal(api.getPageNumber(), 5);
  assert.equal((await ui.key('PageDown', { target: { closest() { return {}; } } })).defaultPrevented, undefined); assert.equal(api.getPageNumber(), 5);
  await change(() => { assert.equal(api.goToPage(0), false); assert.equal(api.goToPage(7), false); assert.equal(api.goToPage(1.5), false); assert.equal(api.goToPage(5), false); });
  await ui.click('拡大'); assert.equal(api.getZoom(), 110);
  assert.equal((await ui.wheel(-1)).defaultPrevented, true); assert.equal(api.getZoom(), 120);
  assert.equal((await ui.wheel(1, { ctrlKey: false })).defaultPrevented, undefined);
  await change(() => { assert.equal(api.setZoom(400), true); assert.equal(api.getZoom(), 400); assert.equal(api.setZoom(401), false); assert.equal(api.setZoom(NaN), false); });
  await ui.click('画面に合わせる'); assert.equal(api.getZoom(), 100);
  assert.deepEqual(ui.events.map(event => event.pageNumber), [3, 5, 1, 6, 5]);
  await ui.unmount(); assert.equal(api.goToPage(1), false); assert.equal(api.setZoom(150), false); assert.equal(source.document.destroyed, 1);
  assert.ok(source.loads[0].aborted); assert.ok(ui.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('controlled navigation waits for props and becomes locked without a callback', async t => {
  const source = pdf(8), ui = await mount(t, { loadPdf: source.loadPdf, pageNumber: 3 }), api = ui.ref.current;
  await change(() => assert.equal(api.goToPage(4), true)); assert.equal(api.getPageNumber(), 3); assert.deepEqual(ui.events, [{ pageNumber: 4, pageCount: 8 }]);
  await ui.update({ pageNumber: 4 }); assert.equal(api.getPageNumber(), 4); assert.equal(ui.events.length, 1);
  await ui.update({ pageNumber: undefined }); assert.equal(api.getPageNumber(), 4);
  await ui.update({ pageNumber: 2, onPageChange: undefined });
  await change(() => assert.equal(api.goToPage(5), false)); assert.equal(ui.label('次のページ')[0].props.disabled, true);
  await ui.update({ toolbarVisible: false }); assert.equal(ui.label('ページ番号').length, 0); assert.equal(ui.label('ズーム').length, 1);
});

test('only nearby thumbnails render and leaving the window releases their canvases', async t => {
  const source = pdf(1000), ui = await mount(t, { loadPdf: source.loadPdf });
  const thumbnails = () => ui.root.findAllByProps({ className: 'lxp-pdf-thumbnail' });
  assert.ok(thumbnails().length < 10); assert.ok(source.pages.length < 10);
  const first = ui.canvases.filter(canvas => canvas.label.includes('サムネイル'));
  await ui.key('End'); assert.equal(ui.ref.current.getPageNumber(), 1000); assert.ok(thumbnails().length < 10);
  assert.ok(thumbnails().some(node => node.props['aria-current'] === 'page'));
  assert.ok(first.every(canvas => canvas.width === 0 && canvas.height === 0));
  await change(() => ui.ref.current.goToPage(500)); await change(() => ui.ref.current.goToPage(250));
  const previous = source.pages.filter(page => page.number === 1).length;
  await ui.key('Home'); assert.ok(source.pages.filter(page => page.number === 1).length > previous, 'old page wrappers are evicted from the bounded cache');
});

test('source replacement and unmount abort work and destroy late loaded documents', async t => {
  const waiting = deferred(), signals = [], abandoned = pdf(10), next = pdf(3);
  const ui = await mount(t, { loadPdf: ({ signal }) => { signals.push(signal); return waiting.promise; }, initialPageNumber: 2 });
  assert.equal(ui.ref.current.getPageNumber(), 0); assert.equal(ui.ref.current.goToPage(1), false);
  await ui.update({ loadPdf: next.loadPdf }); assert.ok(signals[0].aborted); assert.equal(ui.ref.current.getPageNumber(), 2);
  await change(() => waiting.resolve(abandoned.document)); assert.equal(abandoned.document.destroyed, 1); assert.equal(abandoned.pages.length, 0);
  assert.deepEqual(ui.loads, [{ pageCount: 3, pageNumber: 2 }]); assert.deepEqual(ui.errors, []);
  await ui.unmount(); assert.ok(next.loads[0].aborted); assert.equal(next.document.destroyed, 1);
});

test('late render completion cannot overwrite a changed page or zoom', async t => {
  const pending = [], source = pdf(4, render => { const gate = deferred(); pending.push({ ...gate, render }); return gate.promise; });
  const ui = await mount(t, { loadPdf: source.loadPdf });
  const original = pending.find(item => item.render.width > 400), target = ui.canvases.find(canvas => canvas.label === 'PDFページ 1');
  assert.ok(original); assert.equal(target.draws.length, 0);
  await change(() => ui.ref.current.setZoom(200)); assert.ok(original.render.signal.aborted);
  const current = pending.filter(item => item.render.width > 400).at(-1);
  await change(() => current.resolve()); assert.equal(target.draws.length, 1);
  await change(() => original.resolve()); assert.equal(target.draws.length, 1);
  await change(() => ui.ref.current.goToPage(2));
  await change(() => { for (const item of pending) item.resolve(); });
  assert.equal(target.width, 0); assert.equal(ui.errors.length, 0);
});

test('large page bitmaps stay bounded while the displayed page keeps its aspect ratio', async t => {
  const source = pdf(2), ui = await mount(t, { loadPdf: source.loadPdf, initialZoom: 400, colorMode: 'dark', primaryColor: '#006699', style: { height: 900 } }, { width: 6000, height: 5000 });
  const main = source.renders.filter(render => render.width > 400);
  assert.ok(main.length); assert.ok(main.every(render => render.width * render.height <= 8_000_000 && render.width <= 8192 && render.height <= 8192));
  const canvas = ui.label('PDFページ 1').find(node => node.type === 'canvas');
  assert.equal(canvas.props.style.width / canvas.props.style.height, 800 / 600);
  const shell = ui.root.findByProps({ 'data-likex-slide-pdf': '' }); assert.equal(shell.props.style.colorScheme, 'dark'); assert.equal(shell.props.style.height, 900);
  assert.equal(ui.scratch.every(item => item.width === 0 && item.height === 0), true);
});

test('invalid documents and observer errors do not leak or stop the viewer lifecycle', async t => {
  const invalid = pdf(10001), ui = await mount(t, { loadPdf: invalid.loadPdf });
  assert.equal(ui.ref.current.getPageNumber(), 0); assert.equal(ui.errors.length, 1); assert.equal(invalid.document.destroyed, 1);
  const source = pdf(3); await ui.update({ loadPdf: source.loadPdf, onLoad() { throw new Error('observer'); }, onPageChange: async () => { throw new Error('observer'); }, onZoomChange() { throw new Error('observer'); } });
  await change(() => { assert.equal(ui.ref.current.goToPage(2), true); assert.equal(ui.ref.current.setZoom(150), true); });
  assert.equal(ui.ref.current.getPageNumber(), 2); assert.equal(ui.ref.current.getZoom(), 150);
  await ui.unmount(); assert.equal(invalid.document.destroyed, 1); assert.equal(source.document.destroyed, 1);
});

test('PDF thumbnail selection supports toggles, ranges and independent current-page state', async t => {
  const ui = await mount(t, { loadPdf: pdf(6).loadPdf }), api = ui.ref.current;
  assert.deepEqual(api.getSelectedPageNumbers(), [1]);
  await ui.click('PDFページ 3 を表示', { ctrlKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 3]); assert.equal(api.getPageNumber(), 3);
  assert.deepEqual(ui.selections.at(-1), { pageNumbers: [1, 3], pageNumber: 3, pageCount: 6 });
  assert.equal(ui.label('PDFページ 1 を表示')[0].props['aria-pressed'], true);
  assert.equal(ui.label('PDFページ 3 を表示')[0].props['aria-current'], 'page');
  await ui.click('PDFページ 5 を表示', { shiftKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [3, 4, 5]);
  await ui.click('PDFページ 4 を表示', { metaKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [3, 5]);
  await ui.click('PDFページ 5 を表示');
  assert.deepEqual(api.getSelectedPageNumbers(), [5]); assert.equal(api.getPageNumber(), 5);
  await ui.click('PDFページ 5 を表示', { metaKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), []); assert.equal(api.getPageNumber(), 5);
});

test('PDF selection API returns detached ordered snapshots and rejects a batch with any invalid page', async t => {
  const ui = await mount(t, { loadPdf: pdf(6).loadPdf, initialPageNumber: 2 }), api = ui.ref.current;
  const input = [5, 1, 5];
  await change(() => assert.equal(api.selectPages(input), true));
  input.push(3); const snapshot = api.getSelectedPageNumbers(); snapshot.push(4);
  ui.selections.at(-1).pageNumbers.push(6);
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 5]); assert.equal(api.getPageNumber(), 2);
  const count = ui.selections.length;
  await change(() => {
    assert.equal(api.selectPages([1, 5]), false);
    for (const value of [[2, 7], [0], [NaN], [1.5], [Infinity], ['2'], null]) assert.equal(api.selectPages(value), false);
  });
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 5]); assert.equal(ui.selections.length, count);
  await change(() => assert.equal(api.selectPages([]), true));
  assert.deepEqual(api.getSelectedPageNumbers(), []); assert.equal(api.getPageNumber(), 2);
  await change(() => assert.equal(api.goToPage(3), true));
  assert.deepEqual(api.getSelectedPageNumbers(), [3]);
  await ui.unmount(); assert.equal(api.selectPages([1]), false);
});

test('PDF controlled selection is a request, can be released and is locked without an observer', async t => {
  const ui = await mount(t, { loadPdf: pdf(6).loadPdf, selectedPageNumbers: [3, 1, 3] }), api = ui.ref.current;
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 3]);
  await change(() => assert.equal(api.selectPages([2, 4]), true));
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 3]);
  assert.deepEqual(ui.selections, [{ pageNumbers: [2, 4], pageNumber: 1, pageCount: 6 }]);
  await ui.update({ selectedPageNumbers: [2, 4] });
  assert.deepEqual(api.getSelectedPageNumbers(), [2, 4]); assert.equal(ui.selections.length, 1);
  await ui.update({ selectedPageNumbers: undefined });
  assert.deepEqual(api.getSelectedPageNumbers(), [2, 4]);
  await change(() => assert.equal(api.selectPages([3]), true));
  assert.deepEqual(api.getSelectedPageNumbers(), [3]);
  await ui.update({ selectedPageNumbers: [2], onSelectionChange: undefined });
  await change(() => assert.equal(api.selectPages([1]), false));
  assert.deepEqual(api.getSelectedPageNumbers(), [2]);
});

test('PDF selection resets on source change and is empty before the replacement finishes loading', async t => {
  const initial = [3, 1], first = pdf(6), next = pdf(2), waiting = deferred();
  const ui = await mount(t, { loadPdf: first.loadPdf, initialSelectedPageNumbers: initial }), api = ui.ref.current;
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 3]); initial.push(4);
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 3]);
  await change(() => api.selectPages([5, 6]));
  await ui.update({ loadPdf: () => waiting.promise, initialSelectedPageNumbers: [2] });
  assert.deepEqual(api.getSelectedPageNumbers(), []);
  await change(() => assert.equal(api.selectPages([1]), false));
  await change(() => waiting.resolve(next.document));
  assert.deepEqual(api.getSelectedPageNumbers(), [2]);
  assert.equal(ui.selections.length, 1, 'source/initial-prop updates do not masquerade as user requests');
});

test('PDF multi-selection stays cheap for long documents and observer failures cannot corrupt it', async t => {
  const source = pdf(1000), ui = await mount(t, { loadPdf: source.loadPdf, onSelectionChange: async event => { event.pageNumbers.length = 0; throw new Error('observer'); } });
  await change(() => assert.equal(ui.ref.current.selectPages(Array.from({ length: 1000 }, (_, i) => i + 1)), true));
  assert.equal(ui.ref.current.getSelectedPageNumbers().length, 1000);
  assert.equal(ui.ref.current.getPageNumber(), 1);
  assert.ok(source.pages.length < 10, 'selection does not load every selected page');
  assert.ok(ui.root.findAllByProps({ className: 'lxp-pdf-thumbnail' }).length < 10);
});

test('PDF range selection supports keyboard extension, additive ranges and scoped select-all', async t => {
  const ui = await mount(t, { loadPdf: pdf(8).loadPdf }), api = ui.ref.current;
  await ui.click('PDFページ 3 を表示');
  await ui.key('PageDown', { shiftKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [3, 4]); assert.equal(api.getPageNumber(), 4);
  await ui.click('PDFページ 6 を表示', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [3, 4, 5, 6]);
  assert.equal((await ui.key('a', { ctrlKey: true })).defaultPrevented, undefined, 'select-all outside the page list remains a host shortcut');
  const list = { focus() {} }, target = { closest(selector) { return selector === '.lxp-pdf-page-list' ? list : null; } };
  assert.equal((await ui.key('a', { metaKey: true, target })).defaultPrevented, true);
  assert.deepEqual(api.getSelectedPageNumbers(), [1, 2, 3, 4, 5, 6, 7, 8]); assert.equal(api.getPageNumber(), 6);
  await change(() => api.selectPages([1, 3]));
  await ui.click('PDFページ 5 を表示', { shiftKey: true });
  assert.deepEqual(api.getSelectedPageNumbers(), [3, 4, 5], 'an API selection establishes a new range anchor');
});

test('PDF selection and displayed-page control can be locked independently', async t => {
  const ui = await mount(t, { loadPdf: pdf(5).loadPdf, selectedPageNumbers: [1, 2], onSelectionChange: undefined }), api = ui.ref.current;
  await ui.click('PDFページ 3 を表示');
  assert.equal(api.getPageNumber(), 3); assert.deepEqual(api.getSelectedPageNumbers(), [1, 2]);
  const selectionRequests = [];
  await ui.update({ pageNumber: 2, onPageChange: undefined, selectedPageNumbers: undefined, onSelectionChange: event => selectionRequests.push(event) });
  await ui.click('PDFページ 4 を表示');
  assert.equal(api.getPageNumber(), 2); assert.deepEqual(api.getSelectedPageNumbers(), [4]);
  assert.deepEqual(selectionRequests, [{ pageNumbers: [4], pageNumber: 2, pageCount: 5 }]);
  await ui.update({ selectedPageNumbers: [2], onSelectionChange: undefined });
  assert.equal(ui.label('PDFページ 4 を表示')[0].props.disabled, true);
});
