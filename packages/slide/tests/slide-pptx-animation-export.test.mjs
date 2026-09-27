import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ stdin: { contents: 'export * from "./src/model-entry";export {openOfficePackage,officeXml} from "./src/ooxml";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const { child, children, parseXml, localName } = m.officeXml;
const element = (id = 'box', patch = {}) => m.createSlideElement({ type: 'shape', id, x: 100, y: 50, width: 100, height: 80, fill: '#ff0000', ...patch });
const tween = (to = { x: 200 }, patch = {}) => ({ type: 'tween', elementId: 'box', durationMs: 1000, to, ...patch });
const step = (id = 'move', animation = tween(), trigger) => ({ id, animation, ...(trigger ? { trigger } : {}) });
const deck = (animations, elements = [element()]) => m.createSlideDeck({ width: 1000, height: 500, slides: [{ id: 'page', name: 'Page', notes: '', background: '#fff', elements, animations }] });
const all = (node, name) => [ ...(localName(node.name) === name ? [node] : []), ...node.children.flatMap(child => all(child, name)) ];
const ctn = node => child(node, 'cTn') ?? child(child(node, 'cBhvr'), 'cTn');
const attr = node => child(child(node, 'cBhvr'), 'attrNameLst')?.children[0]?.text;
const offset = node => Number(child(child(ctn(node), 'stCondLst'), 'cond')?.attributes.delay ?? 0);
const target = node => child(child(child(node, 'cBhvr'), 'tgtEl'), 'spTgt')?.attributes.spid;
const values = node => children(child(node, 'tavLst'), 'tav').map(tav => ({ time: Number(tav.attributes.tm), value: Number(child(child(tav, 'val'), 'fltVal').attributes.val) }));
async function exported(source) {
  const warnings = [], blob = await m.exportSlidePptx(source, { onWarning: warning => warnings.push(warning) });
  const archive = await m.openOfficePackage(blob), root = parseXml(await archive.read('ppt/slides/slide1.xml'));
  const timing = child(root, 'timing'), timeRoot = child(child(child(timing, 'tnLst'), 'par'), 'cTn');
  const sequence = child(child(timeRoot, 'childTnLst'), 'seq');
  const steps = children(child(child(sequence, 'cTn'), 'childTnLst'), 'par');
  return { source, warnings, blob, archive, root, timing, timeRoot, sequence, steps };
}

test('PPTX keeps editable initial geometry and writes a bounded standard five-level timing tree', async () => {
  const source = deck([step('nested', { type: 'sequence', children: [tween(), { type: 'parallel', children: [tween({ y: 200 }), tween({ rotation: 720 }, { delayMs: 200 })] }] })]);
  const before = JSON.stringify(source), out = await exported(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(children(child(out.timing, 'tnLst'), 'par').length, 1);
  assert.equal(out.timeRoot.attributes.nodeType, 'tmRoot');
  assert.equal(child(out.sequence, 'cTn').attributes.nodeType, 'mainSeq');
  const shape = children(child(child(out.root, 'cSld'), 'spTree'), 'sp')[0];
  assert.equal(child(child(child(shape, 'spPr'), 'xfrm'), 'off').attributes.x, String(100 * 9525));
  const ids = all(out.timing, 'cTn').map(node => node.attributes.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(all(out.timing, 'spTgt').every(node => node.attributes.spid === '2'));
  function depth(node, value = 0) {
    const next = value + (['par', 'seq', 'anim', 'animClr', 'set'].includes(localName(node.name)) ? 1 : 0);
    assert.ok(next <= 5, `timing depth ${next}`);
    node.children.forEach(child => depth(child, next));
  }
  depth(out.timing);
  assert.equal(out.archive.paths.some(path => /customXml|animation/i.test(path)), false);
  assert.equal(out.steps[0] && ctn(out.steps[0]).attributes.dur, '2200');
  const wrappers = children(child(ctn(out.steps[0]), 'childTnLst'), 'par');
  assert.deepEqual(wrappers.map(offset), [0, 1000, 1200]);
});

test('click and delayed steps refer to original shape IDs while repeats reverse within one delayed tween', async () => {
  const out = await exported(deck([step('click', tween({ x: 200 }, { delayMs: 25, repeat: 3, yoyo: true }), { type: 'click', elementId: 'trigger' }),
    step('delay', tween({ y: 100 }), { type: 'after-delay', delayMs: 250 }), step('slide-click', tween(), { type: 'click' })], [element(), element('trigger')]));
  const click = child(child(ctn(out.steps[0]), 'stCondLst'), 'cond');
  assert.equal(click.attributes.evt, 'onClick');
  assert.equal(child(child(click, 'tgtEl'), 'spTgt').attributes.spid, '3');
  assert.equal(offset(out.steps[1]), 250);
  assert.ok(child(child(child(child(ctn(out.steps[2]), 'stCondLst'), 'cond'), 'tgtEl'), 'sldTgt'));
  const wrapper = children(child(ctn(out.steps[0]), 'childTnLst'), 'par')[0];
  assert.equal(offset(wrapper), 25);
  assert.equal(ctn(wrapper).attributes.dur, '1000');
  assert.equal(ctn(wrapper).attributes.repeatCount, '3000');
  assert.equal(ctn(wrapper).attributes.autoRev, '1');
  assert.equal(ctn(out.steps[0]).attributes.dur, '6025');
});

test('native coordinate channels convert top-left and size to normalized centers, including size-only movement', async () => {
  const out = await exported(deck([step('size', tween({ width: 300, height: 160 })), step('move', tween({ x: 300, y: 150 }))]));
  const first = all(out.steps[0], 'anim'), second = all(out.steps[1], 'anim');
  const channel = (list, name) => values(list.find(node => attr(node) === name)).map(value => value.value);
  assert.deepEqual(channel(first, 'ppt_x'), [.15, .25]);
  assert.deepEqual(channel(first, 'ppt_y'), [.18, .26]);
  assert.deepEqual(channel(first, 'ppt_w'), [.1, .3]);
  assert.deepEqual(channel(first, 'ppt_h'), [.16, .32]);
  assert.deepEqual(channel(second, 'ppt_x'), [.25, .45]);
  assert.deepEqual(channel(second, 'ppt_y'), [.26, .46]);
});

test('colors use native animClr, standard easing stays native, and spring rotation uses sampled raw degrees', async () => {
  const out = await exported(deck([step('color', tween({ fill: '#0000ff', stroke: '#00ff00', textColor: '#ffffff', x: 200 }, { easing: 'ease-in-out' })),
    step('turn', tween({ rotation: 360 })), step('spring', tween({ rotation: 720 }, { easing: 'spring' }))]));
  const colors = all(out.steps[0], 'animClr');
  assert.deepEqual(colors.map(attr), ['fillcolor', 'stroke.color', 'style.color']);
  assert.equal(child(child(colors[0], 'from'), 'srgbClr').attributes.val, 'FF0000');
  assert.equal(child(child(colors[0], 'to'), 'srgbClr').attributes.val, '0000FF');
  for (const leaf of [...colors, ...all(out.steps[0], 'anim')]) assert.deepEqual([ctn(leaf).attributes.accel, ctn(leaf).attributes.decel], ['50000', '50000']);
  const rotation = all(out.steps[2], 'anim').find(node => attr(node) === 'r');
  const points = values(rotation);
  assert.equal(points.length, 33);
  assert.equal(points[0].value, 360);
  assert.equal(points.at(-1).value, 720);
  assert.ok(points.some(point => point.value > 720));
  assert.equal(out.warnings.filter(warning => /spring/.test(warning)).length, 1);
});

test('simultaneous position and size changes compose the same sampled center as the model evaluator', async () => {
  const source = deck([step('parallel', { type: 'parallel', children: [tween({ x: 300 }, { easing: 'ease-in' }), tween({ width: 400 }, { durationMs: 1500, easing: 'ease-out' })] })]);
  const out = await exported(source);
  assert.ok(out.warnings.some(warning => /中心座標/.test(warning)));
  const center = all(out.steps[0], 'anim').filter(node => attr(node) === 'ppt_x');
  const at = 500, curve = center.find(node => offset(node) <= at && offset(node) + Number(ctn(node).attributes.dur) >= at);
  const time = Math.round((at - offset(curve)) / Number(ctn(curve).attributes.dur) * 100000);
  const point = values(curve).find(point => point.time === time);
  assert.ok(point);
  const frame = m.evaluateSlideAnimations(source.slides[0], { elapsedMs: at }).slide.elements[0];
  assert.ok(Math.abs(point.value - (frame.x + frame.width / 2) / source.width) < 1e-8);
});

test('opacity uses initial and intermediate sets without multiplying the source global alpha twice', async () => {
  const source = deck([step('opacity', tween({ opacity: .25 }))], [element('box', { opacity: .5, fill: '#ff000080' })]);
  const out = await exported(source), direct = children(child(out.timeRoot, 'childTnLst'), 'set');
  assert.equal(direct.length, 1);
  assert.equal(attr(direct[0]), 'style.opacity');
  assert.equal(child(child(direct[0], 'to'), 'fltVal').attributes.val, '0.5');
  const shape = children(child(child(out.root, 'cSld'), 'spTree'), 'sp')[0];
  const fill = child(child(child(shape, 'spPr'), 'solidFill'), 'srgbClr');
  assert.equal(child(fill, 'alpha').attributes.val, String(Math.round(128 / 255 * 100000)));
  const points = all(out.steps[0], 'set').filter(node => attr(node) === 'style.opacity');
  assert.equal(points.length, 33);
  assert.equal(offset(points.at(-1)), 999);
  assert.equal(child(child(points.at(-1), 'to'), 'fltVal').attributes.val, '0.25');
  assert.ok(points.every(node => target(node) === '2'));
  assert.ok(out.warnings.some(warning => /編集画面/.test(warning)));
  assert.equal(source.slides[0].elements[0].opacity, .5);
});

test('snapshot line/font/alpha-color export retains the original shape and reports each approximation once', async () => {
  const out = await exported(deck([step('unsupported', tween({ strokeWidth: 20, fontSize: 60, fill: '#00ff0080' })), step('unsupported-again', tween({ strokeWidth: 10, fontSize: 50 }))]));
  assert.equal(all(out.timing, 'anim').length, 0);
  assert.equal(all(out.timing, 'animClr').length, 0);
  assert.equal(out.warnings.filter(warning => /線幅/.test(warning)).length, 1);
  assert.equal(out.warnings.filter(warning => /文字サイズ/.test(warning)).length, 1);
  assert.equal(out.warnings.filter(warning => /アルファ/.test(warning)).length, 1);
  assert.equal(all(out.root, 'ln')[0].attributes.w, String(2 * 9525));
  assert.equal(all(out.root, 'rPr')[0].attributes.sz, String(24 * 75));
});

test('fractional timing is rounded before scheduling and former animation point budgets no longer reject output', async () => {
  const source = deck([step('fractional', tween({ x: 200 }, { durationMs: 1.4, delayMs: 2.6, repeat: 3 }), { type: 'after-delay', delayMs: .4 })]);
  const before = JSON.stringify(source), out = await exported(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(ctn(out.steps[0]).attributes.dur, '6');
  assert.equal(offset(out.steps[0]), 0);
  assert.equal(out.warnings.filter(warning => /整数/.test(warning)).length, 1);
  const crowded = deck(Array.from({ length: 500 }, (_, index) => step(`s${index}`, tween({ x: 200, y: 200, width: 200, height: 200, rotation: 360 }, { durationMs: 1, easing: 'spring' }))));
  const snapshot = JSON.stringify(crowded);
  const large = await m.exportSlidePptx(crowded);
  assert.ok(large.size > 0);
  assert.equal(JSON.stringify(crowded), snapshot);
});

test('short opacity tweens emit unique offsets and retain the requested final value', async () => {
  for (const durationMs of [1, 2, 8, 16, 32]) {
    const out = await exported(deck([step('short', tween({ opacity: .25 }, { durationMs }))]));
    const points = all(out.steps[0], 'set').filter(node => attr(node) === 'style.opacity');
    const offsets = points.map(offset);
    assert.equal(new Set(offsets).size, offsets.length);
    assert.ok(offsets.every(offset => offset < durationMs));
    assert.equal(child(child(points.at(-1), 'to'), 'fltVal').attributes.val, '0.25');
  }
});

test('RGB color animation preserves a separate global opacity instead of replacing baked paint alpha', async () => {
  const source = deck([step('color', tween({ fill: '#ff0000' }))], [element('box', { opacity: .3, fill: '#00ff00' })]);
  const out = await exported(source), initial = children(child(out.timeRoot, 'childTnLst'), 'set');
  assert.equal(initial.length, 1);
  assert.equal(attr(initial[0]), 'style.opacity');
  assert.equal(child(child(initial[0], 'to'), 'fltVal').attributes.val, '0.3');
  const shape = children(child(child(out.root, 'cSld'), 'spTree'), 'sp')[0];
  const fill = child(child(child(shape, 'spPr'), 'solidFill'), 'srgbClr');
  assert.equal(child(fill, 'alpha'), undefined);
  assert.ok(out.warnings.some(warning => /編集画面/.test(warning)));
  const imported = await m.importSlidePptx(out.blob);
  const final = m.resolveSlideAnimations(imported.deck.slides[0]).elements[0];
  assert.equal(final.opacity, .3);
  assert.equal(final.fill, '#ff0000');
});

test('short sampled color curves begin at the source color and end at the requested color', async () => {
  const out = await exported(deck([step('color', tween({ fill: '#0000ff' }, { durationMs: 2, easing: 'spring' }))]));
  const colors = all(out.steps[0], 'animClr');
  assert.equal(colors.length, 2);
  assert.equal(child(child(colors[0], 'from'), 'srgbClr').attributes.val, 'FF0000');
  assert.equal(child(child(colors.at(-1), 'to'), 'srgbClr').attributes.val, '0000FF');
});
