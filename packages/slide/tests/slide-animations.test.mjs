import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['src/model-entry.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const element = (id = 'a', patch = {}) => m.createSlideElement({ type: 'shape', id, x: 0, y: 0, width: 100, height: 100, ...patch });
const tween = (elementId = 'a', to = { x: 100 }, patch = {}) => ({ type: 'tween', elementId, durationMs: 100, to, ...patch });
const step = (id = 's1', animation = tween(), trigger) => ({ id, animation, ...(trigger ? { trigger } : {}) });
const deck = (animations, elements = [element()]) => m.createSlideDeck({ id: 'deck', slides: [{ id: 'page', name: 'Page', background: '#fff', notes: '', elements, ...(animations === undefined ? {} : { animations }) }] });
const frame = (source, elapsedMs, clicks) => m.evaluateSlideAnimations(source.slides[0], { elapsedMs, ...(clicks ? { clicks } : {}) });
const value = (result, key = 'x', id = 'a') => result.slide.elements.find(element => element.id === id)[key];
const throwsAnimation = (animations, match) => assert.throws(() => deck(animations), match);

test('optional animations preserve static v1 bytes and deeply freeze normalized definitions', () => {
  const legacy = deck();
  assert.equal(m.serializeSlideDeck(legacy), m.serializeSlideDeck(deck([])));
  assert.equal('animations' in deck([]).slides[0], false);
  const input = [step('s1', { type: 'sequence', children: [tween('a', { fill: '#ABC', x: 20 }, { from: { fill: '#1234' } })] })];
  const accepted = deck(input);
  input[0].animation.children[0].to.x = 99;
  const stored = accepted.slides[0].animations;
  assert.equal(stored[0].animation.children[0].to.x, 20);
  assert.equal(stored[0].animation.children[0].to.fill, '#aabbcc');
  assert.ok(Object.isFrozen(stored) && Object.isFrozen(stored[0]) && Object.isFrozen(stored[0].animation.children));
  assert.ok(Object.isFrozen(stored[0].animation.children[0].from));
  const saved = m.serializeSlideDeck(accepted);
  assert.equal(m.serializeSlideDeck(m.parseSlideDeck(saved)), saved);
  assert.deepEqual(m.parseSlideDeck(saved), accepted);
});

test('headless getters return final static state by default and raw definitions only on request', () => {
  const source = deck([step()]);
  assert.equal(m.getDeck(source).slides[0].elements[0].x, 100);
  assert.equal(m.getSlides(source)[0].animations, undefined);
  assert.equal(m.getSlide(source, 'page').elements[0].x, 100);
  assert.equal(m.getElements(source, 'page')[0].x, 100);
  assert.equal(m.getElement(source, 'page', 'a').x, 100);
  assert.equal(m.getDeck(source, { includeAnimations: true }), source);
  assert.equal(m.getSlide(source, 'page', { includeAnimations: true }), source.slides[0]);
  assert.equal(m.getElements(source, 'page', { includeAnimations: true })[0].x, 0);
  assert.equal(m.getElement(source, 'page', 'a', { includeAnimations: true }).x, 0);
  assert.equal(m.getAnimations(source, 'page'), source.slides[0].animations);
  assert.equal(m.getSlide(source, 'missing'), undefined);
  assert.equal(m.getElement(source, 'page', 'missing'), undefined);
  assert.deepEqual(m.getElements(source, 'missing'), []);
  assert.deepEqual(m.getAnimations(source, 'missing'), []);
  assert.ok(Object.isFrozen(m.getDeck(source)) && Object.isFrozen(m.getElements(source, 'missing')));
  assert.throws(() => m.getDeck(source, { includeAnimations: 1 }));
  assert.throws(() => m.getSlide(source, 'page', { unknown: true }));
  const edit = m.applySlideCommands(source, { type: 'element.update', slideId: 'page', elementId: 'a', patch: { y: 23 } }).deck;
  assert.equal(edit.slides[0].elements[0].x, 0);
  assert.equal(edit.slides[0].elements[0].y, 23);
  assert.deepEqual(edit.slides[0].animations, source.slides[0].animations);
});

test('nested sequence and parallel groups capture current values at each tween start', () => {
  const source = deck([step('s1', { type: 'sequence', children: [
    { type: 'parallel', children: [tween('a', { x: 100 }), tween('a', { y: 40 }, { durationMs: 200 })] },
    tween('a', { x: 200 }, { delayMs: 50 }),
  ] })]);
  assert.equal(value(frame(source, 50)), 50);
  assert.equal(value(frame(source, 50), 'y'), 10);
  assert.equal(value(frame(source, 225)), 100);
  assert.equal(value(frame(source, 300)), 150);
  assert.equal(frame(source, 350).finished, true);
  assert.equal(frame(source, 350).slide.animations, undefined);
  assert.equal(value(frame(source, 350), 'y'), 40);
  assert.equal(m.resolveSlideAnimations(source.slides[0]).elements[0].x, 200);
});

test('explicit from takes effect only at the start, including properties absent from to', () => {
  const source = deck([step('s1', tween('a', { x: 200 }, { delayMs: 50, from: { x: 100, opacity: 0.4 } }))]);
  assert.equal(value(frame(source, 49)), 0);
  assert.equal(value(frame(source, 49), 'opacity'), 1);
  assert.equal(value(frame(source, 50)), 100);
  assert.equal(value(frame(source, 100)), 150);
  assert.equal(value(frame(source, 150), 'opacity'), 0.4);
});

test('triggers use preceding completion and consume only matching chronological clicks', () => {
  const source = deck([step(), step('s2', tween('a', { x: 200 }), { type: 'click', elementId: 'a' }),
    step('s3', tween('a', { x: 300 }), { type: 'click' })]);
  const clicks = [{ elapsedMs: 50, elementId: 'a' }, { elapsedMs: 150, elementId: 'b' }, { elapsedMs: 200, elementId: 'a' }];
  assert.deepEqual(frame(source, 180, clicks), { slide: m.resolveSlideAnimations(deck([step()]).slides[0]), finished: false, waitingForClick: true, stepId: 's2', waitingTargetId: 'a' });
  assert.equal(value(frame(source, 250, clicks)), 150);
  const waiting = frame(source, 99999, clicks);
  assert.equal(waiting.stepId, 's3');
  assert.equal(waiting.waitingForClick, true);
  assert.equal(value(waiting), 200);
  assert.equal(frame(source, 450, [...clicks, { elapsedMs: 350 }]).finished, true);
  assert.equal(value(frame(source, 450, [...clicks, { elapsedMs: 350 }])), 300);
  assert.equal(source.slides[0].elements[0].x, 0);
});

test('after-delay and active frames report page-relative start and end boundaries', () => {
  const source = deck([step('s1', tween(), { type: 'after-delay', delayMs: 40 }), step('s2', tween('a', { y: 100 }), { type: 'after-delay', delayMs: 20 })]);
  assert.deepEqual([frame(source, 20).stepStartMs, frame(source, 20).stepEndMs], [40, 140]);
  assert.equal(value(frame(source, 20)), 0);
  assert.equal(value(frame(source, 90)), 50);
  assert.deepEqual([frame(source, 140).stepStartMs, frame(source, 140).stepEndMs], [160, 260]);
  assert.equal(frame(source, 260).finished, true);
  assert.equal(m.resolveSlideAnimations(source.slides[0]).elements[0].y, 100);
});

test('finite repeats restart each iteration and yoyo repeats end at their captured origin', () => {
  const repeated = deck([step('s1', tween('a', { x: 100 }, { repeat: 2, delayMs: 20 }))]);
  assert.equal(value(frame(repeated, 70)), 50);
  assert.equal(value(frame(repeated, 120)), 0);
  assert.equal(value(frame(repeated, 170)), 50);
  assert.equal(value(frame(repeated, 220)), 100);
  const yoyo = deck([step('s1', tween('a', { x: 100 }, { repeat: 2, yoyo: true }))]);
  assert.equal(value(frame(yoyo, 100)), 100);
  assert.equal(value(frame(yoyo, 150)), 50);
  assert.equal(value(frame(yoyo, 200)), 0);
  assert.equal(value(frame(yoyo, 350)), 50);
  assert.equal(value(frame(yoyo, 400)), 0);
  assert.equal(m.resolveSlideAnimations(yoyo.slides[0]).elements[0].x, 0);
});

test('all easing modes interpolate, spring overshoots, and constrained properties clamp', () => {
  const expected = { linear: 25, 'ease-in': 6.25, 'ease-out': 43.75, 'ease-in-out': 12.5 };
  for (const [easing, x] of Object.entries(expected)) assert.equal(value(frame(deck([step('s', tween('a', { x: 100 }, { easing }))]), 25)), x);
  const spring = deck([step('s', tween('a', { x: 100, width: 1, opacity: 0, fontSize: 1, strokeWidth: 0 }, { easing: 'spring' }))]);
  assert.ok(value(frame(spring, 30)) > 100);
  assert.ok(value(frame(spring, 30), 'width') > 0);
  assert.equal(value(frame(spring, 30), 'opacity'), 0);
  assert.equal(value(frame(spring, 30), 'fontSize'), 1);
  assert.equal(value(frame(spring, 30), 'strokeWidth'), 0);
  const bounce = frame(deck([step('s', tween('a', { x: 100 }, { easing: 'bounce' }))]), 50);
  assert.ok(value(bounce) > 0 && value(bounce) < 100);
});

test('color tweening supports hex alpha and transparent without replacing RGB with black', () => {
  const source = deck([step('s', tween('a', { fill: '#ffffff' }, { from: { fill: '#000000' } }))]);
  assert.equal(value(frame(source, 50), 'fill'), '#808080ff');
  const fade = deck([step('s', tween('a', { fill: '#ff0000' }, { from: { fill: 'transparent' } }))]);
  assert.equal(value(frame(fade, 50), 'fill'), '#ff000080');
  assert.equal(value(frame(fade, 100), 'fill'), '#ff0000');
});

test('overlapping writes reject nested parallel conflicts while disjoint properties and adjacent writes work', () => {
  throwsAnimation([step('s', { type: 'parallel', children: [tween(), { type: 'sequence', children: [tween('a', { x: 20 })] }] })], /同時に変更/);
  throwsAnimation([step('s', { type: 'parallel', children: [tween('a', { y: 20 }, { from: { x: 1 } }), tween()] })], /同時に変更/);
  assert.doesNotThrow(() => deck([step('s', { type: 'parallel', children: [tween(), tween('a', { x: 20 }, { delayMs: 100 })] })]));
  assert.doesNotThrow(() => deck([step('s', { type: 'parallel', children: [tween(), tween('a', { y: 20 })] })]));
  assert.doesNotThrow(() => deck([step('s', { type: 'parallel', children: [tween(), tween('b')] })], [element(), element('b')]));
});

test('definition validation rejects unknown keys, accessors, sparse lists and target-incompatible properties', () => {
  for (const animation of [tween('missing'), tween('a', {}), tween('a', { color: '#fff' }), tween('a', { x: Infinity }),
    tween('a', { width: 0 }), tween('a', { opacity: 2 }), tween('a', { fill: 'url(https://evil)' }), tween('a', { x: 1 }, { durationMs: 0 }),
    tween('a', { x: 1 }, { repeat: 1.2 }), tween('a', { x: 1 }, { repeat: 101 }), tween('a', { x: 1 }, { yoyo: 1 }),
    tween('a', { x: 1 }, { easing: 'custom' }), { type: 'parallel', children: [] }, { type: 'sequence', children: Array(1) }]) throwsAnimation([step('s', animation)]);
  throwsAnimation([{ ...step(), extra: true }]);
  throwsAnimation([step(), step()]);
  throwsAnimation([step('s', tween(), { type: 'click', elementId: 'missing' })]);
  throwsAnimation([step('s', tween(), { type: 'immediate', delayMs: 2 })]);
  throwsAnimation([step('s', tween(), { type: 'after-delay', delayMs: -1 })]);
  let invoked = false;
  const props = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  throwsAnimation([step('s', tween('a', props))]);
  assert.equal(invoked, false);
  assert.throws(() => deck([step('s', tween('a', { stroke: '#fff' }))], [m.createSlideElement({ type: 'text', id: 'a' })]));
});

test('node count, recursion depth and aggregate intrinsic duration are bounded before evaluation', () => {
  let nested = tween();
  for (let i = 0; i < 8; i++) nested = { type: 'sequence', children: [nested] };
  throwsAnimation([step('s', nested)], /深さ/);
  throwsAnimation([step('s', { type: 'parallel', children: Array.from({ length: 500 }, () => tween()) })], /ノード数/);
  throwsAnimation([step('s', tween('a', { x: 1 }, { durationMs: 400000, yoyo: true }))], /時間/);
  throwsAnimation([step('s1', tween('a', { x: 1 }, { durationMs: 300001 })), step('s2', tween('a', { x: 2 }, { durationMs: 300000 }))], /時間/);
  throwsAnimation([step('s', tween('a', { x: 1 }, { durationMs: 300000 }), { type: 'after-delay', delayMs: 300001 })], /時間/);
  assert.doesNotThrow(() => deck([step('s', tween('a', { x: 1 }, { durationMs: 600000 }))]));
});

test('evaluation rejects invalid time and unsorted clicks without changing the immutable input', () => {
  const source = deck([step()]);
  for (const options of [{ elapsedMs: -1 }, { elapsedMs: Infinity }, { elapsedMs: 1, extra: true },
    { elapsedMs: 1, clicks: [{ elapsedMs: 2 }, { elapsedMs: 1 }] }, { elapsedMs: 1, clicks: Array(1) },
    { elapsedMs: 1, clicks: [{ elapsedMs: 1, elementId: ' bad' }] }]) assert.throws(() => m.evaluateSlideAnimations(source.slides[0], options));
  assert.equal(frame(source, 0).slide.elements[0].x, 0);
  assert.equal(frame(deck(), 0).finished, true);
});

test('animation commands compare nested content semantically and failed batches are atomic', () => {
  const initial = deck([step()]);
  const same = structuredClone(initial.slides[0].animations);
  same[0].animation.to = Object.fromEntries(Object.entries(same[0].animation.to).reverse());
  assert.equal(m.applySlideCommands(initial, { type: 'animation.set', slideId: 'page', animations: same }).deck, initial);
  const changed = m.applySlideCommands(initial, { type: 'animation.set', slideId: 'page', animations: [step('s1', tween('a', { y: 30 }))] });
  assert.equal(changed.changed, true);
  assert.equal(changed.deck.slides[0].elements[0].x, 0);
  assert.equal(m.getElement(changed.deck, 'page', 'a').y, 30);
  const removed = m.applySlideCommands(changed.deck, { type: 'animation.remove', slideId: 'page', animationId: 's1' });
  assert.equal(removed.deck.slides[0].animations, undefined);
  assert.throws(() => m.applySlideCommands(initial, [{ type: 'deck.rename', title: 'discard' }, { type: 'animation.set', slideId: 'page', animations: [step('bad', tween('missing'))] }]));
  assert.throws(() => m.applySlideCommands(initial, { type: 'animation.remove', slideId: 'page', animationId: 'missing' }));
  assert.throws(() => m.applySlideCommands(initial, { type: 'animation.set', slideId: 'page' }));
  assert.equal(initial.title, '新しいプレゼンテーション');
});

test('slide duplication remaps all step and element IDs including click targets', () => {
  const source = deck([step('s', { type: 'sequence', children: [tween(), tween('b')] }, { type: 'click', elementId: 'b' })], [element(), element('b')]);
  const duplicate = m.applySlideCommands(source, { type: 'slide.duplicate', slideId: 'page' }).deck.slides[1];
  assert.notEqual(duplicate.animations[0].id, 's');
  assert.equal(duplicate.animations[0].animation.children[0].elementId, duplicate.elements[0].id);
  assert.equal(duplicate.animations[0].animation.children[1].elementId, duplicate.elements[1].id);
  assert.equal(duplicate.animations[0].trigger.elementId, duplicate.elements[1].id);
  assert.equal(source.slides[0].animations[0].trigger.elementId, 'b');
});

test('element duplication extracts only copied targets and remaps a copied click target', () => {
  const source = deck([step('s', { type: 'parallel', children: [tween(), tween('b')] }, { type: 'click', elementId: 'a' })], [element(), element('b')]);
  const result = m.applySlideCommands(source, { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] });
  const animations = result.deck.slides[0].animations;
  assert.equal(animations.length, 2);
  assert.equal(animations[0].id, 's');
  assert.notEqual(animations[1].id, 's');
  assert.equal(animations[1].animation.children.length, 1);
  assert.equal(animations[1].animation.children[0].elementId, result.elementIds[0]);
  assert.equal(animations[1].trigger.elementId, result.elementIds[0]);
});

