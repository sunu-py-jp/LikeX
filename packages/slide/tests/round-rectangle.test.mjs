import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './src/model-entry';
  export { openOfficePackage } from './src/ooxml'; export { createZipArchive } from './src/core';
  export { getSlideShapeGeometry } from './src/render/render-style';
  export { SlideProperties } from './src/ui/slide-properties';
  export { SlideArtwork } from './src/ui/slide-artwork';
  export { useSlideEditor } from './src/state/use-slide-editor';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const shape = (extra = {}) => m.createSlideElement({ type: 'shape', shape: 'roundRect', id: 'rounded', width: 200, height: 100, ...extra });
const deck = elements => m.createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#fff', notes: '', elements }] });
const change = action => act(async () => { await action(); });

test('rounded rectangles validate finite ratios, preserve native defaults and support atomic updates and copying', () => {
  const legacy = shape();
  assert.equal(Object.hasOwn(legacy, 'cornerRadiusRatio'), false);
  assert.equal(m.getSlideShapeGeometry(legacy).radius, 12);
  for (const value of [0, .25, .5]) {
    const source = deck([legacy]);
    const changed = m.applySlideCommands(source, { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: value } }).deck;
    const round = changed.slides[0].elements[0];
    assert.equal(round.cornerRadiusRatio, value);
    assert.equal(m.getSlideShapeGeometry(round).radius, value * 100);
    assert.equal(m.getSlideConnectorOutline(round).radiusY, value);
    assert.equal(source.slides[0].elements[0].cornerRadiusRatio, undefined);
    assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(changed)), changed);
    const copied = m.applySlideCommands(changed, { type: 'element.duplicate', slideId: 'page', elementIds: ['rounded'] }).deck;
    assert.equal(copied.slides[0].elements[1].cornerRadiusRatio, value);
    const converted = m.applySlideCommands(changed, { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { shape: 'rect' } }).deck;
    assert.equal(Object.hasOwn(converted.slides[0].elements[0], 'cornerRadiusRatio'), false);
  }
  for (const value of [-.1, .500001, NaN, Infinity, '0.2', null]) assert.throws(() => shape({ cornerRadiusRatio: value }));
  for (const value of ['rect', 'ellipse', 'line']) assert.throws(() => shape({ shape: value, cornerRadiusRatio: .2 }));
  const source = deck([legacy]);
  assert.throws(() => m.applySlideCommands(source, [
    { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: .2 } },
    { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: .7 } },
  ]));
  assert.equal(source.slides[0].elements[0].cornerRadiusRatio, undefined);
  assert.throws(() => m.applySlideCommands(deck([shape({ locked: true })]), { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: .1 } }), /ロック/);
});

test('changing a rounded corner recomputes attached endpoints without changing the target position', () => {
  const source = m.applySlideCommands(deck([shape({ cornerRadiusRatio: 0, strokeWidth: 0 })]), { type: 'line.add', slideId: 'page', id: 'wire', start: { x: 0, y: 0, binding: { targetId: 'rounded', port: 'topRight' } }, end: { x: 500, y: 350 } }).deck;
  const updated = m.applySlideCommands(source, { type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: .5 } }).deck;
  const [target, wire] = updated.slides[0].elements;
  assert.equal(target.x, source.slides[0].elements[0].x);
  assert.equal(target.y, source.slides[0].elements[0].y);
  assert.ok(wire.line.start.x < source.slides[0].elements[1].line.start.x);
  assert.ok(wire.line.start.y > source.slides[0].elements[1].line.start.y);
  assert.deepEqual(wire.line.start.binding, { targetId: target.id, port: 'topRight' });
});

