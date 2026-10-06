import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './src/thumbnail';export {createDocument} from './src/model/document';export * from './src/ui/document-thumbnail-content';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, plugins: [{ name: 'externals', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { LikeDocumentThumbnail, createDocument, documentThumbnailContent, renderDocumentThumbnail } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const model = content => createDocument({ title: 'Preview', content: { type: 'doc', content } });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';

// A minimal DOM with deterministic block layout; the production serializer is used unchanged.
function surface(height = 100) {
  const loaded = [], made = [], observers = [];
  class Element {
    constructor(tag, nodeType = 1, text = '') { this.tag = tag; this.nodeType = nodeType; this.text = text; this.children = []; this.attrs = {}; this.style = {}; this.ownerDocument = document; made.push(this); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    get id() { return this.attrs.id ?? ''; }
    set id(value) { this.attrs.id = value; }
    set src(value) { this.attrs.src = value; loaded.push(value); }
    appendChild(child) { if (child.nodeType === 11) { for (const node of [...child.children]) this.appendChild(node); return child; } child.parent = this; this.children.push(child); return child; }
    replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; for (const node of nodes) this.appendChild(node); }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    get offsetHeight() { return this.fixedHeight ?? this.height(); }
    height() { if (this.tag === 'p' || /^h\d$/.test(this.tag)) return 24; if (this.tag === 'img') return Number(this.attrs.height || 20); if (this.nodeType === 3) return 0; if (this.tag === 'tr') return Math.max(0, ...this.children.map(child => child.height())); return this.children.reduce((sum, child) => sum + child.height(), 0); }
    top() { if (!this.parent) return 0; return this.parent.top() + (this.parent.tag === 'tr' ? 0 : this.parent.children.slice(0, this.parent.children.indexOf(this)).reduce((sum, child) => sum + child.height(), 0)); }
    getBoundingClientRect() { const top = this.top(), height = this.fixedHeight ?? this.height(); return { top, bottom: top + height, height, width: this.fixedWidth ?? 300 }; }
    querySelectorAll(selector) { const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]); const result = []; const walk = node => { for (const child of node.children) { if (names.some(name => Object.hasOwn(child.attrs, name))) result.push(child); walk(child); } }; walk(this); return result; }
  }
  const document = { createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), createTextNode: text => new Element('#text', 3, text), createDocumentFragment: () => new Element('#fragment', 11), defaultView: {
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(node) { this.node = node; } disconnect() { this.disconnected = true; } },
    addEventListener() {}, removeEventListener() {},
  } };
  const host = document.createElement('div'); host.fixedHeight = height;
  return { host, document, loaded, made, observers };
}

test('dedicated entry never imports an editing engine or session', () => {
  for (const path of Object.keys(output.metafile.inputs)) assert.doesNotMatch(path, /prosemirror-(?:view|state|commands|keymap|transform)|create-document-session|use-document-editor/);
});

test('prefix stops at explicit page breaks and bounds long text, rows and canvas shapes', () => {
  const original = model([paragraph('First'), { type: 'page_break' }, { type: 'image', attrs: { src: png } }, paragraph('Later')]);
  const before = JSON.stringify(original), prefix = documentThumbnailContent(original);
  assert.equal(prefix.content.length, 1); assert.equal(prefix.content[0].content[0].text, 'First');
  assert.equal(JSON.stringify(original), before);
  assert.equal(documentThumbnailContent(model([paragraph('x'.repeat(20000))])).content[0].content[0].text.length, 8000);
  const table = model([{ type: 'table', content: Array.from({ length: 100 }, (_, index) => ({ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph(`Row ${index}`)] }] })) }]);
  assert.equal(documentThumbnailContent(table).content[0].content.length, 32);
  const many = documentThumbnailContent(model(Array.from({ length: 1000 }, () => paragraph('short'))));
  const count = node => 1 + (node.content ?? []).reduce((sum, child) => sum + count(child), 0);
  assert.ok(count(many) <= 512);
  const canvas = model([{ type: 'drawing_canvas', attrs: { shapes: Array.from({ length: 60 }, (_, index) => ({ id: `shape-${index}`, preset: 'rect', x: index, y: index, text: 'Shape' })) } }]);
  assert.equal(documentThumbnailContent(canvas).content[0].attrs.shapes.length, 32);
});

test('measured first page stops creating later DOM and does not load later images', () => {
  const { host, loaded, made } = surface(100);
  const content = model([...Array.from({ length: 20 }, (_, index) => paragraph(`Paragraph ${index}`)), { type: 'image', attrs: { src: png } }]);
  renderDocumentThumbnail(host, documentThumbnailContent(content), 0, 'preview');
  assert.equal(host.children.length, 5);
  assert.ok(!host.textContent.includes('Paragraph 5')); assert.deepEqual(loaded, []); assert.ok(!made.some(node => node.tag === 'img'));
});

