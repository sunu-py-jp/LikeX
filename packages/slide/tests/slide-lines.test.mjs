import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ stdin: { contents: `export * from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const shape = (id, options = {}) => m.createSlideElement({ type: 'shape', id, shape: 'rect', x: 100, y: 100, width: 100, height: 80, ...options });
const page = (id, elements) => ({ id, name: id, background: '#fff', notes: '', elements });
const initial = () => m.createSlideDeck({ slides: [page('s', [shape('a'), shape('b', { x: 500, y: 300 })]), page('other', [shape('outside')])] });
const apply = (deck, ...commands) => m.applySlideCommands(deck, commands).deck;
const item = (deck, id = 'line') => deck.slides[0].elements.find(element => element.id === id);
const bound = (targetId, port) => ({ x: 0, y: 0, binding: { targetId, port } });
const add = (patch = {}) => ({ type: 'line.add', slideId: 's', id: 'line', start: bound('a', 'right'), end: bound('b', 'topLeft'), ...patch });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`);

test('two-point line commands support all directions, horizontal/vertical and point geometry without block-arrow changes', () => {
  for (const [start, end] of [[{x:30,y:30},{x:10,y:10}], [{x:10,y:20},{x:50,y:20}], [{x:10,y:20},{x:10,y:50}], [{x:10,y:20},{x:10,y:20}]]) {
    const result = apply(initial(), add({ start, end })), line = item(result);
    assert.deepEqual(line.line, { start, end }); assert.equal(line.rotation, 0);
    assert.ok(line.width >= 1 && line.height >= 1);
    assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(result)), result);
  }
  const arrow = shape('arrow', { shape: 'arrow' });
  assert.equal(m.isSlideLine(arrow), false); assert.equal(arrow.line, undefined);
  assert.throws(() => m.getSlideLineEndpoints(arrow), /線/);
});

test('binding follows target move, resize and rotation, keeping IDs, formatting and undo atomic', () => {
  const original = apply(initial(), add()), session = m.createSlideSession(original);
  assert.deepEqual(item(original).line.start, { x: 200, y: 140, binding: { targetId: 'a', port: 'right' } });
  session.execute([{ type: 'element.update', slideId: 's', elementId: 'a', patch: { x: 200, width: 200, height: 100, rotation: 90 } },
    { type: 'element.update', slideId: 's', elementId: 'b', patch: { y: 400 } }]);
  const updated = session.getSnapshot().deck;
  assert.deepEqual(item(updated).line.start, { x: 300, y: 250, binding: { targetId: 'a', port: 'right' } });
  assert.deepEqual(item(updated).line.end, { x: 500, y: 400, binding: { targetId: 'b', port: 'topLeft' } });
  assert.equal(session.undo(), true); assert.deepEqual(session.getSnapshot().deck, original);
  assert.equal(session.redo(), true); assert.deepEqual(session.getSnapshot().deck, updated);
});

test('binding uses actual ellipse, diamond, triangle and rounded-rectangle outlines', () => {
  for (const kind of ['ellipse', 'diamond', 'triangle', 'roundRect']) {
    let deck = m.createSlideDeck({ slides: [page('s', [shape('a', { shape: kind })])] });
    deck = apply(deck, add({ end: { x: 400, y: 200 }, start: bound('a', 'topRight') }));
    const point = item(deck).line.start;
    assert.ok(point.x > 150 && point.x <= 200); assert.ok(point.y >= 100 && point.y < 140);
    assert.ok(point.x !== 200 || point.y !== 100, `${kind} corner must be on outline, not outside the shape`);
  }
});

test('endpoint updates detach only the replaced endpoint and keep other attachments live', () => {
  const original = apply(initial(), add());
  const updated = apply(original, { type: 'line.update', slideId: 's', elementId: 'line', start: { x: 1, y: 2 } },
    { type: 'element.update', slideId: 's', elementId: 'a', patch: { x: 900 } },
    { type: 'element.update', slideId: 's', elementId: 'b', patch: { y: 500 } });
  assert.deepEqual(item(updated).line.start, { x: 1, y: 2 });
  assert.equal(item(updated).line.end.y, 500); assert.equal(item(updated).line.end.binding.targetId, 'b');
});

