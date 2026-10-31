import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './helpers/build.mjs';
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
          const search = useRef({query:'',replacement:'',caseSensitive:false,wholeWord:false,regex:false,open:false,replace:false,valid:false});
          useImperativeHandle(props.ref, () => ({
            isReady() { return ready.current; },
            focus() { globalThis.__lxteTestAdapterCalls.push({type:'focus',kind}); },
            runCommand(action) { globalThis.__lxteTestAdapterCalls.push({type:'command',kind,action});
              if(action === 'closeSearch') { const open=search.current.open; search.current={...search.current,open:false}; return open; }
              if(action === 'selectAll') { selection.current = {coordinateSpace:kind,ranges:[{anchor:0,head:props.value.length}],mainIndex:0}; props.onSelectionChange?.(selection.current); }
              if(action === 'undo') props.onUndo(); if(action === 'redo') props.onRedo(); return true; },
            getSelection() { return selection.current; }, setSelection(value) { selection.current = value; props.onSelectionChange?.(value); },
            setSearch(query,display={}) { if(!ready.current || Object.keys(query).some(key=>!['query','replacement','caseSensitive','wholeWord','regex'].includes(key)))return false; search.current={query:query.query,replacement:query.replacement??'',caseSensitive:query.caseSensitive??false,wholeWord:query.wholeWord??false,regex:query.regex??false,open:display.open!==false,replace:display.replace===true,valid:!!query.query}; return true; },
            getSearch() { return search.current; },
            goToLine(line,column=1) { globalThis.__lxteTestAdapterCalls.push({type:'line',kind,line,column}); return line > 0; }
          }));
          return createElement('textarea',{ 'data-test-adapter':kind, value:props.value, readOnly:!props.editable,
            onChange:event=>{ selection.current = {coordinateSpace:kind,ranges:[{anchor:event.target.value.length,head:event.target.value.length}],mainIndex:0};
              props.onSelectionChange?.(selection.current); return props.onChange(event.target.value); },
            onPendingChange:props.onPendingChange,onUndo:props.onUndo,onRedo:props.onRedo,onCommandPalette:props.onCommandPalette });
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
  const node = { focus() {}, blur() {}, contains() { return true; }, querySelector() { return null; } };
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
  assert.equal(ui.ref.current.getSearch().open, true);
  assert.equal(ui.ref.current.getText(), 'first\nsecond');
});

test('auto detects structured languages from metadata without making a read-only document dirty', async t => {
  const source = '{\r\n  "name": "example",\r\n  "unfinished":\r\n}';
  const ui = await mount(t, { initialText: source, fileName: 'settings.JSON', onSave: undefined });
  assert.equal(ui.ref.current.getState().mode, 'json');
  assert.equal(ui.ref.current.getDocument().mode, 'json');
  assert.equal(ui.ref.current.getState().viewMode, 'source');
  assert.equal(ui.editor.props.readOnly, true);
  assert.equal(await ui.ref.current.setViewMode('rich'), false);
  await ui.update({ mimeType: 'application/xml; charset=utf-8' });
  assert.equal(ui.ref.current.getState().mode, 'xml');
  await ui.update({ mode: 'yaml' });
  assert.equal(ui.ref.current.getState().mode, 'yaml');
  await ui.update({ mode: 'auto', mimeType: 'text/plain', fileName: 'README.md' });
  assert.equal(ui.ref.current.getState().mode, 'markdown');
  assert.equal(ui.ref.current.getState().viewMode, 'rich');
  assert.equal(ui.ref.current.getText(), source);
  assert.equal(ui.ref.current.getState().dirty, false);
});

test('auto uses stored mode as a fallback and model mode commands retain undo history', async t => {
  const initialDocument = { format: 'likex.texteditor', version: 1, id: 'modes', title: 'Untitled', text: 'value: 12', mode: 'yaml' };
  const ui = await mount(t, { initialDocument });
  assert.equal(ui.ref.current.getState().mode, 'yaml');
  await act(async () => { await ui.ref.current.execute({ type: 'document.update', mode: 'xml' }); });
  assert.equal(ui.ref.current.getState().mode, 'xml');
  assert.equal(ui.ref.current.getText(), initialDocument.text);
  await act(async () => { await ui.ref.current.undo(); });
  assert.equal(ui.ref.current.getState().mode, 'yaml');
  await ui.update({ mode: 'text' });
  assert.equal(ui.ref.current.getState().mode, 'text');
  assert.equal(ui.ref.current.getDocument().mode, 'yaml');
});

