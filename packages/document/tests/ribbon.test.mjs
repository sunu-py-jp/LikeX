import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export { useDocumentEditor } from './src/state/use-document-editor'; export { DocumentRibbon } from './src/ui/document-ribbon';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useDocumentEditor, DocumentRibbon } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const visible = node => !node.props.hidden && (!node.parent || visible(node.parent));
const event = (key, extra = {}) => ({ key, nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra });
async function mount(t, supplied = {}) {
  const ref = createRef(), modes = [], events = [], dirty = [], changes = [], selection = [], listeners = new Map();
  let editor, renderer, unmounted = false, focused;
  let props = { ref, onSave() {}, onRibbonDisplayModeChange: mode => modes.push(mode), onEvent: value => events.push(value), onDirtyChange: value => dirty.push(value), onChange: value => changes.push(value), onSelectionChange: value => selection.push(value), ...supplied };
  const doc = { addEventListener(type, fn) { const entries = listeners.get(type) ?? new Set(); entries.add(fn); listeners.set(type, entries); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
  const surface = { current: { focus() { focused = 'document'; } } };
  function Probe() { editor = useDocumentEditor(props); return h(DocumentRibbon, { editor, surface, onImport() {}, onExport() {}, onImage() {}, onTable() {}, onLink() {}, outline: false, onOutline() {} }); }
  // The view only needs focus/containment, not ProseMirror's editing DOM.
  surface.current.getState = () => null;
  const render = () => h(StrictMode, null, h(Probe));
  await change(() => { renderer = create(render(), { createNodeMock(element) {
    if (element.props.className === 'lxd-ribbon') return { ownerDocument: doc, contains: target => target?.inside === true };
    if (element.props.role === 'tab' || element.props['aria-label'] === 'リボンを表示') return { ownerDocument: doc, focus() { focused = element.props['aria-label'] ?? element.props.children; } };
    return null;
  } }); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { ref, modes, events, dirty, changes, selection, unmount, get editor() { return editor; }, get root() { return renderer.root; }, get focused() { return focused; },
    tab(label) { return renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.join('') === label); },
    tabs() { return renderer.root.findAllByProps({ role: 'tab' }).filter(visible); },
    panels() { return renderer.root.findAllByProps({ role: 'tabpanel' }).filter(visible); },
    label(name) { return renderer.root.findByProps({ 'aria-label': name }); },
    async click(label) { await change(() => this.tab(label).props.onClick()); },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); },
    async set(mode) { let result; await change(() => { result = ref.current.setRibbonDisplayMode(mode); }); return result; },
    async fire(type, target) { await change(() => { for (const listener of listeners.get(type) ?? []) listener({ target }); }); },
    async escape() { const key = event('Escape'); await change(() => renderer.root.findByProps({ className: 'lxd-ribbon' }).props.onKeyDown(key)); return key; },
  };
}

test('Document initial ribbon modes default safely and are read only at mount', async t => {
  for (const [initial, expected] of [[undefined, 'expanded'], ['tabs', 'tabs'], ['autoHide', 'autoHide'], ['hidden', 'hidden'], ['invalid', 'expanded']]) {
    const ui = await mount(t, { initialRibbonDisplayMode: initial });
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
    assert.equal(ui.tabs().length, expected === 'autoHide' || expected === 'hidden' ? 0 : 5);
    assert.equal(ui.panels().length, expected === 'expanded' ? 1 : 0);
    await ui.update({ initialRibbonDisplayMode: 'autoHide' });
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected); assert.deepEqual(ui.modes, []);
    await ui.unmount();
  }
});

test('Document ref accepts consecutive view requests, rejects invalid modes and retained calls after unmount', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await change(() => {
    assert.equal(api.setRibbonDisplayMode('tabs'), true); assert.equal(api.getRibbonDisplayMode(), 'tabs');
    assert.equal(api.setRibbonDisplayMode('tabs'), false);
    assert.equal(api.setRibbonDisplayMode('hidden'), true); assert.equal(api.getRibbonDisplayMode(), 'hidden');
  });
  for (const value of [null, undefined, '', 'collapsed', 1]) assert.equal(await ui.set(value), false);
  assert.deepEqual(ui.modes, ['tabs', 'hidden']);
  await ui.unmount(); assert.equal(api.setRibbonDisplayMode('expanded'), false);
});

