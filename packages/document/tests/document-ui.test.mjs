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
const { LikeDocument, createDocument, serializeDocument, getDocumentText, getBlocks, getImages, getCanvases, getDocumentCanvasConnectorRoute, TestEditorView } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-document-ui-tests.js').toString('base64')}`);
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

test('insert gallery creates editable bent arrows through the component and opens shape formatting', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Shape demo'), onSave() {} });
  await change(() => tab(renderer, '挿入').props.onClick());
  const gallery = renderer.root.findByProps({ 'aria-label': '図形の種類' });
  const bend = gallery.findAllByType('button').find(node => node.props['aria-label'].includes('カギ') && !node.props['aria-label'].includes('上'));
  assert.ok(bend, 'bent arrow is named and visible in insert gallery');
  await change(() => bend.props.onClick({ currentTarget: { closest: () => ({ removeAttribute() {} }) } }));
  const shape = ref.current.getDocument().content.content.find(node => node.type === 'shape'); assert.ok(shape);
  const format = renderer.root.findAllByType('button').find(node => node.props.children === '図形の書式'); assert.ok(format);
  await change(() => format.props.onClick());
  assert.ok(renderer.root.findByProps({ role: 'dialog' }));
  const controls = renderer.root.findAllByType('input');
  for (const name of ['width', 'height', 'rotation', 'fill', 'stroke', 'flipH', 'flipV']) assert.ok(controls.some(node => node.props.name === name), name);
  const form = renderer.root.findByType('form');
  const FormDataOriginal = globalThis.FormData;
  globalThis.FormData = class { get(key) { return ({ text: '承認へ', width: '260', height: '140', rotation: '0', strokeWidth: '2', fill: '#eeeeff', stroke: '#112233', color: '#123456', fontSize: '14' })[key] ?? null; } };
  try { await change(() => form.props.onSubmit({ preventDefault() {}, currentTarget: {} })); }
  finally { globalThis.FormData = FormDataOriginal; }
  const updated = ref.current.getDocument().content.content.find(node => node.type === 'shape'); assert.equal(updated.attrs.text, '承認へ'); assert.equal(updated.attrs.width, 260);
  await change(() => ref.current.undo()); assert.equal(ref.current.getDocument().content.content.find(node => node.type === 'shape').attrs.text, '');
});

test('shape formatting dialog disables unavailable controls and submits only enabled fields', async t => {
  for (const feature of ['text', 'formatting']) {
    const initial = createDocument({ content: { type: 'doc', content: [{ type: 'shape', attrs: { preset: 'bentArrow', text: 'Keep' } }] } });
    const { renderer, ref } = await mount(t, { initialDocument: initial, onSave() {}, features: { [feature]: false } });
    await change(() => ref.current.select({ from: 0, to: 1 }));
    await change(() => renderer.root.findAllByType('button').find(node => node.props.children === '図形の書式').props.onClick());
    assert.equal(renderer.root.findByType('textarea').props.disabled, feature === 'text');
    for (const input of renderer.root.findAllByType('input').filter(node => node.props.name)) assert.equal(input.props.disabled, feature === 'formatting');
    const Original = globalThis.FormData;
    globalThis.FormData = class { get(key) { return ({ text: 'New text', width: '240', height: '140', rotation: '0', strokeWidth: '1.5', fill: '#dbeafe', stroke: '#2563eb', color: '#172554', fontSize: '14' })[key] ?? null; } };
    try { await change(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {}, currentTarget: {} })); }
    finally { globalThis.FormData = Original; }
    const shape = ref.current.getDocument().content.content[0]; assert.equal(shape.attrs.text, feature === 'text' ? 'Keep' : 'New text');
  }
});


