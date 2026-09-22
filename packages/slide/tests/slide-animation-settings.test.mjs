import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
  export { SlideProperties } from './src/ui/slide-properties';
  export { SlideRibbon } from './src/ui/slide-ribbon';
  export { useSlideEditor } from './src/state/use-slide-editor';
  export { createSlideDeck, createSlideElement } from './src/model';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { SlideProperties, SlideRibbon, useSlideEditor, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=slide-animation-settings-tests.js').toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const fixture = () => createSlideDeck({ slides: [
  { id: 'one', name: 'One', notes: '', background: '#fff', elements: [
    createSlideElement({ type: 'text', id: 'text', name: 'Title', text: 'Title', opacity: .8 }),
    createSlideElement({ type: 'shape', id: 'shape', name: 'Shape' }),
    createSlideElement({ type: 'image', id: 'image', name: 'Photo', src: png }),
  ] },
  { id: 'two', name: 'Two', notes: '', background: '#fff', elements: [] },
] });
async function mount(t, supplied = {}) {
  let editor, renderer, opens = 0, presentations = 0;
  let props = { initialDeck: fixture(), onSave() {}, ...supplied };
  function Probe() {
    editor = useSlideEditor(props);
    return h('div', null, h(SlideProperties, { editor, onClose() {} }), h(SlideRibbon, {
      editor, onImage() {}, onImport() {}, onPresent() { presentations++; }, propertiesOpen: false, notesOpen: false,
      onProperties() { opens++; }, onNotes() {}, onFit() {}, ownerDocument: null,
    }));
  }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  const button = label => renderer.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.props.children === label);
  const field = label => renderer.root.findByProps({ 'aria-label': label });
  return { renderer, get editor() { return editor; }, get opens() { return opens; }, get presentations() { return presentations; }, button, field,
    get animations() { return editor.deck.slides[0].animations ?? []; },
    async click(label) { const control = button(label); assert.ok(control, label); assert.equal(!!control.props.disabled, false, label); await change(() => control.props.onClick()); },
    async set(label, value) { await change(() => field(label).props.onChange({ target: { value, checked: value } })); },
    async commit(label, value) { await change(() => field(label).props.onChange({ target: { value: String(value) } })); await change(() => field(label).props.onBlur()); },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); },
  };
}

test('animation settings and ribbon add effects through shared commands, permissions and undo', async t => {
  let requests = 0;
  const app = await mount(t, { onEditRequest: () => { requests++; return true; } });
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['text', 'shape'] }));
  await change(() => app.renderer.root.findAllByProps({ role: 'tab' }).find(tab => tab.props.children === 'アニメーション').props.onClick());
  await app.click('移動を追加');
  assert.equal(requests, 1); assert.equal(app.animations.length, 1);
  assert.equal(app.animations[0].animation.type, 'parallel');
  assert.deepEqual(app.animations[0].animation.children.map(node => node.elementId), ['text', 'shape']);
  assert.equal(app.animations[0].name, '移動');
  assert.deepEqual(app.animations[0].trigger, { type: 'click' });
  assert.equal(app.animations[0].animation.children[0].from, undefined);
  assert.deepEqual(app.animations[0].animation.children[0].to, { x: app.editor.deck.slides[0].elements[0].x + 80 });
  assert.equal(app.editor.dirty, true);
  await change(() => app.editor.history('undo')); assert.equal(app.animations.length, 0);
  await change(() => app.editor.history('redo')); assert.equal(app.animations.length, 1);
  await app.click('アニメーションの詳細設定'); assert.equal(app.opens, 1);
  await app.click('アニメーションを再生'); assert.equal(app.presentations, 1);
});

test('step trigger, timing, easing, repeat, yoyo and removal preserve model history', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await app.commit('ステップ名', 'Entrance');
  await app.set('再生開始', 'after-delay'); await app.commit('ステップの待ち時間 (ms)', 850);
  await app.commit('所要時間 (ms)', 1200); await app.commit('開始までの待ち時間 (ms)', 50);
  await app.set('速度の変化', 'spring'); await app.commit('繰り返し回数', 3); await app.set('往復して再生', true);
  const step = app.animations[0];
  assert.equal(step.name, 'Entrance'); assert.deepEqual(step.trigger, { type: 'after-delay', delayMs: 850 });
  assert.equal(step.animation.durationMs, 1200); assert.equal(step.animation.delayMs, 50);
  assert.equal(step.animation.easing, 'spring'); assert.equal(step.animation.repeat, 3); assert.equal(step.animation.yoyo, true);
  await app.set('再生開始', 'click'); await app.set('クリック対象', 'shape');
  assert.deepEqual(app.animations[0].trigger, { type: 'click', elementId: 'shape' });
  await app.click('ステップを削除'); assert.equal(app.animations.length, 0);
  await change(() => app.editor.history('undo')); assert.equal(app.animations[0].id, step.id);
});

