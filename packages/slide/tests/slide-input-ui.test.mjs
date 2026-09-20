import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { default as LikeSlide } from './src/slide.tsx';
  export { createSlideDeck, createSlideElement, serializeSlideDeck, SLIDE_LIMITS } from './src/model/index.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { LikeSlide, createSlideDeck, createSlideElement, serializeSlideDeck, SLIDE_LIMITS } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };

test('native file UI opens current .slon and .json files and rejects former formats atomically', async t => {
  const ref = createRef(), events = [];
  let renderer;
  await change(() => { renderer = create(h(LikeSlide, { ref, onSave() {}, onEvent: event => events.push(event) })); });
  t.after(() => change(() => renderer.unmount()));
  const fileInput = () => renderer.root.findByProps({ 'aria-label': '読み込むLikeSlideファイル' });
  assert.equal(fileInput().props.accept, '.slon,.json,application/json');
  await change(() => renderer.root.findAllByType('button').find(button => button.props.role === 'tab' && button.props.children === 'ファイル').props.onClick());
  assert.ok(renderer.root.findAllByType('button').some(button => button.props['aria-label'] === 'LikeSlide (.slon)'));
  for (const name of ['native.slon', 'native.json']) {
    const deck = createSlideDeck({ title: name, slides: [{ id: 'one', name: 'One', notes: '', background: '#fff',
      elements: [createSlideElement({ type: 'text', id: 'title', text: name })] }] });
    const json = serializeSlideDeck(deck);
    const target = { files: [new File([json], name, { type: name.endsWith('.json') ? 'application/json' : '' })], value: name };
    await change(() => fileInput().props.onChange({ target }));
    assert.equal(target.value, '');
    assert.equal(ref.current.getDeck().title, name);
    assert.equal(ref.current.getDeck().format, 'likex.slide');
  }
  const before = ref.current.getDeck();
  const imported = events.filter(event => event.type === 'import').length;
  const file = JSON.parse(serializeSlideDeck(before));
  const { format, ...unmarked } = file;
  const { format: runtimeFormat, ...formerUnmarked } = before;
  const missingLayer = structuredClone(file);
  delete missingLayer.slides[0].elements[0].stackOrder;
  for (const invalid of [unmarked, formerUnmarked, before, missingLayer, { ...file, version: 2 }, { ...file, format: 'likex.spreadsheet' }]) {
    await change(() => fileInput().props.onChange({ target: {
      files: [new File([JSON.stringify(invalid)], 'incorrect.slon')], value: '',
    } }));
    assert.deepEqual(ref.current.getDeck(), before);
    assert.equal(events.filter(event => event.type === 'import').length, imported);
  }
  assert.ok(renderer.root.findAllByType('span').some(span => span.props.children === 'LikeSlideのファイル形式ではありません'));
});

test('native file byte preflight permits UTF-8 expansion and still enforces decoded JSON length', async t => {
  const ref = createRef(), events = [];
  let renderer;
  await change(() => { renderer = create(h(LikeSlide, { ref, onSave() {}, onEvent: event => events.push(event) })); });
  t.after(() => change(() => renderer.unmount()));
  const input = () => renderer.root.findByProps({ 'aria-label': '読み込むLikeSlideファイル' });
  // Stub byte sizes so boundary behavior does not allocate hundreds of MiB.
  let reads = 0;
  for (const size of [SLIDE_LIMITS.jsonLength + 1, SLIDE_LIMITS.jsonLength * 3]) {
    const deck = createSlideDeck({ title: `日本語 ${size}` });
    const file = { size, async text() { reads++; return serializeSlideDeck(deck); } };
    await change(() => input().props.onChange({ target: { files: [file], value: '日本語.slon' } }));
    assert.equal(ref.current.getDeck().title, deck.title);
  }
  assert.equal(reads, 2);
  const before = ref.current.getDeck();
  const imported = events.filter(event => event.type === 'import').length;
  const tooLarge = { size: SLIDE_LIMITS.jsonLength * 3 + 1, async text() { reads++; return '{}'; } };
  await change(() => input().props.onChange({ target: { files: [tooLarge], value: '' } }));
  assert.equal(reads, 2);
  assert.deepEqual(ref.current.getDeck(), before);
  assert.ok(renderer.root.findAllByType('span').some(span => span.props.children === 'LikeSlideファイルが大きすぎます。'));
  const oversizedJson = { size: SLIDE_LIMITS.jsonLength + 1, async text() { return ' '.repeat(SLIDE_LIMITS.jsonLength + 1); } };
  await change(() => input().props.onChange({ target: { files: [oversizedJson], value: '' } }));
  assert.deepEqual(ref.current.getDeck(), before);
  assert.equal(events.filter(event => event.type === 'import').length, imported);
  assert.ok(renderer.root.findAllByType('span').some(span => span.props.children === 'JSONのサイズが上限を超えています'));
});

