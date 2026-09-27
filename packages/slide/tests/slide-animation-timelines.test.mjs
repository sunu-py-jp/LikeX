import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export * from './src/model-entry';
  export { getSlideAnimationPlan } from './src/model/animations';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const tween = (elementId, to, patch = {}) => ({ type: 'tween', elementId, durationMs: 100, to, ...patch });
const step = (id, to, patch = {}) => ({ id, animation: tween('a', to), ...patch });
const deck = animations => m.createSlideDeck({ id: 'deck', slides: [{ id: 'page', name: 'Page', notes: '', background: '#fff',
  elements: ['a', 'b'].map(id => m.createSlideElement({ type: 'shape', id, name: id, x: 0, y: 0, rotation: 0 })), animations }] });
const frame = (source, elapsedMs, clicks) => m.evaluateSlideAnimations(source.slides[0], { elapsedMs, clicks });
const element = result => result.slide.elements[0];

test('interleaved independent timelines begin at page start and retain their own sequential values', () => {
  const source = deck([
    step('main-first', { x: 100 }),
    step('side-first', {}, { timelineId: 'side', animation: tween('a', { y: 100 }, { durationMs: 200 }) }),
    step('main-second', { x: 200 }),
    step('side-second', { y: 200 }, { timelineId: 'side' }),
  ]);
  assert.deepEqual([element(frame(source, 50)).x, element(frame(source, 50)).y], [50, 25]);
  assert.deepEqual([element(frame(source, 150)).x, element(frame(source, 150)).y], [150, 75]);
  assert.deepEqual([element(frame(source, 250)).x, element(frame(source, 250)).y], [200, 150]);
  assert.equal(frame(source, 299).finished, false);
  assert.equal(frame(source, 300).finished, true);
  assert.deepEqual(frame(source, 50).activeSteps.map(step => [step.stepId, step.stepEndMs]), [['main-first', 100], ['side-first', 200]]);
  const plan = m.getSlideAnimationPlan(source.slides[0]);
  assert.deepEqual(plan.steps.map(step => step.definition.id), ['main-first', 'side-first', 'main-second', 'side-second']);
  assert.deepEqual(plan.timelines.map(lane => [lane.timelineId, lane.steps.map(step => step.definition.id)]), [
    [undefined, ['main-first', 'main-second']], ['side', ['side-first', 'side-second']],
  ]);
  assert.equal(plan.timelines[0].final.elements[0].y, 0);
  assert.equal(plan.timelines[1].final.elements[0].x, 0);
  assert.equal(m.getElement(source, 'page', 'a').x, 200);
  assert.equal(m.getElement(source, 'page', 'a').y, 200);
  assert.equal(m.getDeck(source, { includeAnimations: true }), source);
});

test('waiting targeted lanes do not pause or overwrite running lanes on the same element', () => {
  const source = deck([
    step('target', { x: 100 }, { timelineId: 'targeted', trigger: { type: 'click', elementId: 'b' } }),
    step('auto', { y: 100 }),
  ]);
  const waiting = frame(source, 50);
  assert.equal(waiting.waitingForClick, true);
  assert.deepEqual(waiting.waitingSteps, [{ stepId: 'target', timelineId: 'targeted', waitingTargetId: 'b' }]);
  assert.deepEqual(waiting.activeSteps, [{ stepId: 'auto', stepStartMs: 0, stepEndMs: 100 }]);
  assert.equal(element(waiting).y, 50);
  const clicked = frame(source, 75, [{ elapsedMs: 25, elementId: 'a' }, { elapsedMs: 50, elementId: 'b' }]);
  assert.deepEqual([element(clicked).x, element(clicked).y], [25, 75]);
  assert.equal(frame(source, 150, [{ elapsedMs: 50, elementId: 'b' }]).finished, true);
  assert.ok(Object.isFrozen(waiting.waitingSteps) && Object.isFrozen(waiting.waitingSteps[0]));
  assert.ok(Object.isFrozen(waiting.activeSteps) && Object.isFrozen(waiting.activeSteps[0]));
});

test('clicks are independently consumed once per eligible lane and never reused for later steps', () => {
  const source = deck([
    step('main-one', { x: 100 }, { trigger: { type: 'click' } }),
    step('side-one', { y: 100 }, { timelineId: 'side', trigger: { type: 'click', elementId: 'b' } }),
    step('main-two', { x: 200 }, { trigger: { type: 'click' } }),
    step('side-two', { y: 200 }, { timelineId: 'side', trigger: { type: 'click', elementId: 'b' } }),
  ]);
  const clicks = [{ elapsedMs: 20, elementId: 'a' }, { elapsedMs: 40, elementId: 'b' }];
  const middle = frame(source, 70, clicks);
  assert.deepEqual([element(middle).x, element(middle).y], [50, 30]);
  assert.deepEqual(frame(source, 140, clicks).waitingSteps.map(step => step.stepId), ['main-two', 'side-two']);
  assert.deepEqual(frame(source, 170, [...clicks, { elapsedMs: 150, elementId: 'b' }]).activeSteps.map(step => step.stepId), ['main-two', 'side-two']);
  assert.equal(frame(source, 250, [...clicks, { elapsedMs: 150, elementId: 'b' }]).finished, true);
  assert.deepEqual(clicks, [{ elapsedMs: 20, elementId: 'a' }, { elapsedMs: 40, elementId: 'b' }]);
});

