import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, createRef, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const calls = [];
globalThis.__lxteTestAdapterCalls = calls;
const result = await build({
  stdin: { contents: `export { TextEditorView } from './src/ui/text-editor-view';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [
    { name: 'react', setup(builder) { builder.onResolve({ filter: /^(?:react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } },
    { name: 'editor-adapters', setup(builder) {
      builder.onResolve({ filter: /\/((code|markdown)-editor)$/ }, ({ path }) => ({ path, namespace: 'test-adapter' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-adapter' }, ({ path }) => ({ contents: `
        import { createElement, useImperativeHandle, useRef, useEffect } from 'react';
        const kind = ${JSON.stringify(path.includes('markdown') ? 'rich' : 'source')};
        function Adapter(props) {
          const ready=useRef(false); useEffect(()=>{ready.current=true;return()=>{ready.current=false;}},[]);
          const selection = useRef({ coordinateSpace: kind, ranges: [{anchor:0,head:0}], mainIndex:0 });
          const search = useRef({query:'',replacement:'',caseSensitive:false,wholeWord:false,regex:false,open:false,valid:false});
          useImperativeHandle(props.ref, () => ({
            isReady() { return ready.current; },
            focus() { globalThis.__lxteTestAdapterCalls.push({type:'focus',kind}); },
            runCommand(action) { globalThis.__lxteTestAdapterCalls.push({type:'command',kind,action});
              if(action === 'closeSearch') { const open=search.current.open; search.current={...search.current,open:false}; return open; }
              if(action === 'selectAll') { selection.current = {coordinateSpace:kind,ranges:[{anchor:0,head:props.value.length}],mainIndex:0}; props.onSelectionChange?.(selection.current); }
              if(action === 'undo') props.onUndo(); if(action === 'redo') props.onRedo(); return true; },
            getSelection() { return selection.current; }, setSelection(value) { selection.current = value; props.onSelectionChange?.(value); },
            setSearch(query,display={}) { if(!ready.current)return false; search.current={query:query.query,replacement:query.replacement??'',caseSensitive:query.caseSensitive??false,wholeWord:query.wholeWord??false,regex:query.regex??false,open:display.open!==false,valid:!!query.query}; return true; },
            getSearch() { return search.current; },
            goToLine(line,column=1) { globalThis.__lxteTestAdapterCalls.push({type:'line',kind,line,column}); return line > 0; }
          }));
          return createElement('textarea',{ 'data-test-adapter':kind, value:props.value, readOnly:!props.editable,
            onChange:event=>{ selection.current = {coordinateSpace:kind,ranges:[{anchor:event.target.value.length,head:event.target.value.length}],mainIndex:0};
              props.onSelectionChange?.(selection.current); return props.onChange(event.target.value); },
            onUndo:props.onUndo,onRedo:props.onRedo,onCommandPalette:props.onCommandPalette });
        }
        export { Adapter as CodeEditor, Adapter as MarkdownEditor };`, loader: 'js' }));
    } },
  ],
});

const temporary = await mkdtemp(join(tmpdir(), 'likex-text-editor-ui-'));
const bundlePath = join(temporary, 'bundle.mjs');
await writeFile(bundlePath, result.outputFiles[0].text);
const { TextEditorView } = await import(pathToFileURL(bundlePath).href);
await rm(temporary, { recursive: true, force: true });

function textOf(node) { return typeof node === 'string' ? node : node.children?.map(textOf).join('') ?? ''; }
async function mount(t, options = {}) {
  const ref = createRef(), changes = [], saves = [], dirty = [];
  let props = { initialText: 'first\nsecond', onSave: value => { saves.push(value); }, onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value), ...options }, renderer;
  const node = { focus() {}, blur() {}, contains() { return true; } };
  await act(async () => { renderer = create(createElement(TextEditorView, { ...props, ref }), { createNodeMock: () => node }); });
  let mounted = true;
  t.after(async () => { if (mounted) await act(async () => renderer.unmount()); });
  return { ref, renderer, changes, saves, dirty,
    get editor() { return renderer.root.findAllByType('textarea')[0]; },
    button(label) { return renderer.root.findAllByType('button').find(item => item.props['aria-label'] === label || textOf(item) === label); },
    async click(label) { const button = this.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label + ' is enabled'); await act(async () => button.props.onClick()); },
    async type(text) { let accepted; await act(async () => { accepted = await this.editor.props.onChange({ target: { value: text } }); }); return accepted; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(TextEditorView, { ...props, ref }))); },
    async unmount() { mounted = false; await act(async () => renderer.unmount()); },
  };
}

test('missing onSave is read-only while search and select-all remain available', async t => {
  const ui = await mount(t, { onSave: undefined });
  assert.equal(ui.editor.props.readOnly, true);
  assert.equal(await ui.type('blocked'), false);
  await act(async () => assert.equal(await ui.ref.current.execute({ type: 'text.set', text: 'blocked' }), null));
  assert.equal(await ui.ref.current.runCommand('deleteLine'), false);
  await act(async () => assert.equal(await ui.ref.current.runCommand('selectAll'), true));
  assert.equal(ui.ref.current.getSelection().ranges[0].head, 12);
  await act(async () => { void ui.ref.current.runCommand('find'); });
  assert.ok(calls.some(call => call.type === 'command' && call.action === 'find'));
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
});

test('source and rich views preserve source and use a shared undo/redo history', async t => {
  const original = '# Heading\n\n- first\n- second\n';
  const ui = await mount(t, { initialText: original, mode: 'markdown' });
  assert.equal(ui.editor.props['data-test-adapter'], 'rich');
  await ui.click('ソース表示'); assert.equal(ui.editor.props.value, original);
  assert.equal(await ui.type(original + '\nExtra'), true);
  await ui.click('文章表示'); assert.equal(ui.editor.props['data-test-adapter'], 'rich');
  assert.equal(ui.editor.props.value, original + '\nExtra');
  await act(async () => ui.editor.props.onUndo());
  assert.equal(ui.editor.props.value, original);
  await act(async () => ui.editor.props.onRedo());
  assert.equal(ui.editor.props.value, original + '\nExtra');
  await act(async () => { void ui.ref.current.runCommand('find'); });
  assert.equal(ui.editor.props['data-test-adapter'], 'source');
  assert.equal(ui.ref.current.getText(), original + '\nExtra');
  await act(async () => assert.equal(await ui.ref.current.goToLine(2), true));
  assert.ok(calls.some(call => call.type === 'line' && call.line === 2));
});

test('disabled editing is enforced for native edit callbacks and external commands', async t => {
  const ui = await mount(t, { features: { editing: false } });
  assert.equal(ui.editor.props.readOnly, true);
  assert.equal(await ui.type('blocked'), false);
  await act(async () => assert.equal(await ui.ref.current.execute({ type: 'text.set', text: 'blocked' }), null));
  assert.equal(await ui.ref.current.runCommand('indent'), false);
  await act(async () => assert.equal(await ui.ref.current.replace({ ...ui.ref.current.getDocument(), text: 'blocked replacement' }), null));
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
  await ui.update({ features: { editing: true, history: false } });
  assert.equal(await ui.type('allowed'), true);
  assert.equal(await ui.ref.current.undo(), false);
  assert.equal(ui.button('元に戻す'), undefined);
});

test('permission denial leaves the source intact and returns an unsuccessful edit', async t => {
  let decide, pending;
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  await act(async () => { pending = ui.editor.props.onChange({ target: { value: 'not accepted' } }); await Promise.resolve(); });
  assert.equal(ui.editor.props.readOnly, true);
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
  await act(async () => { decide(false); assert.equal(await pending, false); });
  assert.equal(ui.editor.props.value, 'first\nsecond');
  assert.equal(ui.editor.props.readOnly, false);
  assert.equal(ui.changes.length, 0);
});

test('save blocks changes, cancelled work cannot apply an obsolete result', async t => {
  let finishSave, saved, saving;
  const ui = await mount(t, { onSave: model => { saved = model; return new Promise(resolve => { finishSave = resolve; }); } });
  assert.equal(await ui.type('to save'), true);
  await act(async () => { saving = ui.ref.current.save(); await Promise.resolve(); });
  assert.equal(ui.editor.props.readOnly, true);
  assert.equal(await ui.type('during save'), false);
  await act(async () => ui.ref.current.cancelPending());
  await act(async () => { finishSave({ ...saved, text: 'obsolete save response' }); assert.equal(await saving, false); });
  assert.equal(ui.ref.current.getText(), 'to save');
  assert.equal(ui.editor.props.readOnly, false);
  assert.equal(await ui.type('after cancellation'), true);
});

test('command palette filters commands, Enter executes and Escape dismisses it', async t => {
  const ui = await mount(t);
  await act(async () => { await ui.ref.current.runCommand('commandPalette'); });
  let dialog = ui.renderer.root.findByProps({ role: 'dialog', 'aria-label': 'コマンド一覧' });
  const search = ui.renderer.root.findByProps({ 'aria-label': 'コマンドを検索' });
  await act(async () => search.props.onChange({ target: { value: 'すべて選択' } }));
  assert.equal(dialog.findAllByType('button').filter(button => textOf(button).startsWith('すべて選択')).length, 1);
  await act(async () => dialog.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }));
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog', 'aria-label': 'コマンド一覧' }).length, 0);
  assert.equal(ui.ref.current.getSelection().ranges[0].head, 12);
  await act(async () => { await ui.ref.current.runCommand('commandPalette'); });
  dialog = ui.renderer.root.findByProps({ role: 'dialog', 'aria-label': 'コマンド一覧' });
  await act(async () => dialog.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
  assert.equal(ui.renderer.root.findAllByProps({ role: 'dialog', 'aria-label': 'コマンド一覧' }).length, 0);
});

test('an edit permission response arriving after unmount is ignored', async t => {
  let decide, pending;
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => { decide = resolve; }) });
  const retained = ui.ref.current;
  await act(async () => { pending = ui.editor.props.onChange({ target: { value: 'late' } }); await Promise.resolve(); });
  await ui.unmount();
  decide(true);
  assert.equal(await pending, false);
  assert.equal(retained.getText(), 'first\nsecond');
  assert.equal(ui.changes.length, 0);
});

test('retained view commands resolve unsuccessfully after unmount', async t => {
  const ui = await mount(t, { mode: 'markdown' }), retained = ui.ref.current;
  await ui.unmount();
  const outcome = await Promise.race([
    Promise.all([retained.runCommand('find'), retained.goToLine(2)]),
    new Promise(resolve => setTimeout(() => resolve('unresolved'), 300)),
  ]);
  assert.deepEqual(outcome, [false, false]);
});

test('an observer exception cannot prevent an accepted text edit from reaching the model', async t => {
  let observed = 0;
  const ui = await mount(t, { onSelectionChange() { observed++; throw new Error('host observer failure'); } });
  assert.equal(await ui.type('still accepted'), true);
  assert.ok(observed > 0);
  assert.equal(ui.ref.current.getText(), 'still accepted');
  assert.equal(ui.changes.length, 1);
});

test('the action row is opt-in while commands and Markdown view switching remain available', async t => {
  const ui = await mount(t, { mode: 'markdown' });
  assert.equal(ui.renderer.root.findAllByType('nav').length, 0);
  for (const label of ['検索', '置換', 'コマンド', 'ファイルを開く', 'ファイルをダウンロード']) assert.equal(ui.button(label), undefined);
  const header = ui.renderer.root.findByType('header');
  assert.ok(header.findAllByType('button').some(button => button.props['aria-label'] === 'ソース表示'));
  await ui.click('ソース表示');
  assert.equal(ui.editor.props['data-test-adapter'], 'source');
  await act(async () => assert.equal(await ui.ref.current.runCommand('selectAll'), true));
  assert.equal(ui.ref.current.getSelection().ranges[0].head, 12);
  await ui.update({ showToolbar: true });
  assert.equal(ui.renderer.root.findAllByType('nav').length, 1);
  for (const label of ['検索', '置換', 'コマンド', 'ファイルを開く', 'ファイルをダウンロード']) assert.ok(ui.button(label), label);
  await ui.click('検索');
  assert.ok(calls.some(call => call.type === 'command' && call.action === 'find'));
  await ui.update({ showToolbar: false });
  assert.equal(ui.renderer.root.findAllByType('nav').length, 0);
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
});

test('custom header actions can augment, replace or hide the default controls', async t => {
  let context;
  const ui = await mount(t, { mode: 'markdown', renderHeaderActions: value => {
    context = value;
    return createElement('div', { 'data-test-header': true }, value.defaultActions, createElement('button', { onClick: () => value.runCommand('selectAll') }, 'すべて選ぶ'));
  } });
  assert.ok(context.defaultActions);
  assert.ok(ui.button('元に戻す'));
  assert.ok(ui.button('保存'));
  await ui.click('すべて選ぶ');
  assert.equal(ui.ref.current.getSelection().ranges[0].head, 12);
  await ui.update({ renderHeaderActions: value => createElement('button', { disabled: !value.canSave, onClick: value.save }, 'カスタム保存') });
  assert.equal(ui.button('元に戻す'), undefined);
  assert.equal(ui.button('保存'), undefined);
  assert.ok(ui.button('カスタム保存'));
  assert.equal(ui.button('カスタム保存').props.disabled, true);
  await ui.type('custom save');
  assert.equal(ui.button('カスタム保存').props.disabled, false);
  await ui.click('カスタム保存');
  assert.equal(ui.saves.at(-1).text, 'custom save');
  await ui.update({ renderHeaderActions: () => null });
  assert.equal(ui.button('カスタム保存'), undefined);
  assert.equal(ui.button('元に戻す'), undefined);
  assert.ok(ui.button('ソース表示'), 'Markdown view switching is separate from the replaceable action area');
  await ui.update({ renderHeaderActions: undefined });
  assert.ok(ui.button('保存'), 'omitting the renderer restores the defaults');
});

test('header context tracks history and guards retained handlers when editing permissions change', async t => {
  let context;
  const ui = await mount(t, { renderHeaderActions: value => { context = value; return value.defaultActions; } });
  assert.equal(context.readOnly, false);
  assert.equal(context.busy, false);
  assert.equal(context.dirty, false);
  assert.equal(context.canSave, false);
  assert.equal(context.canUndo, false);
  assert.equal(context.canRedo, false);
  await ui.type('changed');
  assert.equal(context.dirty, true);
  assert.equal(context.canSave, true);
  assert.equal(context.canUndo, true);
  const retained = context;
  await act(async () => assert.equal(await context.undo(), true));
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
  assert.equal(context.canSave, false);
  assert.equal(context.canUndo, false);
  assert.equal(context.canRedo, true);
  await act(async () => assert.equal(await context.redo(), true));
  assert.equal(ui.ref.current.getText(), 'changed');
  await ui.update({ features: { history: false } });
  assert.equal(context.canUndo, false);
  assert.equal(context.canRedo, false);
  assert.equal(await retained.undo(), false);
  await ui.update({ features: { history: true }, readOnly: true });
  assert.equal(context.readOnly, true);
  assert.equal(context.canSave, false);
  assert.equal(context.canUndo, false);
  assert.equal(context.canRedo, false);
  await act(async () => {
    assert.equal(await retained.save(), false);
    assert.equal(await retained.undo(), false);
    assert.equal(await retained.redo(), false);
    assert.equal(await retained.runCommand('deleteLine'), false);
    assert.equal(await retained.runCommand('selectAll'), true);
  });
  assert.equal(ui.ref.current.getText(), 'changed');
  assert.equal(ui.saves.length, 0);
});

test('custom header actions share save busy-state and reject callbacks retained after unmount', async t => {
  let context, finish, saving;
  const ui = await mount(t, {
    onSave: () => new Promise(resolve => { finish = resolve; }),
    renderHeaderActions: value => { context = value; return value.defaultActions; },
  });
  await ui.type('ready');
  const retained = context;
  await act(async () => { saving = context.save(); await Promise.resolve(); });
  assert.equal(context.busy, true);
  assert.equal(context.canSave, false);
  assert.equal(context.canUndo, false);
  assert.equal(context.canRedo, false);
  await act(async () => {
    assert.equal(await retained.save(), false);
    assert.equal(await retained.undo(), false);
    assert.equal(await retained.runCommand('deleteLine'), false);
  });
  await act(async () => { finish(); assert.equal(await saving, true); });
  assert.equal(context.busy, false);
  assert.equal(context.dirty, false);
  assert.equal(context.canSave, false);
  await ui.unmount();
  assert.equal(await retained.save(), false);
  assert.equal(await retained.undo(), false);
  assert.equal(await retained.redo(), false);
  assert.equal(await retained.runCommand('find'), false);
});

test('retained API switches views and controls search/wrap without changing source or history', async t => {
  const views = [], wraps = [];
  const ui = await mount(t, { mode:'markdown', initialText:'# Heading\n\ntext', onViewModeChange: value => views.push(value), onWordWrapChange: value => wraps.push(value) });
  const api = ui.ref.current;
  assert.equal(api.getState().viewMode, 'rich'); assert.equal(api.getSearch(), null);
  let pending;
  await act(async () => { pending = api.setViewMode('source'); });
  assert.equal(await pending, true); assert.equal(api.getState().viewMode, 'source');
  await act(async () => assert.equal(await api.setSearch({query:'text',replacement:'next',caseSensitive:true}), true));
  assert.equal(api.getSearch().query, 'text'); assert.equal(api.getSearch().open, true);
  assert.equal(api.closeSearch(), true); assert.equal(api.getSearch().open, false);
  await act(async () => { assert.equal(api.setWordWrap(false), true); assert.equal(api.setWordWrap(false), true); });
  assert.equal(api.getState().wordWrap, false); assert.deepEqual(wraps, [false]);
  await act(async () => { pending=api.setViewMode('rich'); }); assert.equal(await pending, true);
  assert.equal(api.getState().viewMode, 'rich'); assert.equal(api.getSearch(), null);
  await act(async () => { pending=api.setSearch({query:'Heading'}); }); assert.equal(await pending, true);
  assert.equal(api.getState().viewMode, 'source'); assert.equal(api.getSearch().query, 'Heading');
  assert.deepEqual(views, ['source','rich','source']);
  assert.equal(api.getText(), '# Heading\n\ntext'); assert.equal(api.getState().dirty, false); assert.equal(api.getState().canUndo, false);
  assert.equal(await api.setSearch({query:'[',regex:true}), false); assert.equal(api.getSearch().query, 'Heading');
  assert.equal(await api.setSearch({query:'x',caseSensitive:'yes'}), false);
  assert.equal(await api.setViewMode('invalid'), false); assert.equal(api.setWordWrap('yes'), false);
  assert.equal(await api.runCommand('not-a-command'), false);
  await ui.update({mode:'text',title:'changed'});
  assert.equal(await api.setViewMode('rich'), false); assert.equal(api.getState().mode, 'text');
  assert.equal(api.exportFile().fileName,'changed.txt');
});

test('new search APIs allow reading and reject replacement when editing is disabled', async t => {
  const ui = await mount(t, { readOnly:true });
  const api=ui.ref.current;
  await act(async () => assert.equal(await api.setSearch({query:'first'}), true));
  assert.equal(await api.setSearch({query:'second'}, {replace:true}), false);
  assert.equal(api.getSearch().query,'first');
  for(const command of ['replace','replaceNext','replaceAll']) assert.equal(await api.runCommand(command),false);
  assert.equal(api.getState().editable, false); assert.equal(api.exportFile().fileName,'Untitled.txt');
  assert.equal(await api.importFile(new Blob(['blocked'])),null);
  await ui.update({features:{export:false}}); assert.equal(api.exportFile(),null); assert.equal(api.download(),false);
});

test('import/export uses shared validation, permission, source preservation and history', async t => {
  const ui=await mount(t); const api=ui.ref.current;
  const file=new File([new Uint8Array([0x93,0xfa,0x96,0x7b])],'日本.txt');
  await act(async () => assert.ok(await api.importFile(file)));
  assert.equal(api.getText(),'日本'); assert.equal(api.getDocument().title,'日本.txt');
  const exported=api.exportFile(); assert.equal(exported.fileName,'日本.txt'); assert.equal(await exported.blob.text(),'日本');
  assert.equal(api.getState().canUndo,true);
  await act(async () => assert.equal(await api.undo(),true)); assert.equal(api.getText(),'first\nsecond');
  await act(async () => assert.equal(await api.redo(),true)); assert.equal(api.getText(),'日本');
  await ui.update({features:{import:false}}); assert.equal(api.getState().canUndo,false);
  assert.equal(await api.importFile(new Blob(['blocked'])),null);
  await ui.update({features:{import:true}});
  await act(async () => assert.ok(await api.importFile(new Blob(['# note\r\n']),{title:'note',mode:'markdown'})));
  assert.equal(api.getDocument().mode,'markdown'); assert.equal(api.exportFile().fileName,'note.md');
  assert.equal(await api.exportFile().blob.text(),'# note\r\n');
  const before=api.getDocument();
  await act(async () => assert.equal(await api.importFile(new Blob(['\0'])),null)); assert.equal(api.getDocument(),before);
  await act(async () => assert.equal(await api.importFile(new Blob(['x']),{mode:'bad'}),null)); assert.equal(api.getDocument(),before);
});

test('cancelled or stale imports never apply after reading finishes', async t => {
  let finish, pending;
  class DelayedBlob extends Blob { arrayBuffer() { return new Promise(resolve=>{finish=resolve;}); } }
  const ui=await mount(t), api=ui.ref.current;
  await act(async () => { pending=api.importFile(new DelayedBlob(['late'])); });
  assert.equal(api.getState().busy,true);
  await act(async () => { api.cancelPending(); finish(new TextEncoder().encode('late').buffer); assert.equal(await pending,null); });
  assert.equal(api.getText(),'first\nsecond'); assert.equal(api.getState().busy,false);
  await act(async () => { pending=api.importFile(new DelayedBlob(['late'])); });
  await ui.update({readOnly:true});
  await act(async () => { finish(new TextEncoder().encode('late').buffer); assert.equal(await pending,null); });
  assert.equal(api.getText(),'first\nsecond');
});

test('superseded view requests resolve false and retained calls stop after unmount', async t => {
  const ui=await mount(t,{mode:'markdown'}), api=ui.ref.current;
  let first, second;
  await act(async()=>{ first=api.setViewMode('source'); second=api.setViewMode('rich'); });
  assert.equal(await first,false); assert.equal(await second,true); assert.equal(api.getState().viewMode,'rich');
  await ui.unmount();
  assert.equal(await api.setViewMode('source'),false); assert.equal(await api.setSearch({query:'x'}),false);
  assert.equal(api.setWordWrap(false),false); assert.equal(api.exportFile(),null);
  assert.equal(await api.importFile(new Blob(['x'])),null);
});

test('initial parent layout calls wait for source adapter creation', async () => {
  const ref=createRef(); let pending, renderer, earlySelection;
  function Host() {
    useLayoutEffect(()=>{
      earlySelection=ref.current.setSelection({coordinateSpace:'source',ranges:[{anchor:0,head:1}],mainIndex:0});
      pending=ref.current.setSearch({query:'initial'});
    },[]);
    return createElement(TextEditorView,{ref,initialText:'initial',onSave:()=>{}});
  }
  await act(async()=>{ renderer=create(createElement(Host),{createNodeMock:()=>({})}); });
  try {
    assert.equal(earlySelection,false,'sync selection reports unready instead of fake success');
    assert.equal(await pending,true); assert.equal(ref.current.getSearch().query,'initial');
  } finally {await act(async()=>renderer.unmount());}
});
