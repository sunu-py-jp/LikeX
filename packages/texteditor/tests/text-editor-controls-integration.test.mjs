import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const actualCode = JSON.stringify(new URL(import.meta.resolve('@codemirror/view')).pathname);
const actualRich = JSON.stringify(new URL(import.meta.resolve('prosemirror-view')).pathname);
const codeMock = `export * from ${actualCode}; import * as real from ${actualCode};
export class EditorView {
  static instances=[];
  constructor({parent,state}){this.state=state;this.dom=parent;this.root={activeElement:null};this.win=globalThis;EditorView.instances.push(this);this.dispatch=this.dispatch.bind(this)}
  dispatch(spec){const startState=this.state,tr=startState.update(spec);this.state=tr.state;
    const update={view:this,startState,state:this.state,docChanged:tr.docChanged,selectionSet:!!tr.selection,transactions:[tr]};
    for(const listener of this.state.facet(real.EditorView.updateListener))listener(update);}
  plugin(){return null} focus(){this.focused=true} destroy(){this.destroyed=true}
}
for(const key of Reflect.ownKeys(real.EditorView))if(!['name','length','prototype'].includes(key))Object.defineProperty(EditorView,key,Object.getOwnPropertyDescriptor(real.EditorView,key));`;
const richMock = `export {Decoration,DecorationSet} from ${actualRich};
export class EditorView {
  static instances=[];
  constructor(place,props){this.state=props.state;this.props=props;this.dom=place;EditorView.instances.push(this);this.dispatch=this.dispatch.bind(this)}
  dispatch(tr){this.props.dispatchTransaction(tr)} updateState(state){this.state=state} setProps(props){this.props={...this.props,...props}}
  coordsAtPos(pos){return {left:30,right:30,top:pos*2,bottom:pos*2+20}} posAtDOM(){return 2} focus(){this.focused=true;this.props.handleDOMEvents?.focus?.(this)} destroy(){this.destroyed=true}
}`;
const output = await build({ stdin: { contents: `export {TextEditorView} from './src/ui/text-editor-view'; export {EditorView as CodeView, keymap} from '@codemirror/view'; export {EditorView as RichView} from 'prosemirror-view';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'ui', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^@likex\/core$/ }, () => ({ path: new URL('../../core/src/index.ts', import.meta.url).pathname }));
  builder.onResolve({ filter: /^@codemirror\/view$/ }, () => ({ path: 'code', namespace: 'mock' }));
  builder.onResolve({ filter: /^prosemirror-view$/ }, () => ({ path: 'rich', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: path === 'code' ? codeMock : richMock, loader: 'js', resolveDir: new URL('../', import.meta.url).pathname }));
} }] });
const { TextEditorView, CodeView, RichView } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-text-editor-controls-integration.test.js').toString('base64')}`);
async function mount(t, options = {}) {
  const ref = createRef(), props = { initialText: 'alpha alpha', mode: 'markdown', initialViewMode: 'source', onSave() {}, ...options };
  let renderer;
  const node = { ownerDocument: {}, focus() {}, contains() { return false; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800 }), scrollTop: 0, querySelector: () => null };
  await act(() => { renderer = create(h(TextEditorView, { ...props, ref }), { createNodeMock: () => node }); });
  t.after(() => act(() => renderer.unmount()));
  return { ref, renderer, props, get code() { return CodeView.instances.at(-1); },
    async update(patch) { Object.assign(props, patch); await act(() => renderer.update(h(TextEditorView, { ...props, ref }))); },
    async call(method, ...args) { let result; await act(() => { result = ref.current[method](...args); }); return await result; } };
}

test('actual source adapter retains search conditions across rich/source remounts', async t => {
  const editor = await mount(t);
  assert.equal(await editor.call('setSearch', { query: 'alpha', replacement: 'B', caseSensitive: true, wholeWord: true }), true);
  assert.equal(await editor.call('setViewMode', 'rich'), true);
  assert.equal(await editor.call('setViewMode', 'source'), true);
  assert.equal(editor.ref.current.getSearch().query, 'alpha');
  assert.equal(editor.ref.current.getSearch().replacement, 'B');
  assert.equal(editor.ref.current.getSearch().caseSensitive, true);
  assert.equal(editor.ref.current.getSearch().wholeWord, true);
  assert.equal(editor.ref.current.getSearch().open, true);
});

test('switching views cannot discard pending native input or remove its unsaved protection', async t => {
  let resolve;
  const unsaved = [], editor = await mount(t, { onEditRequest: () => new Promise(done => { resolve = done; }), onUnsavedChangesChange: value => unsaved.push(value) });
  await act(async () => { editor.code.dispatch({ changes: { from: 0, insert: 'X' } }); });
  assert.equal(editor.ref.current.getEditState(), 'requesting');
  assert.equal(editor.ref.current.getState().pendingInput, true);
  assert.equal(editor.ref.current.getState().hasUnsavedChanges, true);
  assert.equal(await editor.call('setViewMode', 'rich'), false);
  assert.equal(editor.ref.current.getState().viewMode, 'source');
  assert.equal(editor.ref.current.getState().hasUnsavedChanges, true);
  await act(async () => { resolve(false); });
  assert.equal(editor.ref.current.getState().hasUnsavedChanges, false);
  assert.deepEqual(unsaved, [false, true, false]);
  assert.equal(editor.ref.current.getText(), 'alpha alpha');
});

test('cancelEditRequest clears native queued input and ignores a late permission grant', async t => {
  let resolve;
  const editor = await mount(t, { onEditRequest: () => new Promise(done => { resolve = done; }) });
  await act(async () => { editor.code.dispatch({ changes: { from: 0, insert: 'X' } }); });
  assert.equal(editor.ref.current.getState().pendingInput, true);
  await editor.call('cancelEditRequest');
  assert.equal(editor.ref.current.getState().pendingInput, false);
  assert.equal(editor.code.state.sliceDoc(), 'alpha alpha');
  await act(async () => { resolve(true); });
  assert.equal(editor.ref.current.getText(), 'alpha alpha');
  assert.equal(editor.code.state.sliceDoc(), 'alpha alpha');
});

test('dirty replacement guard sees actual pending source input before permission completes', async t => {
  let resolve;
  const editor = await mount(t, { onEditRequest: () => new Promise(done => { resolve = done; }) });
  await act(async () => { editor.code.dispatch({ changes: { from: 0, insert: 'X' } }); });
  const document = editor.ref.current.getDocument();
  assert.equal(await editor.call('replace', { ...document, text: 'replacement' }), null);
  assert.equal(editor.ref.current.getState().pendingInput, true);
  await act(async () => { resolve(true); });
  assert.equal(editor.ref.current.getText(), 'Xalpha alpha');
  assert.equal(editor.ref.current.getState().pendingInput, false);
});

test('read-only and editing policy changes clear pending native input without waiting for host response', async t => {
  for (const options of [{ readOnly: true }, { features: { editing: false } }]) {
    let reject;
    const editor = await mount(t, { onEditRequest: () => new Promise((_resolve, no) => { reject = no; }) });
    await act(async () => { editor.code.dispatch({ changes: { from: 0, insert: 'X' } }); });
    assert.equal(editor.ref.current.getState().pendingInput, true);
    await editor.update(options);
    await act(async () => { await Promise.resolve(); });
    assert.equal(editor.ref.current.getState().pendingInput, false);
    assert.equal(editor.ref.current.getState().hasUnsavedChanges, false);
    assert.equal(editor.code.state.sliceDoc(), 'alpha alpha');
    await act(async () => { reject(new Error('late failure')); });
    assert.equal(editor.ref.current.getText(), 'alpha alpha');
  }
});

test('host mode changes wait for pending rich input and then retain the accepted draft', async t => {
  let resolve;
  const editor = await mount(t, { initialViewMode: 'rich', onEditRequest: () => new Promise(done => { resolve = done; }) });
  const rich = RichView.instances.at(-1);
  await act(async () => { rich.dispatch(rich.state.tr.insertText('X', 1)); });
  assert.equal(editor.ref.current.getState().pendingInput, true);
  await editor.update({ mode: 'text' });
  assert.equal(editor.ref.current.getState().mode, 'markdown');
  assert.equal(editor.ref.current.getState().viewMode, 'rich');
  assert.equal(editor.ref.current.getState().hasUnsavedChanges, true);
  assert.equal(rich.destroyed, undefined, 'pending draft stays in its current adapter');
  await act(async () => { resolve(true); });
  assert.equal(editor.ref.current.getState().mode, 'text');
  assert.equal(editor.ref.current.getState().viewMode, 'source');
  assert.equal(editor.ref.current.getState().pendingInput, false);
  assert.equal(editor.ref.current.getText(), 'Xalpha alpha');
  assert.equal(editor.code.state.sliceDoc(), 'Xalpha alpha');
  assert.equal(editor.ref.current.getState().hasUnsavedChanges, true, 'the accepted unsaved draft remains protected');
});

test('actual formatted CodeMirror keeps cursor and incomplete input without reformatting each keystroke', async t => {
  const source = '{"value":1}', editor = await mount(t, { mode: 'json', initialText: source, initialViewMode: undefined, formatting: true });
  const view = editor.code, shown = view.state.sliceDoc();
  assert.equal(editor.ref.current.getState().viewMode, 'formatted');
  assert.equal(editor.ref.current.getText(), source);
  const at = shown.indexOf('1');
  await act(async () => { view.dispatch({ changes: { from: at, to: at + 1, insert: '22' }, selection: { anchor: at + 2 } }); });
  assert.equal(editor.code, view);
  assert.equal(view.state.sliceDoc(), shown.replace('1', '22'));
  assert.equal(editor.ref.current.getSelection().coordinateSpace, 'formatted');
  assert.equal(editor.ref.current.getSelection().ranges[0].head, at + 2);
  await act(async () => { view.dispatch({ changes: { from: at, to: at + 2, insert: '' }, selection: { anchor: at } }); });
  assert.equal(editor.code, view);
  assert.equal(editor.ref.current.getText(), shown.replace('1', ''));
  assert.equal(view.state.selection.main.head, at);
  assert.ok(editor.ref.current.getDiagnostics().length);
  await editor.call('undo');
  assert.equal(editor.ref.current.getText(), source);
  assert.equal(view.state.sliceDoc(), source);
  await editor.call('redo');
  assert.equal(view.state.sliceDoc(), shown.replace('1', ''));
});

test('formatted draft diagnostics use currently displayed coordinates while permission is pending', async t => {
  let decide;
  const source = '{"value":1}', editor = await mount(t, { mode: 'json', initialText: source, initialViewMode: undefined, formatting: true,
    onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  const view = editor.code, at = view.state.sliceDoc().indexOf('1');
  await act(async () => { view.dispatch({ changes: { from: at, to: at + 1, insert: '' } }); });
  assert.equal(editor.ref.current.getState().pendingInput, true);
  assert.equal(editor.ref.current.getText(), source);
  assert.ok(editor.ref.current.getDiagnostics().length);
  assert.equal(editor.ref.current.getDiagnostics()[0].line, 3);
  assert.equal(await editor.call('setViewMode', 'source'), false);
  await act(async () => { decide(false); });
  assert.equal(editor.ref.current.getText(), source);
  assert.equal(view.state.sliceDoc(), '{\n  "value": 1\n}');
  assert.deepEqual(editor.ref.current.getDiagnostics(), []);
});

test('indentation changes wait for a formatted pending edit then derive from its accepted text', async t => {
  let decide;
  const editor = await mount(t, { mode: 'json', initialText: '{"value":1}', initialViewMode: undefined, formatting: true,
    onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  const view = editor.code, at = view.state.sliceDoc().indexOf('1');
  await act(async () => { view.dispatch({ changes: { from: at, to: at + 1, insert: '2' } }); });
  await editor.update({ formatting: { indent: 4 } });
  assert.equal(editor.code, view);
  assert.equal(view.state.sliceDoc(), '{\n  "value": 2\n}');
  await act(async () => { decide(true); });
  assert.equal(editor.ref.current.getText(), '{\n  "value": 2\n}');
  assert.equal(view.state.sliceDoc(), '{\n    "value": 2\n}');
  assert.equal(editor.ref.current.getState().pendingInput, false);
  await editor.call('setViewMode', 'source');
  assert.equal(editor.code.state.sliceDoc(), '{\n  "value": 2\n}');
});

test('formatted cancellation, readonly and feature changes cannot apply a late draft', async t => {
  for (const options of [{ readOnly: true }, { features: { editing: false } }, { features: { formatting: false } }, null]) {
    let decide;
    const source = '{"value":1}', editor = await mount(t, { mode: 'json', initialText: source, initialViewMode: undefined, formatting: true,
      onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
    const at = editor.code.state.sliceDoc().indexOf('1');
    await act(async () => { editor.code.dispatch({ changes: { from: at, to: at + 1, insert: '2' } }); });
    if (options) await editor.update(options);
    else await editor.call('cancelPending');
    await act(async () => { decide(true); });
    assert.equal(editor.ref.current.getText(), source);
    assert.equal(editor.ref.current.getState().pendingInput, false);
    assert.equal(editor.ref.current.getState().dirty, false);
    assert.ok(!editor.code.state.sliceDoc().includes('2'));
  }
});

test('new document replacement cannot reuse a formatted projection or a retained input callback', async t => {
  const editor = await mount(t, { mode: 'json', initialText: '{"first":1}', initialViewMode: undefined, formatting: true });
  const before = editor.code;
  await editor.call('replace', { ...editor.ref.current.getDocument(), id: 'next-document', text: '{"second":2}' });
  assert.equal(before.destroyed, true);
  assert.equal(editor.code.state.sliceDoc(), '{\n  "second": 2\n}');
  assert.equal(editor.ref.current.getText(), '{"second":2}');
  assert.deepEqual(editor.ref.current.getDiagnostics(), []);
});

test('source and formatted typing use separate undo groups even when edits occur immediately after switching', async t => {
  const original = '{"value":1}', rawEdited = '{"value":2}';
  const editor = await mount(t, { mode: 'json', initialText: original, initialViewMode: 'source', formatting: true });
  const raw = editor.code, at = original.indexOf('1');
  await act(async () => { raw.dispatch({ changes: { from: at, to: at + 1, insert: '2' } }); });
  assert.equal(editor.ref.current.getText(), rawEdited);
  await editor.call('setViewMode', 'formatted');
  const formatted = editor.code, formattedAt = formatted.state.sliceDoc().indexOf('2');
  await act(async () => { formatted.dispatch({ changes: { from: formattedAt, to: formattedAt + 1, insert: '3' } }); });
  assert.equal(editor.ref.current.getText(), '{\n  "value": 3\n}');
  await editor.call('undo');
  assert.equal(editor.ref.current.getText(), rawEdited, 'the first undo retains the source edit preceding the view switch');
  await editor.call('undo');
  assert.equal(editor.ref.current.getText(), original);
});
