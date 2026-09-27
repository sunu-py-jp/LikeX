import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry"; export {openOfficePackage,officeXml} from "./src/ooxml"; export {readSlideAnimations} from "./src/import/pptx-animations"; export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, exportSlidePptx, importSlidePptx, evaluateSlideAnimations, openOfficePackage, officeXml, readSlideAnimations, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const baseline = await exportSlidePptx(createSlideDeck({ width: 1000, height: 600, slides: [{ id: 'page', name: 'Independent timing', background: '#ffffff', notes: '', elements: ['one', 'two', 'three'].map(id => createSlideElement({ id, type: 'shape', shape: 'rect', x: 100, y: 80, width: 200, height: 100, fill: '#00ff00', opacity: .6 })) }] }));
async function imported(timing) {
  const archive = await openOfficePackage(baseline), entries = [];
  for (const path of archive.paths) {
    let content = await archive.read(path);
    if (path === 'ppt/slides/slide1.xml') content = new TextEncoder().encode(new TextDecoder().decode(content).replace('</p:sld>', `${timing}</p:sld>`));
    entries.push({ path, content: new Blob([content]) });
  }
  return importSlidePptx(await createZipArchive(entries));
}
const timing = lanes => `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot" dur="indefinite"><p:childTnLst>${lanes}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const lane = (id, body, trigger, type = 'interactiveSeq') => `<p:seq><p:cTn id="${id}" nodeType="${type}" dur="indefinite">${trigger ? `<p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="${trigger}"/></p:tgtEl></p:cond></p:stCondLst>` : ''}<p:childTnLst>${body}</p:childTnLst></p:cTn></p:seq>`;
const group = (id, body, type = 'par', extra = '') => `<p:${type}><p:cTn id="${id}" fill="hold" ${extra}><p:childTnLst>${body}</p:childTnLst></p:cTn></p:${type}>`;
const common = (id, prop, target = 2, ms = 1000, conditions = '') => `<p:cBhvr><p:cTn id="${id}" dur="${ms}" fill="hold">${conditions}</p:cTn><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>${prop}</p:attrName></p:attrNameLst></p:cBhvr>`;
const anim = (id, prop, from, to, target = 2, ms = 1000, conditions = '') => `<p:anim calcmode="lin" valueType="num" from="${from}" to="${to}">${common(id, prop, target, ms, conditions)}</p:anim>`;
const set = (id, target, value, delay = 0) => `<p:set>${common(id, 'style.visibility', target, 1, `<p:stCondLst><p:cond delay="${delay}"/></p:stCondLst>`)}<p:to><p:strVal val="${value}"/></p:to></p:set>`;
const close = (a, b) => assert.ok(Math.abs(a - b) < .0001, `${a} ≈ ${b}`);
const frame = (slide, elapsedMs, clicks = []) => evaluateSlideAnimations(slide, { elapsedMs, clicks });
const count = node => 1 + (node.children?.reduce((sum, item) => sum + count(item), 0) ?? 0);

test('all standard lanes wait independently and targeted clicks leave unrelated lanes waiting', async () => {
  const { deck, diagnostics } = await imported(timing(lane(2, anim(20, 'r', 0, 90), 2, 'mainSeq') + lane(3, anim(30, 'style.opacity', .6, .2, 3), 3) + lane(4, anim(40, 'r', 0, 180, 4), 4)));
  const slide = deck.slides[0], [one, two, three] = slide.elements;
  assert.equal(slide.animations.length, 3);
  assert.equal(new Set(slide.animations.map(step => step.timelineId)).size, 3);
  assert.equal(frame(slide, 0).waitingSteps.length, 3);
  const clicks = [{ elapsedMs: 100, elementId: two.id }, { elapsedMs: 200, elementId: three.id }];
  const midway = frame(slide, 600, clicks);
  close(midway.slide.elements[0].rotation, 0);
  close(midway.slide.elements[1].opacity, .4);
  close(midway.slide.elements[2].rotation, 72);
  assert.deepEqual(midway.waitingSteps.map(step => step.waitingTargetId), [one.id]);
  assert.deepEqual(diagnostics, []);
});

test('cross-lane conflicts omit only the colliding property and retain unrelated sibling effects', async () => {
  const { deck, diagnostics } = await imported(timing(lane(2, anim(20, 'r', 0, 90), undefined, 'mainSeq') + lane(3, group(31, anim(32, 'r', 0, 180) + anim(33, 'style.opacity', .6, .2, 3)))));
  const slide = deck.slides[0];
  assert.equal(slide.animations.length, 2);
  close(frame(slide, 500).slide.elements[0].rotation, 45);
  close(frame(slide, 500).slide.elements[1].opacity, .4);
  const warning = diagnostics.find(item => item.code === 'animation-conflict');
  assert.equal(warning.action, 'omission');
  assert.equal(warning.slideIndex, 0);
  assert.equal(warning.slideId, slide.id);
  assert.equal(warning.elementId, slide.elements[0].id);
  assert.equal(warning.timingId, '32');
  assert.equal(warning.property, 'rotation');
  assert.ok(warning.animationId && warning.timelineId && warning.sourcePart);
});

test('invalid properties and unsupported sequential behaviors retain sibling motion and original timing', async () => {
  const body = group(3, group(4, anim(10, 'ppt_w', .2, -.1) + anim(11, 'r', 0, 90)) + anim(12, 'unhandled.property', 0, 1, 2, 500) + anim(13, 'r', 90, 180), 'seq');
  const { deck, diagnostics } = await imported(timing(lane(2, body, undefined, 'mainSeq')));
  const slide = deck.slides[0];
  assert.equal(slide.animations.length, 1);
  close(frame(slide, 500).slide.elements[0].rotation, 45);
  close(frame(slide, 1250).slide.elements[0].rotation, 90);
  close(frame(slide, 2000).slide.elements[0].rotation, 135);
  close(frame(slide, 2000).slide.elements[0].width, 200);
  assert.equal(frame(slide, 2500).finished, true);
  assert.ok(diagnostics.some(item => item.property === 'width' && item.timingId === '10'));
  assert.ok(diagnostics.some(item => item.property === 'unhandled.property' && item.timingId === '12'));
});

test('large linear keyframes coalesce exactly and every curved keyframe remains available', async () => {
  for (const curved of [false, true]) {
    const points = Array.from({ length: 1201 }, (_, index) => `<p:tav tm="${100000 * index / 1200}"><p:val><p:fltVal val="${curved ? 90 * (index / 1200) ** 2 : 90 * index / 1200}"/></p:val></p:tav>`).join('');
    const body = group(3, `<p:anim calcmode="lin" valueType="num">${common(10, 'r')}<p:tavLst>${points}</p:tavLst></p:anim>` + anim(11, 'style.opacity', .6, .2, 3));
    const { deck, diagnostics } = await imported(timing(lane(2, body, undefined, 'mainSeq')));
    const slide = deck.slides[0];
    assert.ok(slide.animations.reduce((sum, step) => sum + count(step.animation), 0) > 0);
    close(frame(slide, 1000).slide.elements[0].rotation, 90);
    close(frame(slide, 500).slide.elements[1].opacity, .4);
    if (curved) {
      assert.ok(count(slide.animations[0].animation) > 1000);
      close(frame(slide, 500).slide.elements[0].rotation, 22.5);
      assert.deepEqual(diagnostics, []);
    }
    else { close(frame(slide, 500).slide.elements[0].rotation, 45); assert.deepEqual(diagnostics, []); }
  }
});

test('unresolved and cyclic time references cannot erase safe sibling effects', async () => {
  const references = id => `<p:stCondLst><p:cond evt="onEnd" delay="0"><p:tn val="${id}"/></p:cond></p:stCondLst>`;
  const { deck, diagnostics } = await imported(timing(lane(2, group(3, anim(10, 'r', 0, 90) + anim(11, 'style.opacity', .6, .1, 3, 1000, references(12)) + anim(12, 'r', 0, 180, 4, 1000, references(11))), undefined, 'mainSeq')));
  close(frame(deck.slides[0], 500).slide.elements[0].rotation, 45);
  close(frame(deck.slides[0], 500).slide.elements[1].opacity, deck.slides[0].elements[1].opacity);
  assert.equal(diagnostics.filter(item => ['11', '12'].includes(item.timingId)).length, 2);
});

test('standard root hidden initialization and visible switch preserve the original opacity', async () => {
  const { deck, diagnostics } = await imported(timing(`<p:set>${common(8, 'style.opacity', 2, 1)}<p:to><p:fltVal val="0.6"/></p:to></p:set>` + set(9, 2, 'hidden') + lane(2, group(3, set(10, 2, 'visible', 500)), undefined, 'mainSeq')));
  const slide = deck.slides[0];
  close(slide.elements[0].opacity, 0);
  close(frame(slide, 499).slide.elements[0].opacity, 0);
  close(frame(slide, 500).slide.elements[0].opacity, .6);
  assert.deepEqual(diagnostics, []);
});

test('more than 500 source behaviors and their following steps are retained completely', async () => {
  const many = Array.from({ length: 650 }, (_, index) => anim(100 + index, 'r', index, index + 1, 2, 1)).join('');
  const { deck, diagnostics } = await imported(timing(lane(2, group(3, many, 'seq') + anim(900, 'style.opacity', .6, .2, 3), undefined, 'mainSeq')));
  const slide = deck.slides[0];
  assert.equal(slide.animations.length, 2);
  assert.ok(slide.animations.reduce((sum, step) => sum + count(step.animation), 0) > 650);
  close(frame(slide, 1150).slide.elements[1].opacity, .4);
  assert.equal(frame(slide, 1649).finished, false);
  assert.equal(frame(slide, 1650).finished, true);
  close(frame(slide, 640).slide.elements[0].rotation, 280);
  assert.deepEqual(diagnostics, []);
});

test('all repeated group cycles survive after expansion beyond 500 nodes', async () => {
  const cycle = Array.from({ length: 6 }, (_, index) => anim(100 + index, 'r', index * 10, (index + 1) * 10, 2, 100)).join('');
  const { deck, diagnostics } = await imported(timing(lane(2, group(3, cycle, 'seq', 'repeatCount="100000"') + anim(500, 'style.opacity', .6, .2, 3), undefined, 'mainSeq')));
  const slide = deck.slides[0];
  close(frame(slide, 350).slide.elements[0].rotation, 35);
  close(frame(slide, 60500).slide.elements[1].opacity, .4);
  assert.equal(frame(slide, 61000).finished, true);
  close(frame(slide, 950).slide.elements[0].rotation, 35);
  close(frame(slide, 59950).slide.elements[0].rotation, 55);
  assert.deepEqual(diagnostics, []);
});

test('an invalid size cannot distort its supported concurrent center-position curve', async () => {
  const { deck, diagnostics } = await imported(timing(lane(2, group(3, anim(10, 'ppt_w', .2, -.1) + anim(11, 'ppt_x', .2, .4)), undefined, 'mainSeq')));
  const slide = deck.slides[0];
  close(frame(slide, 500).slide.elements[0].x, 200);
  close(frame(slide, 500).slide.elements[0].width, 200);
  assert.ok(diagnostics.some(item => item.property === 'width' && item.timingId === '10'));
});

test('more than 500 visibility switches all play while independent geometry is retained', async () => {
  const switches = Array.from({ length: 300 }, (_, index) => {
    const target = index % 2 ? 2 : 3, previous = index % 2 ? 3 : 2;
    return set(100 + index * 2, previous, 'hidden', index * 2) + set(101 + index * 2, target, 'visible', index * 2);
  }).join('');
  const { deck, diagnostics } = await imported(timing(set(9, 3, 'hidden') + lane(2, group(3, switches), undefined, 'mainSeq') + lane(4, anim(800, 'r', 0, 90, 4))));
  const slide = deck.slides[0];
  for (const at of [0, 2, 250, 500, 598, 600, 1000]) {
    const current = frame(slide, at).slide.elements;
    assert.equal(current.slice(0, 2).filter(element => element.opacity > 0).length, 1);
    const lastSwitch = Math.min(299, Math.floor(at / 2));
    assert.equal(current[0].opacity, lastSwitch % 2 ? 1 : 0);
    assert.equal(current[1].opacity, lastSwitch % 2 ? 0 : 1);
  }
  close(frame(slide, 500).slide.elements[2].rotation, 45);
  assert.deepEqual(diagnostics, []);
});

test('visibility and geometry lanes retain independent quantities and timing', async () => {
  const switches = Array.from({ length: 190 }, (_, index) => {
    const target = index % 2 ? 2 : 3, previous = index % 2 ? 3 : 2;
    return set(100 + index * 2, previous, 'hidden', index * 2) + set(101 + index * 2, target, 'visible', index * 2);
  }).join('');
  const { deck, diagnostics } = await imported(timing(set(9, 3, 'hidden') + lane(2, group(3, switches), undefined, 'mainSeq') + lane(4, anim(800, 'r', 0, 90, 4))));
  const slide = deck.slides[0];
  for (const at of [0, 250, 500, 600, 1000]) assert.equal(frame(slide, at).slide.elements.slice(0, 2).filter(element => element.opacity > 0).length, 1);
  close(frame(slide, 500).slide.elements[2].rotation, 45);
  assert.deepEqual(diagnostics, []);
});

test('finite animation durations and integer repeats are accepted beyond former application limits', async () => {
  const body = anim(10, 'r', 0, 90, 2, 700000).replace('dur="700000"', 'dur="700000" repeatCount="101000"');
  const { deck, diagnostics } = await imported(timing(lane(2, body, undefined, 'mainSeq')));
  const slide = deck.slides[0];
  close(frame(slide, 350000).slide.elements[0].rotation, 45);
  assert.equal(frame(slide, 700000 * 101 - 1).finished, false);
  assert.equal(frame(slide, 700000 * 101).finished, true);
  assert.deepEqual(diagnostics, []);
});

test('timing XML beyond the former local node/depth caps is retained under shared XML safety limits', async () => {
  const points = Array.from({ length: 7001 }, (_, index) => `<p:tav tm="${100000 * index / 7000}"><p:val><p:fltVal val="${90 * index / 7000}"/></p:val></p:tav>`).join('');
  let body = `<p:anim calcmode="lin" valueType="num">${common(100, 'r')}<p:tavLst>${points}</p:tavLst></p:anim>`;
  for (let index = 0; index < 14; index++) body = group(3 + index, body);
  const { deck, diagnostics } = await imported(timing(lane(2, body, undefined, 'mainSeq')));
  close(frame(deck.slides[0], 500).slide.elements[0].rotation, 45);
  assert.deepEqual(diagnostics, []);
});

test('animation conversion yields and aborts without publishing partially converted animations', async () => {
  const points = Array.from({ length: 2001 }, (_, index) => `<p:tav tm="${50 * index}"><p:val><p:fltVal val="${90 * (index / 2000) ** 2}"/></p:val></p:tav>`).join('');
  const root = officeXml.parseXml(new TextEncoder().encode(timing(lane(2, `<p:anim calcmode="lin" valueType="num">${common(100, 'r')}<p:tavLst>${points}</p:tavLst></p:anim>`, undefined, 'mainSeq'))));
  const controller = new AbortController(), element = createSlideElement({ id: 'one', type: 'shape', shape: 'rect' }), warnings = [];
  const before = JSON.stringify(element);
  const promise = readSlideAnimations(root, { context: { signal: controller.signal, warn: message => warnings.push(message) }, theme: { colors: {}, majorFont: 'Arial', minorFont: 'Arial' }, mapping: {}, targets: new Map([['2', element]]), width: 1000, height: 600, pageNumber: 1 });
  const timer = setTimeout(() => controller.abort(), 0);
  try { await assert.rejects(promise, error => error.name === 'AbortError'); }
  finally { clearTimeout(timer); }
  assert.equal(JSON.stringify(element), before);
  assert.deepEqual(warnings, []);
});
