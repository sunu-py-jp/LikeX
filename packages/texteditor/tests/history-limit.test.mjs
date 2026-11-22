import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from './helpers/build.mjs';

// The adapter and the controller are bundled from source, so this covers the same pair the editor uses.
const built = await build({
  stdin: { contents: `export { textEditorAdapter } from './src/state/use-text-editor';
export { createModelEditorController, MODEL_EDITOR_HISTORY_LIMITS } from './src/core';
export { createTextEditorModel } from './src/model/index';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [
    { name: 'core-source', setup(builder) { builder.onResolve({ filter: /^@likex\/core(?:\/.*)?$/ }, ({ path }) => ({ path: fileURLToPath(new URL(`../../core/src/${path === '@likex/core' ? 'index' : path.slice('@likex/core/'.length)}.ts`, import.meta.url)) })); } },
    { name: 'react', setup(builder) { builder.onResolve({ filter: /^react$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } },
  ],
});
const { textEditorAdapter: adapter, createModelEditorController, MODEL_EDITOR_HISTORY_LIMITS: limits, createTextEditorModel } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const line = 'abcdefghi\n';
const textOf = length => line.repeat(Math.ceil(length / line.length)).slice(0, length);
const open = length => createModelEditorController(adapter, createTextEditorModel({ text: textOf(length), mode: 'text', title: 'notes.txt' }), { onSave() {} });
// Each edit puts one digit at the start. Without a history group every edit is its own undo step.
const digit = index => String(index % 10);
async function type(controller, count, options) { for (let index = 0; index < count; index++) await controller.execute({ type: 'text.insert', offset: 0, text: digit(index) }, options); }
async function undoAll(controller) { const texts = []; while (await controller.undo()) texts.push(controller.getModel().text); return texts; }
async function redoAll(controller) { let steps = 0; while (await controller.redo()) steps++; return steps; }
const weight = text => adapter.getHistoryWeight({ text });

test('the history weight is two bytes for every UTF-16 unit of the text', () => {
  assert.equal(weight(''), 0); assert.equal(weight('abc'), 6); assert.equal(weight('日本語'), 6); assert.equal(weight('😀'), 4);
  assert.equal(adapter.getHistoryWeight(createTextEditorModel({ text: textOf(1000), title: 'A long title does not count' })), 2000);
});

test('small and mid-sized documents keep 100 undo steps', async () => {
  for (const length of [0, 2_000, 300_000]) {
    const c = open(length); await type(c, 130);
    assert.ok(weight(c.getModel().text) * (limits.entries + 1) <= limits.weight);
    const texts = await undoAll(c);
    assert.equal(texts.length, limits.entries); assert.equal(texts.at(-1).length, length + 30); assert.equal(c.getSnapshot().canUndo, false);
    assert.equal(await redoAll(c), limits.entries); assert.equal(c.getModel().text.length, length + 130);
  }
});

test('a large document keeps as many recent undo steps as fit in the budget', async () => {
  const length = 1_000_000, edits = 60, c = open(length); await type(c, edits);
  const final = c.getModel().text; assert.equal(final.length, length + edits);
  const texts = await undoAll(c), steps = texts.length;
  assert.ok(steps < edits && steps > limits.protectedEntries, `kept ${steps} steps`);
  // The newest steps are the ones that stay: each undo removes exactly the latest remaining digit.
  texts.forEach((text, index) => { assert.equal(text.length, final.length - index - 1); assert.equal(text, final.slice(index + 1)); });
  // The current text and the kept steps fit the budget, and the next older step would not have.
  const kept = weight(final) + texts.reduce((total, text) => total + weight(text), 0);
  assert.ok(kept <= limits.weight); assert.ok(kept + weight(texts.at(-1)) - 2 > limits.weight);
  assert.equal(c.getSnapshot().canUndo, false); assert.equal(c.getSnapshot().canRedo, true);
  assert.equal(await redoAll(c), steps); assert.equal(c.getModel().text, final);
  // Trimmed history still accepts new steps and undoes them newest first.
  await c.execute({ type: 'text.replaceRange', from: 0, to: 3, text: 'XYZ' }); assert.equal(await c.undo(), true); assert.equal(c.getModel().text, final);
});

test('typing in one history group stays a single undo step in a large document', async () => {
  const length = 1_000_000, c = open(length); await type(c, 3);
  const before = c.getModel().text; await type(c, 80, { historyGroup: 'typing' });
  assert.equal(c.getModel().text.length, length + 83);
  assert.equal(await c.undo(), true); assert.equal(c.getModel().text, before);
  assert.equal((await undoAll(c)).length, 3); assert.equal(c.getModel().text.length, length);
});

test('a document near the size limit still keeps the latest undo steps', async () => {
  const length = 6_000_000, c = open(length);
  assert.ok(weight(c.getModel().text) * (limits.protectedEntries + 1) > limits.weight);
  await type(c, 8);
  const final = c.getModel().text, texts = await undoAll(c);
  assert.equal(texts.length, limits.protectedEntries); assert.equal(texts.at(-1).length, length + 8 - limits.protectedEntries);
  assert.equal(await redoAll(c), limits.protectedEntries); assert.equal(c.getModel().text, final);
});

test('discard and refresh clear the history of a large document', async () => {
  const length = 1_000_000, c = createModelEditorController(adapter, createTextEditorModel({ text: textOf(length), mode: 'text' }), { onSave() {}, onRefresh: () => createTextEditorModel({ text: 'short', mode: 'text' }) });
  await type(c, 40); assert.equal(c.discard(), true); assert.equal(c.getModel().text.length, length); assert.equal(c.getSnapshot().canUndo, false); assert.equal(c.getSnapshot().dirty, false);
  await type(c, 40); assert.equal(await c.refresh({ discardChanges: true }), true); assert.equal(c.getModel().text, 'short'); assert.equal(c.getSnapshot().canUndo, false);
  // The short document after the refresh has the full step count again.
  await type(c, 130); assert.equal((await undoAll(c)).length, limits.entries);
});