test('controlled Document presentation only changes with host props and retains last mode when released', async t => {
  const ui = await mount(t, { ribbonDisplayMode: 'tabs' });
  assert.equal(await ui.set('hidden'), true); assert.deepEqual(ui.modes, ['hidden']);
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  await ui.update({ ribbonDisplayMode: 'hidden', onRibbonDisplayModeChange: undefined });
  assert.equal(await ui.set('expanded'), false); assert.equal(ui.label('リボンの表示').props.disabled, true);
  await ui.update({ ribbonDisplayMode: undefined });
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  assert.equal(await ui.set('expanded'), true); assert.equal(ui.tabs().length, 5);
});

test('read-only Document ribbon changes preserve data, selection, dirty state and undo without acquiring permission', async t => {
  let requests = 0;
  const ui = await mount(t, { readOnly: true, onSave: undefined, onEditRequest() { requests++; return true; } });
  const document = ui.ref.current.getDocument(), snapshot = ui.editor.session.getSnapshot();
  for (const values of [ui.dirty, ui.changes, ui.events, ui.selection]) values.length = 0;
  assert.equal(await ui.set('hidden'), true); assert.equal(ui.ref.current.getDocument(), document);
  assert.equal(ui.editor.session.getSnapshot(), snapshot); assert.equal(requests, 0);
  for (const values of [ui.dirty, ui.changes, ui.events, ui.selection]) assert.deepEqual(values, []);
});

test('Document ribbon remains independent of undo and host observer failures', async t => {
  const ui = await mount(t, { onRibbonDisplayModeChange() { throw new Error('observer'); } });
  await change(() => ui.ref.current.execute({ type: 'document.update', title: 'Changed' }));
  assert.equal(await ui.set('hidden'), true);
  await change(() => ui.ref.current.undo()); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  assert.notEqual(ui.ref.current.getDocument().title, 'Changed');
  await ui.update({ onRibbonDisplayModeChange: async () => { throw new Error('async observer'); } });
  assert.equal(await ui.set('tabs'), true); assert.equal(ui.editor.notice, null);
});

test('Document tabs temporarily reveal commands and close on outside pointer or focus only', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  await ui.click('挿入'); assert.equal(ui.panels().length, 1);
  await ui.fire('pointerdown', { inside: true }); assert.equal(ui.panels().length, 1);
  await ui.fire('pointerdown', { inside: false }); assert.equal(ui.panels().length, 0);
  await ui.click('ホーム'); assert.equal(ui.panels().length, 1);
  await ui.fire('focusin', { inside: false }); assert.equal(ui.panels().length, 0);
  assert.equal(ui.editor.ribbonDisplayMode, 'tabs'); assert.deepEqual(ui.modes, []);
});

test('auto-hide reveal and Escape restore focus, and full hidden has no in-editor restore button', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'autoHide' });
  assert.equal(ui.tabs().length, 0); assert.equal(visible(ui.label('リボンを表示')), true);
  await change(() => ui.label('リボンを表示').props.onClick());
  assert.equal(ui.tabs().length, 5); assert.equal(ui.panels().length, 1); assert.equal(ui.focused, 'ホーム');
  assert.equal((await ui.escape()).defaultPrevented, true);
  assert.equal(ui.tabs().length, 0); assert.equal(ui.focused, 'リボンを表示');
  await ui.set('hidden'); assert.equal(ui.tabs().length, 0); assert.equal(visible(ui.label('リボンを表示')), false);
  await ui.set('tabs'); await ui.click('挿入'); await ui.escape(); assert.equal(ui.focused, '挿入');
});

test('Document arrow navigation, double click and mode picker share presentation state', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  await change(() => ui.root.findByProps({ role: 'tablist' }).props.onKeyDown(event('ArrowRight')));
  assert.equal(ui.tab('挿入').props['aria-selected'], true); assert.equal(ui.focused, '挿入'); assert.equal(ui.panels().length, 1);
  await change(() => ui.tab('挿入').props.onDoubleClick()); assert.equal(ui.editor.ribbonDisplayMode, 'expanded');
  await change(() => ui.tab('挿入').props.onDoubleClick()); assert.equal(ui.editor.ribbonDisplayMode, 'tabs'); assert.equal(ui.panels().length, 0);
  const picker = ui.label('リボンの表示');
  assert.deepEqual(picker.findAllByType('option').map(item => item.props.value), ['expanded', 'tabs', 'autoHide']);
  await change(() => picker.props.onChange({ currentTarget: { value: 'autoHide' } })); assert.equal(ui.editor.ribbonDisplayMode, 'autoHide');
});