test('element deletion prunes empty groups and whole steps whose click target was removed', () => {
  const source = deck([step('mixed', { type: 'sequence', children: [{ type: 'parallel', children: [tween()] }, tween('b')] }),
    step('empty', tween()), step('trigger', tween('b'), { type: 'click', elementId: 'a' })], [element(), element('b')]);
  const result = m.applySlideCommands(source, { type: 'element.delete', slideId: 'page', elementIds: ['a'] }).deck;
  assert.deepEqual(result.slides[0].animations.map(step => step.id), ['mixed']);
  assert.deepEqual(result.slides[0].animations[0].animation.children.map(node => node.elementId), ['b']);
  const empty = m.applySlideCommands(result, { type: 'element.delete', slideId: 'page', elementIds: ['b'] }).deck;
  assert.equal(empty.slides[0].animations, undefined);
});

test('locked animation targets allow unchanged definitions and unrelated edits but reject changed steps', () => {
  const source = deck([step('locked', tween())], [element('a', { locked: true }), element('b')]);
  assert.equal(m.applySlideCommands(source, { type: 'animation.set', slideId: 'page', animations: structuredClone(source.slides[0].animations) }).deck, source);
  const expanded = m.applySlideCommands(source, { type: 'animation.set', slideId: 'page', animations: [step('other', tween('b')), ...source.slides[0].animations] }).deck;
  assert.equal(expanded.slides[0].animations.length, 2);
  assert.doesNotThrow(() => m.applySlideCommands(expanded, { type: 'animation.remove', slideId: 'page', animationId: 'other' }));
  assert.throws(() => m.applySlideCommands(source, { type: 'animation.remove', slideId: 'page', animationId: 'locked' }), /ロック/);
  assert.throws(() => m.applySlideCommands(source, { type: 'animation.set', slideId: 'page', animations: [step('locked', tween('a', { x: 50 }))] }), /ロック/);
  assert.throws(() => m.applySlideCommands(source, { type: 'animation.set', slideId: 'page', animations: [step('locked', tween('b'))] }), /ロック/);
  assert.throws(() => m.applySlideCommands(expanded, { type: 'animation.set', slideId: 'page', animations: [...expanded.slides[0].animations].reverse() }), /ロック/);
});

