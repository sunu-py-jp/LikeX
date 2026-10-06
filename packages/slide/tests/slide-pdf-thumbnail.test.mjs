import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { LikeSlidePdfThumbnail } from './src/pdf/pdf-thumbnail';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlidePdfThumbnail } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async action => { await act(async () => { await action(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function pdf({ render, getPage, width = 800, height = 600, marker = 'first' } = {}) {
  const signals = [], requests = [], renders = [];
  const document = { pageCount: 1000, destroyed: 0, async destroy() { document.destroyed++; }, async getPage(number, { signal }) {
    requests.push({ number, signal }); if (getPage) return getPage(number, signal);
    return { width, height, async render(options) { const call = { ...options, number, width: options.canvas.width, height: options.canvas.height };
      renders.push(call); options.canvas.marker = typeof marker === 'function' ? marker(number) : marker; await render?.(call); } };
  } };
  return { document, signals, requests, renders, async loadPdf({ signal }) { signals.push(signal); return document; } };
}
async function mount(t, props) {
  let renderer, active = true;
  const canvases = [], scratch = [], observers = [], errors = [], listeners = new Map();
  const document = { defaultView: { devicePixelRatio: 3,
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); } },
    createElement(type) { assert.equal(type, 'canvas'); const canvas = makeCanvas(); scratch.push(canvas); return canvas; } };
  function makeCanvas() { return { ownerDocument: document, width: 0, height: 0, draws: [], getContext() { return { drawImage: source => this.draws.push(source.marker) }; } }; }
  let supplied = { onError: error => errors.push(error), ...props };
  const render = () => h(LikeSlidePdfThumbnail, supplied);
  await change(() => { renderer = create(render(), { createNodeMock(element) {
    if (element.props['data-likex-slide-pdf-thumbnail'] !== undefined) return { ownerDocument: document };
    if (element.type === 'canvas') { const canvas = makeCanvas(); canvases.push(canvas); return canvas; }
    return null;
  } }); });
  const unmount = async () => { if (active) { active = false; await change(() => renderer.unmount()); } }; t.after(unmount);
  return { canvases, scratch, observers, listeners, errors, unmount, get root() { return renderer.root; },
    async update(patch) { supplied = { ...supplied, ...patch }; await change(() => renderer.update(render())); },
  };
}

test('PDF thumbnail fetches and renders only page one with a title and no viewer controls', async t => {
  const source = pdf(), ui = await mount(t, { loadPdf: source.loadPdf, title: 'Cover', colorMode: 'dark', primaryColor: '#006699', style: { width: 360 }, 'aria-label': 'Report cover' });
  assert.deepEqual(source.requests.map(request => request.number), [1]); assert.equal(source.renders.length, 1);
  assert.equal(ui.root.findAllByType('canvas').length, 1); assert.equal(ui.root.findAllByType('button').length, 0); assert.equal(ui.root.findAllByType('input').length, 0);
  assert.equal(ui.root.findAllByType('aside').length, 0); assert.equal(ui.root.findAllByType('footer').length, 0);
  assert.equal(ui.root.findByProps({ className: 'lxp-document-title' }).children.join(''), 'Cover');
  const root = ui.root.findByProps({ 'data-likex-slide-pdf-thumbnail': '' });
  assert.equal(root.props['aria-label'], 'Report cover'); assert.equal(root.props.style.colorScheme, 'dark'); assert.equal(root.props.style.width, 360);
  const canvas = ui.root.findByType('canvas'); assert.equal(canvas.props.style.width, 800); assert.equal(canvas.props.style.height, 600);
  await ui.update({ title: 'Renamed' }); assert.equal(source.requests.length, 1); assert.equal(source.renders.length, 1);
});

test('PDF thumbnail resize fits without upscaling and keeps the small bitmap budget', async t => {
  const source = pdf(), ui = await mount(t, { loadPdf: source.loadPdf, style: { width: 5000, height: 5000 } });
  assert.deepEqual(source.requests.map(request => request.number), [1]); assert.equal(source.renders.length, 1);
  const svg = ui.root.findByProps({ className: 'lxp-pdf-thumbnail-page' });
  assert.equal(svg.props.viewBox, '0 0 800 600'); assert.equal(svg.props.preserveAspectRatio, 'xMidYMid meet');
  assert.deepEqual(svg.props.style, { maxWidth: 800, maxHeight: 600 });
  assert.ok(source.renders[0].width * source.renders[0].height <= 200_000);
  await ui.update({ style: { width: 232, height: 500 } });
  assert.equal(source.requests.length, 1); assert.equal(source.renders.length, 1);
  await ui.unmount(); assert.equal(source.document.destroyed, 1); assert.ok(source.signals[0].aborted);
  assert.ok(ui.observers.every(observer => observer.disconnected)); assert.equal(ui.listeners.size, 0);
  assert.ok([...ui.canvases, ...ui.scratch].every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('PDF thumbnail cancels replaced and unmounted loads and ignores their late results', async t => {
  const gate = deferred(), abandoned = pdf(), next = pdf({ marker: 'next' }), signals = [];
  const ui = await mount(t, { loadPdf: ({ signal }) => { signals.push(signal); return gate.promise; } });
  assert.equal(ui.root.findAllByType('canvas').length, 0); assert.equal(ui.root.findAllByProps({ role: 'status' }).length, 1);
  await ui.update({ loadPdf: next.loadPdf }); assert.ok(signals[0].aborted);
  await change(() => gate.resolve(abandoned.document)); assert.equal(abandoned.document.destroyed, 1); assert.equal(abandoned.requests.length, 0);
  assert.deepEqual(next.requests.map(request => request.number), [1]); assert.deepEqual(ui.errors, []);
  await ui.unmount(); assert.ok(next.signals[0].aborted); assert.equal(next.document.destroyed, 1);
});

test('PDF thumbnail never commits an obsolete render after a source change', async t => {
  const gate = deferred(), old = pdf({ render: () => gate.promise }), next = pdf({ marker: 'next' });
  const ui = await mount(t, { loadPdf: old.loadPdf }), original = ui.canvases[0];
  assert.equal(old.renders.length, 1); assert.equal(original.draws.length, 0);
  await ui.update({ loadPdf: next.loadPdf }); assert.ok(old.renders[0].signal.aborted);
  await change(() => gate.resolve()); assert.equal(original.draws.length, 0); assert.equal(original.width, 0);
  assert.deepEqual(ui.canvases.at(-1).draws, ['next']); assert.equal(old.document.destroyed, 1); assert.deepEqual(ui.errors, []);
});

test('PDF thumbnail exposes loading, input/page/render failures and SSR without running the loader', async t => {
  let serverLoads = 0;
  const html = renderToString(h(LikeSlidePdfThumbnail, { title: 'Server cover', loadPdf: async () => { serverLoads++; throw new Error('should not load'); } }));
  assert.equal(serverLoads, 0); assert.ok(html.includes('Server cover')); assert.ok(html.includes('role="status"'));
  const invalid = pdf(); invalid.document.pageCount = 0;
  const ui = await mount(t, { loadPdf: invalid.loadPdf });
  assert.equal(ui.errors.length, 1); assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 1); assert.equal(invalid.requests.length, 0);
  const failed = pdf({ getPage: async () => { throw new Error('page unavailable'); } });
  await ui.update({ loadPdf: failed.loadPdf }); assert.equal(ui.root.findByProps({ role: 'alert' }).children.join(''), 'page unavailable');
  const renderFailed = pdf({ render: async () => { throw new Error('render unavailable'); } });
  await ui.update({ loadPdf: renderFailed.loadPdf, onError: async () => { throw new Error('observer'); } });
  assert.equal(ui.root.findByProps({ role: 'alert' }).children.join(''), 'render unavailable');
  await ui.unmount(); assert.equal(renderFailed.document.destroyed, 1);
});

test('PDF thumbnail displays the requested page and changes pages without reloading the document', async t => {
  const source = pdf({ marker: number => `page-${number}` }), ui = await mount(t, { loadPdf: source.loadPdf, pageNumber: 3 });
  assert.deepEqual(source.requests.map(request => request.number), [3]); assert.deepEqual(source.renders.map(render => render.number), [3]);
  assert.equal(ui.root.findByType('canvas').props['aria-label'], 'PDFページ 3');
  assert.equal(ui.root.findByProps({ className: 'lxp-titlebar-end lxp-pdf-view-label' }).children.join(''), '3ページ目');
  const firstCanvas = ui.canvases[0];
  await ui.update({ pageNumber: 7 });
  assert.deepEqual(source.requests.map(request => request.number), [3, 7]); assert.deepEqual(source.renders.map(render => render.number), [3, 7]);
  assert.equal(source.signals.length, 1); assert.equal(source.signals[0].aborted, false); assert.equal(source.document.destroyed, 0);
  assert.equal(firstCanvas.width, 0); assert.deepEqual(ui.canvases.at(-1).draws, ['page-7']);
  assert.equal(ui.root.findByType('canvas').props['aria-label'], 'PDFページ 7');
  await ui.update({ pageNumber: 3 }); assert.equal(source.requests.length, 2, 'Revisiting a cached page reuses the same session');
  assert.deepEqual(ui.canvases.at(-1).draws, ['page-3']);
});

test('PDF thumbnail rejects invalid page numbers as a whole and recovers on a valid page', async t => {
  const source = pdf(), ui = await mount(t, { loadPdf: source.loadPdf, pageNumber: 0 });
  assert.equal(ui.errors.length, 1); assert.equal(source.requests.length, 0);
  for (const pageNumber of [-1, 1.5, NaN, Infinity, 1001, '2', null]) {
    const count = ui.errors.length; await ui.update({ pageNumber });
    assert.equal(ui.errors.length, count + 1); assert.equal(source.requests.length, 0);
    assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 1); assert.equal(ui.root.findAllByType('canvas').length, 0);
  }
  await ui.update({ pageNumber: 5 }); assert.deepEqual(source.requests.map(request => request.number), [5]);
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0);
  await ui.update({ pageNumber: undefined }); assert.deepEqual(source.requests.map(request => request.number), [5, 1]);
  assert.equal(source.signals.length, 1); assert.equal(source.document.destroyed, 0);
});

test('PDF thumbnail checks the final page number against the loaded document before requesting it', async t => {
  const loading = deferred(), source = pdf(); source.document.pageCount = 4;
  const ui = await mount(t, { loadPdf: () => loading.promise, pageNumber: 10 });
  await ui.update({ pageNumber: 6 }); assert.equal(ui.errors.length, 0);
  await change(() => loading.resolve(source.document)); assert.equal(ui.errors.length, 1); assert.equal(source.requests.length, 0);
  await ui.update({ pageNumber: 4 }); assert.deepEqual(source.requests.map(request => request.number), [4]);
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('PDF thumbnail aborts obsolete page fetches and excludes their late errors and results', async t => {
  const pending = new Map(), source = pdf({ getPage: number => {
    const gate = deferred(); pending.set(number, gate); return gate.promise;
  } });
  const ui = await mount(t, { loadPdf: source.loadPdf, pageNumber: 2 });
  await ui.update({ pageNumber: 3 }); assert.ok(source.requests[0].signal.aborted);
  await change(() => pending.get(2).reject(new Error('old page error'))); assert.deepEqual(ui.errors, []);
  await ui.update({ pageNumber: 4 }); assert.ok(source.requests[1].signal.aborted);
  let obsoleteRenders = 0;
  await change(() => pending.get(3).resolve({ width: 800, height: 600, async render() { obsoleteRenders++; } }));
  await change(() => pending.get(4).resolve({ width: 800, height: 600, async render({ canvas }) { canvas.marker = 'page-4'; } }));
  assert.equal(obsoleteRenders, 0); assert.deepEqual(ui.errors, []); assert.deepEqual(ui.canvases.at(-1).draws, ['page-4']);
  await ui.update({ pageNumber: 5 });
  await change(() => pending.get(5).reject(new Error('page 5 fetch error')));
  assert.equal(ui.root.findByProps({ role: 'alert' }).children.join(''), 'page 5 fetch error');
  await ui.update({ pageNumber: 6 });
  await change(() => pending.get(6).resolve({ width: 800, height: 600, async render({ canvas }) { canvas.marker = 'page-6'; } }));
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0); assert.deepEqual(ui.canvases.at(-1).draws, ['page-6']);
  assert.equal(source.signals.length, 1);
});

test('PDF thumbnail discards old page renders and scopes render errors to their target page', async t => {
  const waiting = deferred(), source = pdf({ marker: number => `page-${number}`, render: async call => {
    if (call.number === 2) await waiting.promise;
    if (call.number === 4) throw new Error('page 4 render error');
  } });
  const ui = await mount(t, { loadPdf: source.loadPdf, pageNumber: 2 }), obsoleteCanvas = ui.canvases[0];
  await ui.update({ pageNumber: 3 }); assert.ok(source.renders[0].signal.aborted);
  await change(() => waiting.reject(new Error('obsolete render error')));
  assert.deepEqual(ui.errors, []); assert.equal(obsoleteCanvas.draws.length, 0); assert.equal(obsoleteCanvas.width, 0);
  assert.deepEqual(ui.canvases.at(-1).draws, ['page-3']);
  await ui.update({ pageNumber: 4 }); assert.equal(ui.errors.length, 1);
  assert.equal(ui.root.findByProps({ role: 'alert' }).children.join(''), 'page 4 render error');
  await ui.update({ pageNumber: 5 }); assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.deepEqual(ui.canvases.at(-1).draws, ['page-5']); assert.equal(source.signals.length, 1);
});