test('canvas GUI adds and connects shapes, follows drag movement and deletes selected elements with undo', async t => {
  const { renderer, ref } = await mount(t, { initialDocument: body('Canvas demo'), onSave() {} });
  await change(() => tab(renderer, '挿入').props.onClick());
  await change(() => button(renderer, '描画キャンバスを挿入').props.onClick());
  await change(() => button(renderer, '描画キャンバスを編集').props.onClick());
  const action = label => renderer.root.findAllByType('button').find(node => node.props.children === label);
  const canvas = () => getCanvases(ref.current.getDocument())[0].node.attrs;
  await change(() => action('図形を追加').props.onClick());
  await change(() => button(renderer, 'キャンバス図形のテキスト').props.onChange({ target: { value: '受注登録' } }));
  await change(() => action('図形を追加').props.onClick()); assert.equal(canvas().shapes.length, 2);
  await change(() => action('直交コネクタを追加').props.onClick()); assert.equal(canvas().connectors.length, 1);
  const secondId = canvas().shapes[1].id;
  assert.equal(canvas().connectors[0].end.binding.targetId, secondId);
  const drawing = () => button(renderer, 'キャンバス内の図形と接続線');
  const shapeGroup = drawing().findAllByType('g').find(node => node.props.transform && node.props['aria-label'] !== '図形 受注登録');
  const svg = { setPointerCapture() {}, createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x / 2, y: this.y / 2 }; } }; }, getScreenCTM() { return { inverse() { return {}; } }; } };
  await change(() => shapeGroup.props.onPointerDown({ currentTarget: { ownerSVGElement: svg, focus() {} }, pointerId: 2, button: 0, clientX: 420, clientY: 60, preventDefault() {} }));
  await change(() => drawing().props.onPointerMove({ currentTarget: svg, pointerId: 2, clientX: 520, clientY: 220 }));
  assert.equal(canvas().shapes[1].x, 210, 'preview does not write until pointer-up');
  await change(() => drawing().props.onPointerUp({ currentTarget: svg, pointerId: 2, clientX: 520, clientY: 220 }));
  assert.equal(canvas().shapes[1].x, 260); assert.equal(canvas().shapes[1].y, 110);
  const route = getDocumentCanvasConnectorRoute(canvas(), canvas().connectors[0]); assert.equal(route.points.at(-1).x, 260); assert.equal(route.points.at(-1).y, 150);
  await change(() => drawing().props.onKeyDown({ key: 'Delete', preventDefault() {}, stopPropagation() {} }));
  assert.equal(canvas().shapes.length, 1); assert.equal(canvas().connectors[0].end.binding, undefined);
  await change(() => ref.current.undo()); assert.equal(canvas().shapes.length, 2); assert.equal(canvas().connectors[0].end.binding.targetId, secondId);
  const line = drawing().findAllByType('g').find(node => node.props['aria-label']?.startsWith('接続線 '));
  await change(() => line.props.onClick());
  await change(() => drawing().props.onKeyDown({ key: 'Backspace', preventDefault() {}, stopPropagation() {} })); assert.equal(canvas().connectors.length, 0);
});

test('canvas component permissions and feature flags cover GUI and ref changes', async t => {
  const original = createDocument({ content: { type: 'doc', content: [{ type: 'drawing_canvas', attrs: { shapes: [{ id: 'one', preset: 'rect', x: 0, y: 0 }] } }] } });
  for (const props of [{ readOnly: true }, { onEditRequest: () => false }, { features: { formatting: false, text: false } }]) {
    const { renderer, ref } = await mount(t, { initialDocument: original, onSave() {}, ...props });
    const snapshot = serializeDocument(ref.current.getDocument()), id = getCanvases(ref.current.getDocument())[0].id;
    await change(() => ref.current.select({ from: 0, to: 1 }));
    await change(() => button(renderer, '描画キャンバスを編集').props.onClick());
    const drawing = button(renderer, 'キャンバス内の図形と接続線');
    await change(() => drawing.findAllByType('g').find(node => node.props.transform).props.onClick());
    if (props.readOnly || props.features) {
      assert.equal(button(renderer, 'キャンバス図形のテキスト').props.disabled, true);
      assert.equal(button(renderer, 'キャンバス図形 x').props.disabled, true);
    }
    await change(async () => { assert.equal(await ref.current.execute({ type: 'canvas.shape.update', canvasId: id, id: 'one', patch: { x: 80 } }), null); });
    assert.equal(serializeDocument(ref.current.getDocument()), snapshot);
  }
});