test('animation history and saved baselines distinguish definitions even when final geometry matches', () => {
  const source = deck([step()]);
  const session = m.createSlideSession(source);
  session.execute({ type: 'animation.set', slideId: 'page', animations: [step('s1', tween('a', { x: 100 }, { easing: 'bounce' }))] });
  assert.equal(session.getSnapshot().dirty, true);
  assert.equal(session.getSnapshot().canUndo, true);
  session.undo();
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(session.getSnapshot().deck, source);
  session.redo();
  assert.equal(session.getSnapshot().deck.slides[0].animations[0].animation.easing, 'bounce');
});

test('deleting an unlocked trigger cannot remove a locked target animation indirectly', () => {
  const source = deck([step('locked', tween('b', { x: 600 }), { type: 'click', elementId: 'a' })],
    [element('a'), element('b', { x: 400, locked: true })]);
  const before = m.serializeSlideDeck(source);
  assert.throws(() => m.applySlideCommands(source, { type: 'animation.remove', slideId: 'page', animationId: 'locked' }), /ロック/);
  assert.throws(() => m.applySlideCommands(source, { type: 'element.delete', slideId: 'page', elementIds: ['a'] }), /ロック/);
  assert.throws(() => m.applySlideCommands(source, [{ type: 'deck.rename', title: 'discard' },
    { type: 'element.delete', slideId: 'page', elementIds: ['a'] }]), /ロック/);
  assert.equal(m.serializeSlideDeck(source), before);
  assert.equal(m.getElement(source, 'page', 'b').x, 600);
  const unlocked = m.applySlideCommands(source, [
    { type: 'element.update', slideId: 'page', elementId: 'b', patch: { locked: false } },
    { type: 'element.delete', slideId: 'page', elementIds: ['a'] },
  ]).deck;
  assert.equal(unlocked.slides[0].animations, undefined);
  assert.equal(unlocked.slides[0].elements[0].x, 400);
});

