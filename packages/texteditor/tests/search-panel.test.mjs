import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export {CompactSearchPanel, openCompactReplacePanel, summarizeSearchMatches, searchMatchOrdinal, setCodeEditorSearch, getCodeEditorSearch, textEditorSearchPolicy} from './src/ui/search-panel';
  export {runCodeEditorAction} from './src/ui/code-editor';
  export {EditorState, EditorSelection, Compartment} from '@codemirror/state';
  export {SearchQuery, getSearchQuery, setSearchQuery, search, openSearchPanel, closeSearchPanel} from '@codemirror/search';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { CompactSearchPanel, openCompactReplacePanel, summarizeSearchMatches, searchMatchOrdinal, setCodeEditorSearch, getCodeEditorSearch, textEditorSearchPolicy, runCodeEditorAction, EditorState, EditorSelection, Compartment, SearchQuery, getSearchQuery, setSearchQuery, search, openSearchPanel, closeSearchPanel } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

class Element {
  constructor(document, name) { this.ownerDocument = document; this.tagName = name; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.selected = true; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  emit(type, options = {}) { const event = { target: this, key: '', altKey: false, shiftKey: false, isComposing: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...options }; for (const listener of this.listeners.get(type) ?? []) listener(event); return event; }
  click() { if (!this.disabled) this.emit('click'); }
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
function editor(text = 'alpha ALPHA alphabet\nalpha', readOnly = false) {
  const document = { activeElement: null, createElement(name) { return new Element(this, name); }, createElementNS(_ns, name) { return new Element(this, name); } };
  const permission = new Compartment(), policy = new Compartment();
  const view = { dom: document.createElement('div'), root: document, focused: false, plugin() { return null; }, focus() { this.focused = true; document.activeElement = this.dom; },
    state: EditorState.create({ doc: text, extensions: [search(), EditorState.allowMultipleSelections.of(true), permission.of(EditorState.readOnly.of(readOnly)), policy.of(textEditorSearchPolicy.of({}))] }),
    dispatch(spec) { const startState = view.state, transaction = startState.update(spec); view.state = transaction.state; ui.panel?.update({ startState, state: view.state, docChanged: transaction.docChanged, selectionSet: !!transaction.selection, transactions: [transaction] }); },
  };
  const ui = { view, document, panel: null, node(label) { const node = all(this.panel.dom).find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; },
    input(value, name = '検索', options = {}) { const input = this.node(name); input.value = value; input.emit('input', options); },
    key(key, options = {}, target = this.node('検索')) { return this.panel.dom.emit('keydown', { key, target, ...options }); },
    readonly(value) { view.dispatch({ effects: permission.reconfigure(EditorState.readOnly.of(value)) }); },
    policy(value) { view.dispatch({ effects: policy.reconfigure(textEditorSearchPolicy.of(value)) }); },
    count() { return all(this.panel.dom).find(node => node.className === 'lxte-search-count').textContent; },
    row() { return all(this.panel.dom).find(node => node.className === 'lxte-replace-row'); },
  };
  openSearchPanel(view); ui.panel = new CompactSearchPanel(view); ui.panel.mount(); return ui;
}

test('find starts collapsed and toggles expose explicit pressed states without losing input', () => {
  const ui = editor();
  assert.equal(ui.row().hidden, true);
  assert.equal(ui.document.activeElement, ui.node('検索'));
  ui.input('alpha'); assert.equal(ui.count(), '4件');
  ui.node('大文字小文字を区別').click();
  assert.equal(ui.count(), '3件'); assert.equal(ui.node('大文字小文字を区別').getAttribute('aria-pressed'), 'true');
  ui.node('単語単位で検索').click(); assert.equal(ui.count(), '2件');
  assert.equal(ui.node('検索').value, 'alpha');
  ui.node('置換を表示').click(); assert.equal(ui.row().hidden, false); assert.equal(ui.document.activeElement, ui.node('置換'));
  ui.node('置換を閉じる').click(); assert.equal(ui.row().hidden, true);
});

test('Enter navigates with a current match number, Shift+Enter reverses and Alt+Enter selects all', () => {
  const ui = editor('alpha beta alpha\nalpha'); ui.input('alpha');
  assert.equal(ui.key('Enter').prevented, true); assert.equal(ui.count(), '1 / 3');
  ui.key('Enter'); assert.equal(ui.count(), '2 / 3');
  ui.key('Enter', { shiftKey: true }); assert.equal(ui.count(), '1 / 3');
  ui.key('Enter', { altKey: true }); assert.equal(ui.view.state.selection.ranges.length, 3);
  assert.equal(ui.view.focused, true, 'all-match selection returns focus for simultaneous editing');
  assert.equal(ui.key('Enter', {}, ui.node('正規表現')).prevented, false, 'button Enter keeps its native click behavior');
  ui.key('Escape'); assert.equal(ui.view.focused, true);
});

test('replace command expands and uses shared CodeMirror replacement transactions', () => {
  const ui = editor('alpha beta alpha');
  ui.input('alpha'); assert.equal(openCompactReplacePanel(ui.view), true); assert.equal(ui.row().hidden, false);
  ui.input('new', '置換');
  ui.key('Enter', {}, ui.node('検索'));
  const replaceButton = all(ui.panel.dom).find(node => node.tagName === 'button' && node.getAttribute('aria-label') === '置換');
  replaceButton.click(); assert.equal(ui.view.state.sliceDoc(), 'new beta alpha');
  ui.node('すべて置換').click(); assert.equal(ui.view.state.sliceDoc(), 'new beta new');
  assert.equal(ui.count(), '0件'); assert.equal(ui.node('すべて置換').disabled, true);
});

test('read-only changes cannot replace and retain existing search while allowing navigation', () => {
  const ui = editor('alpha alpha'); ui.input('alpha'); ui.node('置換を表示').click(); ui.input('X', '置換');
  ui.readonly(true);
  const before = ui.view.state.sliceDoc();
  ui.node('すべて置換').emit('click'); ui.key('Enter', {}, ui.node('置換'));
  assert.equal(ui.view.state.sliceDoc(), before);
  assert.equal(ui.node('すべて置換').disabled, true);
  assert.equal(openCompactReplacePanel(ui.view), false);
  ui.key('Enter'); assert.equal(ui.count(), '1 / 2');
  ui.node('置換を閉じる').click(); assert.equal(ui.row().hidden, true);
  ui.readonly(false); assert.equal(openCompactReplacePanel(ui.view), true);
  ui.node('すべて置換').click(); assert.equal(ui.view.state.sliceDoc(), 'X X');
});

test('invalid regular expressions are visible and disable operations; composing input waits for commit', () => {
  const ui = editor(); ui.input('alpha', '検索', { isComposing: true });
  assert.equal(getSearchQuery(ui.view.state).search, '');
  ui.node('検索').emit('compositionend'); assert.equal(getSearchQuery(ui.view.state).search, 'alpha');
  ui.node('正規表現').click(); ui.input('[');
  assert.equal(ui.node('検索').getAttribute('aria-invalid'), 'true');
  assert.equal(all(ui.panel.dom).find(node => node.className === 'lxte-search-error').hidden, false);
  assert.equal(ui.node('次の一致（Enter）').disabled, true);
  assert.equal(ui.key('Enter', { isComposing: true }).prevented, false);
  ui.input('alpha'); assert.equal(ui.node('検索').getAttribute('aria-invalid'), 'false');
});

test('query state survives closing and rebuilding the panel, including replacement and flags', () => {
  const ui = editor(); ui.input('alpha'); ui.node('大文字小文字を区別').click(); ui.node('置換を表示').click(); ui.input('next', '置換');
  closeSearchPanel(ui.view); ui.panel.destroy(); openSearchPanel(ui.view); ui.panel = new CompactSearchPanel(ui.view);
  assert.equal(ui.node('検索').value, 'alpha'); assert.equal(ui.node('置換').value, 'next');
  assert.equal(ui.node('大文字小文字を区別').getAttribute('aria-pressed'), 'true');
  assert.equal(ui.row().hidden, true);
});

test('selection and replacement-only updates reuse counts, document edits refresh them', () => {
  const ui = editor('a a a'); let tested = 0;
  const predicate = () => { tested++; return true; };
  ui.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'a', test: predicate })) });
  const afterCount = tested; assert.ok(afterCount >= 3);
  ui.view.dispatch({ selection: EditorSelection.cursor(1) }); assert.equal(tested, afterCount);
  ui.input('X', '置換'); assert.equal(tested, afterCount);
  ui.view.dispatch({ changes: { from: 0, to: 1, insert: 'b' } }); assert.ok(tested > afterCount); assert.equal(ui.count(), '2件');
});

