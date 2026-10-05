import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export {useSlideEditor} from './src/state/use-slide-editor'; export {SlideRibbon} from './src/ui/slide-ribbon'; export {default as LikeSlide} from './src/slide';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useSlideEditor, SlideRibbon, LikeSlide } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=slide-ribbon-test.js').toString('base64')}`);
const change = async action => { await act(async () => { await action(); }); };
function visible(node) { for (let item = node; item; item = item.parent) if (item.props.hidden) return false; return true; }
function key(key, extra = {}) { return { key, nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; }
async function mount(t, supplied = {}, full = false) {
  let editor, renderer, active = true, focused;
  const ref = createRef(), modes = [], changes = [], dirty = [], events = [];
  let props = { onSave() {}, onRibbonDisplayModeChange: mode => modes.push(mode), onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value), onEvent: value => events.push(value), ...supplied };
  const listeners = new Map();
  const document = { addEventListener(type, fn) { const list = listeners.get(type) ?? new Set(); list.add(fn); listeners.set(type, list); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
  function Probe() { editor = useSlideEditor({ ...props, ref }); return h(SlideRibbon, { editor, ownerDocument: null, onImage() {}, onImport() {}, onPresent() {}, onProperties() {}, onNotes() {}, onFit() {} }); }
  const render = () => h(StrictMode, null, full ? h(LikeSlide, { ...props, ref }) : h(Probe));
  await change(() => { renderer = create(render(), { createNodeMock(element) {
    if (element.props.className === 'lxp-ribbon') return { ownerDocument: document, contains: target => target?.inside };
    if (element.props.role === 'tab' || element.props['aria-label'] === 'リボンを表示') return { focus() { focused = element.props['aria-label'] ?? element.props.children; } };
    return null;
  } }); });
  const unmount = async () => { if (active) { active = false; await change(() => renderer.unmount()); } }; t.after(unmount);
  return { ref, modes, changes, dirty, events, unmount, get editor() { return editor; }, get root() { return renderer.root; }, get focused() { return focused; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); },
    async set(mode) { let result; await change(() => { result = ref.current.setRibbonDisplayMode(mode); }); return result; },
    tab(label) { return renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.join('') === label); },
    panels() { return renderer.root.findAllByProps({ role: 'tabpanel' }).filter(visible); },
    tabs() { return renderer.root.findAllByProps({ role: 'tab' }).filter(visible); },
    label(label) { return renderer.root.findAllByProps({ 'aria-label': label }).filter(node => typeof node.type === 'string' && visible(node)); },
    async outside(type, inside = false) { await change(() => { for (const fn of [...listeners.get(type) ?? []]) fn({ target: { inside } }); }); },
  };
}

test('slide ribbon defaults and initial-only values cover all four modes', async t => {
  for (const [initial, expected] of [[undefined, 'expanded'], ['tabs', 'tabs'], ['autoHide', 'autoHide'], ['hidden', 'hidden'], ['invalid', 'expanded']]) {
    const ui = await mount(t, { initialRibbonDisplayMode: initial });
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
    await ui.update({ initialRibbonDisplayMode: 'hidden' });
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
    assert.deepEqual(ui.modes, []); await ui.unmount();
  }
});

test('slide ribbon API updates immediately, rejects invalid modes, and ignores retained setters after unmount', async t => {
  const ui = await mount(t), api = ui.ref.current;
  await change(() => {
    assert.equal(api.setRibbonDisplayMode('tabs'), true); assert.equal(api.getRibbonDisplayMode(), 'tabs');
    assert.equal(api.setRibbonDisplayMode('tabs'), false); assert.equal(api.setRibbonDisplayMode('hidden'), true);
  });
  for (const value of [null, undefined, '', 'invalid', 1]) assert.equal(await ui.set(value), false);
  assert.deepEqual(ui.modes, ['tabs', 'hidden']); await ui.unmount();
  assert.equal(api.setRibbonDisplayMode('expanded'), false);
});

test('controlled ribbon requests wait for host props and releasing control retains the last mode', async t => {
  const ui = await mount(t, { ribbonDisplayMode: 'tabs' }), api = ui.ref.current;
  assert.equal(await ui.set('hidden'), true); assert.deepEqual(ui.modes, ['hidden']);
  assert.equal(api.getRibbonDisplayMode(), 'tabs');
  await ui.update({ ribbonDisplayMode: 'hidden' }); assert.equal(api.getRibbonDisplayMode(), 'hidden');
  await ui.update({ ribbonDisplayMode: undefined }); assert.equal(api.getRibbonDisplayMode(), 'hidden');
  assert.equal(await ui.set('expanded'), true); assert.equal(api.getRibbonDisplayMode(), 'expanded');
  await ui.update({ ribbonDisplayMode: 'tabs', onRibbonDisplayModeChange: undefined });
  assert.equal(ui.editor.ribbonDisplayModeLocked, true); assert.equal(await ui.set('hidden'), false);
  assert.equal(ui.label('リボンの表示')[0].props.disabled, true);
});

