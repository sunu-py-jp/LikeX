import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const built = await build({ stdin: { contents: 'export * from "./thumbnail"; export { createSlideDeck, createSlideElement } from "./model/normalize";', resolveDir: new URL('../src', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeSlideThumbnail, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const page = (id, text) => ({ id, name: id, background: '#ffffff', notes: 'notes must stay out of the preview', elements: [createSlideElement({ type: 'text', id: `${id}-title`, text, x: 80, y: 80, width: 600, height: 100 })] });

test('thumbnail entry renders only page one and excludes all editor modules', () => {
  const deck = createSlideDeck({ title: 'Quick preview', slides: Array.from({ length: 100 }, (_, i) => page(`p${i}`, i === 0 ? 'First page artwork' : `Offscreen content ${i}`)) });
  const markup = renderToStaticMarkup(h(LikeSlideThumbnail, { deck, colorMode: 'dark', primaryColor: '#445566', style: { height: 210 } }));
  assert.match(markup, /Quick preview/); assert.match(markup, /First page artwork/); assert.match(markup, /height:210px/);
  assert.match(markup, /color-scheme:dark/); assert.match(markup, /viewBox="0 0 1280 720"/);
  assert.doesNotMatch(markup, /Offscreen content|notes must stay|<button|<input|<textarea|contenteditable/i);
  assert.equal((markup.match(/data-slide-element-id=/g) ?? []).length, 1);
  const included = Object.values(built.metafile.outputs).flatMap(output => Object.entries(output.inputs ?? {}).filter(([, data]) => data.bytesInOutput > 0).map(([name]) => name));
  assert.ok(included.every(file => !/use-slide-editor|create-slide-session|slide-filmstrip|slide-canvas|slide-ribbon/.test(file)), included.join('\n'));
});

test('first page uses final static animation state without animation playback', () => {
  const cover = page('cover', 'Final state');
  cover.animations = [{ id: 'move', trigger: { type: 'click' }, animation: { type: 'tween', elementId: 'cover-title', durationMs: 500, easing: 'linear', to: { x: 500 } } }];
  const deck = createSlideDeck({ slides: [cover, page('other', 'Other')] });
  const markup = renderToStaticMarkup(h(LikeSlideThumbnail, { deck }));
  assert.match(markup, /left:500px/); assert.doesNotMatch(markup, /left:80px/);
});

test('thumbnail updates when the host replaces the model and contains invalid input errors', async t => {
  let view; const errors = [];
  const render = deck => h(LikeSlideThumbnail, { deck, title: 'Host title', onError: async error => { errors.push(error); throw new Error('observer'); } });
  await act(async () => { view = create(render(createSlideDeck({ slides: [page('first', 'Before')] }))); });
  t.after(async () => { await act(async () => view.unmount()); });
  assert.match(JSON.stringify(view.toJSON()), /Before/);
  await act(async () => view.update(render(createSlideDeck({ slides: [page('first', 'After')] }))));
  assert.match(JSON.stringify(view.toJSON()), /After/); assert.doesNotMatch(JSON.stringify(view.toJSON()), /Before/);
  await act(async () => view.update(render({ invalid: true })));
  assert.match(JSON.stringify(view.toJSON()), /プレビューできません/); assert.match(JSON.stringify(view.toJSON()), /Host title/);
  assert.equal(errors.length, 1);
});
