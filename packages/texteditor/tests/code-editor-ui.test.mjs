import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const actualView = JSON.stringify(new URL(import.meta.resolve('@codemirror/view')).pathname);
const mockView = `export * from ${actualView}; import * as real from ${actualView};
export class EditorView {
  static instances=[];
  constructor({parent,state}){this.state=state;this.dom=parent;this.root={activeElement:null};this.win=globalThis;EditorView.instances.push(this);this.dispatch=this.dispatch.bind(this)}
  dispatch(spec){const startState=this.state,tr=startState.update(spec);this.state=tr.state;
    const update={view:this,startState,state:this.state,docChanged:tr.docChanged,selectionSet:!!tr.selection,transactions:[tr]};
    for(const listener of this.state.facet(real.EditorView.updateListener))listener(update);}
  plugin(){return null} focus(){this.focused=true} destroy(){this.destroyed=true}
}
for(const key of Reflect.ownKeys(real.EditorView))if(!['name','length','prototype'].includes(key))Object.defineProperty(EditorView,key,Object.getOwnPropertyDescriptor(real.EditorView,key));`;
const output = await build({ stdin: { contents: `export {CodeEditor} from './src/ui/code-editor'; export {EditorView as TestView, keymap} from '@codemirror/view';
  export { ensureSyntaxTree } from '@codemirror/language';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'ui', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^@codemirror\/view$/ }, () => ({ path: 'view', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mockView, loader: 'js', resolveDir: new URL('../', import.meta.url).pathname }));
} }] });
const { CodeEditor, TestView, keymap, ensureSyntaxTree } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-code-editor-ui.test.js').toString('base64')}`);
async function mount(t, options = {}) {
  const ref = createRef(), changes = [], props = { value: 'alpha alpha', editable: true, wordWrap: false, onChange: async text => { changes.push(text); return true; }, onUndo() {}, onRedo() {}, ...options, ref };
  let renderer;
  await act(() => { renderer = create(h(CodeEditor, props), { createNodeMock: node => node.type === 'div' ? { ownerDocument: {} } : null }); });
  t.after(() => act(() => renderer.unmount()));
  return { ref, renderer, props, changes, view: TestView.instances.at(-1), async update(patch) { Object.assign(props, patch); await act(() => renderer.update(h(CodeEditor, props))); } };
}

test('source search reports query and panels while policy updates close and block the same controls', async t => {
  const searches = [], panels = [], editor = await mount(t, { onSearchChange: state => searches.push(state), onPanelsChange: state => panels.push(state) });
  await act(() => assert.equal(editor.ref.current.setSearch({ query: 'alpha', caseSensitive: true }), true));
  assert.equal(searches.at(-1).query, 'alpha');
  assert.equal(searches.at(-1).caseSensitive, true);
  assert.deepEqual(editor.ref.current.getOpenPanels(), ['search']);
  assert.deepEqual(panels.at(-1), ['search']);
  await act(() => assert.equal(editor.ref.current.closePanel('search'), true));
  assert.deepEqual(editor.ref.current.getOpenPanels(), []);
  assert.equal(searches.at(-1).query, 'alpha', 'closing retains the condition');
  await act(() => editor.ref.current.runCommand('find'));
  await editor.update({ searchEnabled: false });
  assert.deepEqual(editor.ref.current.getOpenPanels(), []);
  assert.equal(editor.ref.current.runCommand('find'), false);
  assert.equal(editor.ref.current.setSearch({ query: 'changed' }), false);
  const binding = editor.view.state.facet(keymap).flat().find(item => item.key === 'Mod-f');
  assert.equal(binding.preventDefault, true);
  assert.equal(binding.run(editor.view), false, 'keyboard respects the latest feature policy');
});

test('go-to-line panel is available to the public close and status API', async t => {
  const panels = [], editor = await mount(t, { onPanelsChange: state => panels.push(state) });
  await act(() => assert.equal(editor.ref.current.runCommand('goToLine'), true));
  assert.deepEqual(editor.ref.current.getOpenPanels(), ['goToLine']);
  assert.deepEqual(panels.at(-1), ['goToLine']);
  await act(() => assert.equal(editor.ref.current.closePanel('goToLine'), true));
  assert.deepEqual(editor.ref.current.getOpenPanels(), []);
  assert.deepEqual(panels.at(-1), []);
  assert.equal(editor.ref.current.closePanel('goToLine'), false);
});

test('pending source input remains visible to the host until accepted or replaced externally', async t => {
  const pending = [], states = [], editor = await mount(t, { onPendingChange: value => states.push(value), onChange: () => new Promise(resolve => pending.push(resolve)) });
  await act(() => editor.view.dispatch({ changes: { from: 0, insert: 'X' } }));
  assert.deepEqual(states, [true]);
  await editor.update({ value: 'replacement' });
  assert.deepEqual(states, [true, false]);
  await act(() => pending.shift()(false));
  assert.equal(editor.view.state.sliceDoc(), 'replacement');
  await act(() => editor.view.dispatch({ changes: { from: 0, insert: 'Y' } }));
  await act(() => editor.renderer.unmount());
  assert.deepEqual(states, [true, false, true, false]);
  await act(() => pending.shift()(true));
  assert.deepEqual(states, [true, false, true, false]);
});

test('changing syntax mode preserves the mounted view, exact source, multiple selections and search', async t => {
  const source = '{\r\n  "name": "日本", "count": 42\r\n}\r\n';
  const editor = await mount(t, { value: source, mode: 'json', editable: false });
  const view = editor.view, count = TestView.instances.length;
  assert.match(ensureSyntaxTree(view.state, view.state.doc.length, 1000).toString(), /PropertyName/);
  const selection = { coordinateSpace: 'source', ranges: [{ anchor: 7, head: 11 }, { anchor: 20, head: 20 }], mainIndex: 1 };
  await act(() => editor.ref.current.setSelection(selection));
  await act(() => editor.ref.current.setSearch({ query: 'name', caseSensitive: true }));
  const originalSearch = editor.ref.current.getSearch();
  for (const mode of ['xml', 'yaml', 'markdown', 'text', 'json']) {
    await editor.update({ mode });
    assert.equal(TestView.instances.length, count, 'language changes must not create a new editor');
    assert.equal(TestView.instances.at(-1), view);
    assert.equal(view.state.sliceDoc(), source);
    assert.deepEqual(editor.ref.current.getSelection(), selection);
    assert.deepEqual(editor.ref.current.getSearch(), originalSearch);
  }
  await act(() => view.dispatch({ changes: { from: 0, insert: 'blocked' } }));
  assert.equal(view.state.sliceDoc(), source, 'read-only remains enforced after language reconfiguration');
  assert.deepEqual(editor.changes, [], 'syntax changes must not create text edits or dirty the document');
});