test('named timelines retain explicit origins, unwrapped rotations, delays, repeats and yoyo', () => {
  const source = deck([
    step('turn-one', { rotation: 360 }), step('turn-two', { rotation: 720 }),
    step('side', {}, { timelineId: 'side', trigger: { type: 'after-delay', delayMs: 25 },
      animation: tween('a', { y: 100 }, { from: { y: 20 }, repeat: 2, yoyo: true }) }),
  ]);
  assert.deepEqual([element(frame(source, 20)).rotation, element(frame(source, 20)).y], [72, 0]);
  assert.deepEqual([element(frame(source, 150)).rotation, element(frame(source, 150)).y], [180, 80]);
  assert.equal(frame(source, 425).finished, true);
  assert.deepEqual([element(frame(source, 425)).rotation, element(frame(source, 425)).y], [0, 20]);
});

test('cross-lane conflicting writes and invalid timeline IDs reject atomically', () => {
  for (const timelineId of ['', ' padded', 'has space', 10, null]) assert.throws(() => deck([step('s', { x: 1 }, { timelineId })]));
  assert.throws(() => deck([step('main', { x: 100 }), step('side', { x: 200 }, { timelineId: 'side', trigger: { type: 'after-delay', delayMs: 1000 } })]), /独立タイムライン/);
  assert.throws(() => deck([step('main', { x: 100 }), step('side', {}, { timelineId: 'side', animation: tween('a', { y: 100 }, { from: { x: 10 } }) })]), /独立タイムライン/);
  const source = deck([step('main', { x: 100 })]), before = m.serializeSlideDeck(source);
  assert.throws(() => m.applySlideCommands(source, [
    { type: 'deck.rename', title: 'discard' },
    { type: 'animation.set', slideId: 'page', animations: [...source.slides[0].animations, step('side', { x: 200 }, { timelineId: 'side' })] },
  ]), /独立タイムライン/);
  assert.equal(m.serializeSlideDeck(source), before);
});

test('independent timelines do not sum their unrelated finite durations', () => {
  const source = deck([
    step('main', {}, { animation: tween('a', { x: 100 }, { durationMs: 1e308 }) }),
    step('side', {}, { timelineId: 'side', animation: tween('b', { x: 100 }, { durationMs: 1e308 }) }),
  ]);
  assert.equal(frame(source, 5e307).slide.elements[0].x, 50);
  assert.equal(frame(source, 5e307).slide.elements[1].x, 50);
  assert.equal(frame(source, 1e308).finished, true);
});

test('native storage, semantic history and duplication retain independent timeline groups', () => {
  const source = deck([
    step('main', { x: 100 }),
    step('side-one', { y: 100 }, { timelineId: 'side', trigger: { type: 'click', elementId: 'a' } }),
    step('side-two', { y: 200 }, { timelineId: 'side' }),
  ]);
  const saved = m.serializeSlideDeck(source);
  assert.equal(m.serializeSlideDeck(m.parseSlideDeck(saved)), saved);
  assert.equal(m.parseSlideDeck(saved).slides[0].animations[1].timelineId, 'side');
  const session = m.createSlideSession(source);
  session.execute({ type: 'animation.set', slideId: 'page', animations: source.slides[0].animations.map(step => ({ ...step, timelineId: undefined })) });
  assert.equal(session.getSnapshot().dirty, true);
  session.undo(); assert.equal(session.getSnapshot().deck, source); assert.equal(session.getSnapshot().dirty, false);
  session.redo(); assert.ok(session.getSnapshot().deck.slides[0].animations.every(step => step.timelineId === undefined));
  const copiedSlide = m.applySlideCommands(source, { type: 'slide.duplicate', slideId: 'page' }).deck.slides[1];
  assert.deepEqual(copiedSlide.animations.map(step => step.timelineId), [undefined, 'side', 'side']);
  const copied = m.applySlideCommands(source, { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] });
  const [first, second] = copied.deck.slides[0].animations.slice(4);
  assert.notEqual(first.timelineId, 'side'); assert.equal(first.timelineId, second.timelineId);
  assert.equal(first.trigger.elementId, copied.elementIds[0]);
  assert.equal(first.animation.elementId, copied.elementIds[0]);
  assert.equal(second.animation.to.y, 220);
  const deleted = m.applySlideCommands(source, { type: 'element.delete', slideId: 'page', elementIds: ['b'] }).deck;
  assert.deepEqual(deleted.slides[0].animations, source.slides[0].animations);
});

test('legacy main-only frames keep their original public shape and absent IDs are not synthesized', () => {
  const source = deck([step('waiting', { x: 100 }, { trigger: { type: 'click' } })]);
  assert.deepEqual(Object.keys(frame(source, 0)).sort(), ['finished', 'slide', 'stepId', 'waitingForClick']);
  assert.equal(Object.hasOwn(source.slides[0].animations[0], 'timelineId'), false);
  const named = frame(deck([step('named', { x: 100 }, { timelineId: 'lane' })]), 25);
  assert.equal(named.activeSteps[0].timelineId, 'lane');
});
