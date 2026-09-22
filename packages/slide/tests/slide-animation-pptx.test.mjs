import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry";export {openOfficePackage,officeXml} from "./src/ooxml";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, exportSlidePptx, importSlidePptx, resolveSlideAnimations, openOfficePackage, officeXml } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { child, children, parseXml } = officeXml;
function source() {
  return createSlideDeck({ slides: [{ id: 'cover', name: 'Cover', background: '#ffffff', notes: '', elements: [
    createSlideElement({ id: 'heading', type: 'text', text: 'Animated', x: 10, y: 20, width: 100, height: 40, color: '#ff0000' }),
  ], animations: [
    { id: 'position', trigger: { type: 'click' }, animation: { type: 'sequence', children: [
      { type: 'tween', elementId: 'heading', durationMs: 250, to: { x: 70, y: 80 } },
      { type: 'parallel', children: [
        { type: 'tween', elementId: 'heading', durationMs: 400, easing: 'bounce', to: { width: 200, rotation: 45 } },
        { type: 'tween', elementId: 'heading', durationMs: 600, delayMs: 100, to: { color: '#0000ff', fontSize: 36 } },
      ] },
    ] } },
    { id: 'pulse', trigger: { type: 'after-delay', delayMs: 1500 }, animation: {
      type: 'tween', elementId: 'heading', durationMs: 300, from: { height: 60 }, to: { height: 120 }, repeat: 2, yoyo: true,
    } },
  ] }] });
}

test('PPTX exports final static tween values and reports dropped timing once without changing the source', async () => {
  const deck = source(), before = JSON.stringify(deck), warnings = [];
  const file = await exportSlidePptx(deck, { onWarning: warning => warnings.push(warning) });
  assert.equal(warnings.length, 1); assert.match(warnings[0], /最終静止状態/); assert.match(warnings[0], /タイミング・トリガー・繰り返し/);
  assert.equal(JSON.stringify(deck), before);
  const imported = await importSlidePptx(file);
  assert.deepEqual(imported.warnings, []);
  const actual = imported.deck.slides[0].elements[0], final = resolveSlideAnimations(deck.slides[0]).elements[0];
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'fontSize']) assert.equal(actual[key], final[key], key);
  assert.equal(actual.color, '#0000ff'); assert.equal(actual.text, 'Animated'); assert.equal(actual.height, 60);
  assert.equal(imported.deck.slides[0].animations?.length ?? 0, 0);
  const archive = await openOfficePackage(file);
  const root = parseXml(await archive.read('ppt/slides/slide1.xml'));
  assert.equal(child(root, 'timing'), undefined); assert.equal(child(root, 'transition'), undefined);
  assert.equal(archive.paths.some(path => /customXml|animation/i.test(path)), false);
  const shape = children(child(child(root, 'cSld'), 'spTree'), 'sp')[0];
  assert.equal(child(child(shape, 'spPr'), 'xfrm').attributes.rot, String(45 * 60000));
});

test('static PPTX exports do not warn and warning callback rejection fails without modifying animation data', async () => {
  const warnings = [];
  await exportSlidePptx(createSlideDeck(), { onWarning: warning => warnings.push(warning) });
  assert.deepEqual(warnings, []);
  const deck = source(), before = JSON.stringify(deck);
  await assert.rejects(exportSlidePptx(deck, { onWarning() { throw new Error('host refused lossy conversion'); } }), /host refused/);
  assert.equal(JSON.stringify(deck), before);
});
