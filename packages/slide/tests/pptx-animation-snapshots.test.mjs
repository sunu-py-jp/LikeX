import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ stdin: { contents: 'export * from "./src/model-entry";export {openOfficePackage,officeXml} from "./src/ooxml";',
  resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n//# sourceURL=pptx-snapshot-test-bundle.mjs`).toString('base64')}`);
const { child, children, localName, parseXml } = m.officeXml;
const all = (node, name) => [...(localName(node.name) === name ? [node] : []), ...node.children.flatMap(item => all(item, name))];
const tween = (to, options = {}) => ({ type: 'tween', elementId: 'box', durationMs: 1000, to, ...options });
const step = (id, animation, options = {}) => ({ id, animation, ...options });
const makeDeck = (animations, options = {}) => m.createSlideDeck({ width: 1000, height: 500, slides: [{ id: 'page', name: 'Page', background: '#ffffff', notes: '',
  elements: [m.createSlideElement({ type: 'shape', id: 'box', name: 'Box', x: 100, y: 50, width: 100, height: 80, fill: '#ff0000', text: 'Text', ...options })], animations }] });
const timing = node => child(node, 'cTn') ?? child(child(node, 'cBhvr'), 'cTn');
const attribute = node => child(child(node, 'cBhvr'), 'attrNameLst')?.children[0]?.text;
const target = node => child(child(child(node, 'cBhvr'), 'tgtEl'), 'spTgt')?.attributes.spid;
const offset = node => Number(child(child(timing(node), 'stCondLst'), 'cond')?.attributes.delay ?? 0);
async function exported(deck) {
  const diagnostics = [], warnings = [];
  const blob = await m.exportSlidePptx(deck, { onDiagnostic: value => diagnostics.push(value), onWarning: value => warnings.push(value) });
  const archive = await m.openOfficePackage(blob), root = parseXml(await archive.read('ppt/slides/slide1.xml'));
  const timeRoot = child(child(child(child(root, 'timing'), 'tnLst'), 'par'), 'cTn');
  const sequences = children(child(timeRoot, 'childTnLst'), 'seq');
  const steps = children(child(timing(sequences[0]), 'childTnLst'), 'par');
  const shapes = children(child(child(root, 'cSld'), 'spTree'), 'sp');
  return { blob, root, timeRoot, sequences, steps, shapes, diagnostics, warnings };
}
function shapeMap(out) {
  return new Map(out.shapes.map(shape => [child(child(shape, 'nvSpPr'), 'cNvPr').attributes.id, shape]));
}
function visibleAt(out, stepIndex, milliseconds, prior) {
  const visible = prior ? new Set(prior) : new Set(shapeMap(out).keys());
  const sets = [...(prior ? [] : children(child(out.timeRoot, 'childTnLst'), 'set')), ...all(out.steps[stepIndex], 'set')]
    .filter(node => attribute(node) === 'style.visibility' && offset(node) <= milliseconds).sort((a, b) => offset(a) - offset(b));
  for (const node of sets) {
    if (child(child(node, 'to'), 'strVal').attributes.val === 'visible') visible.add(target(node));
    else visible.delete(target(node));
  }
  return visible;
}

test('font, line width and alpha become editable bounded snapshots with one visible shape and exact endpoint styles', async () => {
  const source = makeDeck([step('styles', tween({ fontSize: 60, strokeWidth: 20, fill: '#00ff0080' }))], { opacity: .4 });
  const before = JSON.stringify(source), out = await exported(source), byId = shapeMap(out);
  assert.equal(JSON.stringify(source), before);
  assert.ok(out.shapes.length > 2 && out.shapes.length <= 201);
  assert.equal(new Set(byId.keys()).size, out.shapes.length);
  assert.equal(all(out.root, 'anim').some(node => ['style.fontSize', 'stroke.weight', 'fill.opacity'].includes(attribute(node))), false);
  assert.equal(all(out.root, 'animClr').length, 0);
  for (const time of [0, 250, 500, 750, 999]) assert.equal(visibleAt(out, 0, time).size, 1);
  const final = byId.get([...visibleAt(out, 0, 999)][0]);
  assert.equal(all(final, 'rPr')[0].attributes.sz, String(60 * 75));
  assert.equal(all(final, 'ln')[0].attributes.w, String(20 * 9525));
  const paint = child(child(child(final, 'spPr'), 'solidFill'), 'srgbClr');
  assert.equal(paint.attributes.val, '00FF00');
  assert.equal(child(paint, 'alpha').attributes.val, String(Math.round(.4 * 128 / 255 * 100000)));
  assert.deepEqual(new Set(out.diagnostics.filter(item => item.animationId === 'styles').map(item => item.property)), new Set(['fontSize', 'strokeWidth', 'fill']));
  assert.ok(out.diagnostics.every(item => item.code === 'animation-approximated' && item.action === 'approximation' && item.slideId === 'page' && item.elementId === 'box'));
});

test('transparent colors and repeated autoreverse return to the original while preserving all extrema', async () => {
  const out = await exported(makeDeck([step('repeat', tween({ fill: 'transparent', fontSize: 60 }, { durationMs: 100, repeat: 2, yoyo: true }))]));
  const byId = shapeMap(out);
  for (const time of [0, 50, 100, 150, 200, 250, 300, 399]) assert.equal(visibleAt(out, 0, time).size, 1);
  assert.ok(child(child(byId.get([...visibleAt(out, 0, 100)][0]), 'spPr'), 'noFill'));
  assert.ok(child(child(byId.get([...visibleAt(out, 0, 300)][0]), 'spPr'), 'noFill'));
  assert.deepEqual([...visibleAt(out, 0, 399)], ['2']);
});

test('snapshot styles compose with native motion on another lane and click conditions cover every visible alias', async () => {
  const out = await exported(makeDeck([step('styles', tween({ fontSize: 60 })),
    step('motion', tween({ x: 300 }), { timelineId: 'motion-lane', trigger: { type: 'click', elementId: 'box' } })]));
  assert.deepEqual(out.sequences.map(sequence => timing(sequence).attributes.nodeType), ['mainSeq', 'interactiveSeq']);
  const motions = all(out.sequences[1], 'anim').filter(node => attribute(node) === 'ppt_x');
  assert.deepEqual(new Set(motions.map(target)), new Set(shapeMap(out).keys()));
  const motionStep = children(child(timing(out.sequences[1]), 'childTnLst'), 'par')[0];
  const conditions = children(child(timing(motionStep), 'stCondLst'), 'cond');
  assert.deepEqual(new Set(conditions.map(node => child(child(node, 'tgtEl'), 'spTgt').attributes.spid)), new Set(shapeMap(out).keys()));
  assert.ok(out.diagnostics.some(item => item.animationId === 'motion' && /クリック/.test(item.message)));
});

test('later triggered style steps hide the previous snapshot, including an unchanged style step', async () => {
  const out = await exported(makeDeck([step('grow', tween({ fontSize: 60 })), step('unchanged', tween({ fontSize: 60 }), { trigger: { type: 'click' } }),
    step('shrink', tween({ fontSize: 12 }), { trigger: { type: 'click' } })]));
  let visible = visibleAt(out, 0, 999);
  const held = new Set(visible);
  visible = visibleAt(out, 1, 999, visible);
  assert.deepEqual(visible, held);
  visible = visibleAt(out, 2, 999, visible);
  assert.equal(visible.size, 1);
  assert.equal(all(shapeMap(out).get([...visible][0]), 'rPr')[0].attributes.sz, String(12 * 75));
});

test('conflicting independent snapshot lanes are explicitly diagnosed per affected property', async () => {
  const out = await exported(makeDeck([step('font', tween({ fontSize: 60 })), step('line', tween({ strokeWidth: 20 }), { timelineId: 'other' })]));
  assert.equal(out.shapes.length, 1);
  assert.deepEqual(out.diagnostics.map(item => [item.code, item.property, item.animationId]), [
    ['animation-conflict', 'fontSize', 'font'], ['animation-conflict', 'strokeWidth', 'line'],
  ]);
});

test('snapshot sampling retains its quality beyond the former 200-shape animation cap', async () => {
  const source = makeDeck(Array.from({ length: 12 }, (_, index) => step(`s${index}`, tween({ fontSize: 30 + index * 2, strokeWidth: 3 + index / 3 }))));
  const out = await exported(source);
  assert.ok(out.shapes.length > 201 && out.shapes.length <= 1000);
  assert.equal(out.warnings.some(message => /間引/.test(message)), false);
  let visible;
  for (let index = 0; index < out.steps.length; index++) visible = visibleAt(out, index, 999, visible);
  assert.equal(visible.size, 1);
  assert.equal(all(shapeMap(out).get([...visible][0]), 'rPr')[0].attributes.sz, String(52 * 75));
});

test('same-lane global opacity is baked into style snapshots instead of multiplying discrete behaviors', async () => {
  const out = await exported(makeDeck([step('fade', tween({ opacity: .4 })), step('font', tween({ fontSize: 36 })), step('move', tween({ x: 300 }))]));
  assert.equal(all(out.steps[0], 'set').filter(node => attribute(node) === 'style.opacity').length, 0);
  assert.ok(all(out.root, 'set').length < 300);
  const imported = await m.importSlidePptx(out.blob);
  assert.ok(imported.deck.slides[0].animations.length >= 3);
  assert.equal(imported.warnings.some(message => /上限/.test(message)), false);
});

test('independent position and size lanes never emit competing native center channels', async () => {
  const out = await exported(makeDeck([step('move', tween({ x: 300 })), step('size', tween({ width: 300 }), { timelineId: 'size' })]));
  assert.equal(all(out.sequences[0], 'anim').filter(node => attribute(node) === 'ppt_x').length, 1);
  assert.equal(all(out.sequences[1], 'anim').filter(node => attribute(node) === 'ppt_x').length, 0);
  assert.equal(all(out.sequences[1], 'anim').filter(node => attribute(node) === 'ppt_w').length, 1);
  assert.ok(out.diagnostics.some(item => item.code === 'animation-conflict' && item.action === 'adjustment' && item.property === 'width' && item.animationId === 'size'));
});

test('snapshot insertion preserves original shape IDs and places every variant below the next source element', async () => {
  const source = makeDeck([step('font', tween({ fontSize: 60 }))]);
  const deck = m.createSlideDeck({ ...source, slides: [{ ...source.slides[0], animations: [step('font', tween({ fontSize: 60 }), { trigger: { type: 'click', elementId: 'foreground' } })], elements: [...source.slides[0].elements,
    m.createSlideElement({ id: 'foreground', type: 'text', text: 'Foreground' })] }] });
  const out = await exported(deck), shapeIds = [...shapeMap(out).keys()];
  assert.equal(shapeIds[0], '2');
  assert.equal(shapeIds.at(-1), '3');
  const condition = child(child(timing(out.steps[0]), 'stCondLst'), 'cond');
  assert.equal(child(child(condition, 'tgtEl'), 'spTgt').attributes.spid, '3');
});

test('snapshot overflow fails with a structured limit diagnostic and leaves input unchanged', async () => {
  const source = makeDeck([step('font', tween({ fontSize: 60 }))]);
  const deck = m.createSlideDeck({ ...source, slides: [{ ...source.slides[0], elements: [...source.slides[0].elements,
    ...Array.from({ length: 999 }, (_, index) => m.createSlideElement({ id: `e${index}`, type: 'shape' }))] }] });
  const before = JSON.stringify(deck), diagnostics = [];
  await assert.rejects(m.exportSlidePptx(deck, { onDiagnostic: item => diagnostics.push(item) }), /上限/);
  assert.equal(JSON.stringify(deck), before);
  assert.ok(diagnostics.some(item => item.code === 'animation-limit' && item.slideId === 'page'));
});

function nearCharacterLimit(snapshotAllowance) {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
  const first = { ...makeDeck([step('font', tween({ fontSize: 60 }))], { name: 'b'.repeat(1000), text: '' }).slides[0], notes: 'Initial note' };
  first.elements = [...first.elements, m.createSlideElement({ id: 'picture', type: 'image', name: 'Image name', alt: 'a'.repeat(1000), src: png })];
  const slides = [first, ...Array.from({ length: 20 }, (_, index) => ({ id: `notes-${index}`, name: 'Notes', notes: '', background: '#ffffff', elements: [] }))];
  slides[1].elements = [m.createSlideElement({ id: 'static-text', type: 'text', name: 'Static text', text: 'Body text' })];
  const existing = slides.reduce((sum, slide) => sum + slide.name.length + slide.notes.length + slide.elements.reduce((total, element) =>
    total + element.name.length + (element.type === 'image' ? element.alt.length : element.text.length), 0), 0);
  // The output includes the reusable default master/layout names in its budget.
  const generatedCatalogNames = 'LikeSlide'.length + 'Blank'.length;
  let remaining = m.SLIDE_LIMITS.totalTextLength - snapshotAllowance - existing - generatedCatalogNames;
  for (const slide of slides.slice(1)) {
    const length = Math.min(m.SLIDE_LIMITS.textLength, remaining);
    slide.notes = 'n'.repeat(length); remaining -= length;
  }
  assert.equal(remaining, 0);
  // A title has its own 1,000-character bound; it is not part of the existing
  // aggregate model budget and must not silently change this boundary.
  return m.createSlideDeck({ title: 'Title'.repeat(200), slides });
}

test('snapshot character budget counts all metadata at the exact file boundary without reducing quality', async () => {
  const source = nearCharacterLimit(32_000), out = await exported(source);
  assert.equal(out.shapes.length, 33, 'The initial shape and all 32 style samples retain the configured precision');
  assert.equal(out.warnings.some(message => /間引/.test(message)), false);
  const { deck } = await m.importSlidePptx(out.blob);
  const characters = deck.slides.reduce((sum, slide) => sum + slide.name.length + slide.notes.length + slide.elements.reduce((total, element) =>
    total + element.name.length + (element.type === 'image' ? element.alt.length : element.text.length), 0), 0);
  const catalogCharacters = [...deck.masters, ...deck.layouts].reduce((sum, definition) => sum + definition.name.length, 0);
  assert.equal(characters + catalogCharacters, m.SLIDE_LIMITS.totalTextLength);
  assert.equal(deck.title, source.title);
});

test('one character beyond the snapshot file budget rejects without reducing sampling quality', async () => {
  const source = nearCharacterLimit(31_999), before = JSON.stringify(source), diagnostics = [];
  await assert.rejects(m.exportSlidePptx(source, { onDiagnostic: item => diagnostics.push(item) }), /文字数/);
  assert.equal(JSON.stringify(source), before);
  assert.ok(diagnostics.some(item => item.code === 'animation-limit' && item.slideId === 'page'));
});

test('repeated snapshots can exceed 12,000 switches and 8 MiB while retaining each pass', async () => {
  const source = makeDeck([step('repeat', tween({ fontSize: 60 }, { repeat: 400 }))]);
  const out = await exported(source), sets = all(out.steps[0], 'set').filter(node => attribute(node) === 'style.visibility');
  assert.ok(sets.length > 24_000);
  assert.ok(out.blob.size > 8 * 1024 * 1024 && out.blob.size < 16 * 1024 * 1024);
  assert.equal(out.warnings.some(message => /上限|間引/.test(message)), false);
  const final = shapeMap(out).get([...visibleAt(out, 0, 399_999)][0]);
  assert.equal(all(final, 'rPr')[0].attributes.sz, String(60 * 75));
});

test('PPTX standard integer fields still reject unrepresentable times and repetition counts', async () => {
  for (const options of [{ durationMs: 0x100000000 }, { repeat: 0x100000000 }]) {
    await assert.rejects(m.exportSlidePptx(makeDeck([step('invalid', tween({ x: 300 }, options))])), /標準XML.*32ビット/);
  }
  const out = await exported(makeDeck([step('long', tween({ x: 300 }, { durationMs: 600_001 }))]));
  assert.equal(timing(out.steps[0]).attributes.dur, '600001');
});

test('PPTX export can be cancelled before or during snapshot conversion without changing the source', async () => {
  const source = makeDeck([step('repeat', tween({ fontSize: 60 }, { repeat: 400 }))]), before = JSON.stringify(source);
  const preCancelled = new AbortController(); preCancelled.abort();
  await assert.rejects(m.exportSlidePptx(source, { signal: preCancelled.signal }), { name: 'AbortError' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try { await assert.rejects(m.exportSlidePptx(source, { signal: controller.signal }), { name: 'AbortError' }); }
  finally { clearTimeout(timer); }
  assert.equal(JSON.stringify(source), before);
});

test('deep source animation groups flatten into the standard PPTX timing tree without recursive conversion', async () => {
  let animation = tween({ x: 300 });
  for (let index = 0; index < 2000; index++) animation = { type: 'parallel', children: [animation] };
  const out = await exported(makeDeck([step('nested', animation)]));
  assert.equal(all(out.root, 'anim').filter(node => attribute(node) === 'ppt_x').length, 1);
  assert.equal(timing(out.steps[0]).attributes.dur, '1000');
});
