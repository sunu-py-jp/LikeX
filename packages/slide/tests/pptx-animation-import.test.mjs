import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry"; export {openOfficePackage} from "./src/ooxml"; export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, exportSlidePptx, importSlidePptx, evaluateSlideAnimations, resolveSlideAnimations, openOfficePackage, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const near = (actual, expected, tolerance = .02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const shape = id => createSlideElement({ id, type: 'shape', shape: 'rect', x: 100, y: 80, width: 200, height: 100, fill: '#00ff00', stroke: '#000000' });
const tween = (elementId, durationMs, from, to, other = {}) => ({ type: 'tween', elementId, durationMs, from, to, ...other });
function deck(animation, other = {}) {
  return createSlideDeck({ width: 1000, height: 600, slides: [{ id: 'page', name: 'Import regression', background: '#ffffff', notes: '', elements: [shape('one'), shape('two')], ...(animation ? { animations: [{ id: 'step', animation }] } : {}), ...other }] });
}
const frame = (slide, elapsedMs) => evaluateSlideAnimations(slide, { elapsedMs }).slide.elements;
const staticPackage = await exportSlidePptx(deck());

async function withTiming(timing) {
  const archive = await openOfficePackage(staticPackage), entries = [];
  for (const path of archive.paths) {
    let content = await archive.read(path);
    if (path === 'ppt/slides/slide1.xml') content = new TextEncoder().encode(new TextDecoder().decode(content).replace('</p:sld>', `${timing}</p:sld>`));
    entries.push({ path, content: new Blob([content]) });
  }
  return createZipArchive(entries);
}
const standard = children => `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${children}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const common = (id, attribute, extra = '', target = '<p:spTgt spid="2"/>') => `<p:cBhvr><p:cTn id="${id}" dur="1000" fill="hold" ${extra}><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl>${target}</p:tgtEl><p:attrNameLst><p:attrName>${attribute}</p:attrName></p:attrNameLst></p:cBhvr>`;
const numeric = (id, attribute, to, extra = '', target) => `<p:anim calcmode="lin" valueType="num" from="0" to="${to}">${common(id, attribute, extra, target)}</p:anim>`;

test('different-duration center and size curves preserve explicit starts, repeats and unrelated targets', async () => {
  for (const yoyo of [false, true]) {
    const source = deck({ type: 'parallel', children: [
      tween('one', 1000, { x: 140, y: 90 }, { x: 280, y: 170 }, { repeat: 2, yoyo }),
      tween('one', 1500, { width: 240, height: 120 }, { width: 400, height: 180 }, { repeat: 2, yoyo }),
      tween('two', 1000, { x: 100 }, { x: 300 }),
    ] });
    const { deck: actual, warnings } = await importSlidePptx(await exportSlidePptx(source));
    assert.equal(actual.slides[0].animations.length, 1);
    assert.ok(warnings.some(warning => /中心位置とサイズ.*近似/.test(warning)));
    assert.ok(warnings.every(warning => !/省略/.test(warning)), warnings.join('\n'));
    for (const at of [0, 125, 500, 999, 1250, 1999, 2500, 3500, 6000]) {
      const expected = frame(source.slides[0], at), received = frame(actual.slides[0], at);
      for (let index = 0; index < expected.length; index++) for (const key of ['x', 'y', 'width', 'height']) near(received[index][key], expected[index][key], .1);
    }
  }
});

test('1ms fill and stroke changes survive visibility helpers and preserve the delay', async () => {
  const source = deck(tween('one', 1, { fill: '#00ff00', stroke: '#000000' }, { fill: '#ff0000', stroke: '#0000ff' }, { delayMs: 250 }));
  const actual = await importSlidePptx(await exportSlidePptx(source));
  assert.deepEqual(actual.warnings, []);
  assert.equal(frame(actual.deck.slides[0], 249)[0].fill, '#00ff00');
  const final = resolveSlideAnimations(actual.deck.slides[0]).elements[0];
  assert.equal(final.fill, '#ff0000');
  assert.equal(final.stroke, '#0000ff');
  assert.equal(evaluateSlideAnimations(actual.deck.slides[0], { elapsedMs: 250 }).finished, false);
  assert.equal(evaluateSlideAnimations(actual.deck.slides[0], { elapsedMs: 251 }).finished, true);
});

test('root initialization restores global opacity for animated RGB color without baking alpha twice', async () => {
  const source = deck(tween('one', 1000, { fill: '#00ff00' }, { fill: '#ff0000' }), { elements: [{ ...shape('one'), opacity: .3 }, shape('two')] });
  const actual = await importSlidePptx(await exportSlidePptx(source));
  assert.deepEqual(actual.warnings, []);
  assert.equal(actual.deck.slides[0].elements[0].opacity, .3);
  const final = resolveSlideAnimations(actual.deck.slides[0]).elements[0];
  assert.equal(final.opacity, .3);
  assert.equal(final.fill, '#ff0000');
});

test('unsupported behavior, formula and partial text target each warn without erasing supported siblings', async () => {
  const formula = `<p:anim calcmode="lin" valueType="num">${common(12, 'ppt_x')}<p:tavLst><p:tav tm="0" fmla="globalThis.invalidPptxFormula=true"><p:val><p:fltVal val="0"/></p:val></p:tav><p:tav tm="100000"><p:val><p:fltVal val="1"/></p:val></p:tav></p:tavLst></p:anim>`;
  const hidden = `<p:set>${common(14, 'style.visibility')}<p:to><p:strVal val="hidden"/></p:to></p:set>`;
  const fragment = standard(numeric(10, 'r', 90) + numeric(11, 'unsupported.property', 10) + formula + hidden + numeric(13, 'r', 180, '', '<p:spTgt spid="3"><p:txEl><p:charRg st="0" end="1"/></p:txEl></p:spTgt>'));
  const { deck: actual, warnings } = await importSlidePptx(await withTiming(fragment));
  assert.equal(actual.slides[0].animations.length, 1);
  assert.equal(resolveSlideAnimations(actual.slides[0]).elements[0].rotation, 90);
  assert.equal(resolveSlideAnimations(actual.slides[0]).elements[1].rotation, 0);
  for (const pattern of [/unsupported.property/, /数式/, /図形全体以外/]) assert.ok(warnings.some(warning => pattern.test(warning)), warnings.join('\n'));
  assert.equal(resolveSlideAnimations(actual.slides[0]).elements[0].opacity, 0);
  assert.equal(globalThis.invalidPptxFormula, undefined);
});

test('duplicate time IDs reject timing while fractional or infinite repeats reject only their behavior', async () => {
  const duplicated = await importSlidePptx(await withTiming(standard(numeric(10, 'r', 90) + numeric(10, 'style.opacity', 1))));
  assert.equal(duplicated.deck.slides[0].animations, undefined);
  assert.ok(duplicated.warnings.some(warning => /タイミングIDが重複/.test(warning)));
  for (const repeat of ['1500', 'indefinite', '9007199254740992000']) {
    const { deck: actual, warnings } = await importSlidePptx(await withTiming(standard(numeric(10, 'r', 90) + numeric(11, 'style.opacity', 1, `repeatCount="${repeat}"`))));
    assert.equal(resolveSlideAnimations(actual.slides[0]).elements[0].rotation, 90);
    assert.ok(warnings.some(warning => /繰り返し/.test(warning)), warnings.join('\n'));
  }
});

test('unknown target IDs warn and standard XML edits determine imported values', async () => {
  for (const angle of [45, 135]) {
    const { deck: actual, warnings } = await importSlidePptx(await withTiming(standard(numeric(10, 'r', angle) + numeric(11, 'r', 180, '', '<p:spTgt spid="999"/>'))));
    assert.equal(resolveSlideAnimations(actual.slides[0]).elements[0].rotation, angle);
    assert.ok(warnings.some(warning => /図形ID 999/.test(warning)));
  }
});

test('sampled style steps preserve their elapsed time and visible opacity', async () => {
  const source = deck(undefined, { animations: [
    { id: 'fade', animation: tween('one', 1000, { opacity: 1 }, { opacity: .4 }) },
    { id: 'font', animation: tween('one', 1000, { fontSize: 24 }, { fontSize: 36 }) },
    { id: 'move', animation: tween('one', 1000, { x: 100 }, { x: 300 }) },
  ] });
  const { deck: actual } = await importSlidePptx(await exportSlidePptx(source));
  assert.equal(actual.slides[0].animations.length, 3);
  const middle = frame(actual.slides[0], 1500);
  near(Math.max(...middle.slice(0, -1).map(element => element.opacity)), .4);
  near(frame(actual.slides[0], 1500)[0].x, 100);
  near(frame(actual.slides[0], 2500)[0].x, 200);
});
