import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export * from './src/model-entry';
  export { openOfficePackage } from './src/ooxml';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSlidePptx, evaluateSlideAnimations, resolveSlideAnimations, openOfficePackage } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const fixture = new Uint8Array(await readFile(new URL('fixtures/openxml-sdk-powerpoint-fly-in.pptx', import.meta.url)));
const tweens = node => node.type === 'tween' ? [node] : node.children.flatMap(tweens);

test('official SDK fixture retains pinned upstream bytes and its PowerPoint application metadata', async () => {
  assert.equal(fixture.byteLength, 50034);
  assert.equal(createHash('sha256').update(fixture).digest('hex'), '67554040bbcae362b91b9fab72b58dfce5bd885307ed28a1777ac319e5528233');
  const archive = await openOfficePackage(fixture);
  const xml = async path => new TextDecoder().decode(await archive.read(path));
  const app = await xml('docProps/app.xml'), core = await xml('docProps/core.xml'), slide = await xml('ppt/slides/slide1.xml');
  assert.match(app, /<Application>Microsoft Office PowerPoint<\/Application>/);
  assert.match(app, /<AppVersion>12\.0000<\/AppVersion>/);
  assert.match(core, /<dc:creator>officese<\/dc:creator>/);
  assert.match(core, /<cp:lastModifiedBy>GPU Test Lab<\/cp:lastModifiedBy>/);
  assert.match(core, /2006-07-06T22:20:04Z/); assert.match(core, /2006-08-28T23:28:29Z/);
  assert.match(slide, /nodeType="mainSeq"/);
  assert.match(slide, /val="1\+#ppt_h\/2"/);
  assert.match(slide, /<p:txEl><p:pRg st="0" end="0"\/><\/p:txEl>/);
});

test('unmodified PowerPoint fixture keeps supported timing and attributes omissions to formula and paragraph targets', async () => {
  const { deck, diagnostics } = await importSlidePptx(fixture);
  assert.equal(deck.slides.length, 1); assert.deepEqual([deck.width, deck.height], [960, 720]);
  const slide = deck.slides[0], [title, body] = slide.elements;
  assert.equal(slide.elements.length, 2);
  assert.equal(title.text, 'Text: 100 characters');
  assert.equal(body.text, '29% of slides created in a typical PowerPoint presentation contain only text\nThe percentage ha');
  assert.deepEqual([title.x, title.width, title.height, body.x, body.y, body.width], [48, 864, 120, 48, 168, 864]);
  const motions = slide.animations.flatMap(step => tweens(step.animation));
  const supported = motions.filter(tween => tween.to.x !== undefined);
  assert.equal(supported.length, 1);
  assert.equal(supported[0].elementId, title.id); assert.equal(supported[0].durationMs, 500);
  assert.deepEqual(supported[0].from, { x: 48 }); assert.deepEqual(supported[0].to, { x: 48 });
  assert.ok(motions.every(tween => tween.to.y === undefined), 'the unsupported Fly In Y formula must not be guessed');
  assert.equal(evaluateSlideAnimations(slide, { elapsedMs: 1000 }).waitingForClick, true);
  const active = evaluateSlideAnimations(slide, { elapsedMs: 350, clicks: [{ elapsedMs: 100 }] });
  assert.equal(active.stepStartMs, 100); assert.equal(active.stepEndMs, 600);
  assert.equal(active.slide.elements[0].x, 48); assert.equal(active.slide.elements[0].y, title.y);
  assert.deepEqual(resolveSlideAnimations(slide).elements.map(element => [element.x, element.y]), slide.elements.map(element => [element.x, element.y]));

  const formula = diagnostics.find(item => item.timingId === '8' && item.code === 'unsupported-animation');
  assert.ok(formula); assert.equal(formula.action, 'omission'); assert.equal(formula.phase, 'import');
  assert.equal(formula.sourcePart, 'ppt/slides/slide1.xml'); assert.equal(formula.property, 'ppt_y');
  assert.equal(formula.elementId, title.id); assert.equal(formula.animationId, slide.animations[0].id);
  assert.match(formula.message, /数値|数式/);
  for (const [timingId, property] of [['10', 'style.visibility'], ['11', 'ppt_x'], ['12', 'ppt_y'], ['16', 'style.visibility'], ['17', 'ppt_x'], ['18', 'ppt_y']]) {
    const diagnostic = diagnostics.find(item => item.timingId === timingId && item.code === 'unsupported-animation');
    assert.ok(diagnostic, `missing paragraph diagnostic for timing ${timingId}`);
    assert.equal(diagnostic.action, 'omission'); assert.equal(diagnostic.sourcePart, 'ppt/slides/slide1.xml');
    assert.equal(diagnostic.property, property); assert.equal(diagnostic.elementId, body.id);
    assert.match(diagnostic.message, /図形全体以外/);
  }
});