test('unwrapped rotation endpoints retain the same trajectory across group and step boundaries', () => {
  for (const direction of [1, -1]) {
    const first = tween('a', { rotation: direction * 360 });
    const second = tween('a', { rotation: direction * 720 });
    const grouped = deck([step('group', { type: 'sequence', children: [first, second] })]);
    const separate = deck([step('first', first), step('second', second)]);
    for (const time of [0, 25, 100, 125, 150, 175, 200])
      assert.equal(value(frame(grouped, time), 'rotation'), value(frame(separate, time), 'rotation'), `rotation at ${time}`);
    assert.equal(value(frame(separate, 150), 'rotation'), 180);
    const delayed = deck([step('first', first), step('second', second, { type: 'after-delay', delayMs: 50 })]);
    assert.equal(value(frame(delayed, 125), 'rotation'), 0);
    assert.equal(value(frame(delayed, 200), 'rotation'), 180);
    const clicked = deck([step('first', first), step('second', second, { type: 'click' })]);
    assert.equal(value(frame(clicked, 250, [{ elapsedMs: 200 }]), 'rotation'), 180);
    assert.equal(m.resolveSlideAnimations(separate.slides[0]).elements[0].rotation, 0);
  }
});

test('element duplication cannot indirectly add steps referencing a locked click target', () => {
  const source = deck([step('click', tween('a'), { type: 'click', elementId: 'b' })],
    [element('a'), element('b', { locked: true })]);
  const before = m.serializeSlideDeck(source);
  assert.throws(() => m.applySlideCommands(source, { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] }), /ロック/);
  assert.equal(m.serializeSlideDeck(source), before);
  const unrelated = m.applySlideCommands(source, { type: 'element.add', slideId: 'page', element: { type: 'shape', id: 'c' } }).deck;
  assert.doesNotThrow(() => m.applySlideCommands(unrelated, { type: 'element.duplicate', slideId: 'page', elementIds: ['c'] }));
  const unlocked = m.applySlideCommands(source, [
    { type: 'element.update', slideId: 'page', elementId: 'b', patch: { locked: false } },
    { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] },
  ]).deck;
  assert.equal(unlocked.slides[0].animations.length, 2);
});

