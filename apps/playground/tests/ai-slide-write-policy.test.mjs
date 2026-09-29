import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = await build({ stdin: { contents: `
  export { checkSlideWrite, checkSlideWriteResult } from './apps/playground/build/ai/slide-write-policy.ts';
  export { canonicalSlideDeck } from './apps/playground/build/ai/slide-snapshot.ts';
  export { SkillWorkspace } from './apps/playground/build/ai/tools.ts';
  export { createDemoSlideDeck } from './apps/playground/src/demo/slide-deck.ts';
  export { parseSlideDeck, serializeSlideDeck, applySlideCommands } from './packages/slide/src/model-entry.ts';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'source-model', setup(builder) {
    builder.onResolve({ filter: /^@likex\/slide(?:\/model)?$/ }, () => ({ path: path.join(root, 'packages/slide/src/model-entry.ts') }));
  } }] });
const { checkSlideWrite, checkSlideWriteResult, canonicalSlideDeck, SkillWorkspace, createDemoSlideDeck,
  parseSlideDeck, serializeSlideDeck, applySlideCommands } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const firstPage = [
  { type: 'slide.replaceContent', slideId: 'cover', elements: [
    { type: 'shape', id: 'stock', x: 1010, y: 302, width: 190, height: 110 },
    { type: 'shape', id: 'ship', x: 760, y: 420, width: 190, height: 110 },
  ] },
  { type: 'line.add', slideId: 'cover', id: 'flow', start: { x: 1105, y: 412, binding: { targetId: 'stock', port: 'bottom' } }, end: { x: 950, y: 475, binding: { targetId: 'ship', port: 'right' } }, strokeWidth: 2, endArrow: 'triangle' },
];
const replacement = (slideId, count) => ({ type: 'slide.replaceContent', slideId,
  elements: Array.from({ length: count }, (_, index) => ({ type: 'text', id: `${slideId}-new-${index}`, text: `Content ${index}`, x: 64, y: 80 + index * 90 })) });
function edit(source, commands) { return serializeSlideDeck(applySlideCommands(parseSlideDeck(source), commands).deck); }
function checkedEdit(source, commands) {
  const before = checkSlideWrite(source, 'apply', commands), result = edit(source, commands);
  checkSlideWriteResult(before, result, 'apply'); return result;
}

test('successive page replacements accept untouched connector-angle normalization and different element counts', () => {
  let source = serializeSlideDeck(createDemoSlideDeck());
  source = checkedEdit(source, [{ type: 'deck.rename', title: 'AWS proposal' }]);
  source = checkedEdit(source, firstPage);
  const previous = JSON.parse(source);
  // Older files can contain noncanonical angles from generated arrowheads.
  // Editing another page must not count harmless normalization as a second edit.
  previous.slides[0].elements[0].rotation = 209.99999999999997;
  source = JSON.stringify(previous);
  const updated = checkedEdit(source, [replacement('milestones', 11)]);
  assert.notDeepEqual(JSON.parse(updated).slides[0], previous.slides[0], 'raw JSON sees the harmless normalization');
  assert.deepEqual(canonicalSlideDeck(updated).slides[0], canonicalSlideDeck(source).slides[0]);
  assert.equal(JSON.parse(updated).slides[1].elements.length, 11);
  const final = checkedEdit(updated, [replacement('images', 3)]);
  assert.equal(JSON.parse(final).slides[2].elements.length, 3);
});

test('native element array order and object key order do not create spurious changes on other pages', () => {
  const initial = JSON.parse(serializeSlideDeck(createDemoSlideDeck()));
  initial.slides = initial.slides.map(page => Object.fromEntries(Object.entries({ ...page, elements: [...page.elements].reverse() }).reverse()));
  const source = JSON.stringify(initial), updated = checkedEdit(source, [replacement('decisions', 2)]);
  assert.deepEqual(canonicalSlideDeck(updated).slides.slice(0, 3), canonicalSlideDeck(source).slides.slice(0, 3));
});

test('semantic postflight still rejects genuine cross-page coordinates, stacking, animations and text changes', () => {
  const source = serializeSlideDeck(createDemoSlideDeck()), deck = parseSlideDeck(source), before = checkSlideWrite(source, 'apply', [replacement('decisions', 2)]);
  const first = deck.slides[0], element = first.elements[0];
  for (const extra of [
    { type: 'element.update', slideId: first.id, elementId: element.id, patch: { x: element.x + 1e-10 } },
    { type: 'element.order', slideId: first.id, elementIds: [element.id], direction: 'front' },
    { type: 'animation.set', slideId: first.id, animations: [] },
    { type: 'slide.update', slideId: first.id, patch: { notes: 'Changed notes' } },
  ]) {
    const commands = [replacement('decisions', 2), extra];
    assert.throws(() => checkSlideWrite(source, 'apply', commands), error => error.details.code === 'slide_page_limit');
    assert.throws(() => checkSlideWriteResult(before, edit(source, commands), 'apply'), error => error.details.code === 'slide_page_limit');
  }
});

test('CLI workspace commits consecutive demo-page replacements after connectors without weakening staging atomicity', async () => {
  const source = serializeSlideDeck(createDemoSlideDeck()), workspace = await SkillWorkspace.create(root, 'slide', source), signal = new AbortController().signal;
  try {
    for (const commands of [[{ type: 'deck.rename', title: 'AWS proposal' }], firstPage, [replacement('milestones', 11)], [replacement('images', 3)]])
      await workspace.invoke('apply_commands', { commands, dryRun: false, resolvesFailureIds: [] }, signal);
    const result = await workspace.result(signal);
    assert.equal(result.changed, true);
    const pages = parseSlideDeck(result.document).slides;
    assert.equal(pages[0].elements.length, 3);
    assert.equal(pages[1].elements.length, 11);
    assert.equal(pages[2].elements.length, 3);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});
