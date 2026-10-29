import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockView = `export {Decoration,DecorationSet} from ${JSON.stringify(new URL(import.meta.resolve('prosemirror-view')).pathname)};
export class EditorView {
  static instances=[];
  constructor(place,props){this.state=props.state;this.props=props;this.dom=place;EditorView.instances.push(this);this.dispatch=this.dispatch.bind(this)}
  dispatch(tr){this.props.dispatchTransaction(tr)} updateState(state){this.state=state} setProps(props){this.props={...this.props,...props}}
  coordsAtPos(pos){return {left:30,right:30,top:pos*2,bottom:pos*2+20}} posAtDOM(){return 2} focus(){this.focused=true;this.props.handleDOMEvents?.focus?.(this)} destroy(){this.destroyed=true}
}`;
const output = await build({ stdin: { contents: `export {MarkdownEditor} from './src/ui/markdown-editor'; export {EditorView as TestView} from 'prosemirror-view';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'ui', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^prosemirror-view$/ }, () => ({ path: 'view', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mockView, loader: 'js', resolveDir: new URL('../', import.meta.url).pathname }));
} }] });
const { MarkdownEditor, TestView } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-markdown-ui.test.js').toString('base64')}`);
async function mount(t, options = {}, nodeMock) {
  const ref = createRef(), changes = [], props = { value: 'Alpha beta', editable: true, onChange: async text => { changes.push(text); return true; }, onUndo() {}, onRedo() {}, ...options, ref };
  let renderer;
  await act(() => { renderer = create(h(MarkdownEditor, props), { createNodeMock: node => nodeMock?.(node) ?? (node.type === 'div' ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800 }), scrollTop: 0, querySelector: () => null } : null) }); });
  t.after(() => act(() => renderer.unmount()));
  return { ref, renderer, props, changes, view: TestView.instances.at(-1), async update(patch) { Object.assign(props, patch); await act(() => renderer.update(h(MarkdownEditor, props))); } };
}
const select = (ref, from, to = from) => ref.current.setSelection({ coordinateSpace: 'rich', ranges: [{ anchor: from, head: to }], mainIndex: 0 });
const hints = editor => editor.view.props.decorations(editor.view.state).find();

test('empty-paragraph hint appears only at the focused caret and never changes Markdown', async t => {
  const editor = await mount(t, { value: '' });
  assert.equal(editor.renderer.root.findAllByProps({ className: 'lxte-format-hint' }).length, 0);
  assert.deepEqual(hints(editor), [], 'an unfocused editor has no hint');
  await act(() => editor.ref.current.focus());
  let decorations = hints(editor);
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].from, 0);
  assert.equal(decorations[0].to, 2);
  assert.equal(decorations[0].type.attrs['data-placeholder'], '/ でブロックを追加');
  assert.equal(editor.view.state.doc.textContent, '');
  assert.deepEqual(editor.changes, [], 'focus and placeholder do not enter the change/history path');

  await act(() => editor.view.props.handleDOMEvents.blur(editor.view));
  assert.deepEqual(hints(editor), []);
  await act(() => editor.ref.current.focus());
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('hello', 1)));
  assert.deepEqual(hints(editor), [], 'typing removes the hint immediately');
  assert.deepEqual(editor.changes, ['hello']);
});

test('hint follows empty paragraphs but not range selections, headings, code, or readonly state', async t => {
  const editor = await mount(t, { value: '' });
  const schema = editor.view.state.schema;
  await act(() => editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, [
    schema.nodes.paragraph.create(), schema.nodes.paragraph.create(null, schema.text('hello')), schema.nodes.paragraph.create(),
  ])));
  await act(() => editor.ref.current.focus());
  const count = editor.changes.length;
  await act(() => select(editor.ref, 1));
  assert.equal(hints(editor)[0].from, 0);
  await act(() => select(editor.ref, 10));
  assert.equal(hints(editor)[0].from, 9);
  await act(() => select(editor.ref, 1, 10));
  assert.deepEqual(hints(editor), []);
  await act(() => select(editor.ref, 4));
  assert.deepEqual(hints(editor), []);
  await act(() => select(editor.ref, 1));
  assert.equal(editor.changes.length, count, 'moving between paragraphs does not change the source');

  await editor.update({ editable: false });
  assert.deepEqual(hints(editor), []);
  await editor.update({ editable: true, formatting: false });
  assert.deepEqual(hints(editor), []);
  await editor.update({ formatting: true });
  assert.equal(hints(editor).length, 1);
  await act(() => editor.ref.current.runCommand('markdown.heading1'));
  assert.deepEqual(hints(editor), []);
  await act(() => editor.ref.current.runCommand('markdown.codeBlock'));
  assert.deepEqual(hints(editor), []);
});

test('mount and view-only selection preserve exact Markdown without notifying a change', async t => {
  const editor = await mount(t, { value: '##  Heading\n\n* a\n' });
  await act(() => select(editor.ref, 1, 4));
  assert.deepEqual(editor.changes, []);
  assert.equal(editor.ref.current.getSelection().coordinateSpace, 'rich');
  assert.equal(editor.view.state.doc.firstChild.type.name, 'heading');
});