test('target deletion detaches at current coordinates and line duplication only remaps copied targets', () => {
  const original = apply(initial(), add()), saved = item(original).line.start;
  const removed = apply(original, { type: 'element.delete', slideId: 's', elementIds: ['a'] });
  assert.deepEqual(item(removed).line.start, { x: saved.x, y: saved.y });
  assert.equal(item(removed).line.end.binding.targetId, 'b');
  const alone = m.applySlideCommands(original, { type: 'element.duplicate', slideId: 's', elementIds: ['line'] });
  const copy = item(alone.deck, alone.elementIds[0]);
  assert.deepEqual(copy.line.start, { x: saved.x + 20, y: saved.y + 20 }); assert.equal(copy.line.end.binding, undefined);
  const together = m.applySlideCommands(original, { type: 'element.duplicate', slideId: 's', elementIds: ['a', 'line'] });
  const copiedLine = together.deck.slides[0].elements.find(element => together.elementIds.includes(element.id) && m.isSlideLine(element));
  assert.notEqual(copiedLine.line.start.binding.targetId, 'a'); assert.equal(copiedLine.line.end.binding, undefined);
  const duplicated = m.applySlideCommands(original, { type: 'slide.duplicate', slideId: 's' });
  const page = duplicated.deck.slides.find(slide => slide.id === duplicated.slideId);
  for (const point of Object.values(page.elements.find(m.isSlideLine).line)) assert.ok(page.elements.some(element => element.id === point.binding.targetId));
});

test('moving a line body detaches it while targets remain unmoved; style-only changes retain bindings', () => {
  const original = apply(initial(), add());
  const styled = apply(original, { type: 'element.update', slideId: 's', elementId: 'line', patch: { stroke: '#00ff00', strokeWidth: 5 } });
  assert.deepEqual(item(styled).line, item(original).line);
  const moved = apply(original, { type: 'element.update', slideId: 's', elementId: 'line', patch: { x: item(original).x + 20, y: item(original).y + 30 } });
  assert.deepEqual(item(moved).line.start, { x: item(original).line.start.x + 20, y: item(original).line.start.y + 30 });
  assert.deepEqual(item(moved, 'a'), item(original, 'a'));
});

test('line endpoint equality is idempotent and legacy line rendering is preserved until first edit', () => {
  const legacy = shape('legacy', { shape: 'line', x: 30, y: 40, width: 200, height: 4, rotation: 90, strokeWidth: 2 });
  const endpoints = m.getSlideLineEndpoints(legacy);
  near(endpoints.start.x, 131); near(endpoints.start.y, -57);
  const source = m.createSlideDeck({ slides: [page('s', [legacy])] });
  assert.equal(source.slides[0].elements[0].line, undefined);
  const changed = m.applySlideCommands(source, { type: 'line.update', slideId: 's', elementId: 'legacy', end: endpoints.end });
  assert.deepEqual(m.getSlideLineEndpoints(item(changed.deck, 'legacy')), endpoints);
  const repeated = m.applySlideCommands(changed.deck, { type: 'line.update', slideId: 's', elementId: 'legacy', start: endpoints.start, end: endpoints.end });
  assert.equal(repeated.changed, false);
});

test('invalid targets, self/line connections, malformed endpoints and locks reject atomically', () => {
  const original = apply(initial(), add()), json = m.serializeSlideDeck(original);
  for (const invalid of [
    { start: bound('outside', 'top') }, { start: bound('line', 'top') }, { start: bound('missing', 'top') },
    { start: { x: NaN, y: 0 } }, { start: bound('a', 'bad') }, { start: { x: 1, y: 2, unexpected: true } }, {},
  ]) assert.throws(() => apply(original, { type: 'element.update', slideId: 's', elementId: 'a', patch: { x: 20 } }, { type: 'line.update', slideId: 's', elementId: 'line', ...invalid }));
  assert.equal(m.serializeSlideDeck(original), json);
  const locked = apply(original, { type: 'element.update', slideId: 's', elementId: 'line', patch: { locked: true } });
  assert.throws(() => apply(locked, { type: 'line.update', slideId: 's', elementId: 'line', start: { x: 1, y: 1 } }), /ロック/);
  assert.throws(() => apply(original, { type: 'element.update', slideId: 's', elementId: 'a', patch: { line: item(original).line } }), /線/);
});