test('file import resolves each new filename and MIME independently of the previous language', async t => {
  const ui = await mount(t, { initialText: '' });
  const load = async (file, options = {}) => {
    let result;
    await act(async () => { result = await ui.ref.current.importFile(file, { discardChanges: true, ...options }); });
    assert.equal(ui.ref.current.getState().mode, result.mode);
    return result;
  };
  assert.equal((await load(new File(['{"ok":true}'], 'settings.txt', { type: 'application/problem+json' }))).mode, 'json');
  assert.equal((await load(new File(['ok: true\n'], 'settings.YML', { type: 'text/plain' }))).mode, 'yaml');
  assert.equal((await load(new Blob(['untyped text']))).mode, 'text', 'an unnamed blob must not inherit a previous filename hint');
  assert.equal(ui.ref.current.getDocument().title, 'settings.YML', 'keeping the display title must not carry over the language');
  const titled = await load(new File(['{}'], 'settings.json', { type: 'text/plain' }), { title: '設定' });
  assert.equal(titled.mode, 'json', 'a display title must not hide the actual filename');
  assert.equal(titled.title, '設定');
  assert.equal((await load(new Blob(['ok: true']), { title: 'settings.yaml' })).mode, 'yaml');
  assert.equal((await load(new Blob(['<root/>'], { type: 'text/xml' }))).mode, 'xml');
  assert.equal((await load(new File(['plain'], 'notes.txt'))).mode, 'text');
  assert.equal((await load(new File(['{}'], 'config.json'), { mode: 'text' })).mode, 'text');
  assert.equal((await load(new Blob(['key: value']), { fileName: 'config', mimeType: 'application/yaml' })).mode, 'yaml');
  assert.equal(ui.ref.current.getDocument().title, 'config');
});

