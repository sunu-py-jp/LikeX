import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ absWorkingDir: root, entryPoints: ['src/model-entry.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createSlideDeck, createSlideElement, applySlideCommands, prepareSlideConditionalEdit, applySlideConditionalEdit, createSlideSession } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const element = (id, patch = {}) => createSlideElement({ type: 'text', id, text: id, ...patch });
const page = (id, elements = []) => ({ id, name: id, notes: '', background: '#fff', elements });
const fixture = () => createSlideDeck({ id: 'deck', title: 'original', slides: [page('one', [element('a'), element('b')]), page('two')],
  masters: [{ id: 'master', name: 'Master', background: '#fff', elements: [] }],
  layouts: [{ id: 'layout', masterId: 'master', name: 'Layout', elements: [], placeholders: [] }] });
const text = (value, patch = {}) => ({ type: 'element.update', slideId: 'one', elementId: 'a', patch: { text: value, ...patch } });

test('conditional patches merge independent properties and report the current conflicting values atomically', () => {
  const before = fixture();
  const edit = prepareSlideConditionalEdit(before, [text('AI text'), { type: 'slide.update', slideId: 'two', patch: { notes: 'AI notes' } }]);
  const live = applySlideCommands(before, [text('a', { color: '#ff0000' }), { type: 'deck.rename', title: 'User title' }]).deck;
  const accepted = applySlideConditionalEdit(live, edit);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.deck.title, 'User title');
  assert.equal(accepted.deck.slides[0].elements[0].text, 'AI text');
  assert.equal(accepted.deck.slides[0].elements[0].color, '#ff0000');
  assert.equal(accepted.deck.slides[1].notes, 'AI notes');
  const changed = applySlideCommands(live, text('User text')).deck;
  const rejected = applySlideConditionalEdit(changed, edit);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'conflict');
  assert.ok(rejected.conflicts.some(item => item.path === 'slides.one.elements.a.text' && item.expected === 'a' && item.actual === 'User text'));
  assert.equal(changed.slides[1].notes, '');
  assert.equal(before.slides[0].elements[0].text, 'a');
});

test('element identity, locks, disappearance and stale no-op values are guarded', () => {
  const before = fixture(), edit = prepareSlideConditionalEdit(before, text('a'));
  for (const command of [text('new'), text('a', { locked: true }), { type: 'element.delete', slideId: 'one', elementIds: ['a'] }]) {
    const changed = applySlideCommands(before, command).deck;
    assert.equal(applySlideConditionalEdit(changed, edit).ok, false);
  }
  const another = createSlideDeck({ ...before, id: 'another' });
  assert.equal(applySlideConditionalEdit(another, edit).ok, false);
  assert.equal(applySlideConditionalEdit(before, edit).changed, false);
});

test('all relationship and structural commands use a conservative atomic document precondition', () => {
  const before = applySlideCommands(fixture(), [
    { type: 'line.add', slideId: 'one', id: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } },
    { type: 'animation.set', slideId: 'one', animations: [{ id: 'anim', animation: { type: 'tween', elementId: 'a', durationMs: 100, to: { opacity: 0 } } }] },
  ]).deck;
  const commands = [
    { type: 'deck.resize', width: 800, height: 600 },
    { type: 'masters.import', library: { width: 1280, height: 720, masters: before.masters, layouts: before.layouts } },
    { type: 'slide.add', slide: { id: 'three' } },
    { type: 'slide.applyLayout', slideId: 'one', layoutId: 'layout' },
    { type: 'slide.detachLayout', slideId: 'one' },
    { type: 'slide.delete', slideId: 'two' },
    { type: 'slide.duplicate', slideId: 'one' },
    { type: 'slide.move', slideId: 'one', index: 1 },
    { type: 'slide.replaceContent', slideId: 'one', elements: [{ type: 'text', text: 'replaced' }] },
    { type: 'animation.set', slideId: 'one', animations: [] },
    { type: 'animation.remove', slideId: 'one', animationId: 'anim' },
    { type: 'line.add', slideId: 'one', start: { x: 0, y: 0 }, end: { x: 200, y: 200 } },
    { type: 'line.update', slideId: 'one', elementId: 'line', start: { x: 20, y: 20 } },
    { type: 'element.add', slideId: 'one', element: { type: 'shape' } },
    { type: 'element.update', slideId: 'one', elementId: 'a', patch: { x: 30 } },
    { type: 'element.delete', slideId: 'one', elementIds: ['a'] },
    { type: 'element.duplicate', slideId: 'one', elementIds: ['a'] },
    { type: 'element.order', slideId: 'one', elementIds: ['a'], direction: 'front' },
  ];
  const changed = applySlideCommands(before, { type: 'slide.update', slideId: 'two', patch: { notes: 'User work' } }).deck;
  for (const command of commands) {
    const edit = prepareSlideConditionalEdit(before, command);
    assert.equal(applySlideConditionalEdit(before, edit).ok, true, command.type);
    assert.equal(applySlideConditionalEdit(changed, edit).ok, false, command.type);
  }
});