test('arrowhead-only edits preserve endpoints, stay line-specific and remove superseded connector API', () => {
  const original = apply(initial(), add());
  for (const marker of ['none','triangle','openArrow','diamond','oval','stealth']) {
    const edited = apply(original, { type: 'line.update', slideId: 's', elementId: 'line', startArrow: marker, endArrow: marker });
    assert.equal(item(edited).startArrow, marker); assert.deepEqual(item(edited).line, item(original).line);
    assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(edited)), edited);
  }
  assert.throws(() => apply(original, { type: 'line.update', slideId: 's', elementId: 'line', endArrow: 'unknown' }));
  assert.throws(() => apply(original, { type: 'element.update', slideId: 's', elementId: 'a', patch: { endArrow: 'triangle' } }), /線/);
  assert.throws(() => apply(original, { type: 'element.connect', slideId: 's', sourceId: 'a', targetId: 'b' }));
  assert.equal(m.createSlideConnector, undefined);
  const left = shape('left', { shape: 'leftArrow' }); assert.equal(m.isSlideLine(left), false); assert.equal(left.line, undefined);
});

test('animated targets keep lines attached, and standalone line translation animates both endpoints', () => {
  const original = apply(initial(), add());
  const animated = apply(original, { type: 'animation.set', slideId: 's', animations: [{ id: 'move', animation: { type: 'tween', elementId: 'a', durationMs: 100, to: { x: 300 } } }] });
  const frame = m.evaluateSlideAnimations(animated.slides[0], { elapsedMs: 50 }).slide;
  near(frame.elements.find(element => element.id === 'line').line.start.x, 300);
  const free = apply(original, { type: 'line.update', slideId: 's', elementId: 'line', start: { x: 10, y: 20 }, end: { x: 50, y: 80 } },
    { type: 'animation.set', slideId: 's', animations: [{ id: 'move', animation: { type: 'tween', elementId: 'line', durationMs: 100, to: { x: 110 } } }] });
  const moved = m.evaluateSlideAnimations(free.slides[0], { elapsedMs: 50 }).slide.elements.find(element => element.id === 'line');
  near(moved.line.start.x, 60); near(moved.line.end.x, 100);
});


test('elbow routes stay orthogonal and follow connected target moves, size and rotation with undo/native persistence', () => {
  const session = m.createSlideSession(initial());
  session.execute(add({ routing: 'elbow', end: bound('b', 'left'), endArrow: 'triangle' }));
  const route = deck => m.getSlideLineRoute(item(deck), deck.slides[0].elements);
  const orthogonal = value => { assert.ok(value.points.length >= 2); for (let i = 1; i < value.points.length; i++) assert.ok(Math.abs(value.points[i].x-value.points[i-1].x)<1e-7 || Math.abs(value.points[i].y-value.points[i-1].y)<1e-7); };
  const before = session.getSnapshot().deck, first = route(before); orthogonal(first);
  assert.equal(item(before).routing, 'elbow');
  assert.deepEqual(m.parseSlideDeck(m.serializeSlideDeck(before)), before);
  session.execute({ type: 'element.update', slideId: 's', elementId: 'b', patch: { x: 180, y: 80, width: 200, height: 180, rotation: 45 } });
  const after = session.getSnapshot().deck, next = route(after); orthogonal(next); assert.notDeepEqual(next.points, first.points);
  assert.deepEqual(item(after).line.end.binding, { targetId: 'b', port: 'left' });
  near(item(after).x, next.bounds.x); near(item(after).y, next.bounds.y); near(item(after).width, Math.max(1,next.bounds.width)); near(item(after).height, Math.max(1,next.bounds.height));
  session.undo(); assert.deepEqual(route(session.getSnapshot().deck), first);
  session.redo(); assert.deepEqual(route(session.getSnapshot().deck), next);
  session.execute({ type: 'line.update', slideId: 's', elementId: 'line', routing: 'straight' });
  assert.equal(route(session.getSnapshot().deck).points.length, 2);
});

test('elbow route validation is atomic and unrelated block arrows cannot receive routing', () => {
  const before = apply(initial(), add({ routing: 'elbow' })), snapshot = m.serializeSlideDeck(before);
  for (const command of [{ type:'line.update',slideId:'s',elementId:'line',routing:'curve' }, {type:'element.update',slideId:'s',elementId:'a',patch:{routing:'elbow'}}])
    assert.throws(() => apply(before, {type:'deck.rename',title:'Partial'}, command));
  assert.equal(m.serializeSlideDeck(before), snapshot);
  const changed = apply(before, {type:'element.update',slideId:'s',elementId:'line',patch:{shape:'bentArrow'}});
  assert.equal(item(changed).routing, undefined); assert.equal(item(changed).line, undefined);
});