test('long tables render only initial rows and preserve the schema formatting', () => {
  const { host, made } = surface(100);
  const document = model([{ type: 'table', content: Array.from({ length: 100 }, (_, index) => ({ type: 'table_row', content: [{ type: index === 0 ? 'table_header' : 'table_cell', content: [paragraph(`Row ${index}`)] }] })) }]);
  renderDocumentThumbnail(host, documentThumbnailContent(document), 0, 'preview');
  assert.equal(made.filter(node => node.tag === 'tr').length, 5); assert.equal(made.filter(node => node.tag === 'th').length, 1);
  assert.ok(!host.textContent.includes('Row 5'));
});

test('schema rendering keeps text inert and only assigns visible validated image sources', () => {
  const { host, loaded, made } = surface(500);
  const document = model([paragraph('<script>alert(1)</script>'), { type: 'image', attrs: { src: png, width: 20, height: 20 } }, { type: 'shape', attrs: { preset: 'rect', text: '<unsafe>' } }]);
  renderDocumentThumbnail(host, documentThumbnailContent(document), 0, 'preview');
  assert.deepEqual(loaded, [png]); assert.ok(!made.some(node => node.tag === 'script')); assert.ok(host.textContent.includes('<script>')); assert.ok(made.some(node => node.tag === 'svg'));
});

async function mount(document, onError) {
  const fixture = surface(1122), root = fixture.document.createElement('div'), viewport = fixture.document.createElement('div'); viewport.fixedWidth = 400; viewport.fixedHeight = 238;
  let renderer;
  await act(async () => { renderer = create(h(LikeDocumentThumbnail, { document, onError }), { createNodeMock: element => {
    if (element.props['data-likex-document-thumbnail'] === '') return root;
    if (element.props.className === 'lxd-thumbnail-viewport') return viewport;
    if (element.props.className === 'lxd-editor lxd-thumbnail-body') return fixture.host;
    return null;
  } }); });
  return { ...fixture, renderer, viewport };
}

test('controlled updates, static SSR, fit resizing and observer cleanup work without editing controls', async () => {
  const first = model([paragraph('First document')]), second = model([paragraph('Second document')]);
  const ssr = renderToStaticMarkup(h(LikeDocumentThumbnail, { document: first }));
  assert.match(ssr, /Preview/); assert.match(ssr, /inert=""/); assert.doesNotMatch(ssr, /role="textbox"|lxd-ribbon|lxd-zoom|lxd-navigation/);
  const instance = await mount(first);
  assert.ok(instance.host.textContent.includes('First document')); assert.equal(instance.observers.length, 1);
  await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document: second })));
  assert.ok(instance.host.textContent.includes('Second document')); assert.ok(!instance.host.textContent.includes('First document'));
  const before = instance.renderer.root.findByProps({ className: 'lxd-thumbnail-fit' }).props.style.width;
  instance.viewport.fixedWidth = 80;
  await act(async () => instance.observers[0].callback());
  assert.ok(instance.renderer.root.findByProps({ className: 'lxd-thumbnail-fit' }).props.style.width < before);
  instance.viewport.fixedWidth = instance.viewport.fixedHeight = 2000;
  await act(async () => instance.observers[0].callback());
  assert.equal(instance.renderer.root.findByProps({ className: 'lxd-surface lxd-thumbnail-page' }).props.style.transform, 'scale(1)');
  await act(async () => instance.renderer.unmount()); assert.equal(instance.observers[0].disconnected, true); assert.equal(instance.host.children.length, 0);
});

test('invalid input is rejected before DOM rendering and observer failures are isolated', async () => {
  const valid = model([paragraph('Safe')]);
  const invalid = structuredClone(valid); invalid.content.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }];
  const errors = [], instance = await mount(invalid, error => { errors.push(error); throw new Error('Observer failure'); });
  assert.equal(errors.length, 1); assert.ok(errors[0] instanceof Error); assert.equal(instance.host.children.length, 0);
  assert.equal(instance.renderer.root.findByProps({ role: 'status' }).children[0], '文書のプレビューを表示できません。');
  await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document: valid })));
  assert.ok(instance.host.textContent.includes('Safe'));
  await act(async () => instance.renderer.unmount());
});