test('counting stops at a bounded limit and ordinal lookup handles unmatched selections', () => {
  const state = EditorState.create({ doc: 'a '.repeat(10005) }), query = new SearchQuery({ search: 'a' });
  const summary = summarizeSearchMatches(state, query);
  assert.equal(summary.matches.length, 10000); assert.equal(summary.truncated, true);
  assert.equal(searchMatchOrdinal(summary.matches, 19998, 19999), 10000);
  assert.equal(searchMatchOrdinal(summary.matches, 20000, 20001), 0);
  assert.equal(searchMatchOrdinal(summary.matches, 4, 7), 0);
});

test('external search query drives the same panel, navigation, replacement and match selection', () => {
  const ui=editor('alpha ALPHA alphabet\nalpha');
  assert.equal(setCodeEditorSearch(ui.view,{query:'alpha',replacement:'X',caseSensitive:true,wholeWord:true},{replace:true}),true);
  assert.equal(ui.node('検索').value,'alpha'); assert.equal(ui.node('置換').value,'X'); assert.equal(ui.row().hidden,false);
  assert.equal(ui.count(),'2件');
  assert.deepEqual(getCodeEditorSearch(ui.view),{query:'alpha',replacement:'X',caseSensitive:true,wholeWord:true,regex:false,open:true,replace:true,valid:true});
  const callbacks={onUndo(){},onRedo(){}};
  assert.equal(runCodeEditorAction(ui.view,'findNext',callbacks),true);
  assert.equal(runCodeEditorAction(ui.view,'replaceNext',callbacks),true);
  assert.equal(ui.view.state.sliceDoc(),'X ALPHA alphabet\nalpha');
  assert.equal(runCodeEditorAction(ui.view,'replaceAll',callbacks),true);
  assert.equal(ui.view.state.sliceDoc(),'X ALPHA alphabet\nX');
  assert.equal(setCodeEditorSearch(ui.view,{query:'X'},{open:false}),true); assert.equal(getCodeEditorSearch(ui.view).open,false);
  assert.equal(runCodeEditorAction(ui.view,'selectSearchMatches',callbacks),true); assert.equal(ui.view.state.selection.ranges.length,2);
  assert.equal(getCodeEditorSearch(ui.view).replacement,''); assert.equal(getCodeEditorSearch(ui.view).caseSensitive,false);
});