test('session tokens detect structural ABA and isolate editor instances while preserving Undo for successful batches', () => {
  const session = createSlideSession(fixture()), other = createSlideSession(fixture());
  const snapshot = session.getMutationSnapshot(), edit = prepareSlideConditionalEdit(snapshot.deck, text('AI'));
  assert.equal(other.executeConditional(edit, snapshot.token).ok, false);
  session.execute({ type: 'slide.move', slideId: 'one', index: 1 });
  session.undo();
  assert.deepEqual(session.getSnapshot().deck, snapshot.deck);
  assert.equal(session.executeConditional(edit, snapshot.token).ok, false);
  const fresh = session.getMutationSnapshot();
  session.execute(text('a', { color: '#123456' }));
  assert.equal(session.executeConditional(edit, fresh.token).ok, true);
  assert.equal(session.getSnapshot().deck.slides[0].elements[0].text, 'AI');
  session.undo();
  assert.equal(session.getSnapshot().deck.slides[0].elements[0].text, 'a');
  assert.equal(session.getSnapshot().deck.slides[0].elements[0].color, '#123456');
  const imported = session.getMutationSnapshot();
  session.replace(imported.deck);
  assert.equal(session.executeConditional(edit, imported.token).ok, false);
});

test('invalid batches never partially apply and prepared command inputs are isolated', () => {
  const before = fixture(), command = text('AI'), edit = prepareSlideConditionalEdit(before, command);
  command.patch.text = 'mutated';
  assert.equal(applySlideConditionalEdit(before, edit).deck.slides[0].elements[0].text, 'AI');
  assert.throws(() => prepareSlideConditionalEdit(before, [text('AI'), { type: 'element.delete', slideId: 'one', elementIds: ['missing'] }]));
  assert.throws(() => applySlideConditionalEdit(before, { before, commands: command }));
  assert.throws(() => applySlideConditionalEdit(before, { before, commands: [text('AI')], conditions: [] }));
  assert.equal(before.slides[0].elements[0].text, 'a');
});

test('whole-deck scope protects reasoning inputs outside the write target', () => {
  const before = fixture();
  const commands = text('Summary based on another page');
  const live = applySlideCommands(before, { type: 'slide.update', slideId: 'two', patch: { notes: 'New evidence' } }).deck;
  assert.equal(applySlideConditionalEdit(live, prepareSlideConditionalEdit(before, commands)).ok, true);
  assert.equal(applySlideConditionalEdit(live, prepareSlideConditionalEdit(before, commands, { scope: 'deck' })).ok, false);
  assert.throws(() => prepareSlideConditionalEdit(before, commands, { scope: 'ignored' }));
});

test('successful structural batches invalidate stale tokens even when their net result is identical', () => {
  const session = createSlideSession(fixture()), snapshot = session.getMutationSnapshot();
  const structural = prepareSlideConditionalEdit(snapshot.deck, [
    { type: 'slide.move', slideId: 'one', index: 1 },
    { type: 'slide.move', slideId: 'one', index: 0 },
  ]);
  const result = session.executeConditional(structural, snapshot.token);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(session.getSnapshot().canUndo, false);
  assert.equal(session.executeConditional(prepareSlideConditionalEdit(snapshot.deck, text('AI')), snapshot.token).ok, false);
  const next = session.getMutationSnapshot();
  assert.equal(session.execute({ type: 'slide.move', slideId: 'one', index: 0 }).changed, false);
  assert.notEqual(session.getMutationSnapshot().token.structureRevision, next.token.structureRevision);
});

test('Undo, Redo, host save baselines and discard invalidate prepared edits even when target values match', () => {
  const check = (prepareBoundary, crossBoundary) => {
    const session = createSlideSession(fixture());
    prepareBoundary(session);
    const snapshot = session.getMutationSnapshot();
    const edit = prepareSlideConditionalEdit(snapshot.deck, text('AI'));
    crossBoundary(session);
    assert.equal(session.getSnapshot().deck.slides[0].elements[0].text, 'a');
    const result = session.executeConditional(edit, snapshot.token);
    assert.equal(result.ok, false);
    assert.equal(result.conflicts[0].path, 'token');
  };
  check(session => session.execute({ type: 'deck.rename', title: 'Changed' }), session => assert.equal(session.undo(), true));
  check(session => { session.execute({ type: 'deck.rename', title: 'Changed' }); session.undo(); }, session => assert.equal(session.redo(), true));
  check(() => {}, session => session.markSaved(session.getSnapshot().deck));
  check(() => {}, session => session.discard());
});