test('DOM rendering failures show a placeholder and async error observers cannot reject the preview', async () => {
  const first = model([paragraph('First')]), next = model([paragraph('Next')]);
  const instance = await mount(first), createElement = instance.document.createElement;
  instance.document.createElement = tag => { if (tag === 'p') throw new Error('DOM unavailable'); return createElement(tag); };
  const errors = [];
  await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document: next, onError: async error => { errors.push(error.message); throw new Error('Observer rejected'); } })));
  assert.deepEqual(errors, ['DOM unavailable']); assert.equal(instance.host.children.length, 0);
  assert.equal(instance.renderer.root.findByProps({ role: 'status' }).children[0], '文書のプレビューを表示できません。');
  instance.document.createElement = createElement;
  await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document: first })));
  assert.ok(instance.host.textContent.includes('First'));
  await act(async () => instance.renderer.unmount());
});

test('selected pages get a fresh budget and never create preceding or following content', () => {
  const document = model([
    paragraph('x'.repeat(20000)), ...Array.from({ length: 800 }, () => paragraph('Previous')),
    { type: 'table', content: Array.from({ length: 80 }, () => ({ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph('Old row')] }] })) },
    { type: 'image', attrs: { src: png } }, { type: 'page_break' },
    paragraph('Selected'), { type: 'image', attrs: { src: png } },
    { type: 'page_break' }, paragraph('Following'), { type: 'image', attrs: { src: png } },
  ]);
  const content = documentThumbnailContent(document, 2), instance = surface(500);
  renderDocumentThumbnail(instance.host, content, 0, 'target');
  assert.equal(instance.host.textContent, 'Selected'); assert.deepEqual(instance.loaded, [png]);
  assert.equal(content.content.length, 2); assert.equal(instance.made.filter(node => node.tag === 'img').length, 1);
  assert.throws(() => documentThumbnailContent(document, 4), /4ページ目/);
});

test('nested breaks preserve selected list numbering and table columns without other-page text', () => {
  const list = model([{ type: 'ordered_list', attrs: { order: 7 }, content: [
    { type: 'list_item', content: [paragraph('Old')] },
    { type: 'list_item', content: [paragraph('Before'), { type: 'page_break' }, paragraph('Selected')] },
    { type: 'list_item', content: [paragraph('Still selected'), { type: 'page_break' }, paragraph('Later')] },
  ] }]);
  const selected = documentThumbnailContent(list, 2);
  assert.equal(selected.content[0].attrs.order, 8);
  assert.equal(selected.content[0].content.length, 2);
  assert.doesNotMatch(JSON.stringify(selected), /Old|Before|Later|page_break/);
  const table = model([{ type: 'table', content: [{ type: 'table_row', content: [
    { type: 'table_cell', content: [paragraph('Old cell')] },
    { type: 'table_cell', content: [paragraph('Before'), { type: 'page_break' }, paragraph('Selected')] },
    { type: 'table_cell', content: [paragraph('Next cell')] },
  ] }] }]);
  const cells = documentThumbnailContent(table, 2).content[0].content[0].content;
  assert.equal(cells.length, 3); assert.deepEqual(cells[0].content, []);
  assert.equal(cells[1].content[0].content[0].text, 'Selected');
  assert.equal(cells[2].content[0].content[0].text, 'Next cell');
  const instance = surface(500); renderDocumentThumbnail(instance.host, documentThumbnailContent(table, 2), 0, 'table');
  assert.equal(instance.host.textContent, 'SelectedNext cell');
  assert.deepEqual(documentThumbnailContent(model([{ type: 'page_break' }]), 2).content, []);
});

test('controlled page changes preserve title on invalid targets and recover without changing document', async () => {
  const document = model([paragraph('First'), { type: 'page_break' }, paragraph('Second')]), errors = [];
  const instance = await mount(document, error => errors.push(error));
  try {
    await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document, pageNumber: 2 })));
    assert.equal(instance.host.textContent, 'Second');
    for (const pageNumber of [0, -1, 1.5, NaN, Infinity, '2', null, 3]) {
      await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document, pageNumber, onError: error => errors.push(error) })));
      assert.equal(instance.renderer.root.findByProps({ className: 'lxd-document-title' }).props.children, 'Preview');
      assert.equal(instance.renderer.root.findAllByProps({ role: 'status' }).length, 1);
      assert.equal(instance.host.textContent, '');
    }
    assert.equal(errors.length, 8);
    await act(async () => instance.renderer.update(h(LikeDocumentThumbnail, { document, pageNumber: 1 })));
    assert.equal(instance.host.textContent, 'First'); assert.equal(instance.renderer.root.findAllByProps({ role: 'status' }).length, 0);
  } finally { await act(async () => instance.renderer.unmount()); }
});