test('feature policy hides replacement and blocks panel actions and shared commands', () => {
  const ui = editor('alpha alpha');
  setCodeEditorSearch(ui.view, { query: 'alpha', replacement: 'X' }, { replace: true });
  ui.policy({ replace: false });
  assert.equal(ui.node('置換を表示').hidden, true);
  assert.equal(ui.row().hidden, true);
  assert.equal(getCodeEditorSearch(ui.view).replace, false);
  assert.equal(openCompactReplacePanel(ui.view), false);
  for (const action of ['replace', 'replaceNext', 'replaceAll']) assert.equal(runCodeEditorAction(ui.view, action, { onUndo() {}, onRedo() {} }), false);
  ui.node('すべて置換').emit('click');
  assert.equal(ui.view.state.sliceDoc(), 'alpha alpha');
  assert.equal(runCodeEditorAction(ui.view, 'findNext', { onUndo() {}, onRedo() {} }), true, 'read-only search remains usable');
  const before = getCodeEditorSearch(ui.view);
  ui.policy({ search: false });
  assert.equal(setCodeEditorSearch(ui.view, { query: 'changed' }), false);
  for (const action of ['find', 'findNext', 'findPrevious', 'selectSearchMatches']) assert.equal(runCodeEditorAction(ui.view, action, { onUndo() {}, onRedo() {} }), false);
  assert.equal(getCodeEditorSearch(ui.view).query, before.query);
});

test('replacement expansion notifies the host and can be explicitly collapsed', () => {
  const states = [], ui = editor('a a');
  ui.policy({ onChange(state) { states.push(state); } });
  setCodeEditorSearch(ui.view, { query: 'a', replacement: 'b' }, { replace: true });
  assert.equal(states.at(-1).replace, true);
  setCodeEditorSearch(ui.view, { query: 'a', replacement: 'c' }, { replace: false });
  assert.equal(states.at(-1).replace, false);
  assert.equal(ui.row().hidden, true);
  assert.equal(getCodeEditorSearch(ui.view).replacement, 'c');
});

test('invalid queries and read-only replace requests leave the previous query intact', () => {
  const ui=editor('a a'); setCodeEditorSearch(ui.view,{query:'a'});
  const before=getCodeEditorSearch(ui.view);
  for(const query of [{query:'[',regex:true},{query:4},{query:'x',regex:'yes'},{query:'x',unknown:true}])
    assert.equal(setCodeEditorSearch(ui.view,query),false);
  assert.deepEqual(getCodeEditorSearch(ui.view),before);
  assert.equal(setCodeEditorSearch(ui.view,{query:'x'},{open:'yes'}),false);
  ui.readonly(true);
  assert.equal(setCodeEditorSearch(ui.view,{query:'b',replacement:'x'},{replace:true}),false);
  assert.equal(runCodeEditorAction(ui.view,'replaceNext',{onUndo(){},onRedo(){}}),false);
  assert.equal(runCodeEditorAction(ui.view,'replaceAll',{onUndo(){},onRedo(){}}),false);
  assert.deepEqual(getCodeEditorSearch(ui.view),before); assert.equal(ui.view.state.sliceDoc(),'a a');
});