test('view-only changes preserve content and pending input without acquiring editing permission or creating history', async t => {
  let permissions = 0;
  const ui = await mount(t, { readOnly: true, onSave: undefined, onEditRequest() { permissions++; return true; } });
  const deck = ui.editor.deck;
  ui.changes.length = 0; ui.dirty.length = 0; ui.events.length = 0;
  await ui.set('hidden'); assert.equal(ui.editor.deck, deck); assert.equal(ui.editor.canUndo, false);
  assert.equal(permissions, 0); assert.deepEqual(ui.changes, []); assert.deepEqual(ui.dirty, []); assert.deepEqual(ui.events, []);
  const edit = await mount(t); let flushed = 0;
  edit.editor.registerInputFlush(() => { flushed++; }, () => true);
  await change(() => edit.editor.refreshPendingInput());
  await edit.set('hidden'); assert.equal(flushed, 0); assert.equal(edit.editor.dirty, true);
  await change(() => edit.editor.execute({ type: 'deck.rename', title: 'Changed' }));
  await change(() => edit.editor.history('undo'));
  assert.equal(edit.ref.current.getRibbonDisplayMode(), 'hidden');
});

test('host observer errors cannot reject or revert ribbon view changes', async t => {
  const ui = await mount(t, { onRibbonDisplayModeChange() { throw new Error('observer'); } });
  assert.equal(await ui.set('tabs'), true); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  await ui.update({ onRibbonDisplayModeChange: async () => { throw new Error('async observer'); } });
  assert.equal(await ui.set('hidden'), true); assert.equal(ui.editor.notice, null);
});

test('tabs mode reveals only a temporary command panel; outside pointer/focus close it without mode changes', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  assert.equal(ui.tabs().length, 6); assert.equal(ui.panels().length, 0);
  await change(() => ui.tab('挿入').props.onClick()); assert.equal(ui.panels().length, 1); assert.equal(ui.label('テキスト ボックス').length, 1);
  await ui.outside('pointerdown', true); assert.equal(ui.panels().length, 1);
  await ui.outside('pointerdown'); assert.equal(ui.panels().length, 0);
  await change(() => ui.tab('挿入').props.onClick()); await ui.outside('focusin'); assert.equal(ui.panels().length, 0);
  assert.deepEqual(ui.modes, []);
});

test('autoHide exposes a reveal button and Escape restores focus while hidden has no internal reveal', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'autoHide' });
  assert.equal(ui.tabs().length, 0); assert.equal(ui.panels().length, 0);
  await change(() => ui.label('リボンを表示')[0].props.onClick()); assert.equal(ui.tabs().length, 6); assert.equal(ui.panels().length, 1); assert.equal(ui.focused, 'ホーム');
  await change(() => ui.root.findByProps({ className: 'lxp-ribbon' }).props.onKeyDown(key('Escape')));
  assert.equal(ui.tabs().length, 0); assert.equal(ui.focused, 'リボンを表示');
  await ui.set('hidden'); assert.equal(ui.tabs().length, 0); assert.equal(ui.label('リボンを表示').length, 0); assert.equal(ui.label('リボンの表示').length, 0);
  await ui.set('expanded'); assert.equal(ui.tabs().length, 6); assert.equal(ui.panels().length, 1);
});

test('keyboard tab navigation opens collapsed panels and double click collapses without resetting the active tab', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  await change(() => ui.root.findByProps({ role: 'tablist' }).props.onKeyDown(key('ArrowRight')));
  assert.equal(ui.tab('挿入').props['aria-selected'], true); assert.equal(ui.focused, '挿入'); assert.equal(ui.panels().length, 1);
  await change(() => ui.root.findByProps({ className: 'lxp-ribbon' }).props.onKeyDown(key('Escape')));
  assert.equal(ui.panels().length, 0); assert.equal(ui.focused, '挿入');
  await change(() => ui.tab('挿入').props.onDoubleClick()); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  await change(() => ui.tab('挿入').props.onDoubleClick()); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs'); assert.equal(ui.tab('挿入').props['aria-selected'], true);
});

test('mode changes keep mounted ribbon controls and invalidate old temporary disclosure', async t => {
  const ui = await mount(t);
  const original = ui.root.findByProps({ 'aria-label': 'フォント' });
  await ui.set('hidden'); assert.equal(ui.root.findByProps({ 'aria-label': 'フォント' }), original);
  await ui.set('tabs'); assert.equal(ui.panels().length, 0);
  await change(() => ui.tab('ホーム').props.onClick()); assert.equal(ui.panels().length, 1);
  await ui.set('autoHide'); assert.equal(ui.panels().length, 0); assert.equal(ui.tabs().length, 0);
  await ui.set('expanded'); assert.equal(ui.root.findByProps({ 'aria-label': 'フォント' }), original);
  assert.deepEqual(ui.root.findByProps({ 'aria-label': 'リボンの表示' }).findAllByType('option').map(option => option.props.value), ['expanded', 'tabs', 'autoHide']);
});

test('Ctrl+F1 is scoped to the Slide editor and cannot restore fully hidden mode', async t => {
  const ui = await mount(t, {}, true);
  const press = async extra => { const event = key('F1', { ctrlKey: true, target: { closest() { return true; } }, ...extra }); await change(() => ui.root.findByProps({ 'data-likex-slide': '' }).props.onKeyDown(event)); return event; };
  assert.equal((await press()).defaultPrevented, true); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  await press(); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  await press({ nativeEvent: { isComposing: true } }); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  await ui.set('autoHide'); await press(); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  await ui.set('hidden'); assert.equal((await press()).defaultPrevented, undefined); assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
});
