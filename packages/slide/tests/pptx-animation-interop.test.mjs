import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry"; export {openOfficePackage,officeXml} from "./src/ooxml"; export {createZipArchive} from "./src/core";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSlidePptx, exportSlidePptx, createSlideDeck, createSlideElement, evaluateSlideAnimations, resolveSlideAnimations, openOfficePackage, officeXml, createZipArchive } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { child, localName, parseXml } = officeXml;
const fixtureRoot = new URL('fixtures/', import.meta.url);
const basic = new Uint8Array(await readFile(new URL('powerpoint-basic.pptx', fixtureRoot)));
const baselineWarnings = (await importSlidePptx(basic)).warnings;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .002, `${actual} ≈ ${expected}`);

async function independentPackage(profile, change = value => value) {
  // Only the standard timing fragment is authored here. Container/shape XML is
  // from the independent python-pptx fixture, never LikeSlide's export function.
  const xml = await readFile(new URL(`pptx-animation-${profile}.xml`, fixtureRoot), 'utf8');
  const timing = change(xml.slice(xml.indexOf('<p:timing')));
  const archive = await openOfficePackage(basic), entries = [];
  for (const path of archive.paths) {
    let content = await archive.read(path);
    if (path === 'ppt/slides/slide2.xml') content = new TextEncoder().encode(new TextDecoder().decode(content).replace('</p:sld>', `${timing}</p:sld>`));
    entries.push({ path, content: new Blob([content]) });
  }
  return createZipArchive(entries);
}