test('typed targets expose supported properties and changing to an image removes incompatible values', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await app.set('終了値 追加するプロパティ', 'fontSize');
  await change(() => app.field('終了値 追加するプロパティ').parent.findByType('button').props.onClick());
  await app.commit('終了値 文字サイズ', 48);
  await app.set('終了値 追加するプロパティ', 'color');
  await change(() => app.field('終了値 追加するプロパティ').parent.findByType('button').props.onClick());
  await app.set('終了値 文字色', '#123456');
  assert.equal(app.animations[0].animation.to.fontSize, 48); assert.equal(app.animations[0].animation.to.color, '#123456');
  await app.set('開始値を指定', false); assert.equal(app.animations[0].animation.from, undefined);
  await app.set('動きの対象', 'image');
  assert.deepEqual(app.animations[0].animation.to, { x: app.editor.deck.slides[0].elements[0].x + 80 });
  assert.equal(app.animations[0].animation.elementId, 'image');
  const properties = app.field('終了値 追加するプロパティ').findAllByType('option').map(option => option.props.value);
  assert.ok(properties.includes('opacity')); assert.equal(properties.includes('fontSize'), false); assert.equal(properties.includes('color'), false);
  await app.set('開始値を指定', true); assert.deepEqual(app.animations[0].animation.from, { x: app.editor.deck.slides[0].elements[2].x });
});

test('sequential and parallel groups can add and edit child motions without overwriting existing children', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await app.set('構成 1', 'parallel'); await app.click('動きを追加');
  let group = app.animations[0].animation;
  assert.equal(group.type, 'parallel'); assert.equal(group.children.length, 2);
  assert.deepEqual(group.children[0].to, { x: app.editor.deck.slides[0].elements[0].x + 80 });
  assert.ok(!Object.hasOwn(group.children[1].to, 'x'), 'parallel additions do not collide with an existing x write');
  await app.set('構成 1', 'sequence');
  await change(() => app.renderer.root.findAllByProps({ 'aria-label': '構成 2' })[1].props.onChange({ target: { value: 'parallel' } }));
  group = app.animations[0].animation;
  assert.equal(group.type, 'sequence'); assert.equal(group.children[1].type, 'parallel');
  await app.click('動き 1 を削除');
  assert.equal(app.animations[0].animation.children.length, 1);
});

test('animation numeric drafts reject stale decks and do not commit after switching slides or steps', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await app.set('所要時間 (ms)', '2300');
  await change(() => app.editor.execute({ type: 'deck.rename', title: 'Changed elsewhere' }));
  await change(() => app.field('所要時間 (ms)').props.onBlur());
  assert.equal(app.animations[0].animation.durationMs, 600);
  await app.set('所要時間 (ms)', '3100');
  const oldBlur = app.field('所要時間 (ms)').props.onBlur;
  await change(() => app.editor.select({ slideId: 'two', elementIds: [] }));
  await change(() => oldBlur());
  assert.equal(app.animations[0].animation.durationMs, 600);
  await change(() => app.editor.select({ slideId: 'one', elementIds: [] }));
  await app.click('ステップを追加');
  await app.set('所要時間 (ms)', '3200');
  const previousBlur = app.field('所要時間 (ms)').props.onBlur;
  await app.set('編集するアニメーション', app.animations[0].id);
  await change(() => previousBlur());
  assert.ok(app.animations.every(step => step.animation.durationMs === 600));
});

test('read-only, feature flags and locked targets gate all animation settings', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await change(() => app.editor.execute({ type: 'element.update', slideId: 'one', elementId: 'text', patch: { locked: true } }));
  assert.equal(app.field('所要時間 (ms)').props.disabled, true); assert.equal(app.button('ステップを削除').props.disabled, true);
  assert.equal(app.field('アニメーションを追加する対象').findAllByType('option').find(option => option.props.value === 'text').props.disabled, true);
  const original = app.animations[0];
  await app.set('アニメーションを追加する対象', 'shape'); await app.click('ステップを追加');
  assert.equal(app.animations.length, 2); assert.deepEqual(app.animations[0], original, 'unchanged locked effects survive additions for other targets');
  assert.equal(app.field('クリック対象').findAllByType('option').find(option => option.props.value === 'text').props.disabled, true);
  await app.update({ readOnly: true });
  assert.equal(app.button('ステップを追加'), undefined); assert.equal(app.button('ステップを削除'), undefined);
  assert.equal(app.field('所要時間 (ms)').props.disabled, true);
  await app.update({ features: { animations: false } });
  assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'アニメーション設定' }).length, 0);
  assert.equal(app.renderer.root.findAllByProps({ role: 'tab' }).some(tab => tab.props.children === 'アニメーション'), false);
});