test('toolbar and public adapter apply the same rich formatting; undo goes to the host', async t => {
  let undone = 0;
  const editor = await mount(t, { onUndo: () => undone++ });
  await act(() => select(editor.ref, 1, 6));
  await act(() => editor.ref.current.runCommand('markdown.bold'));
  assert.equal(editor.changes.at(-1), '**Alpha** beta');
  await act(() => editor.ref.current.runCommand('undo'));
  assert.equal(undone, 1);
  await act(() => editor.ref.current.runCommand('selectAll'));
  assert.equal(editor.view.state.selection.from, 0);
  assert.equal(editor.view.state.selection.to, editor.view.state.doc.content.size);
});

test('readonly and formatting policy cannot be bypassed by the rich adapter', async t => {
  const editor = await mount(t, { editable: false });
  await act(() => select(editor.ref, 1, 6));
  assert.equal(editor.view.props.editable(), false);
  assert.equal(editor.ref.current.runCommand('markdown.bold'), false);
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('X')));
  assert.deepEqual(editor.changes, []);
  await editor.update({ editable: true, formatting: false });
  assert.equal(editor.ref.current.runCommand('markdown.bold'), false);
  assert.equal(editor.renderer.root.findAllByProps({ 'aria-label': 'Markdownの書式' }).length, 0);
});

test('rejected asynchronous changes restore the authoritative source', async t => {
  const editor = await mount(t, { onChange: async () => false });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('X', 1)));
  assert.equal(editor.view.state.doc.textContent, 'Alpha beta');
});

test('acknowledged edits can be undone externally even when the source was previously submitted', async t => {
  const editor = await mount(t, { value: 'One' });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('!', 4)));
  await editor.update({ value: 'One!' });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('?', 5)));
  await editor.update({ value: 'One!?' });
  await editor.update({ value: 'One!' });
  assert.equal(editor.view.state.doc.textContent, 'One!');
});

test('unsupported HTML and tables retain source and request the source editor', async t => {
  let switched = 0;
  const editor = await mount(t, { value: '<div>Keep this</div>', onSourceMode: () => switched++ });
  assert.equal(editor.view.props.editable(), false);
  assert.deepEqual(editor.changes, []);
  const sourceButton = editor.renderer.root.findAllByType('button').find(button => button.props.onClick === editor.props.onSourceMode);
  await act(() => sourceButton.props.onClick());
  assert.equal(switched, 1);
  await editor.update({ value: '| A | B |\n| --- | --- |\n| 1 | 2 |' });
  assert.equal(editor.view.props.editable(), false);
  assert.deepEqual(editor.changes, []);
});

test('slash menu supports keyboard navigation and inserts a heading in one change', async t => {
  const editor = await mount(t, { value: '' });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('/h1', 1)));
  assert.equal(editor.renderer.root.findAllByProps({ role: 'listbox' }).length, 1);
  await act(() => editor.view.props.handleKeyDown(editor.view, { key: 'Enter' }));
  assert.equal(editor.view.state.doc.firstChild.type.name, 'heading');
  assert.equal(editor.view.state.doc.firstChild.attrs.level, 1);
  assert.equal(editor.view.state.doc.textContent, '');
  assert.equal(editor.renderer.root.findAllByProps({ role: 'listbox' }).length, 0);
});

test('rapid rich edits queue behind one asynchronous change instead of dropping text', async t => {
  let release;
  const changes = [], gate = new Promise(resolve => { release = resolve; });
  const editor = await mount(t, { value: 'A', onChange: async text => { changes.push(text); return changes.length === 1 ? gate : true; } });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('B', 2)));
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('C', 3)));
  assert.deepEqual(changes, ['AB']);
  await editor.update({ value: 'AB' });
  assert.equal(editor.view.state.doc.textContent, 'ABC');
  await act(() => release(true));
  assert.deepEqual(changes, ['AB', 'ABC']);
  assert.equal(editor.view.state.doc.textContent, 'ABC');
});

test('a stale rejected change cannot overwrite an externally replaced document', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const editor = await mount(t, { value: 'A', onChange: () => gate });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('B', 2)));
  await editor.update({ value: 'Replacement' });
  await act(() => release(false));
  assert.equal(editor.view.state.doc.textContent, 'Replacement');
});

test('task checkbox clicks update Markdown and selection observer exceptions cannot discard edits', async t => {
  const editor = await mount(t, { value: '- [ ] Pending', onSelectionChange: () => { throw new Error('observer'); } });
  const checkbox = { closest: () => ({}) };
  await act(() => editor.view.props.handleClick(editor.view, 2, { target: { closest: selector => selector === '.lxte-task-checkbox' ? checkbox : null } }));
  assert.match(editor.changes.at(-1), /\[x\] Pending/);
  await editor.update({ editable: false });
  const before = editor.changes.length;
  await act(() => editor.view.props.handleClick(editor.view, 2, { target: { closest: () => checkbox } }));
  assert.equal(editor.changes.length, before);
});

