import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const result = await build({ stdin: { contents: `export {default as LikeSlide} from './src/slide'; export {createSlideDeck} from './src/model';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlide, createSlideDeck } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=slide-mobile-layout-test.js').toString('base64')}`);
const change = fn => act(async () => { await fn(); });
async function mount(t, supplied = {}) {
  const ref = createRef(), observers = new Set(), changes = [], dirty = [];
  const win = new EventTarget();
  win.ResizeObserver = class { constructor(fn) { this.fn = fn; observers.add(this); } observe() {} disconnect() { observers.delete(this); } };
  const document = Object.assign(new EventTarget(), { defaultView: win });
  const node = Object.assign(new EventTarget(), { ownerDocument: document, clientWidth: 390, querySelector() { return null; }, contains() { return false; } });
  const deck = createSlideDeck({ slides: ['one', 'two'].map(id => ({ id, name: id, background: '#fff', notes: '', elements: [] })) });
  let props = { initialDeck: deck, readOnly: true, onChange: value => changes.push(value), onDirtyChange: value => dirty.push(value), ...supplied };
  let renderer;
  const render = () => h(LikeSlide, { ...props, ref });
  await change(() => { renderer = create(render(), { createNodeMock: element => element.props['data-likex-slide'] === '' ? node : null }); });
  t.after(() => change(() => renderer.unmount()));
  return { ref, changes, dirty, observers, get root() { return renderer.root; },
    layout() { return renderer.root.findByProps({ 'data-likex-slide': '' }).props['data-layout']; },
    button(label) { return renderer.root.findAllByProps({ 'aria-label': label }).find(node => node.type === 'button'); },
    async resize(width) { node.clientWidth = width; await change(() => { for (const observer of observers) observer.fn(); }); },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(render())); },
  };
}

test('slide auto layout follows container width and explicit overrides without editing the deck', async t => {
  const ui = await mount(t), original = ui.ref.current.getDeck();
  ui.changes.length = 0; ui.dirty.length = 0;
  assert.equal(ui.layout(), 'mobile');
  assert.equal(ui.root.findByProps({ className: 'lxp-notes' }).props.hidden, true);
  await ui.resize(720); assert.equal(ui.layout(), 'desktop');
  assert.equal(ui.root.findByProps({ className: 'lxp-notes' }).props.hidden, false);
  await ui.update({ layout: 'mobile' }); assert.equal(ui.layout(), 'mobile'); assert.equal(ui.observers.size, 0);
  await ui.resize(1200); assert.equal(ui.layout(), 'mobile');
  await ui.update({ layout: 'desktop' }); await ui.resize(320); assert.equal(ui.layout(), 'desktop');
  await ui.update({ layout: 'auto' }); assert.equal(ui.layout(), 'mobile');
  assert.deepEqual(ui.ref.current.getDeck(), original); assert.deepEqual(ui.changes, []); assert.deepEqual(ui.dirty, []);
});

test('mobile read-only page navigation and drawer work with a hidden ribbon; feature flags remain effective', async t => {
  const ui = await mount(t, { layout: 'mobile', ribbonDisplayMode: 'hidden' });
  assert.equal(ui.button('前のスライド').props.disabled, true);
  await change(() => ui.button('次のスライド').props.onClick()); assert.equal(ui.ref.current.getPageNumber(), 2);
  assert.equal(ui.button('次のスライド').props.disabled, true);
  await change(() => ui.button('スライド一覧を表示').props.onClick());
  assert.equal(ui.root.findByProps({ className: 'lxp-navigation-pane' }).props['data-open'], true);
  await change(() => ui.button('スライド 1: one').props.onClick({}));
  assert.equal(ui.ref.current.getPageNumber(), 1);
  assert.equal(ui.root.findByProps({ className: 'lxp-navigation-pane' }).props['data-open'], false);
  assert.equal(ui.button('書式設定を表示'), undefined);
  await change(() => ui.button('検索を表示').props.onClick());
  assert.equal(ui.root.findByProps({ 'aria-label': '検索する文字列' }).props.disabled, undefined);
  await change(() => ui.button('一覧を閉じる').props.onClick());
  await ui.update({ features: { search: false, notes: false } });
  assert.equal(ui.button('検索を表示'), undefined); assert.equal(ui.button('ノートを表示'), undefined);
});
