import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockViewSource = `export class EditorView {
  static instances = [];
  constructor(place, props) { this.props = props; this.state = props.state; this.updates = 0; this.dom = place; EditorView.instances.push(this); }
  updateState(state) { this.state = state; this.updates++; }
  setProps(props) { this.props = {...this.props,...props}; }
  dispatch(transaction) { this.props.dispatchTransaction(transaction); }
  focus() { this.focused = true; }
  destroy() { this.destroyed = true; }
}`;
const output = await build({ stdin: { contents: `export {default as LikeDocument} from './src/document';export * from './src/model';export {EditorView as TestEditorView} from 'prosemirror-view';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [
  { name: 'react-and-view', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^prosemirror-view$/ }, () => ({ path: 'pm-test-view', namespace: 'pm-test-view' }));
    builder.onLoad({ filter: /.*/, namespace: 'pm-test-view' }, () => ({ contents: mockViewSource, loader: 'js' }));
  } },
] });
const { LikeDocument, createDocument, serializeDocument, getDocumentText, getBlocks, getImages, TestEditorView } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-document-ui-tests.js').toString('base64')}`);
const change = async callback => act(async () => { await callback(); });
const body = value => createDocument({ content: { type: 'doc', content: [{ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] }] } });
const button = (renderer, label) => renderer.root.findByProps({ 'aria-label': label });
const tab = (renderer, name) => renderer.root.findAllByType('button').find(node => node.props.role === 'tab' && node.props.children === name);
const notice = renderer => renderer.root.findAllByType('span').map(node => typeof node.props.children === 'string' ? node.props.children : '').join(' ');
async function mount(t, props, nodes = false) {
  const ref = createRef(), listeners = new Map(), ownerDocument = { activeElement: null, defaultView: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); }, confirm: () => true } };
  const root = { ownerDocument, isConnected: true, addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
  let renderer;
  await change(() => { renderer = create(h(LikeDocument, { ref, ...props }), nodes ? { createNodeMock: element => {
    if (element.props['data-likex-document'] === '') return root;
    if (element.type === 'div' && Object.keys(element.props).every(key => key === 'ref')) return { ownerDocument };
    return null;
  } } : undefined); });
  t.after(() => change(() => renderer.unmount()));
  return { renderer, ref, root, listeners, view: TestEditorView.instances.at(-1) };
}

test('server rendering includes home ribbon groups, native extension, text and isolated primary color', () => {
  const html = renderToStaticMarkup(h(LikeDocument, { initialDocument: body('Document consumer text'), primaryColor: '#2563eb' }));
  for (const text of ['data-likex-document', 'Document consumer text', 'クリップボード', 'フォント', '段落', '.dcon', '--lxd-primary:#2563eb']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-selected="true"[^>]*>ホーム/);
  assert.ok(!html.includes('class="lxd-save"'), 'without onSave no editable save action');
});

test('onSave omission and readOnly disable ref writes and rendered editing, while export stays available', async t => {
  for (const options of [{}, { onSave() {}, readOnly: true }]) {
    const { renderer, ref, view } = await mount(t, { initialDocument: body('Original'), ...options }, true);
    assert.equal(view.props.editable(), false);
    await change(async () => { assert.equal(await ref.current.execute({ type: 'text.insert', from: 1, text: 'Changed' }), null); });
    assert.equal(getDocumentText(ref.current.getDocument()), 'Original');
    assert.equal(button(renderer, '太字').props.disabled, true);
    assert.equal(await ref.current.save(), false);
    await change(() => tab(renderer, 'ファイル').props.onClick());
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'DCONを開く' }).length, 0);
    assert.equal(button(renderer, 'Word (.docx)').props.disabled, false);
  }
});

test('feature flags remove editing groups and cannot be bypassed through the component ref', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Original'), onSave() {}, features: { formatting: false, tables: false, images: false, lists: false, pageLayout: false, import: false, export: false, history: false } });
  assert.equal(renderer.root.findAllByProps({ 'aria-label': '太字' }).length, 0);
  for (const command of [{ type: 'paragraph.set', from: 1, to: 2, align: 'right' }, { type: 'table.insert', at: 1, rows: 2, columns: 2 }, { type: 'list.set', from: 1, to: 2, kind: 'bullet' }, { type: 'pageBreak.insert', at: 1 }]) await change(async () => { assert.equal(await ref.current.execute(command), null); });
  assert.equal(getDocumentText(ref.current.getDocument()), 'Original');
  await change(() => tab(renderer, '挿入').props.onClick());
  for (const label of ['表を挿入', '画像を挿入', '改ページ']) assert.equal(renderer.root.findAllByProps({ 'aria-label': label }).length, 0);
  await assert.rejects(ref.current.exportDocx(), /書き出し/);
});