test('element duplication offsets explicit animation positions while slide duplication preserves them', () => {
  const source = deck([step('sequence', { type: 'sequence', children: [
    tween('a', { x: 200, y: 300, width: 120, rotation: 90 }, { from: { x: 100, y: 150, width: 100 } }),
    tween('a', { x: 400, opacity: 0.5 }),
  ] })], [element('a', { x: 100, y: 150 })]);
  const result = m.applySlideCommands(source, { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] });
  const copyId = result.elementIds[0], copy = result.deck.slides[0].elements.find(element => element.id === copyId);
  assert.deepEqual([copy.x, copy.y], [120, 170]);
  const [first, second] = result.deck.slides[0].animations[1].animation.children;
  assert.deepEqual(first.from, { x: 120, y: 170, width: 100 });
  assert.deepEqual(first.to, { x: 220, y: 320, width: 120, rotation: 90 });
  assert.deepEqual(second.to, { x: 420, opacity: 0.5 });
  assert.equal(second.from, undefined);
  const final = m.getElement(result.deck, 'page', copyId);
  assert.deepEqual([final.x, final.y, final.width, final.rotation, final.opacity], [420, 320, 120, 90, 0.5]);
  const pageCopy = m.applySlideCommands(source, { type: 'slide.duplicate', slideId: 'page' }).deck.slides[1];
  assert.deepEqual(pageCopy.animations[0].animation.children[0].from, source.slides[0].animations[0].animation.children[0].from);
  assert.deepEqual(pageCopy.animations[0].animation.children[1].to, source.slides[0].animations[0].animation.children[1].to);
  assert.equal(source.slides[0].elements[0].x, 100);
});

test('copying an out-of-range animated position fails the entire command batch', () => {
  for (const animation of [tween('a', { x: 100000 }), tween('a', { y: 1 }, { from: { y: 100000 } })]) {
    const source = deck([step('limit', animation)]);
    const before = m.serializeSlideDeck(source);
    assert.throws(() => m.applySlideCommands(source, [{ type: 'deck.rename', title: 'discard' },
      { type: 'element.duplicate', slideId: 'page', elementIds: ['a'] }]));
    assert.equal(m.serializeSlideDeck(source), before);
    assert.doesNotThrow(() => m.applySlideCommands(source, { type: 'slide.duplicate', slideId: 'page' }));
  }
});