test('slash menu survives scroll and returns after transient edit-permission processing', async t => {
  const editor = await mount(t, { value: '' });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('/', 1)));
  const scroller = editor.renderer.root.findByProps({ className: 'lxte-rich-scroll' });
  await act(() => scroller.props.onScroll?.({ currentTarget: { scrollTop: 100 } }));
  assert.equal(editor.renderer.root.findAllByProps({ role: 'listbox' }).length, 1);
  await editor.update({ editable: false });
  await act(() => select(editor.ref, 2));
  await editor.update({ editable: true });
  assert.equal(editor.renderer.root.findAllByProps({ role: 'listbox' }).length, 1);
  await act(() => editor.view.props.handleKeyDown(editor.view, { key: 'ArrowDown' }));
  await act(() => editor.view.props.handleKeyDown(editor.view, { key: 'Enter' }));
  assert.equal(editor.view.state.doc.firstChild.type.name, 'heading');
});

test('slash arrow keys are captured without moving the document selection or scrolling its ancestors', async t => {
  const selected = { offsetTop: 37, offsetHeight: 48 };
  const list = { scrollTop: 0, clientHeight: 180, querySelector: () => selected };
  const scroller = { scrollTop: 420, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }) };
  const editor = await mount(t, { value: '' }, node => node.props.role === 'listbox' ? list : node.props.className === 'lxte-rich-scroll' ? scroller : null);
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('/', 1)));
  const before = editor.view.state, changes = editor.changes.length;
  const root = editor.renderer.root.findByProps({ className: 'lxte-markdown-editor' });
  let prevented = 0, stopped = 0;
  const press = key => root.props.onKeyDownCapture({ target: { closest: () => ({}) }, nativeEvent: { key }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  for (let i = 0; i < 7; i++) {
    selected.offsetTop += 48;
    await act(() => press('ArrowDown'));
  }
  assert.equal(prevented, 7);
  assert.equal(stopped, 7);
  assert.equal(editor.view.state, before);
  assert.equal(editor.changes.length, changes);
  assert.equal(scroller.scrollTop, 420);
  assert.equal(list.scrollTop, selected.offsetTop + selected.offsetHeight - list.clientHeight);
  assert.equal(editor.renderer.root.findByProps({ role: 'option', 'aria-selected': true }).props.children[1].props.children[0].props.children, '引用');
  selected.offsetTop = 37;
  for (let i = 0; i < 7; i++) await act(() => press('ArrowUp'));
  assert.equal(list.scrollTop, 37);
  assert.equal(scroller.scrollTop, 420);
  const beforeToolbar = prevented;
  await act(() => root.props.onKeyDownCapture({ target: { closest: () => null }, nativeEvent: { key: 'ArrowDown' }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } }));
  assert.equal(prevented, beforeToolbar, 'toolbar selects and link fields retain their native keys');
  await act(() => press('Escape'));
  const count = prevented;
  await act(() => press('ArrowDown'));
  assert.equal(prevented, count, 'normal cursor keys are untouched after menu closes');
});

test('slash navigation does not consume IME composition keys', async t => {
  const editor = await mount(t, { value: '' });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('/', 1)));
  let prevented = false;
  const root = editor.renderer.root.findByProps({ className: 'lxte-markdown-editor' });
  await act(() => root.props.onKeyDownCapture({ target: { closest: () => ({}) }, nativeEvent: { key: 'ArrowDown', isComposing: true }, preventDefault() { prevented = true; }, stopPropagation() {} }));
  assert.equal(prevented, false);
  assert.equal(editor.view.props.handleKeyDown(editor.view, { key: 'Enter', isComposing: true }), false);
  assert.equal(editor.renderer.root.findAllByProps({ role: 'listbox' }).length, 1);
});

test('slash menu height fits the editor viewport above or below the caret without ancestor scrolling', async t => {
  const scroller = { scrollTop: 420, getBoundingClientRect: () => ({ left: 0, top: 100, width: 800, height: 280 }) };
  const editor = await mount(t, { value: '' }, node => node.props.className === 'lxte-rich-scroll' ? scroller : null);
  editor.view.coordsAtPos = () => ({ left: 30, right: 30, top: 350, bottom: 370 });
  await act(() => editor.view.dispatch(editor.view.state.tr.insertText('/', 1)));
  let style = editor.renderer.root.findByProps({ role: 'listbox' }).props.style;
  assert.equal(style.top - scroller.scrollTop, 8);
  assert.equal(style.maxHeight, 236);
  assert.ok(style.top - scroller.scrollTop + style.maxHeight <= 272);
  assert.equal(scroller.scrollTop, 420);

  editor.view.coordsAtPos = () => ({ left: 30, right: 30, top: 110, bottom: 130 });
  await act(() => select(editor.ref, 2));
  style = editor.renderer.root.findByProps({ role: 'listbox' }).props.style;
  assert.equal(style.top - scroller.scrollTop, 36);
  assert.equal(style.maxHeight, 236);
  assert.equal(style.top - scroller.scrollTop + style.maxHeight, 272);
  assert.equal(scroller.scrollTop, 420);
});