test('actual change requests permission; denial leaves content, undo history and dirty state unchanged', async t => {
  const changes = [], dirty = [], events = []; let requests = 0, allow = false;
  const { renderer, ref } = await mount(t, { initialDocument: body('Original'), onSave() {}, onEditRequest: () => { requests++; return allow; }, onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value), onEvent: event => events.push(event) });
  await change(() => ref.current.select({ from: 1, to: 4 })); assert.equal(requests, 0);
  await change(async () => { assert.equal(await ref.current.execute({ type: 'text.insert', from: 1, text: 'X' }), null); });
  assert.equal(requests, 1); assert.deepEqual(changes, []); assert.deepEqual(dirty, [false]); assert.match(notice(renderer), /他のユーザー/);
  await change(async () => { assert.equal(await ref.current.undo(), false); }); assert.equal(requests, 1);
  allow = true; await change(() => ref.current.execute({ type: 'text.insert', from: 1, text: 'X' }));
  assert.equal(getDocumentText(ref.current.getDocument()), 'XOriginal'); assert.equal(requests, 2); assert.deepEqual(dirty, [false, true]);
  await change(() => ref.current.execute({ type: 'text.insert', from: 2, text: 'Y' })); assert.equal(requests, 2);
  assert.equal(events.filter(event => event.type === 'change').length, 2);
});