test('animation permission refusal and feature changes while pending retain the original deck', async t => {
  let resolve;
  const app = await mount(t, { onEditRequest: () => new Promise(done => { resolve = done; }) });
  await app.click('ステップを追加'); assert.equal(app.editor.requesting, true);
  await change(() => resolve(false)); assert.equal(app.animations.length, 0); assert.equal(app.editor.canUndo, false);
  await app.click('ステップを追加');
  await app.update({ features: { animations: false } });
  await change(() => resolve(true)); assert.equal(app.animations.length, 0); assert.equal(app.editor.canUndo, false);
});

test('move presets preserve the resting appearance and move inward at the coordinate limit', async t => {
  const app = await mount(t);
  await change(() => app.editor.execute({ type: 'element.update', slideId: 'one', elementId: 'text', patch: { x: 100000 } }));
  await app.click('ステップを追加');
  assert.deepEqual(app.animations[0].animation.to, { x: 99920 });
  assert.equal(app.animations[0].animation.from, undefined);
  assert.equal(app.editor.deck.slides[0].elements[0].x, 100000);
  assert.equal(app.editor.deck.slides[0].elements[0].opacity, .8);
});

test('step ordering retains selection and undo while blocking movement across locked steps', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  const first = app.animations[0].id;
  await app.set('アニメーションを追加する対象', 'shape');
  await app.click('ステップを追加');
  const second = app.animations[1].id;
  assert.equal(app.button('ステップを下へ').props.disabled, true);
  await app.click('ステップを上へ');
  assert.deepEqual(app.animations.map(step => step.id), [second, first]);
  assert.equal(app.field('編集するアニメーション').props.value, second);
  assert.equal(app.button('ステップを上へ').props.disabled, true);
  await app.click('ステップを下へ');
  assert.deepEqual(app.animations.map(step => step.id), [first, second]);
  await change(() => app.editor.history('undo'));
  assert.deepEqual(app.animations.map(step => step.id), [second, first]);
  await change(() => app.editor.history('redo'));
  await change(() => app.editor.execute({ type: 'element.update', slideId: 'one', elementId: 'text', patch: { locked: true } }));
  assert.equal(app.button('ステップを上へ').props.disabled, true, 'reordering an unlocked step must not move its locked neighbor');
  await app.set('編集するアニメーション', first);
  assert.equal(app.button('ステップを下へ').props.disabled, true);
});

test('child ordering preserves motions and rejects stale drafts after a reorder', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  await app.set('構成 1', 'parallel'); await app.click('動きを追加');
  await app.set('構成 1', 'sequence');
  const original = app.animations[0].animation.children;
  const durations = () => app.renderer.root.findAllByProps({ 'aria-label': '所要時間 (ms)' });
  await change(() => durations()[0].props.onChange({ target: { value: '2200' } }));
  const oldBlur = durations()[0].props.onBlur;
  assert.equal(app.button('動き 1 を上へ').props.disabled, true);
  assert.equal(app.button('動き 2 を下へ').props.disabled, true);
  await app.click('動き 2 を上へ');
  assert.deepEqual(app.animations[0].animation.children, [original[1], original[0]]);
  await change(() => oldBlur());
  assert.deepEqual(app.animations[0].animation.children, [original[1], original[0]]);
  await app.click('動き 1 を下へ');
  assert.deepEqual(app.animations[0].animation.children, original);
  await change(() => app.editor.history('undo'));
  assert.deepEqual(app.animations[0].animation.children, [original[1], original[0]]);
  await app.update({ readOnly: true });
  assert.equal(app.button('動き 1 を下へ').props.disabled, true);
});

test('color controls show six-digit colors and preserve saved alpha until explicitly edited', async t => {
  const app = await mount(t);
  await app.click('ステップを追加');
  const step = app.animations[0];
  await change(() => app.editor.execute({ type: 'animation.set', slideId: 'one', animations: [{
    ...step, animation: { ...step.animation, to: { color: '#12345680' }, from: { color: '#abcdef40' } },
  }] }));
  assert.equal(app.field('終了値 文字色').props.value, '#123456');
  assert.equal(app.field('開始値 文字色').props.value, '#abcdef');
  assert.equal(app.animations[0].animation.to.color, '#12345680');
  assert.equal(app.animations[0].animation.from.color, '#abcdef40');
  await app.set('終了値 文字色', '#654321');
  assert.equal(app.animations[0].animation.to.color, '#654321');
  assert.equal(app.animations[0].animation.from.color, '#abcdef40');
  await change(() => app.editor.history('undo'));
  assert.equal(app.animations[0].animation.to.color, '#12345680');
});