test('primary color changes and resets without changing the deck or another instance', async t => {
  const ref = createRef(), dirty = [], changes = [];
  const initialDeck = createSlideDeck({ slides: [{ id: 'slide', name: 'Theme test', background: '#ffeeaa', notes: '', elements: [] }] });
  let props = { ref, initialDeck, onSave() {}, primaryColor: '#2563eb', colorMode: 'light', onDirtyChange: value => dirty.push(value), onChange: value => changes.push(value) };
  let renderer;
  const view = () => h('main', {}, h(LikeSlide, props), h(LikeSlide, { primaryColor: '#fff' }));
  await change(() => { renderer = create(view()); });
  t.after(() => change(() => renderer.unmount()));
  const roots = () => renderer.root.findAll(node => node.type === 'div' && node.props['data-likex-slide'] === '');
  const original = ref.current.getDeck();
  const second = { ...roots()[1].props.style };
  const lightAccent = roots()[0].props.style['--lxp-accent'];
  assert.equal(roots()[0].props.style['--lxp-primary'], '#2563eb');
  assert.equal(roots()[1].props.style['--lxp-on-primary'], '#000000');
  const originalDirtyCount = dirty.length, originalChangeCount = changes.length;
  props = { ...props, colorMode: 'dark' };
  await change(() => renderer.update(view()));
  assert.notEqual(roots()[0].props.style['--lxp-accent'], lightAccent);
  props = { ...props, primaryColor: '#ff0' };
  await change(() => renderer.update(view()));
  assert.equal(roots()[0].props.style['--lxp-primary'], '#ffff00');
  assert.equal(roots()[0].props.style['--lxp-on-primary'], '#000000');
  assert.deepEqual(roots()[1].props.style, second);
  props = { ...props, primaryColor: undefined };
  await change(() => renderer.update(view()));
  assert.equal(roots()[0].props.style['--lxp-primary'], undefined);
  assert.equal(roots()[0].props.style['--lxp-accent'], '#f39472');
  props = { ...props, primaryColor: '#2563eb', style: { '--lxp-primary': '#123456' } };
  await change(() => renderer.update(view()));
  assert.equal(roots()[0].props.style['--lxp-primary'], '#123456');
  assert.deepEqual(ref.current.getDeck(), original);
  assert.equal(dirty.length, originalDirtyCount);
  assert.equal(changes.length, originalChangeCount);
  await change(async () => { assert.equal(await ref.current.undo(), false); });
});

for (const field of ['notes', 'name']) {
  for (const allowed of [false, true]) {
    test(`${field} shows model content after blur while asynchronous permission is ${allowed ? 'granted' : 'denied'}`, async t => {
      let resolve;
      const permission = new Promise(done => { resolve = done; });
      const initialDeck = createSlideDeck({ slides: [{ id: 'slide', name: 'Original name', notes: 'Original notes', background: '#ffffff', elements: [] }] });
      const ref = createRef();
      let renderer;
      await change(() => { renderer = create(h(LikeSlide, { ref, initialDeck, onSave() {}, onEditRequest: () => permission })); });
      t.after(() => change(() => renderer.unmount()));
      const control = () => field === 'notes' ? renderer.root.findByProps({ 'aria-label': '発表者ノート' }) :
        renderer.root.findAllByType('input').find(input => input.props.defaultValue !== undefined);
      const target = { value: `New ${field}` };
      await change(() => control().props.onBlur({ target }));
      assert.equal(target.value, `Original ${field}`, 'uncontrolled DOM cannot retain a value the model has not accepted');
      assert.equal(ref.current.getDeck().slides[0][field], `Original ${field}`);
      await change(() => resolve(allowed));
      assert.equal(ref.current.getDeck().slides[0][field], `${allowed ? 'New' : 'Original'} ${field}`);
      assert.equal(control().props.defaultValue, `${allowed ? 'New' : 'Original'} ${field}`);
    });
  }
}