test('formatting UI changes only selected rounded rectangles through permissions, history and feature gates', async t => {
  let editor, renderer, requests = 0;
  let props = { initialDeck: deck([shape(), shape({ id: 'other', cornerRadiusRatio: .1 }), shape({ id: 'plain', shape: 'rect' })]), onSave() {}, onEditRequest() { requests++; return true; } };
  function Probe() { editor = m.useSlideEditor(props); return h(m.SlideProperties, { editor, onClose() {} }); }
  await change(() => { renderer = create(h(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => editor.select({ slideId: 'page', elementIds: ['rounded', 'other', 'plain'] }));
  const field = () => renderer.root.findAllByType('label').find(node => node.findAllByType('span').some(span => span.props.children === '角の丸み（%）')).findByType('input');
  assert.equal(field().props.value, 24);
  await change(() => field().props.onChange({ target: { value: '70' } }));
  await change(() => field().props.onBlur());
  assert.equal(requests, 1);
  assert.deepEqual(editor.deck.slides[0].elements.map(value => value.cornerRadiusRatio), [.35, .35, undefined]);
  await change(() => editor.history('undo'));
  assert.deepEqual(editor.deck.slides[0].elements.map(value => value.cornerRadiusRatio), [undefined, .1, undefined]);
  await change(() => editor.history('redo'));
  assert.equal(editor.deck.slides[0].elements[0].cornerRadiusRatio, .35);
  await change(() => editor.execute({ type: 'element.update', slideId: 'page', elementId: 'other', patch: { locked: true } }));
  assert.equal(field().props.disabled, true);
  await change(() => editor.execute({ type: 'element.update', slideId: 'page', elementId: 'other', patch: { locked: false } }));
  props = { ...props, readOnly: true };
  await change(() => renderer.update(h(Probe)));
  assert.equal(field().props.disabled, true);
  await change(() => editor.execute({ type: 'element.update', slideId: 'page', elementId: 'rounded', patch: { cornerRadiusRatio: .1 } }));
  assert.equal(editor.deck.slides[0].elements[0].cornerRadiusRatio, .35);
  props = { ...props, readOnly: false, features: { formatting: false } };
  await change(() => renderer.update(h(Probe)));
  assert.equal(renderer.root.findAllByType('span').filter(node => node.props.children === '角の丸み（%）').length, 0);
});

test('artwork shared by page and thumbnail uses the requested rounded rectangle radius', async t => {
  const source = deck([shape({ cornerRadiusRatio: .4 })]);
  let renderer;
  await change(() => { renderer = create(h(m.SlideArtwork, { deck: source, slide: source.slides[0], scale: .1 })); });
  t.after(() => change(() => renderer.unmount()));
  assert.equal(renderer.root.findByType('rect').props.rx, 40);
});

async function editPptx(file, transform) {
  const archive = await m.openOfficePackage(file), entries = [];
  for (const path of archive.paths) entries.push({ path, content: new Blob([path === 'ppt/slides/slide1.xml' ? transform(new TextDecoder().decode(await archive.read(path))) : await archive.read(path)]) });
  return m.createZipArchive(entries);
}

test('PPTX preserves plain and connected rounded rectangle adjustments and eight-port bindings', async () => {
  for (const radius of [0, .18, .5]) for (const attached of [false, true]) {
    const source = deck([shape({ cornerRadiusRatio: radius })]);
    const withLine = attached ? m.applySlideCommands(source, { type: 'line.add', slideId: 'page', id: 'wire', start: { x: 0, y: 0, binding: { targetId: 'rounded', port: 'topRight' } }, end: { x: 500, y: 350 } }).deck : source;
    const file = await m.exportSlidePptx(withLine), archive = await m.openOfficePackage(file);
    const xml = new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'));
    if (!attached) assert.ok(xml.includes(`name="adj" fmla="val ${radius * 100000}"`));
    const result = await m.importSlidePptx(file), actual = result.deck.slides[0].elements;
    assert.deepEqual(result.warnings, []);
    assert.equal(actual[0].cornerRadiusRatio, radius);
    if (attached) {
      assert.deepEqual(actual[1].line.start.binding, { targetId: actual[0].id, port: 'topRight' });
      assert.ok(Math.abs(actual[1].line.start.x - withLine.slides[0].elements[1].line.start.x) < .001);
      assert.ok(Math.abs(actual[1].line.start.y - withLine.slides[0].elements[1].line.start.y) < .001);
    }
  }
});

test('external PPTX roundRect imports the Office default, explicit val and bounded malformed adjustments', async () => {
  const base = await m.exportSlidePptx(deck([shape()]));
  for (const [content, expected, warnings] of [
    ['', .16667, 0], ['<a:gd name="adj" fmla="val 30000"/>', .3, 0],
    ['<a:gd name="adj" fmla="val 80000"/>', .5, 1], ['<a:gd name="adj" fmla="val -20"/>', 0, 1],
    ['<a:gd name="adj" fmla="*/ w 1 2"/>', .16667, 1],
  ]) {
    const file = await editPptx(base, xml => xml.replace(/(<a:prstGeom prst="roundRect">)<a:avLst>.*?<\/a:avLst>/, `$1<a:avLst>${content}</a:avLst>`));
    const result = await m.importSlidePptx(file);
    assert.equal(result.deck.slides[0].elements[0].cornerRadiusRatio, expected);
    assert.equal(result.warnings.length, warnings);
  }
});

test('standard Office roundRect cardinal connection indices remain attached when the corner is adjusted', async () => {
  const source = m.applySlideCommands(deck([shape({ cornerRadiusRatio: .4 })]), { type: 'line.add', slideId: 'page', id: 'wire', start: { x: 0, y: 0, binding: { targetId: 'rounded', port: 'top' } }, end: { x: 500, y: 350 } }).deck;
  const file = await editPptx(await m.exportSlidePptx(source), xml => xml.replace(/<a:custGeom>.*?<\/a:custGeom>/g, '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>'));
  const result = await m.importSlidePptx(file), [target, wire] = result.deck.slides[0].elements;
  assert.deepEqual(result.warnings, []);
  assert.equal(target.cornerRadiusRatio, .4);
  assert.deepEqual(wire.line.start.binding, { targetId: target.id, port: 'top' });
});