test('independent mainSeq reads click, piecewise keyframes, rotation, color and delayed centered scale', async () => {
  const { deck, warnings } = await importSlidePptx(await independentPackage('main-sequence'));
  const animationWarnings = warnings.filter(warning => !baselineWarnings.includes(warning));
  assert.equal(animationWarnings.length, 1);
  assert.match(animationWarnings[0], /拡大縮小.*文字/);
  const slide = deck.slides[1], original = slide.elements[1];
  assert.ok(slide.animations?.length);
  const waiting = evaluateSlideAnimations(slide, { elapsedMs: 0 });
  assert.equal(waiting.waitingForClick, true);
  close(waiting.slide.elements[1].x, original.x);
  const clicks = [{ elapsedMs: 100 }];
  const midpoint = evaluateSlideAnimations(slide, { elapsedMs: 600, clicks }).slide.elements[1];
  close(midpoint.x, .25 * deck.width - original.width / 2);
  close(midpoint.rotation, 52.5);
  assert.match(midpoint.fill, /^#994d33(?:ff)?$/);
  const beforeScale = evaluateSlideAnimations(slide, { elapsedMs: 1200, clicks }).slide.elements[1];
  close(beforeScale.width, original.width);
  const final = resolveSlideAnimations(slide).elements[1];
  close(final.width, original.width * 1.5);
  close(final.height, original.height * .5);
  close(final.x + final.width / 2, deck.width * .5);
  close(final.y + final.height / 2, original.y + original.height / 2);
  close(final.rotation, 90);
  assert.match(final.fill, /^#ff0000(?:ff)?$/);
  assert.equal(evaluateSlideAnimations(slide, { elapsedMs: 1800, clicks }).finished, true);
});

test('independent interactiveSeq targets its shape and uses thousandth repeat counts with autoreverse', async () => {
  const { deck, warnings } = await importSlidePptx(await independentPackage('interactive-sequence'));
  assert.deepEqual(warnings, baselineWarnings);
  const slide = deck.slides[1], target = slide.elements[1];
  const waiting = evaluateSlideAnimations(slide, { elapsedMs: 0 });
  assert.equal(waiting.waitingForClick, true);
  assert.equal(waiting.waitingTargetId, target.id);
  assert.equal(evaluateSlideAnimations(slide, { elapsedMs: 1000, clicks: [{ elapsedMs: 0, elementId: slide.elements[0].id }] }).waitingForClick, true);
  const clicks = [{ elapsedMs: 100, elementId: target.id }];
  close(evaluateSlideAnimations(slide, { elapsedMs: 350, clicks }).slide.elements[1].rotation, 52.5);
  close(evaluateSlideAnimations(slide, { elapsedMs: 600, clicks }).slide.elements[1].rotation, 90);
  close(evaluateSlideAnimations(slide, { elapsedMs: 1100, clicks }).slide.elements[1].rotation, 15);
  assert.equal(evaluateSlideAnimations(slide, { elapsedMs: 1100, clicks }).finished, false);
  const final = evaluateSlideAnimations(slide, { elapsedMs: 2100, clicks });
  assert.equal(final.finished, true);
  close(final.slide.elements[1].rotation, 15);
});

function animatedDeck() {
  const element = createSlideElement({ id: 'shape', type: 'shape', shape: 'rect', x: 60, y: 90, width: 240, height: 120, fill: '#339966' });
  const independent = createSlideElement({ id: 'independent-shape', type: 'shape', shape: 'ellipse', x: 400, y: 300 });
  return createSlideDeck({ slides: [{ id: 'page', name: 'Schema validation', background: '#ffffff', notes: '', elements: [element, independent], animations: [
    { id: 'movement', trigger: { type: 'click', elementId: element.id }, animation: { type: 'sequence', children: [
      { type: 'parallel', children: [
        { type: 'tween', elementId: element.id, durationMs: 250, to: { x: 100, y: 200, width: 400, height: 200 } },
        { type: 'tween', elementId: element.id, durationMs: 500, easing: 'bounce', to: { rotation: 90, fill: '#ff000080', stroke: '#334455', strokeWidth: 4 } },
      ] },
      { type: 'tween', elementId: element.id, durationMs: 200, delayMs: 50, repeat: 2, yoyo: true, to: { opacity: .4, fontSize: 40 } },
    ] } },
    { id: 'fade', trigger: { type: 'after-delay', delayMs: 300 }, animation: { type: 'tween', elementId: element.id, durationMs: 500, from: { opacity: 0 }, to: { opacity: 1 } } },
    { id: 'independent-click', timelineId: 'secondary', trigger: { type: 'click', elementId: independent.id }, animation: { type: 'tween', elementId: independent.id, durationMs: 700, to: { x: 500, rotation: 30 } } },
  ] }] });
}

test('native timing export follows PowerPoint root/depth restrictions and uses unique time node IDs', async () => {
  const file = await exportSlidePptx(animatedDeck());
  const archive = await openOfficePackage(file), root = parseXml(await archive.read('ppt/slides/slide1.xml'));
  const roots = child(child(root, 'timing'), 'tnLst')?.children ?? [];
  assert.equal(roots.length, 1);
  assert.equal(localName(roots[0].name), 'par');
  const ids = [], behaviors = new Set(['anim', 'animClr', 'animEffect', 'animMotion', 'animRot', 'animScale', 'cmd', 'set']);
  function visit(node, depth) {
    const kind = localName(node.name), timing = child(node, 'cTn') ?? child(child(node, 'cBhvr'), 'cTn');
    assert.ok(timing, `Expected time node for ${kind}`);
    assert.ok(timing.attributes.id);
    ids.push(timing.attributes.id);
    const nested = child(timing, 'childTnLst')?.children ?? [];
    if (depth >= 5 && !behaviors.has(kind)) assert.ok(nested.length > 0 && nested.every(item => behaviors.has(localName(item.name))), `At depth ${depth}, container ${kind} must directly hold only behaviors`);
    for (const next of nested) visit(next, depth + 1);
  }
  visit(roots[0], 1);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 5, 'The check must exercise native animation behavior output');
  assert.equal(archive.paths.some(path => path.startsWith('customXml/')), false);
});

const validatorDll = process.env.LIKEX_OPENXML_VALIDATOR;
test('optional Microsoft Open XML SDK validates independent fixtures and actual animation output', { skip: !validatorDll }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likex-pptx-interop-'));
  try {
    const cases = [
      ['independent-main', await independentPackage('main-sequence')],
      ['independent-interactive', await independentPackage('interactive-sequence')],
      ['likex-export', await exportSlidePptx(animatedDeck())],
    ];
    const paths = [];
    for (const [name, blob] of cases) {
      const path = join(directory, `${name}.pptx`);
      await writeFile(path, new Uint8Array(await blob.arrayBuffer())); paths.push(path);
    }
    const run = promisify(execFile);
    let result;
    try { result = await run(process.env.LIKEX_DOTNET ?? 'dotnet', [validatorDll, ...paths], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); }
    catch (error) { assert.fail(`Open XML SDK validation failed: ${error.stdout ?? ''}\n${error.stderr ?? error.message}`); }
    const reports = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(reports.length, cases.length);
    for (const report of reports) assert.deepEqual(report.Errors, [], JSON.stringify(report));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