test('structured source exports use the detected extension and MIME without formatting content', async t => {
  for (const [mode, extension, mime] of [['json', 'json', 'application/json'], ['xml', 'xml', 'application/xml'], ['yaml', 'yaml', 'application/yaml']]) {
    const source = '  exact\r\nsource\t\n';
    const ui = await mount(t, { initialText: source, mode, title: 'data', onSave: undefined });
    const result = ui.ref.current.exportFile();
    assert.equal(result.fileName, `data.${extension}`);
    assert.equal(result.blob.type, `${mime};charset=utf-8`);
    assert.equal(await result.blob.text(), source);
    assert.equal(ui.ref.current.getState().dirty, false);
  }
  for (const name of ['settings.yml', 'notes.markdown', 'diagram.svg']) {
    const ui = await mount(t, { fileName: name, onSave: undefined });
    assert.equal(ui.ref.current.exportFile().fileName, name);
  }
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
  assert.equal(ui.ref.current.getSearch().open, true);
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
  await act(async () => assert.equal(api.closeSearch(), true)); assert.equal(api.getSearch().open, false);
  await act(async () => { assert.equal(api.setWordWrap(false), true); assert.equal(api.setWordWrap(false), true); });
  assert.equal(api.getState().wordWrap, false); assert.deepEqual(wraps, [false]);
  await act(async () => { pending=api.setViewMode('rich'); }); assert.equal(await pending, true);
  assert.equal(api.getState().viewMode, 'rich'); assert.equal(api.getSearch().query, 'text');
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
  await act(async () => assert.ok(await api.importFile(new Blob(['# note\r\n']),{title:'note',mode:'markdown',discardChanges:true})));
  assert.equal(api.getDocument().mode,'markdown'); assert.equal(api.exportFile().fileName,'note.md');
  assert.equal(await api.exportFile().blob.text(),'# note\r\n');
  const before=api.getDocument();
  await act(async () => assert.equal(await api.importFile(new Blob(['\0']), {discardChanges:true}),null)); assert.equal(api.getDocument(),before);
  await act(async () => assert.equal(await api.importFile(new Blob(['x']),{mode:'bad',discardChanges:true}),null)); assert.equal(api.getDocument(),before);
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

test('feature flags gate mounted model commands, search controls and history requirements', async t => {
  const ui=await mount(t,{mode:'markdown',showToolbar:true,features:{search:false,replace:false,formatting:false,save:false}}), api=ui.ref.current;
  assert.equal(api.openSearch('first'),false); assert.equal(api.openExternalSearch(),false);
  assert.equal(await api.setSearch({query:'first'}),false); assert.deepEqual(api.find({query:'first'}),[]);
  for(const command of ['find','replace','findNext','markdown.bold','indent']) assert.equal(await api.runCommand(command),false);
  for(const label of ['検索','置換','保存']) assert.equal(ui.button(label),undefined);
  await act(async()=>assert.equal(await api.execute({type:'text.replaceAll',query:'first',replacement:'next'}),null));
  await act(async()=>assert.equal(await api.execute({type:'markdown.format',selection:{from:1,to:3},action:'bold'}),null));
  assert.equal(await ui.type('plain typing still works'),true); assert.equal(api.getState().canSave,false);
  assert.equal(await api.save(),false);
  await ui.update({features:{search:true,replace:true,formatting:true,save:true}});
  await act(async()=>assert.ok(await api.execute({type:'text.replaceAll',query:'plain',replacement:'new'})));
  await ui.update({features:{replace:false}}); assert.equal(api.getState().canUndo,false); assert.equal(await api.undo(),false);
});

test('explicit edit lifecycle exposes permission, cancellation, discard and refresh with save context', async t => {
  let decide, permissionContext, saveContext;
  const ui=await mount(t,{onEditRequest:(_request,context)=>{permissionContext=context;return new Promise(resolve=>{decide=resolve;});},onSave:(_model,context)=>{saveContext=context;}}), api=ui.ref.current;
  assert.equal(api.getEditState(),'view'); let editing;
  await act(async()=>{editing=api.requestEdit();});
  assert.equal(api.getEditState(),'requesting'); assert.equal(api.getState().busy,true);
  await act(async()=>{api.cancelEditRequest();decide(true);assert.equal(await editing,false);});
  assert.equal(permissionContext.signal.aborted,true); assert.equal(api.getEditState(),'view');
  await ui.update({onEditRequest:()=>true});
  await act(async()=>assert.equal(await api.requestEdit(),true)); assert.equal(api.getEditState(),'edit');
  await act(async()=>assert.equal(api.endEdit(),true)); assert.equal(api.getEditState(),'view');
  await ui.type('changed'); assert.equal(api.endEdit(),false);
  await act(async()=>assert.equal(await api.save(),true)); assert.ok(saveContext.signal); assert.ok(saveContext.requestId);
  await ui.type('discard me'); await act(async()=>assert.equal(api.discard(),true)); assert.equal(api.getText(),'changed');
  assert.equal(api.getState().canUndo,false); assert.equal(api.getEditState(),'view');
  await ui.update({onRefresh:context=>{assert.ok(context.signal);return {...api.getDocument(),text:'fresh from host'};}});
  await ui.type('unsaved'); await act(async()=>assert.equal(await api.refresh(),false)); assert.equal(api.getText(),'unsaved');
  await act(async()=>assert.equal(await api.refresh({discardChanges:true}),true));
  assert.equal(api.getText(),'fresh from host'); assert.equal(api.getState().dirty,false); assert.equal(api.getState().canUndo,false);
  await ui.update({readOnly:true,onRefresh:()=>({...api.getDocument(),text:'readonly refresh'})});
  await act(async()=>assert.equal(await api.refresh(),true)); assert.equal(api.getText(),'readonly refresh');
});

test('dirty replacement guards import, replace and batched document replacement atomically', async t => {
  const notifications=[]; const ui=await mount(t,{onUnsavedChangesChange:value=>notifications.push(value)}), api=ui.ref.current;
  await ui.type('keep unsaved'); const before=api.getDocument();
  await act(async()=>{
    assert.equal(await api.replace({...before,text:'no'}),null);
    assert.equal(await api.importFile(new Blob(['no'])),null);
    assert.equal(await api.execute([{type:'text.insert',offset:0,text:'must not apply'},{type:'document.replace',document:{...before,text:'no'}}]),null);
  });
  assert.equal(api.getDocument(),before); assert.equal(api.getState().hasUnsavedChanges,true);
  await act(async()=>assert.ok(await api.replace({...before,text:'explicit'},{discardChanges:true})));
  assert.equal(api.getText(),'explicit'); await act(async()=>assert.equal(await api.undo(),true)); assert.equal(api.getText(),'keep unsaved');
  await act(async()=>assert.equal(api.discard(),true)); assert.equal(api.getText(),'first\nsecond');
  assert.deepEqual(notifications,[false,true,false]);
});

test('unsaved notifications and browser warning include pending input and can be disabled', async t => {
  const previousWindow=globalThis.window, listeners=new Map(), observed=[];
  globalThis.window={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
  try {
    const ui=await mount(t,{onUnsavedChangesChange:value=>observed.push(value)}), api=ui.ref.current;
    assert.equal(listeners.has('beforeunload'),false);
    await act(async()=>ui.editor.props.onPendingChange(true));
    assert.equal(api.getState().dirty,false); assert.equal(api.getState().hasUnsavedChanges,true); assert.equal(api.getState().pendingInput,true);
    const event={preventDefault(){this.prevented=true;},returnValue:null}; listeners.get('beforeunload')(event);
    assert.equal(event.prevented,true); assert.equal(event.returnValue,'');
    assert.equal(await api.save(),false); assert.equal(api.endEdit(),false);
    await ui.update({warnOnUnsavedChanges:false}); assert.equal(listeners.has('beforeunload'),false);
    await act(async()=>ui.editor.props.onPendingChange(false)); assert.deepEqual(observed,[false,true,false]);
    await ui.unmount();
  } finally {globalThis.window=previousWindow;}
});

test('initial search, retained query and common panel controls work across source and rich views', async t => {
  const observed=[];
  const ui=await mount(t,{mode:'markdown',initialSearchOpen:true,initialSearchQuery:'first',onPanelsChange:panels=>observed.push(panels)}), api=ui.ref.current;
  assert.equal(api.getState().viewMode,'source'); assert.equal(api.getSearch().query,'first'); assert.equal(api.getSearch().open,true);
  assert.ok(api.getOpenPanels().includes('search'));
  await act(async()=>assert.equal(api.closePanel('search'),true)); assert.equal(api.getSearch().open,false);
  let pending; await act(async()=>{pending=api.setViewMode('rich');}); assert.equal(await pending,true);
  assert.equal(api.getSearch().query,'first'); assert.equal(api.getSearch().open,false);
  await act(async()=>{pending=api.setViewMode('source');}); assert.equal(await pending,true); assert.equal(api.getSearch().query,'first');
  await act(async()=>assert.equal(api.openSearch(),true)); assert.equal(api.getSearch().query,'first');
  await act(async()=>assert.equal(await api.runCommand('commandPalette'),true));
  assert.deepEqual(api.getOpenPanels().sort(),['commandPalette','search']);
  await act(async()=>api.closePanels()); assert.deepEqual(api.getOpenPanels(),[]);
  assert.ok(observed.some(panels=>panels.includes('commandPalette')));
});

test('external results navigate source and the keyword tab uses native search', async t => {
  const selected=[];
  const ui=await mount(t,{mode:'markdown',externalSearch:{title:'意味検索',results:[{id:'r',title:'second',target:{from:6,to:12}}],onResultSelect:result=>selected.push(result.id)},initialSearchOpen:true}), api=ui.ref.current;
  assert.equal(api.getState().viewMode,'source'); assert.deepEqual(api.getSelection().ranges,[{anchor:6,head:12}]); assert.deepEqual(selected,['r']);
  assert.equal(api.getSearchPanelState().mode,'external'); assert.equal(api.getSearchPanelState().results.length,1);
  const context=api.getSearchPanelState(); await act(async()=>assert.equal(context.openSearch('first'),true));
  assert.equal(api.getSearch().query,'first'); assert.equal(api.getSearch().open,true); assert.equal(api.getSearchPanelState().mode,'local');
  await act(async()=>assert.equal(api.openExternalSearch('r'),true)); assert.equal(api.getSearchPanelState().mode,'external');
  assert.equal(api.openExternalSearch('missing'),false);
  await act(async()=>api.closePanel('search')); assert.equal(api.getSearchPanelState().open,false);
});

test('host search is used by keyboard and API and stale results cannot survive a document change', async t => {
  const requests=[]; let renderContext;
  const ui=await mount(t,{onSearchRequest:(request,context)=>new Promise(resolve=>requests.push({request,context,resolve})),renderSearch:context=>{renderContext=context;return null;}}), api=ui.ref.current;
  await act(async()=>assert.equal(api.openSearch('first'),true)); assert.equal(requests.length,1); assert.equal(requests[0].request.query.query,'first');
  assert.equal(api.getSearchPanelState().busy,true);
  await act(async()=>assert.ok(await api.execute({type:'text.set',text:'another text'})));
  assert.equal(requests[0].context.signal.aborted,true); assert.equal(requests.length,2);
  await act(async()=>requests[0].resolve([{id:'stale',target:{from:0,to:5}}])); assert.equal(api.getSearchPanelState().results.length,0);
  await act(async()=>requests[1].resolve([{id:'fresh',target:{from:0,to:7}}])); assert.equal(api.getSearchPanelState().results[0].id,'fresh');
  await act(async()=>assert.equal(await renderContext.selectResult('fresh'),true)); assert.deepEqual(api.getSelection().ranges,[{anchor:0,head:7}]);
  const root=ui.renderer.root.findByType('section');
  await act(async()=>root.props.onKeyDownCapture({isDefaultPrevented:()=>false,nativeEvent:{isComposing:false},ctrlKey:true,key:'f',target:{closest:()=>true},preventDefault(){},stopPropagation(){}}));
  assert.equal(api.getSearchPanelState().open,true);
  await act(async()=>assert.equal(await api.runCommand('replace'),true));
  assert.equal(api.getSearchPanelState().open,false); assert.equal(api.getSearch().replace,true);
});

test('structured formatting is opt-in and its display toggle leaves original bytes and history untouched', async t => {
  const source = '{"name":"設定","items":[1,2]}', formatted = JSON.stringify(JSON.parse(source), null, 2);
  const plain = await mount(t, { initialText: source, fileName: 'settings.json' });
  assert.equal(plain.editor.props.value, source);
  assert.equal(plain.button('整形表示'), undefined);
  assert.equal(await plain.ref.current.setViewMode('formatted'), false);
  const ui = await mount(t, { initialText: source, fileName: 'settings.json', formatting: true });
  assert.equal(ui.ref.current.getState().mode, 'json');
  assert.equal(ui.ref.current.getState().viewMode, 'formatted');
  assert.equal(ui.editor.props.value, formatted);
  assert.equal(ui.editor.props.readOnly, false);
  assert.equal(ui.ref.current.getText(), source);
  assert.equal(ui.ref.current.getState().dirty, false);
  assert.equal(ui.ref.current.getState().canUndo, false);
  await ui.click('ソース表示');
  assert.equal(ui.editor.props.value, source);
  await ui.click('整形表示');
  assert.equal(ui.editor.props.value, formatted);
  assert.equal(ui.ref.current.getText(), source);
  assert.equal(await ui.ref.current.exportFile().blob.text(), source);
  assert.equal(ui.changes.length, 0);
  assert.equal(ui.ref.current.getState().dirty, false);
});

test('formatted edits adopt exact entered text, preserve incomplete syntax and share model undo/redo', async t => {
  const source = '{"a":1}', ui = await mount(t, { initialText: source, mode: 'json', formatting: { indent: 4 } });
  const edited = '{\n    "a": 2,\n    "unfinished":\n}';
  assert.equal(await ui.type(edited), true);
  assert.equal(ui.editor.props.value, edited, 'do not reformat or reject incomplete syntax');
  assert.equal(ui.ref.current.getText(), edited);
  assert.equal(ui.ref.current.getState().viewMode, 'formatted');
  assert.equal(ui.ref.current.getState().dirty, true);
  assert.ok(ui.ref.current.getDiagnostics().length);
  assert.match(textOf(ui.renderer.root.findByType('footer')), /\d+ 行、\d+ 列:/);
  await act(async () => { assert.equal(await ui.ref.current.undo(), true); });
  assert.equal(ui.ref.current.getText(), source);
  assert.equal(ui.editor.props.value, source, 'undo is not silently reformatted during this editing session');
  assert.equal(ui.ref.current.getState().dirty, false);
  await act(async () => { assert.equal(await ui.ref.current.redo(), true); });
  assert.equal(ui.editor.props.value, edited);
  await act(async () => { assert.equal(await ui.ref.current.save(), true); });
  assert.equal(ui.saves.at(-1).text, edited);
});

test('formatted selection coordinates and native search target the displayed text', async t => {
  const ui = await mount(t, { initialText: '{"name":"hello"}', mode: 'json', formatting: true });
  await act(async () => { assert.equal(await ui.ref.current.runCommand('selectAll'), true); });
  assert.equal(ui.ref.current.getState().viewMode, 'formatted');
  assert.deepEqual(ui.ref.current.getSelection(), { coordinateSpace: 'formatted', ranges: [{ anchor: 0, head: ui.editor.props.value.length }], mainIndex: 0 });
  assert.equal(ui.ref.current.setSelection({ coordinateSpace: 'source', ranges: [{ anchor: 0, head: 1 }], mainIndex: 0 }), false);
  await act(async () => { assert.equal(ui.ref.current.setSelection({ coordinateSpace: 'formatted', ranges: [{ anchor: 3, head: 5 }], mainIndex: 0 }), true); });
  await act(async () => { assert.equal(await ui.ref.current.setSearch({ query: 'name' }), true); });
  assert.equal(ui.ref.current.getState().viewMode, 'formatted');
  assert.equal(ui.ref.current.getSearch().query, 'name');
  await act(async () => { assert.equal(await ui.ref.current.goToLine(2, 3), true); });
  assert.equal(ui.ref.current.getState().viewMode, 'formatted');
});

test('raw external search navigation leaves formatted coordinates before selecting the match', async t => {
  const source = '{"name":"hello"}';
  const ui = await mount(t, { initialText: source, mode: 'json', formatting: true,
    externalSearch: { results: [{ id: 'hello', title: 'hello', target: { from: 9, to: 14 } }] }, initialSearchOpen: true });
  await act(async () => { await Promise.resolve(); });
  const context = ui.ref.current.getSearchPanelState();
  let result;
  await act(async () => { result = context.selectResult('hello'); });
  await result;
  assert.equal(ui.ref.current.getState().viewMode, 'source');
  assert.equal(ui.ref.current.getSelection().coordinateSpace, 'source');
  assert.deepEqual(ui.ref.current.getSelection().ranges, [{ anchor: 9, head: 14 }]);
  assert.equal(ui.editor.props.value, source);
});

test('formatting configuration and diagnostics honor features, readonly, invalid input and indentation changes', async t => {
  const source = '{"a":{"b":2}}';
  const ui = await mount(t, { initialText: source, mode: 'json', formatting: true, initialViewMode: 'source', onSave: undefined });
  assert.equal(ui.editor.props.value, source);
  await ui.click('整形表示');
  assert.equal(ui.editor.props.value, JSON.stringify(JSON.parse(source), null, 2));
  assert.equal(await ui.type('invalid'), false);
  assert.equal(ui.ref.current.getText(), source);
  await ui.update({ formatting: { indent: 4 }, initialViewMode: undefined });
  assert.equal(ui.editor.props.value, JSON.stringify(JSON.parse(source), null, 4));
  await ui.update({ features: { formatting: false } });
  assert.equal(ui.ref.current.getState().viewMode, 'source');
  assert.equal(ui.editor.props.value, source);
  assert.equal(await ui.ref.current.setViewMode('formatted'), false);
  const invalid = await mount(t, { initialText: '{"a":}', mode: 'json', formatting: true });
  assert.equal(invalid.ref.current.getState().viewMode, 'source');
  assert.equal(invalid.button('整形表示'), undefined);
  assert.ok(invalid.ref.current.getDiagnostics().length);
  await invalid.update({ formatting: false });
  assert.ok(invalid.ref.current.getDiagnostics().length, 'validation is independent of formatting');
  await invalid.update({ features: { validation: false } });
  assert.deepEqual(invalid.ref.current.getDiagnostics(), []);
  assert.equal(invalid.renderer.root.findAllByProps({ className: 'lxte-diagnostic' }).length, 0);
  await invalid.update({ formatting: { indent: NaN } });
  assert.equal(invalid.ref.current.getState().viewMode, 'source');
});

test('structured formatting supports XML and YAML projections and mounted text.format feature gates', async t => {
  for (const [mode, source] of [['xml', '<root><child>text</child></root>'], ['yaml', 'root:\n child: value\n']]) {
    const ui = await mount(t, { initialText: source, mode, formatting: true });
    assert.equal(ui.ref.current.getState().viewMode, 'formatted', mode);
    assert.notEqual(ui.editor.props.value, source, mode);
    assert.equal(ui.ref.current.getText(), source);
    assert.deepEqual(ui.ref.current.getDiagnostics(), []);
    await ui.click('ソース表示');
    assert.equal(ui.editor.props.value, source);
  }
  const ui = await mount(t, { initialText: '{"a":1}', mode: 'json', features: { formatting: false } });
  await act(async () => { assert.equal(await ui.ref.current.execute({ type: 'text.format' }), null); });
  await ui.update({ features: { formatting: true } });
  await act(async () => { assert.ok(await ui.ref.current.execute({ type: 'text.format', indent: 4 })); });
  assert.equal(ui.ref.current.getText(), '{\n    "a": 1\n}');
});