test('native file input and ref share import logic, invalid input is atomic and imports remain undoable', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Original'), onSave() {} });
  const input = renderer.root.findByProps({ 'aria-label': 'DCONファイルを選択' });
  assert.ok(input.props.accept.includes('.dcon'));
  const incoming = createDocument({ title: 'Imported', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New body' }] }] } });
  const target = { files: [new File([serializeDocument(incoming)], 'example.dcon')], value: 'example.dcon' };
  await change(() => input.props.onChange({ target })); assert.equal(target.value, ''); assert.equal(ref.current.getDocument().title, 'Imported');
  const snapshot = ref.current.getDocument();
  await change(() => ref.current.importNative('{"format":"other","version":1}'));
  assert.deepEqual(ref.current.getDocument(), snapshot);
  await change(async () => { assert.equal(await ref.current.undo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'Original');
  await change(async () => { assert.equal(await ref.current.redo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'New body');
});

test('save hooks preserve undo/redo after completion and clear beforeunload when the baseline matches', async t => {
  let allow = false, saves = 0; const events = [];
  const { renderer, ref, listeners } = await mount(t, { initialDocument: body('Original'), onBeforeSave: () => allow, onSave: async document => { saves++; return document; }, onEvent: event => events.push(event) }, true);
  await change(() => ref.current.execute({ type: 'text.insert', from: 1, text: 'X' })); assert.ok(listeners.has('beforeunload'));
  await change(async () => { assert.equal(await ref.current.save(), false); }); assert.equal(saves, 0);
  allow = true; await change(async () => { assert.equal(await ref.current.save(), true); }); assert.equal(saves, 1); assert.equal(listeners.has('beforeunload'), false);
  assert.equal(button(renderer, '元に戻す').props.disabled, false);
  await change(async () => { assert.equal(await ref.current.undo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'Original'); assert.ok(listeners.has('beforeunload'));
  await change(async () => { assert.equal(await ref.current.redo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'XOriginal'); assert.equal(listeners.has('beforeunload'), false);
  assert.deepEqual(events.filter(event => event.type === 'save').map(event => event.phase), ['start', 'cancelled', 'start', 'success']);
});

test('collapsed-caret mark changes update ribbon indicators without dirtying saved data', async t => {
  const { renderer, ref, view } = await mount(t, { initialDocument: body('Original'), onSave() {} }, true);
  const before = ref.current.getDocument();
  await change(() => button(renderer, '太字').props.onClick());
  assert.ok(view.state.storedMarks.some(mark => mark.type.name === 'strong'));
  assert.equal(button(renderer, '太字').props['aria-pressed'], true);
  assert.deepEqual(ref.current.getDocument(), before);
  await change(async () => { assert.equal(await ref.current.undo(), false); });
});

test('native ProseMirror typing uses commands and history while keeping bold stored marks', async t => {
  const { renderer, ref, view } = await mount(t, { initialDocument: body('Original'), onSave() {} }, true);
  await change(() => button(renderer, '太字').props.onClick());
  await change(() => view.dispatch(view.state.tr.insertText('X')));
  assert.equal(getDocumentText(ref.current.getDocument()), 'XOriginal');
  assert.ok(ref.current.getDocument().content.content[0].content[0].marks.some(mark => mark.type === 'strong'));
  await change(async () => { assert.equal(await ref.current.undo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'Original');
  await change(async () => { assert.equal(await ref.current.redo(), true); }); assert.equal(getDocumentText(ref.current.getDocument()), 'XOriginal');
});

test('programmatic selection updates ribbon formatting to the newly selected content', async t => {
  const initialDocument = createDocument({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'strong' }] }, { type: 'text', text: 'Plain' }] }] } });
  const { renderer, ref } = await mount(t, { initialDocument, onSave() {} }, true);
  await change(() => ref.current.select({ from: 7, to: 9 }));
  assert.equal(button(renderer, '太字').props['aria-pressed'], false);
  await change(() => ref.current.select({ from: 1, to: 3 }));
  assert.equal(button(renderer, '太字').props['aria-pressed'], true);
});

test('deferred or denied native typing reconciles the view and never writes before permission', async t => {
  let complete;
  const permission = new Promise(resolve => { complete = resolve; });
  const { ref, view } = await mount(t, { initialDocument: body('Original'), onSave() {}, onEditRequest: () => permission }, true);
  const updates = view.updates;
  await change(() => view.dispatch(view.state.tr.insertText('X')));
  assert.equal(getDocumentText(ref.current.getDocument()), 'Original'); assert.equal(view.state.doc.textContent, 'Original'); assert.ok(view.updates > updates);
  assert.equal(view.props.editable(), false);
  await change(() => complete(false));
  assert.equal(getDocumentText(ref.current.getDocument()), 'Original'); assert.equal(view.state.doc.textContent, 'Original'); assert.equal(view.props.editable(), true);
});

test('Ctrl/Cmd+Z from a ribbon select undoes page settings rather than losing the shortcut', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Text'), onSave() {} });
  await change(() => ref.current.execute({ type: 'document.update', page: { margins: { top: 30 } } }));
  const target = { tagName: 'SELECT', type: 'select-one', closest(selector) { return selector.includes('select') ? this : null; } };
  let prevented = false;
  await change(() => renderer.root.findByProps({ 'data-likex-document': '' }).props.onKeyDownCapture({ target, nativeEvent: { isComposing: false }, ctrlKey: true, metaKey: false, shiftKey: false, key: 'z', preventDefault() { prevented = true; }, stopPropagation() {} }));
  assert.equal(prevented, true); assert.equal(ref.current.getDocument().page.margins.top, 20);
});

test('image API defaults keep intrinsic aspect ratio and UI input excludes unsupported media', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Text'), onSave() {} });
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
  const imageInput = renderer.root.findByProps({ 'aria-label': '挿入する画像を選択' }); assert.equal(imageInput.props.accept, 'image/png,image/jpeg');
  await change(() => ref.current.execute({ type: 'image.insert', at: 0, src, alt: 'Landscape', width: 320 }));
  const image = getImages(ref.current.getDocument())[0]; assert.equal(image.node.attrs.height, 160); assert.equal(image.node.attrs.alt, 'Landscape');
});

test('table and whole-document selections include resource nodes in the actual editor view', async t => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
  const initialDocument = createDocument({ content: { type: 'doc', content: [{ type: 'image', attrs: { src } },
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] }] },
    { type: 'page_break' }] } });
  const { ref, view } = await mount(t, { initialDocument, onSave() {} }, true);
  const table = getBlocks(initialDocument).find(block => block.node.type === 'table');
  await change(() => ref.current.select({ from: table.from, to: table.to }));
  assert.equal(view.state.selection.node.type.name, 'table'); assert.equal(view.state.selection.content().content.firstChild.type.name, 'table');
  await change(() => ref.current.select({ from: 0, to: view.state.doc.content.size }));
  assert.equal(view.state.selection.toJSON().type, 'all');
  assert.equal(view.state.selection.content().content.firstChild.type.name, 'image');
  assert.equal(view.state.selection.content().content.lastChild.type.name, 'page_break');
});
